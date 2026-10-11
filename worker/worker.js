// Worker de Cloudflare v2: cada tag lleva su PROPIO token y ese token solo abre SU juego.
// Aunque alguien cambie la ruta de la petición, el juego lo decide el token, no la URL.
//
// Necesita:
//   - Binding R2:  ROMS
//   - Secreto:     TOKENS          JSON {"token1":"esmeralda.gba","token2":"rojofuego.gba"}
//                                  (lo genera tools/generar-tokens.mjs)
//   - Variable:    ALLOWED_ORIGIN  (ej. https://mozeu.github.io)
//   - Secreto OPCIONAL: TOKEN      modo antiguo (un token global + nombre de archivo en la ruta).
//                                  Sirve solo mientras migras tus tags. Cuando termines:
//                                  npx wrangler secret delete TOKEN

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
const MIN_TOKEN = 16;   // rechaza tokens cortos o vacíos por error de configuración

// Comparación en tiempo constante, sin depender de APIs propias de Cloudflare.
function safeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

// TOKENS -> lista de [token, archivo]. Si el JSON está mal, no autoriza a nadie.
function parseTokens(raw) {
  try {
    const out = [];
    for (const [t, file] of Object.entries(JSON.parse(raw || "{}"))) {
      if (t.length >= MIN_TOKEN && typeof file === "string" && SAFE_NAME.test(file)) {
        out.push([t, file]);
      }
    }
    return out;
  } catch {
    return [];
  }
}

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };
    const reply = (body, status) => new Response(body, { status, headers: cors });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET") return reply("Método no permitido", 405);

    const auth = request.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

    // 1) Modo nuevo: el token decide el archivo. La ruta de la petición se ignora.
    let key = null;
    for (const [t, file] of parseTokens(env.TOKENS)) {
      if (safeEqual(token, t)) key = file;   // sin "break": el tiempo no depende de cuál acierta
    }

    // 2) Modo antiguo (solo si TOKEN sigue configurado): token global + nombre en la ruta.
    if (key === null && env.TOKEN && env.TOKEN.length >= MIN_TOKEN && safeEqual(token, env.TOKEN)) {
      let name = "";
      try { name = decodeURIComponent(new URL(request.url).pathname.slice(1)); } catch {}
      if (!SAFE_NAME.test(name)) return reply("Nombre no válido", 400);
      key = name;
    }

    if (key === null) return reply("No autorizado", 401);

    const obj = await env.ROMS.get(key);
    if (!obj) return reply("No existe", 404);

    return new Response(obj.body, {
      headers: {
        ...cors,
        "Content-Type": "application/octet-stream",
        "Content-Length": String(obj.size),
        "Cache-Control": "no-store",
      },
    });
  },
};