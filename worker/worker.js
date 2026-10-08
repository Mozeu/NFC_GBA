// Worker de Cloudflare: sirve ROMs desde un bucket R2 privado.
// Necesita:
//   - Binding R2:  ROMS            (tu bucket)
//   - Secreto:     TOKEN           (el token que va en el tag NFC)
//   - Variable:    ALLOWED_ORIGIN  (ej. https://tuusuario.github.io)

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

function safeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  return crypto.subtle.timingSafeEqual(x, y);
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

    // Comprobar el token
    const auth = request.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!env.TOKEN || !safeEqual(token, env.TOKEN)) return reply("No autorizado", 401);

    // Nombre de archivo (solo letras, números, punto, guion)
    const key = decodeURIComponent(new URL(request.url).pathname.slice(1));
    if (!SAFE_NAME.test(key)) return reply("Nombre no válido", 400);

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
