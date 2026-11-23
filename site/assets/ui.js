// Shared helpers for the public site and the owner dashboard. No dependencies.

/** Escape any value for safe insertion into HTML text or attribute values. */
export const esc = v => String(v ?? "").replace(/[&<>"'`]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const LABELS = {
  species: { cat: "Cat", dog: "Dog", rabbit: "Rabbit", other: "Other" },
  speciesPlural: { cat: "Cats", dog: "Dogs", rabbit: "Rabbits", other: "Other pets" },
  sex: { female: "Female", male: "Male", unknown: "Sex unknown" },
  age: { baby: "Baby", young: "Young", adult: "Adult", senior: "Senior" },
  ageHelp: { baby: "Under 6 months", young: "6 months – 2 years", adult: "2 – 8 years", senior: "8 years +" },
  status: { available: "Available", reserved: "Reserved", adopted: "Adopted", hidden: "Hidden" },
  traits: { "good-with-cats": "Good with cats", "good-with-dogs": "Good with dogs", "good-with-children": "Good with children", "indoor-only": "Indoor only",
    "needs-garden": "Needs a garden", shy: "Shy at first", playful: "Playful", "lap-cat": "Loves a lap", "pair-bonded": "Must go with a friend", "special-needs": "Special needs" },
  health: { "vet-checked": "Vet health check", vaccinated: "Vaccinated", microchipped: "Microchipped", neutered: "Neutered / spayed", "flea-wormed": "Flea and worm treated" },
  appStatus: { new: "New", reviewing: "Reviewing", "home-check": "Home check", approved: "Approved", adopted: "Adopted", declined: "Declined" },
  topic: { general: "General question", adopting: "Adopting", fostering: "Fostering", volunteering: "Volunteering", rehoming: "Rehoming my pet" },
  homeType: { house: "House", flat: "Flat / apartment", bungalow: "Bungalow", other: "Other" },
  outdoor: { "private-garden": "Private garden", "shared-garden": "Shared garden", balcony: "Balcony only", none: "No outdoor space" },
};

export function money(amount, currency = "£") {
  if (amount === null || amount === undefined || amount === "") return "";
  const n = Number(amount);
  return currency + (Number.isInteger(n) ? n.toLocaleString("en-GB") : n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
}
export function feeFor(animal, settings) {
  const fee = animal?.fee ?? settings.defaultFee;
  return fee === null || fee === undefined ? null : money(fee, settings.currency);
}
export function ageText(a) {
  if (a.birthDate) {
    const months = Math.max(0, Math.floor((Date.now() - Date.parse(a.birthDate)) / (30.44 * 864e5)));
    if (months < 1) return "Under 1 month";
    if (months < 24) return `${months} month${months === 1 ? "" : "s"}`;
    return `${Math.floor(months / 12)} years`;
  }
  return LABELS.age[a.ageGroup] || "";
}
export const fmtDate = (iso, long) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: long ? "long" : "short", year: "numeric" });
export const fmtDateTime = iso => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const imgUrl = (id, thumb = false) => `/api/images/${encodeURIComponent(id)}${thumb ? "/thumb" : ""}`;
/** True when the phone layout is active (matches the CSS breakpoint). */
export const isPhone = () => matchMedia("(max-width: 760px)").matches;

export const LOGO = `<svg class="mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path fill="#1e1d20" d="M24 42.5S6.5 32 4.4 20.6C3 12.9 8.2 6.5 15 6.5c3.9 0 6.9 2 9 5 2.1-3 5.1-5 9-5 6.8 0 12 6.4 10.6 14.1C41.5 32 24 42.5 24 42.5z"/><g fill="#e9bcb9"><ellipse cx="24" cy="27.5" rx="5.6" ry="4.6"/><circle cx="16.6" cy="21" r="2.4"/><circle cx="20.6" cy="17" r="2.4"/><circle cx="27.4" cy="17" r="2.4"/><circle cx="31.4" cy="21" r="2.4"/></g></svg>`;
export const PAW = `<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><g fill="currentColor"><ellipse cx="24" cy="30" rx="9" ry="7.5"/><circle cx="12.5" cy="20" r="4"/><circle cx="19" cy="13" r="4"/><circle cx="29" cy="13" r="4"/><circle cx="35.5" cy="20" r="4"/></g></svg>`;

/** Photo block with graceful empty and error states. */
export function photo(id, alt, { cls = "", pill = "", eager = false, thumb = false } = {}) {
  const inner = id
    ? `<img src="${imgUrl(id, thumb)}" alt="${esc(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" data-fallback>`
    : `<div class="ph-empty">${PAW}</div>`;
  return `<div class="ph ${cls} ${id ? "" : "ph-empty"}">${pill}${inner}</div>`;
}
// Swap broken images for the paw placeholder (no inline handlers: CSP-safe).
document.addEventListener("error", e => {
  const img = e.target;
  if (img instanceof HTMLImageElement && img.hasAttribute("data-fallback")) {
    const box = img.parentElement; img.remove(); box.classList.add("ph-empty");
    box.insertAdjacentHTML("beforeend", `<div class="ph-empty">${PAW}</div>`);
  }
}, true);

let toastTimer;
export function toast(message, { error = false } = {}) {
  let t = $("#toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; t.setAttribute("role", "status"); t.setAttribute("aria-live", "polite"); document.body.append(t); }
  t.textContent = message; t.classList.toggle("error", error); t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3600);
}

/** JSON fetch with consistent error objects: throws { status, message, fields }. */
export async function api(path, { method = "GET", body, admin = false } = {}) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (admin) headers["x-requested-with"] = "pawfamily";
  let res;
  try { res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin" }); }
  catch { throw { status: 0, message: "You appear to be offline. Check your connection and try again." }; }
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok || data.ok === false) throw { status: res.status, message: data.error || `Something went wrong (error ${res.status}).`, fields: data.fields || {} };
  return data;
}

/* ---------- Form helpers ---------- */
export function showFieldErrors(form, fields = {}) {
  $$("[aria-invalid]", form).forEach(el => el.removeAttribute("aria-invalid"));
  $$(".err", form).forEach(el => { el.textContent = ""; });
  let first = null;
  for (const [name, msg] of Object.entries(fields)) {
    const input = form.elements[name];
    const el = input instanceof RadioNodeList ? input[0] : input;
    const err = $(`#err-${CSS.escape(form.id)}-${CSS.escape(name)}`, form);
    if (el) { el.setAttribute("aria-invalid", "true"); first ||= el; }
    if (err) err.textContent = msg;
  }
  first?.focus();
  return Boolean(first);
}
export function formError(form, message) {
  let box = $(".form-error", form);
  if (!message) { box?.remove(); return; }
  if (!box) { box = document.createElement("div"); box.className = "form-error"; box.setAttribute("role", "alert"); form.prepend(box); }
  box.textContent = message;
  box.scrollIntoView({ block: "center", behavior: "smooth" });
}
export function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || "Saving…"; btn.setAttribute("aria-busy", "true"); btn.disabled = true; }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.removeAttribute("aria-busy"); btn.disabled = false; }
}
/** Field markup with an error slot wired to aria-describedby. */
export function field(formId, name, label, control, { hint = "", optional = false } = {}) {
  const errId = `err-${formId}-${name}`, hintId = hint ? `hint-${formId}-${name}` : "";
  const described = [hintId, errId].filter(Boolean).join(" ");
  return `<div class="field"><label for="${formId}-${name}">${esc(label)}${optional ? ' <span class="opt">(optional)</span>' : ""}</label>
    ${control.replace("<CONTROL", `id="${formId}-${name}" name="${name}" aria-describedby="${described}"`)}
    ${hint ? `<span class="hint" id="${hintId}">${esc(hint)}</span>` : ""}<span class="err" id="${errId}"></span></div>`;
}

/** Client-side mirror of the server rules (the server re-checks everything). */
export const check = {
  required: (v, label) => (String(v).trim() ? "" : `${label} is required.`),
  email: v => (/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(String(v).trim()) ? "" : "Enter an email address like name@example.com."),
  phone: v => (!String(v).trim() || /^[0-9+()\-.\s]{6,30}$/.test(String(v).trim()) ? "" : "Enter a phone number using digits, spaces and +."),
  min: (v, n, label) => (String(v).trim().length >= n ? "" : `${label} needs at least ${n} characters.`),
};

/** Resize an image file in the browser to a JPEG data URL (max edge `max` px). */
export async function resizeImage(file, max = 1600, quality = 0.82) {
  if (!file.type.startsWith("image/")) throw new Error("That file isn't a photo.");
  let source;
  try { source = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch {
    source = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This photo format can't be read here. Try a JPG or PNG.")); };
      img.src = url;
    });
  }
  const w = source.width, h = source.height, scale = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
  const g = canvas.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}
