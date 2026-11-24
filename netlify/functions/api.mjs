// Pawfamily API: one Netlify Function, routed internally. See docs/DESIGN.md §3.
import { randomBytes } from "node:crypto";
import { getStores, listRecords } from "./lib/store.mjs";
import { HttpError, ok, fail, readJson, clientKey, nowIso } from "./lib/http.mjs";
import { getCredentials, hashPassword, verifyPassword, createSessionCookie, clearSessionCookie, readSession, requireAdmin, assertSameOrigin, CREDENTIALS_KEY } from "./lib/auth.mjs";
import { rules as r, validate } from "./lib/validate.mjs";
import { notifyOwner, sendPetAlert, emailConfigured, ownerEmailConfigured } from "./lib/email.mjs";
import { DEFAULT_SETTINGS, getSettings, buildExport, feeOf, speciesWords } from "./lib/site.mjs";
import { createBackup } from "./lib/backup.mjs";

export const config = { path: "/api/*" };

const SPECIES = ["cat", "dog", "rabbit", "other"];
const SEX = ["female", "male", "unknown"];
const AGE = ["baby", "young", "adult", "senior"];
const ANIMAL_STATUS = ["available", "reserved", "adopted", "hidden"];
const TRAITS = ["good-with-cats", "good-with-dogs", "good-with-children", "indoor-only", "needs-garden", "shy", "playful", "lap-cat", "pair-bonded", "special-needs"];
const HEALTH = ["vaccinated", "microchipped", "neutered", "flea-wormed", "vet-checked"];
const APP_STATUS = ["new", "chatting", "reserved", "paid", "delivered", "declined"];
const DOCS = ["contract", "vaccination-record", "microchip", "registration", "health-check"];
const MSG_STATUS = ["new", "replied"];
const MAX_IMAGE = 3 * 1024 * 1024;


const newId = () => randomBytes(12).toString("hex");
const sortKey = () => String(Date.now()).padStart(15, "0"); // time-ordered, storage-safe key prefix
const slugify = (name, id) => `${String(name).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "pet"}-${id.slice(0, 5)}`;

/* ---------------- rate limiting ---------------- */
async function rateLimit(store, scope, key, limit, windowMs) {
  const k = `ratelimit/${scope}/${key}`;
  const now = Date.now();
  let rec = await store.getJSON(k);
  if (!rec || rec.resetAt < now) rec = { count: 0, resetAt: now + windowMs };
  if (rec.count >= limit) {
    const mins = Math.max(1, Math.ceil((rec.resetAt - now) / 60000));
    throw new HttpError(429, `Too many attempts. Please try again in ${mins} minute${mins === 1 ? "" : "s"}.`);
  }
  return { rec, key: k, async hit() { rec.count += 1; await store.setJSON(k, rec); }, async clear() { await store.delete(k); } };
}

/* ---------------- shared loaders ---------------- */
const publicAnimal = a => ({
  id: a.id, slug: a.slug, name: a.name, species: a.species, breed: a.breed, sex: a.sex, ageGroup: a.ageGroup, birthDate: a.birthDate,
  status: a.status, fee: a.fee, reservationFee: a.reservationFee ?? null, mum: a.mum || "", dad: a.dad || "", summary: a.summary, story: a.story, photos: a.photos, traits: a.traits, health: a.health,
  healthNotes: a.healthNotes, featured: a.featured, createdAt: a.createdAt,
});

/* ---------------- schemas ---------------- */
const animalSchema = {
  name: r.text(60, { required: true, label: "Name" }),
  species: r.oneOf(SPECIES, { label: "Species" }),
  breed: r.text(80, { label: "Breed" }),
  sex: r.oneOf(SEX, { label: "Sex" }),
  ageGroup: r.oneOf(AGE, { label: "Age group" }),
  birthDate: r.date(),
  status: r.oneOf(ANIMAL_STATUS, { label: "Status" }),
  fee: r.money(),
  reservationFee: r.money(),
  mum: v => (!v ? [""] : /^[a-f0-9]{24}$/.test(String(v)) ? [String(v)] : [undefined, "Choose a parent from the list."]),
  dad: v => (!v ? [""] : /^[a-f0-9]{24}$/.test(String(v)) ? [String(v)] : [undefined, "Choose a parent from the list."]),
  summary: r.text(180, { label: "Short summary" }),
  story: r.text(5000, { label: "Story" }),
  photos: r.idList(8),
  traits: r.pick(TRAITS),
  health: r.pick(HEALTH),
  healthNotes: r.text(600, { label: "Health notes" }),
  featured: r.bool(),
};
const applicationSchema = {
  animalId: r.text(40),
  intent: r.oneOf(["reserve", "buy"], { label: "Reserve or buy" }),
  sexPreference: r.oneOf(["female", "male", "no-preference"], { label: "Male or female", fallback: "no-preference" }),
  name: r.text(100, { required: true, min: 2, label: "Your name" }),
  email: r.email(),
  phone: r.phone(),
  deliveryArea: r.text(60, { required: true, label: "Town or postcode for delivery" }),
  experience: r.oneOf(["yes", "no"], { label: "Experience with kittens" }),
  experienceDetails: r.text(800, { label: "Your experience" }),
  children: r.oneOf(["no", "yes"], { label: "Children at home" }),
  childrenAges: r.text(100, { label: "Children's ages" }),
  otherPets: r.text(300, { label: "Other pets" }),
  message: r.text(2000, { label: "Your message" }),
  consent: r.bool(),
};
const messageSchema = {
  name: r.text(100, { required: true, min: 2, label: "Your name" }),
  email: r.email(),
  phone: r.phone(),
  topic: r.oneOf(["general", "kittens", "reserving", "delivery", "litters"], { label: "Topic", fallback: "general" }),
  message: r.text(3000, { required: true, min: 10, label: "Your message" }),
};
const storySchema = {
  title: r.text(120, { required: true, label: "Title" }),
  animalName: r.text(60, { label: "Pet's name" }),
  body: r.text(5000, { required: true, min: 20, label: "Story" }),
  photo: v => { const s = String(v || ""); if (!s) return [""]; return /^[a-f0-9]{24}$/.test(s) ? [s] : [undefined, "That photo isn't valid. Upload it again."]; },
  published: r.bool(),
};
const settingsSchema = {
  rescueName: r.text(60, { required: true, label: "Business name" }),
  tagline: r.text(120, { label: "Tagline" }),
  town: r.text(60, { label: "Town" }), region: r.text(60, { label: "Region" }),
  email: r.email({ required: false }), phone: r.phone(),
  facebookUrl: r.url(), instagramUrl: r.url(),
  licenceNumber: r.text(60, { label: "Licence number" }),
  currency: r.text(3, { required: true, label: "Currency symbol" }),
  defaultFee: r.money(),
  defaultReservationFee: r.money(),
  goHomeWeeks: v => { if (v === "" || v === null || v === undefined) return [13]; const n = Number(v); return Number.isInteger(n) && n >= 8 && n <= 20 ? [n] : [undefined, "Enter a number of weeks between 8 and 20."]; },
  feeIncludes: r.text(400, { label: "What the kitten fee includes" }),
  deliveryInfo: r.text(800, { label: "Delivery information" }),
  paymentInfo: r.text(800, { label: "Payment information" }),
  announcement: r.text(160, { label: "Announcement" }),
  aboutText: r.text(5000, { label: "About text" }),
};

/* ---------------- image helpers ---------------- */
function decodeImage(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) throw new HttpError(422, "Upload a JPG, PNG or WebP photo.");
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > MAX_IMAGE) throw new HttpError(413, "That photo is too large (max 3 MB).");
  const sig = bytes.subarray(0, 12);
  const isJpeg = sig[0] === 0xff && sig[1] === 0xd8 && sig[2] === 0xff;
  const isPng = sig.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = sig.subarray(0, 4).toString("ascii") === "RIFF" && sig.subarray(8, 12).toString("ascii") === "WEBP";
  const type = isJpeg ? "image/jpeg" : isPng ? "image/png" : isWebp ? "image/webp" : null;
  if (!type) throw new HttpError(422, "That file isn't a valid photo.");
  return { bytes: new Uint8Array(bytes), type };
}

/** Delete a photo and its thumbnail. */
const deleteImage = (images, id) => Promise.all([images.delete(`img/${id}`), images.delete(`img/${id}-t`)]);

/* ---------------- handlers ---------------- */
async function publicSite({ data }) {
  const [settings, animals, stories, parents, litters] = await Promise.all([getSettings(data), listRecords(data, "animals/"), listRecords(data, "stories/"),
    listRecords(data, "parents/"), listRecords(data, "litters/")]);
  return ok({
    settings,
    parents: parents.map(({ id, name, role, breed, colour, born, about, healthNotes, photo }) => ({ id, name, role, breed, colour, born, about, healthNotes, photo })),
    litters: litters.filter(l => l.published).map(({ id, mum, dad, status, when, details }) => ({ id, mum, dad, status, when, details })),
    animals: animals.filter(a => a.status === "available" || a.status === "reserved").map(publicAnimal),
    stories: stories.filter(s => s.published).map(({ id, title, animalName, body, photo, createdAt }) => ({ id, title, animalName, body, photo, createdAt })),
  }, { "cache-control": "no-cache" }); // always revalidate: owner changes must show on the next page load (req. A4)
}

function honeypot(body) { if (String(body.website || "").trim()) throw new HttpError(422, "Submission rejected."); }

async function submitApplication(req, ctx) {
  assertSameOrigin(req);
  const body = await readJson(req);
  honeypot(body);
  const limiter = await rateLimit(ctx.data, "forms", clientKey(req, ctx.context), 5, 3600e3);
  const v = validate(body, applicationSchema);
  if (!v.consent) throw new HttpError(422, "Please check the highlighted fields.", { consent: "Please confirm we may store your details to reply to your enquiry." });
  if (v.children === "yes" && !v.childrenAges) throw new HttpError(422, "Please check the highlighted fields.", { childrenAges: "Please tell us the children's ages." });
  let animalName = "Any available kitten";
  if (v.animalId && v.animalId !== "any") {
    const a = await ctx.data.getJSON(`animals/${v.animalId}`);
    if (!a || !["available", "reserved"].includes(a.status)) throw new HttpError(422, "That kitten is no longer listed. Please choose another or 'Any available kitten'.", { animalId: "No longer listed." });
    animalName = a.name;
  } else v.animalId = "any";
  const rec = { id: newId(), createdAt: nowIso(), status: "new", notes: "", animalName, ...v };
  await ctx.data.setJSON(`applications/${sortKey()}_${rec.id}`, rec);
  await limiter.hit();
  await notifyOwner(`New enquiry (${v.intent === "reserve" ? "reserve" : "buy now"}): ${animalName}`, [
    ["Kitten", animalName], ["Wants to", v.intent === "reserve" ? "Reserve" : "Buy an available kitten"], ["Male or female", v.sexPreference],
    ["Name", v.name], ["Email", v.email], ["Phone", v.phone], ["Delivery area", v.deliveryArea],
    ["Experience with kittens", v.experience + (v.experienceDetails ? `: ${v.experienceDetails}` : "")], ["Children", v.children + (v.childrenAges ? ` (${v.childrenAges})` : "")],
    ["Other pets", v.otherPets], ["Message", v.message],
  ], v.email);
  return ok({ id: rec.id });
}

async function submitMessage(req, ctx) {
  assertSameOrigin(req);
  const body = await readJson(req);
  honeypot(body);
  const limiter = await rateLimit(ctx.data, "forms", clientKey(req, ctx.context), 5, 3600e3);
  const v = validate(body, messageSchema);
  const rec = { id: newId(), createdAt: nowIso(), status: "new", ...v };
  await ctx.data.setJSON(`messages/${sortKey()}_${rec.id}`, rec);
  await limiter.hit();
  await notifyOwner(`New message (${v.topic}) from ${v.name}`, [["Name", v.name], ["Email", v.email], ["Phone", v.phone], ["Topic", v.topic], ["Message", v.message]], v.email);
  return ok({ id: rec.id });
}

async function getImage(id, { images }, variant) {
  if (!/^[a-f0-9]{24}$/.test(id) || (variant && variant !== "thumb")) return fail(404, "Not found.");
  const img = (variant === "thumb" && await images.getBinary(`img/${id}-t`)) || await images.getBinary(`img/${id}`);
  if (!img) return fail(404, "Not found.");
  return new Response(img.data, { status: 200, headers: {
    "content-type": img.contentType, "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox",
  } });
}

async function login(req, ctx, cfg) {
  assertSameOrigin(req);
  if (!cfg.configured) return fail(503, "Sign-in isn't set up yet. Add ADMIN_EMAIL, ADMIN_PASSWORD_HASH and SESSION_SECRET in Netlify (see docs/SETUP.md).");
  const body = await readJson(req, 4096);
  const limiter = await rateLimit(ctx.data, "login", clientKey(req, ctx.context), 5, 15 * 60e3);
  const email = String(body.email || "").trim().toLowerCase();
  const passwordOk = await verifyPassword(String(body.password || "").slice(0, 200), cfg.hash); // always run: equal timing
  if (email !== cfg.email || !passwordOk) {
    await limiter.hit();
    return fail(401, "That email and password don't match.");
  }
  await limiter.clear();
  return ok({}, { "set-cookie": createSessionCookie(req, cfg.version) });
}

/* Admin CRUD helpers */
async function findByKey(store, prefix, id) {
  const keys = await store.listKeys(prefix);
  return keys.find(k => k === `${prefix}${id}` || k.endsWith(`_${id}`)) || null;
}

async function adminAnimals(req, ctx, id) {
  const { data, images } = ctx;
  if (req.method === "GET" && !id) return ok({ animals: await listRecords(data, "animals/") });
  if (req.method === "POST" && !id) {
    const v = validate(await readJson(req), animalSchema);
    const rid = newId();
    const rec = { id: rid, slug: slugify(v.name, rid), ...v, createdAt: nowIso(), updatedAt: nowIso() };
    await data.setJSON(`animals/${rid}`, rec);
    const alerted = rec.status === "available" ? await alertWaitlist(ctx, rec, new URL(req.url).origin) : 0;
    return ok({ animal: rec, alerted });
  }
  const existing = id && await data.getJSON(`animals/${id}`);
  if (!existing) return fail(404, "That pet wasn't found.");
  if (req.method === "PUT") {
    const v = validate(await readJson(req), animalSchema);
    const slug = v.name === existing.name ? existing.slug : slugify(v.name, existing.id);
    const removed = (existing.photos || []).filter(p => !v.photos.includes(p));
    const rec = { ...existing, ...v, slug, updatedAt: nowIso() };
    await data.setJSON(`animals/${id}`, rec);
    await Promise.all(removed.map(p => deleteImage(images, p)));
    const alerted = rec.status === "available" && existing.status !== "available" ? await alertWaitlist(ctx, rec, new URL(req.url).origin) : 0;
    return ok({ animal: rec, alerted });
  }
  if (req.method === "DELETE") {
    await data.delete(`animals/${id}`);
    await Promise.all((existing.photos || []).map(p => deleteImage(images, p)));
    return ok();
  }
  return fail(405, "Method not allowed.");
}

async function adminImages(req, ctx, id) {
  if (req.method === "POST" && !id) {
    const body = await readJson(req, 5 * 1024 * 1024);
    const { bytes, type } = decodeImage(body.dataUrl);
    const thumb = body.thumbDataUrl ? decodeImage(body.thumbDataUrl) : null; // ~600 px version for cards
    const iid = newId();
    await ctx.images.setBinary(`img/${iid}`, bytes, type);
    if (thumb) await ctx.images.setBinary(`img/${iid}-t`, thumb.bytes, thumb.type);
    return ok({ id: iid, url: `/api/images/${iid}` });
  }
  if (req.method === "DELETE" && /^[a-f0-9]{24}$/.test(id || "")) { await deleteImage(ctx.images, id); return ok(); }
  return fail(405, "Method not allowed.");
}

/** A date that may be in the future (e.g. a planned delivery). */
const dateAny = v => { const s = String(v ?? "").trim(); if (!s) return [""]; return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? [s] : [undefined, "Enter a valid date."]; };

async function adminRecords(req, ctx, id, { prefix, statuses, plural }) {
  const { data } = ctx;
  if (req.method === "GET" && !id) return ok({ [plural]: await listRecords(data, prefix) });
  const key = id && /^[a-f0-9]{24}$/.test(id) ? await findByKey(data, prefix, id) : null;
  const existing = key && await data.getJSON(key);
  if (!existing) return fail(404, "Not found.");
  if (req.method === "PUT") {
    const isEnquiry = prefix === "applications/";
    const v = validate(await readJson(req), { status: r.oneOf(statuses, { label: "Status" }), notes: r.text(3000, { label: "Notes" }),
      ...(isEnquiry ? { agreedFee: r.money(), depositAmount: r.money(), depositDate: r.date(), paidInFullDate: r.date(), deliveryDate: dateAny, docs: r.pick(DOCS) } : {}) });
    const rec = { ...existing, status: v.status, ...(isEnquiry ? { notes: v.notes, agreedFee: v.agreedFee, depositAmount: v.depositAmount, depositDate: v.depositDate,
      paidInFullDate: v.paidInFullDate, deliveryDate: v.deliveryDate, docs: v.docs } : {}), updatedAt: nowIso() };
    await data.setJSON(key, rec);
    return ok({ record: rec });
  }
  if (req.method === "DELETE") { await data.delete(key); return ok(); }
  return fail(405, "Method not allowed.");
}

async function adminStories(req, ctx, id) {
  const { data, images } = ctx;
  if (req.method === "GET" && !id) return ok({ stories: await listRecords(data, "stories/") });
  if (req.method === "POST" && !id) {
    const v = validate(await readJson(req), storySchema);
    const rec = { id: newId(), ...v, createdAt: nowIso(), updatedAt: nowIso() };
    await data.setJSON(`stories/${rec.id}`, rec);
    return ok({ story: rec });
  }
  const existing = id && /^[a-f0-9]{24}$/.test(id) && await data.getJSON(`stories/${id}`);
  if (!existing) return fail(404, "Not found.");
  if (req.method === "PUT") {
    const v = validate(await readJson(req), storySchema);
    if (existing.photo && existing.photo !== v.photo) await deleteImage(images, existing.photo);
    const rec = { ...existing, ...v, updatedAt: nowIso() };
    await data.setJSON(`stories/${id}`, rec);
    return ok({ story: rec });
  }
  if (req.method === "DELETE") {
    await data.delete(`stories/${id}`);
    if (existing.photo) await deleteImage(images, existing.photo);
    return ok();
  }
  return fail(405, "Method not allowed.");
}

async function adminSettings(req, { data }) {
  if (req.method === "GET") return ok({ settings: await getSettings(data) });
  if (req.method === "PUT") {
    const v = validate(await readJson(req), settingsSchema);
    await data.setJSON("settings", v);
    return ok({ settings: { ...DEFAULT_SETTINGS, ...v } });
  }
  return fail(405, "Method not allowed.");
}

async function adminSummary({ data }) {
  const [animals, applications, messages, stories] = await Promise.all(["animals/", "applications/", "messages/", "stories/"].map(p => listRecords(data, p)));
  const waitlistCount = (await data.listKeys("waitlist/")).length;
  const count = (list, s) => list.filter(x => x.status === s).length;
  return ok({
    animals: { total: animals.length, available: count(animals, "available"), reserved: count(animals, "reserved"), adopted: count(animals, "adopted"), hidden: count(animals, "hidden") },
    applications: { total: applications.length, new: count(applications, "new"), open: applications.filter(a => !["delivered", "declined"].includes(a.status)).length,
      reserved: count(applications, "reserved"), paid: count(applications, "paid") },
    messages: { total: messages.length, new: count(messages, "new") },
    stories: { total: stories.length, published: stories.filter(s => s.published).length, pending: stories.filter(s => s.submitted && !s.published).length },
    waitlist: { total: waitlistCount },
    email: { owner: ownerEmailConfigured(), public: emailConfigured() && Boolean(process.env.MAIL_FROM) },
    recentApplications: applications.slice(0, 5),
    recentMessages: messages.slice(0, 5),
  });
}

async function adminExport({ data }) {
  const snapshot = await buildExport(data);
  return ok(snapshot, { "content-disposition": `attachment; filename="pawfamily-backup-${snapshot.exportedAt.slice(0, 10)}.json"` });
}

/* Owner changes their sign-in email and/or password (Settings > Security). */
async function adminSecurity(req, ctx, creds) {
  if (req.method === "GET") return ok({ email: creds.email, source: creds.source, updatedAt: creds.updatedAt || null });
  if (req.method !== "PUT") return fail(405, "Method not allowed.");
  const body = await readJson(req, 4096);
  const limiter = await rateLimit(ctx.data, "security", clientKey(req, ctx.context), 5, 15 * 60e3);
  const currentOk = await verifyPassword(String(body.currentPassword || "").slice(0, 200), creds.hash);
  if (!currentOk) {
    await limiter.hit();
    throw new HttpError(422, "Please check the highlighted fields.", { currentPassword: "That isn't your current password." });
  }
  const v = validate(body, { newEmail: r.email() });
  const newPassword = String(body.newPassword || "");
  const fields = {};
  if (newPassword) {
    if (newPassword.length < 12) fields.newPassword = "Use at least 12 characters.";
    else if (newPassword.length > 200) fields.newPassword = "Use 200 characters or fewer.";
    else if (newPassword === String(body.currentPassword)) fields.newPassword = "Choose a password different from your current one.";
    else if (newPassword !== String(body.confirmPassword || "")) fields.confirmPassword = "The two new passwords don't match.";
  }
  if (Object.keys(fields).length) throw new HttpError(422, "Please check the highlighted fields.", fields);
  if (!newPassword && v.newEmail === creds.email) throw new HttpError(422, "Nothing to change. Enter a new password or a new email.");
  const version = (creds.storedVersion || 0) + 1;
  const rec = { email: v.newEmail, hash: newPassword ? await hashPassword(newPassword) : creds.hash, version, envFingerprint: creds.fp, updatedAt: nowIso() };
  await ctx.data.setJSON(CREDENTIALS_KEY, rec);
  await limiter.clear();
  // Keep this device signed in with the new version; every other session is now invalid.
  return ok({ email: rec.email, passwordChanged: Boolean(newPassword) }, { "set-cookie": createSessionCookie(req, `d${version}`) });
}

/* ---------------- parents & litters ---------------- */
const parentSchema = {
  name: r.text(60, { required: true, label: "Name" }),
  role: r.oneOf(["mum", "dad"], { label: "Mum or dad" }),
  breed: r.text(80, { label: "Breed" }),
  colour: r.text(80, { label: "Colour" }),
  born: r.text(20, { label: "Born" }),
  about: r.text(1500, { label: "About" }),
  healthNotes: r.text(600, { label: "Health" }),
  photo: v => { const s = String(v || ""); if (!s) return [""]; return /^[a-f0-9]{24}$/.test(s) ? [s] : [undefined, "That photo isn't valid. Upload it again."]; },
};
const litterSchema = {
  mum: v => (!v ? [""] : /^[a-f0-9]{24}$/.test(String(v)) ? [String(v)] : [undefined, "Choose a parent from the list."]),
  dad: v => (!v ? [""] : /^[a-f0-9]{24}$/.test(String(v)) ? [String(v)] : [undefined, "Choose a parent from the list."]),
  status: r.oneOf(["planned", "expected", "born", "fully-reserved"], { label: "Status" }),
  when: r.text(60, { required: true, label: "Expected or born" }),
  details: r.text(800, { label: "Details" }),
  published: r.bool(),
};
async function adminCollection(req, { data, images }, id, prefix, schema, plural, photoKey) {
  if (req.method === "GET" && !id) return ok({ [plural]: await listRecords(data, prefix) });
  if (req.method === "POST" && !id) {
    const v = validate(await readJson(req), schema);
    const rec = { id: newId(), ...v, createdAt: nowIso(), updatedAt: nowIso() };
    await data.setJSON(`${prefix}${rec.id}`, rec);
    return ok({ record: rec });
  }
  const existing = id && /^[a-f0-9]{24}$/.test(id) && await data.getJSON(`${prefix}${id}`);
  if (!existing) return fail(404, "Not found.");
  if (req.method === "PUT") {
    const v = validate(await readJson(req), schema);
    if (photoKey && existing[photoKey] && existing[photoKey] !== v[photoKey]) await deleteImage(images, existing[photoKey]);
    const rec = { ...existing, ...v, updatedAt: nowIso() };
    await data.setJSON(`${prefix}${id}`, rec);
    return ok({ record: rec });
  }
  if (req.method === "DELETE") {
    await data.delete(`${prefix}${id}`);
    if (photoKey && existing[photoKey]) await deleteImage(images, existing[photoKey]);
    return ok();
  }
  return fail(405, "Method not allowed.");
}

/* ---------------- waiting list ---------------- */
const waitlistSchema = {
  name: r.text(100, { required: true, min: 2, label: "Your name" }),
  email: r.email(),
  species: r.oneOf(["any", ...SPECIES], { label: "Type of pet", fallback: "any" }),
  sex: r.oneOf(["any", "female", "male"], { label: "Sex", fallback: "any" }),
  ageGroup: r.oneOf(["any", ...AGE], { label: "Age", fallback: "any" }),
  consent: r.bool(),
};
const wantsPet = (w, a) => (w.species === "any" || w.species === a.species) && (w.sex === "any" || w.sex === a.sex) && (w.ageGroup === "any" || w.ageGroup === a.ageGroup);

async function joinWaitlist(req, ctx) {
  assertSameOrigin(req);
  const body = await readJson(req);
  honeypot(body);
  const limiter = await rateLimit(ctx.data, "forms", clientKey(req, ctx.context), 5, 3600e3);
  const v = validate(body, waitlistSchema);
  if (!v.consent) throw new HttpError(422, "Please check the highlighted fields.", { consent: "Please confirm we may email you about matching pets." });
  const all = await listRecords(ctx.data, "waitlist/");
  if (all.some(w => w.email === v.email && w.species === v.species && w.sex === v.sex && w.ageGroup === v.ageGroup)) return ok({ already: true });
  const { consent, ...prefs } = v;
  const rec = { id: newId(), token: randomBytes(16).toString("hex"), createdAt: nowIso(), consentAt: nowIso(), notified: [], ...prefs };
  await ctx.data.setJSON(`waitlist/${sortKey()}_${rec.id}`, rec);
  await limiter.hit();
  return ok({});
}

/** Email everyone on the waiting list whose wishes match a newly available pet (once per pet). */
async function alertWaitlist(ctx, animal, origin) {
  if (!emailConfigured()) return 0;
  const { data } = ctx;
  const [settings, keys] = await Promise.all([getSettings(data), data.listKeys("waitlist/")]);
  let sent = 0;
  for (const key of keys.slice(0, 500)) {
    const w = await data.getJSON(key);
    if (!w || !wantsPet(w, animal) || (w.notified || []).includes(animal.id)) continue;
    const res = await sendPetAlert({
      to: w.email, name: w.name, rescueName: settings.rescueName, pet: animal.name,
      petLine: [animal.sex !== "unknown" ? animal.sex : "", animal.ageGroup, animal.breed || speciesWords[animal.species]].filter(Boolean).join(" "),
      fee: feeOf(animal, settings), petUrl: `${origin}/adopt/${animal.slug}`,
      unsubscribeUrl: `${origin}/api/public/waitlist/unsubscribe?id=${w.id}&t=${w.token}`, replyTo: settings.email || undefined,
    });
    if (res.sent) { w.notified = [...(w.notified || []), animal.id].slice(-200); await data.setJSON(key, w); sent++; }
  }
  return sent;
}

async function unsubscribeWaitlist(url, { data }) {
  const id = url.searchParams.get("id") || "", token = url.searchParams.get("t") || "";
  let done = false;
  if (/^[a-f0-9]{24}$/.test(id) && /^[a-f0-9]{32}$/.test(token)) {
    const key = (await data.listKeys("waitlist/")).find(k => k.endsWith(`_${id}`));
    const rec = key && await data.getJSON(key);
    if (rec && rec.token === token) { await data.delete(key); done = true; }
  }
  const msg = done ? "You've been removed from the waiting list. You won't receive any more pet alerts." : "This link has already been used or isn't valid. You're not on the waiting list.";
  return new Response(`<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Waiting list</title><link rel="stylesheet" href="/assets/styles.css"></head>
<body><main class="page-head"><div class="wrap"><div class="eyebrow">Waiting list</div><h1>${done ? "You're unsubscribed" : "Nothing to do"}</h1><p class="lead">${msg}</p><div class="btn-row mt-m"><a class="btn" href="/adopt">See our pets</a></div></div></main></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

async function adminWaitlist(req, { data }, id) {
  if (req.method === "GET" && !id) return ok({ waitlist: (await listRecords(data, "waitlist/")).map(({ token, ...w }) => w), emailReady: emailConfigured() && Boolean(process.env.MAIL_FROM) });
  if (req.method === "DELETE" && /^[a-f0-9]{24}$/.test(id || "")) {
    const key = (await data.listKeys("waitlist/")).find(k => k.endsWith(`_${id}`));
    if (!key) return fail(404, "Not found.");
    await data.delete(key); return ok();
  }
  return fail(405, "Method not allowed.");
}

/* ---------------- happy tail submissions (public, moderated) ---------------- */
const submittedStorySchema = {
  name: r.text(100, { required: true, min: 2, label: "Your name" }),
  email: r.email(),
  animalName: r.text(60, { required: true, label: "Your pet's name" }),
  title: r.text(120, { required: true, label: "Title" }),
  body: r.text(3000, { required: true, min: 20, label: "Your story" }),
  consent: r.bool(),
};
async function submitStory(req, ctx) {
  assertSameOrigin(req);
  const body = await readJson(req, 5 * 1024 * 1024);
  honeypot(body);
  const limiter = await rateLimit(ctx.data, "stories", clientKey(req, ctx.context), 3, 3600e3);
  const v = validate(body, submittedStorySchema);
  if (!v.consent) throw new HttpError(422, "Please check the highlighted fields.", { consent: "Please confirm we may publish your story and photo." });
  let photo = "";
  if (body.dataUrl) {
    const full = decodeImage(body.dataUrl), thumb = body.thumbDataUrl ? decodeImage(body.thumbDataUrl) : null;
    photo = newId();
    await ctx.images.setBinary(`img/${photo}`, full.bytes, full.type);
    if (thumb) await ctx.images.setBinary(`img/${photo}-t`, thumb.bytes, thumb.type);
  }
  const rec = { id: newId(), title: v.title, animalName: v.animalName, body: v.body, photo, published: false, submitted: true,
    submittedBy: { name: v.name, email: v.email }, createdAt: nowIso(), updatedAt: nowIso() };
  await ctx.data.setJSON(`stories/${rec.id}`, rec);
  await limiter.hit();
  await notifyOwner(`New happy tail to approve: ${v.animalName}`, [["From", v.name], ["Email", v.email], ["Pet", v.animalName], ["Title", v.title], ["Story", v.body], ["Photo", photo ? "Yes" : "No"]], v.email);
  return ok({});
}

/* ---------------- anonymous visit counts ---------------- */
const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|headless|lighthouse|monitor/i;
async function recordHit(req, { data }) {
  assertSameOrigin(req);
  if (BOT_UA.test(req.headers.get("user-agent") || "")) return new Response(null, { status: 204 });
  const text = (await req.text()).slice(0, 512);
  let path = "";
  try { path = String(JSON.parse(text).path || ""); } catch { /* ignore */ }
  if (!/^\/[a-z0-9\-/]{0,100}$/.test(path)) return new Response(null, { status: 204 });
  const day = nowIso().slice(0, 10), key = `stats/${day}`;
  const rec = (await data.getJSON(key)) || { date: day, total: 0, pages: {}, pets: {} };
  rec.total += 1;
  const pet = path.match(/^\/adopt\/([a-z0-9-]+)\/?$/);
  if (pet) rec.pets[pet[1]] = (rec.pets[pet[1]] || 0) + 1;
  const page = pet ? "/adopt/(pet)" : path.replace(/\/$/, "") || "/";
  if (rec.pages[page] || Object.keys(rec.pages).length < 100) rec.pages[page] = (rec.pages[page] || 0) + 1;
  await data.setJSON(key, rec);
  return new Response(null, { status: 204 });
}
async function adminStats(url, { data }) {
  const days = Math.min(90, Math.max(7, Number(url.searchParams.get("days")) || 30));
  const today = new Date(nowIso().slice(0, 10) + "T00:00:00Z");
  const dates = Array.from({ length: days }, (_, i) => new Date(today.getTime() - (days - 1 - i) * 864e5).toISOString().slice(0, 10));
  const recs = await Promise.all(dates.map(d => data.getJSON(`stats/${d}`)));
  const pages = {}, pets = {};
  recs.forEach(rc => { if (!rc) return; for (const [k, n] of Object.entries(rc.pages || {})) pages[k] = (pages[k] || 0) + n; for (const [k, n] of Object.entries(rc.pets || {})) pets[k] = (pets[k] || 0) + n; });
  const animals = await listRecords(data, "animals/");
  const nameOf = slug => animals.find(a => a.slug === slug)?.name || slug;
  const top = (o, n, f = k => k) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ key: f(k), views: v }));
  return ok({
    days: dates.map((d, i) => ({ date: d, views: recs[i]?.total || 0 })),
    total: recs.reduce((t, rc) => t + (rc?.total || 0), 0),
    topPages: top(pages, 8), topPets: top(pets, 8, nameOf),
  });
}

/* ---------------- backups ---------------- */
async function adminBackups(req, { data }, id) {
  if (req.method === "GET" && !id) return ok({ backups: (await data.listKeys("backups/")).map(k => k.slice(8)).sort().reverse() });
  if (req.method === "POST" && !id) return ok(await createBackup(data));
  if (req.method === "GET" && /^\d{4}-\d{2}-\d{2}$/.test(id || "")) {
    const snap = await data.getJSON(`backups/${id}`);
    if (!snap) return fail(404, "That backup wasn't found.");
    return ok(snap, { "content-disposition": `attachment; filename="pawfamily-backup-${id}.json"` });
  }
  return fail(405, "Method not allowed.");
}

/* ---------------- router ---------------- */
export default async function handler(req, context) {
  try {
    return await route(req, context); // `await` so rejected route promises are caught below
  } catch (e) {
    if (e instanceof HttpError) return fail(e.status, e.message, e.fields);
    console.error("Unhandled API error", e);
    return fail(500, "Something went wrong on our side. Please try again.");
  }
}

async function route(req, context) {
  {
    const url = new URL(req.url);
    const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
    const [area, resource, id] = parts;
    const stores = await getStores();
    const ctx = { ...stores, context };
    const m = req.method;

    if (area === "health" && m === "GET") return ok({ status: "up" });
    if (area === "images" && m === "GET" && resource) return getImage(resource, stores, id);

    if (area === "public") {
      if (resource === "site" && m === "GET") return publicSite(stores);
      if (resource === "applications" && m === "POST") return submitApplication(req, ctx);
      if (resource === "messages" && m === "POST") return submitMessage(req, ctx);
      if (resource === "waitlist" && m === "POST" && !id) return joinWaitlist(req, ctx);
      if (resource === "waitlist" && m === "GET" && id === "unsubscribe") return unsubscribeWaitlist(url, stores);
      if (resource === "stories" && m === "POST") return submitStory(req, ctx);
      if (resource === "hit" && m === "POST") return recordHit(req, stores);
    }

    const needsAuth = area === "auth" || area === "admin";
    const creds = needsAuth ? await getCredentials(stores.data) : null;

    if (area === "auth") {
      if (resource === "login" && m === "POST") return login(req, ctx, creds);
      if (resource === "logout" && m === "POST") { assertSameOrigin(req); return ok({}, { "set-cookie": clearSessionCookie(req) }); }
      if (resource === "me" && m === "GET") {
        const signedIn = Boolean(readSession(req, creds));
        return ok({ signedIn, configured: creds.configured, ...(signedIn ? { source: creds.source } : {}) });
      }
    }

    if (area === "admin") {
      requireAdmin(req, creds);
      switch (resource) {
        case "summary": if (m === "GET") return adminSummary(stores); break;
        case "animals": return adminAnimals(req, ctx, id);
        case "images": return adminImages(req, ctx, id);
        case "applications": return adminRecords(req, ctx, id, { prefix: "applications/", statuses: APP_STATUS, plural: "applications" });
        case "messages": return adminRecords(req, ctx, id, { prefix: "messages/", statuses: MSG_STATUS, plural: "messages" });
        case "stories": return adminStories(req, ctx, id);
        case "parents": return adminCollection(req, ctx, id, "parents/", parentSchema, "parents", "photo");
        case "litters": return adminCollection(req, ctx, id, "litters/", litterSchema, "litters");
        case "settings": return adminSettings(req, stores);
        case "export": if (m === "GET") return adminExport(stores); break;
        case "security": return adminSecurity(req, ctx, creds);
        case "waitlist": return adminWaitlist(req, stores, id);
        case "stats": if (m === "GET") return adminStats(url, stores); break;
        case "backups": return adminBackups(req, stores, id);
      }
    }
    return fail(404, "Not found.");
  }
}
