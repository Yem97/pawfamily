// Local development server: serves site/ and runs the real API handler against a file store.
// Usage: npm run dev   (env: PORT, PAWFAMILY_DATA_DIR, ADMIN_EMAIL, ADMIN_PASSWORD_HASH, SESSION_SECRET)
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.PAWFAMILY_DATA_DIR ||= path.join(root, ".data");
const { default: api } = await import("../netlify/functions/api.mjs");
const { default: share } = await import("../netlify/functions/share.mjs");
const { default: seo } = await import("../netlify/functions/seo.mjs");

const SITE = path.join(root, "site");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json" };

// Mirror the production security headers from netlify.toml so CSP problems show up locally.
const toml = await fs.readFile(path.join(root, "netlify.toml"), "utf8");
const headers = {};
for (const m of toml.matchAll(/^\s*([A-Za-z-]+)\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/gm)) if (/^[A-Z]/.test(m[1]) && m[1].includes("-")) headers[m[1]] = m[2];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    const fn = url.pathname.startsWith("/api/") ? api
      : /^\/adopt\/[a-z0-9-]+\/?$/.test(url.pathname) ? share
      : ["/sitemap.xml", "/robots.txt"].includes(url.pathname) ? seo : null;
    if (fn) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const request = new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
      const response = await fn(request, { ip: req.socket.remoteAddress, params: { slug: url.pathname.split("/")[2] } });
      const out = {}; response.headers.forEach((v, k) => { out[k] = v; });
      res.writeHead(response.status, out);
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    let file = path.normalize(path.join(SITE, decodeURIComponent(url.pathname)));
    if (!file.startsWith(SITE)) { res.writeHead(400).end(); return; }
    let stat = await fs.stat(file).catch(() => null);
    if (stat?.isDirectory()) { file = path.join(file, "index.html"); stat = await fs.stat(file).catch(() => null); }
    if (!stat) file = url.pathname.startsWith("/admin") ? path.join(SITE, "admin/index.html") : path.join(SITE, "index.html"); // SPA fallbacks
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", ...headers });
    res.end(await fs.readFile(file));
  } catch (e) {
    console.error(e); res.writeHead(500).end("Server error");
  }
});
const port = Number(process.env.PORT || 8888);
server.listen(port, () => console.log(`Pawfamily running at http://localhost:${port}  (data: ${process.env.PAWFAMILY_DATA_DIR})`));
