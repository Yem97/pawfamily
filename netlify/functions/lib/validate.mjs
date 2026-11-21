// Small, explicit server-side validators. The browser validates too, but the server never trusts it.
import { HttpError } from "./http.mjs";

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
const clean = v => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();

export const rules = {
  text: (max, { required = false, min = 0, label = "This field" } = {}) => v => {
    const s = clean(v);
    if (required && !s) return [null, `${label} is required.`];
    if (s && s.length < min) return [null, `${label} needs at least ${min} characters.`];
    if (s.length > max) return [null, `${label} must be ${max} characters or fewer.`];
    return [s];
  },
  email: ({ required = true } = {}) => v => {
    const s = clean(v).toLowerCase();
    if (!s) return required ? [null, "Email address is required."] : [""];
    if (s.length > 200 || !EMAIL.test(s)) return [null, "Enter an email address like name@example.com."];
    return [s];
  },
  phone: () => v => {
    const s = clean(v);
    if (!s) return [""];
    if (s.length > 30 || !/^[0-9+()\-.\s]{6,}$/.test(s)) return [null, "Enter a phone number using digits, spaces and +."];
    return [s];
  },
  oneOf: (values, { label = "This field", fallback } = {}) => v => {
    const s = clean(v);
    if (values.includes(s)) return [s];
    if (fallback !== undefined && !s) return [fallback];
    return [null, `Choose a valid option for ${label.toLowerCase()}.`];
  },
  bool: () => v => [v === true || v === "true" || v === "on"],
  money: () => v => {
    if (v === null || v === undefined || v === "") return [null];
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 100000) return [undefined, "Enter an amount between 0 and 100,000."];
    return [Math.round(n * 100) / 100];
  },
  date: () => v => {
    const s = clean(v);
    if (!s) return [""];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) return [undefined, "Enter a valid date."];
    if (Date.parse(s) > Date.now() + 864e5) return [undefined, "The date can't be in the future."];
    return [s];
  },
  url: () => v => {
    const s = clean(v);
    if (!s) return [""];
    try {
      const u = new URL(s);
      if (!["https:", "http:"].includes(u.protocol) || s.length > 300) throw new Error();
      return [u.toString()];
    } catch { return [undefined, "Enter a full web address starting with https://"]; }
  },
  idList: (max) => v => {
    if (!Array.isArray(v)) return [[]];
    const ids = v.map(clean).filter(id => /^[a-z0-9]{8,40}$/.test(id));
    if (ids.length > max) return [undefined, `No more than ${max} photos.`];
    return [[...new Set(ids)]];
  },
  pick: (allowed) => v => [Array.isArray(v) ? [...new Set(v.map(clean).filter(x => allowed.includes(x)))] : []],
};

/** Validate `input` against a schema of rule functions. Throws HttpError(422) with per-field messages. */
export function validate(input, schema) {
  const out = {}, fields = {};
  for (const [key, rule] of Object.entries(schema)) {
    const [value, err] = rule(input?.[key]);
    if (err) fields[key] = err; else out[key] = value;
  }
  if (Object.keys(fields).length) throw new HttpError(422, "Please check the highlighted fields.", fields);
  return out;
}
