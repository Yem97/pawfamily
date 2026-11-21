import { createHash } from "node:crypto";

export class HttpError extends Error {
  constructor(status, message, fields) { super(message); this.status = status; this.fields = fields; }
}

const BASE_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
};

export function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...extraHeaders } });
}
export const ok = (data = {}, headers) => json(200, { ok: true, ...data }, headers);
export const fail = (status, error, fields) => json(status, { ok: false, error, ...(fields ? { fields } : {}) });

/** Parse a JSON body with a hard size cap. */
export async function readJson(req, maxBytes = 64 * 1024) {
  const type = req.headers.get("content-type") || "";
  if (!type.includes("application/json")) throw new HttpError(415, "Send the request as JSON.");
  const text = await req.text();
  if (Buffer.byteLength(text) > maxBytes) throw new HttpError(413, "That request is too large.");
  try {
    const value = JSON.parse(text || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value;
  } catch { throw new HttpError(400, "The request could not be read."); }
}

/** Salted hash of the client's IP: used only for rate limiting, never stored raw. */
export function clientKey(req, context) {
  const ip = context?.ip || req.headers.get("x-nf-client-connection-ip")
    || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "local";
  return createHash("sha256").update((process.env.SESSION_SECRET || "pawfamily") + "|" + ip).digest("hex").slice(0, 32);
}

export const nowIso = () => new Date().toISOString();
