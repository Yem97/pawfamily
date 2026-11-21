// Owner authentication: scrypt password hash from env, HMAC-signed session cookie.
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { HttpError } from "./http.mjs";

const scrypt = promisify(scryptCb);
const COOKIE = "pf_session";
const SESSION_HOURS = 8;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(String(password), Buffer.from(saltB64, "base64"), expected.length,
    { N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return expected.length === key.length && timingSafeEqual(expected, key);
}

export function authConfig() {
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const hash = (process.env.ADMIN_PASSWORD_HASH || "").trim();
  const secret = process.env.SESSION_SECRET || "";
  return { email, hash, secret, configured: Boolean(email && hash.startsWith("scrypt$") && secret.length >= 32) };
}

const b64url = buf => Buffer.from(buf).toString("base64url");
const sign = (payload, secret) => createHmac("sha256", secret).update(payload).digest("base64url");

export function createSessionCookie(req) {
  const { secret } = authConfig();
  const payload = b64url(JSON.stringify({ sub: "owner", exp: Date.now() + SESSION_HOURS * 3600e3, n: b64url(randomBytes(8)) }));
  const value = `${payload}.${sign(payload, secret)}`;
  return `${COOKIE}=${value}; ${cookieAttrs(req)}; Max-Age=${SESSION_HOURS * 3600}`;
}
export const clearSessionCookie = req => `${COOKIE}=; ${cookieAttrs(req)}; Max-Age=0`;
function cookieAttrs(req) {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `Path=/api; HttpOnly; SameSite=Strict${secure}`;
}

export function readSession(req) {
  const { secret, configured } = authConfig();
  if (!configured) return null;
  const raw = (req.headers.get("cookie") || "").split(";").map(c => c.trim()).find(c => c.startsWith(COOKIE + "="));
  if (!raw) return null;
  const [payload, mac] = raw.slice(COOKIE.length + 1).split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.sub === "owner" && data.exp > Date.now() ? data : null;
  } catch { return null; }
}

/** Same-origin check for state-changing requests (defence in depth on top of SameSite=Strict). */
export function assertSameOrigin(req) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) throw new HttpError(403, "Request blocked: it came from another website.");
}

/** Admin gate: valid session, custom header (forces CORS preflight cross-site), same origin. */
export function requireAdmin(req) {
  if (req.headers.get("x-requested-with") !== "pawfamily") throw new HttpError(403, "Request blocked.");
  assertSameOrigin(req);
  if (!readSession(req)) throw new HttpError(401, "Please sign in again.");
}
