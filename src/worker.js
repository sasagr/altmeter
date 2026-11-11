// Password gate for the whole site (Cloudflare Worker in front of static assets).
// Set the password in Cloudflare: Workers & Pages → altmeter → Settings →
// Variables and Secrets → Add → type Secret, name SITE_PASSWORD.
// The cookie holds an HMAC derived from the password, never the password itself;
// changing SITE_PASSWORD logs everyone out.

const COOKIE = 'altmeter_auth';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const PUBLIC = new Set(['/icon.svg', '/manifest.webmanifest']);

const enc = new TextEncoder();
async function token(secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('altmeter-session-v1'));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function readCookie(req, name) {
  const m = (req.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}

const page = (msg = '') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>AltMeter · Sign in</title><link rel="icon" href="/icon.svg" type="image/svg+xml"><meta name="robots" content="noindex">
<style>
:root{--bg:#f6f7f9;--card:#fff;--text:#14181d;--muted:#5d6873;--line:#e1e6ea;--accent:#0f766e;--ink:#fff;--err:#dc2626}
@media (prefers-color-scheme:dark){:root{--bg:#0e1215;--card:#171c21;--text:#e8edf1;--muted:#96a3ae;--line:#2c353d;--accent:#2dd4bf;--ink:#062320;--err:#f87171}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:16px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:16px}
form{width:100%;max-width:340px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px 24px;box-shadow:0 6px 24px rgba(0,0,0,.1)}
img{width:44px;height:44px;display:block;margin-bottom:14px}h1{font-size:20px;margin:0 0 4px}p{color:var(--muted);margin:0 0 18px;font-size:14px}
input{width:100%;height:46px;border:1px solid var(--line);border-radius:10px;padding:0 14px;font:inherit;background:var(--bg);color:var(--text)}
input:focus{outline:2px solid var(--accent);outline-offset:0;border-color:transparent}
button{margin-top:12px;width:100%;height:46px;border:0;border-radius:10px;background:var(--accent);color:var(--ink);font:inherit;font-weight:600;cursor:pointer}
.err{color:var(--err);font-size:14px;margin:10px 0 0}
</style></head><body>
<form method="post" action="/__login">
<img src="/icon.svg" alt=""><h1>AltMeter</h1><p>Enter the password to continue.</p>
<input type="password" name="password" autocomplete="current-password" placeholder="Password" required autofocus aria-label="Password">
${msg ? `<div class="err">${msg}</div>` : ''}
<button type="submit">Sign in</button>
</form></body></html>`;

const html = (body, status = 200, extra = {}) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...extra } });

async function handle(request, env) {
  const next = () => env.ASSETS.fetch(request);
  const url = new URL(request.url);
  const secret = env.SITE_PASSWORD;
  if (!secret) return html('<h1>Not configured</h1><p>Set the SITE_PASSWORD secret in Cloudflare Pages settings and redeploy.</p>', 503);

  const good = await token(secret);

  if (url.pathname === '/__login' && request.method === 'POST') {
    const form = await request.formData();
    const pw = String(form.get('password') || '');
    if (safeEqual(await token(pw), good)) {
      return new Response(null, {
        status: 303,
        headers: { Location: '/', 'Set-Cookie': `${COOKIE}=${good}; Max-Age=${MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax` },
      });
    }
    await new Promise((r) => setTimeout(r, 800)); // slow down guessing
    return html(page('Wrong password.'), 401);
  }

  if (url.pathname === '/__logout') {
    return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax` } });
  }

  if (PUBLIC.has(url.pathname) || safeEqual(readCookie(request, COOKIE) || '', good)) return next();
  return html(page(), 401);
}

export default { fetch: handle };
