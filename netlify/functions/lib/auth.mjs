// Owner authentication.
// Credentials come from one of two places:
//   1. "netlify":   ADMIN_EMAIL + ADMIN_PASSWORD_HASH environment variables (initial setup, and the recovery route)
//   2. "dashboard": set by the owner in Settings > Security, stored hashed in Blobs under auth/credentials
// Dashboard credentials only apply while ADMIN_PASSWORD_HASH is unchanged. Replacing it in Netlify is a full reset.
// Sessions are HMAC-signed cookies carrying a credentials version, so changing the password signs out every other device.
import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { HttpError } from "./http.mjs";

const scrypt = promisify(scryptCb);
const COOKIE = "pf_session";
const SESSION_HOURS = 8;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const CREDENTIALS_KEY = "auth/credentials";

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

function envConfig() {
  return {
    email: (process.env.ADMIN_EMAIL || "").trim().toLowerCase(),
    hash: (process.env.ADMIN_PASSWORD_HASH || "").trim(),
    secret: process.env.SESSION_SECRET || "",
  };
}

/** Resolve the owner's current credentials. `data` is the Blobs/file store. */
export async function getCredentials(data) {
  const env = envConfig();
  if (env.secret.length < 32) return { configured: false };
  const fp = env.hash ? createHash("sha256").update(env.hash).digest("hex").slice(0, 16) : "";
  const stored = await data.getJSON(CREDENTIALS_KEY);
  if (stored && stored.envFingerprint === fp && String(stored.hash).startsWith("scrypt$") && stored.email) {
    return { configured: true, source: "dashboard", email: stored.email, hash: stored.hash, version: `d${stored.version}`, fp, storedVersion: stored.version, updatedAt: stored.updatedAt };
  }
  if (env.email && env.hash.startsWith("scrypt$")) {
    return { configured: true, source: "netlify", email: env.email, hash: env.hash, version: `e${fp}`, fp, storedVersion: stored?.envFingerprint === fp ? stored.version : 0 };
  }
  return { configured: false };
}

const b64url = buf => Buffer.from(buf).toString("base64url");
const sign = payload => createHmac("sha256", envConfig().secret).update(payload).digest("base64url");

export function createSessionCookie(req, version) {
  const payload = b64url(JSON.stringify({ sub: "owner", v: version, exp: Date.now() + SESSION_HOURS * 3600e3, n: b64url(randomBytes(8)) }));
  return `${COOKIE}=${payload}.${sign(payload)}; ${cookieAttrs(req)}; Max-Age=${SESSION_HOURS * 3600}`;
}
export const clearSessionCookie = req => `${COOKIE}=; ${cookieAttrs(req)}; Max-Age=0`;
function cookieAttrs(req) {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `Path=/api; HttpOnly; SameSite=Strict${secure}`;
}

/** Returns the session payload if the cookie is valid, unexpired and matches the current credentials version. */
export function readSession(req, creds) {
  if (!creds?.configured) return null;
  const raw = (req.headers.get("cookie") || "").split(";").map(c => c.trim()).find(c => c.startsWith(COOKIE + "="));
  if (!raw) return null;
  const [payload, mac] = raw.slice(COOKIE.length + 1).split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload)), given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.sub === "owner" && data.exp > Date.now() && data.v === creds.version ? data : null;
  } catch { return null; }
}

/** Same-origin check for state-changing requests (defence in depth on top of SameSite=Strict). */
export function assertSameOrigin(req) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) throw new HttpError(403, "Request blocked: it came from another website.");
}

/** Admin gate: custom header (forces a CORS preflight cross-site), same origin, valid session. */
export function requireAdmin(req, creds) {
  if (req.headers.get("x-requested-with") !== "pawfamily") throw new HttpError(403, "Request blocked.");
  assertSameOrigin(req);
  if (!readSession(req, creds)) throw new HttpError(401, "Please sign in again.");
}
