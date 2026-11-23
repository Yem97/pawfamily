// Pawfamily API: one Netlify Function, routed internally. See docs/DESIGN.md §3.
import { randomBytes } from "node:crypto";
import { getStores, listRecords } from "./lib/store.mjs";
import { HttpError, ok, fail, readJson, clientKey, nowIso } from "./lib/http.mjs";
import { getCredentials, hashPassword, verifyPassword, createSessionCookie, clearSessionCookie, readSession, requireAdmin, assertSameOrigin, CREDENTIALS_KEY } from "./lib/auth.mjs";
import { rules as r, validate } from "./lib/validate.mjs";
import { notifyOwner } from "./lib/email.mjs";

export const config = { path: "/api/*" };

const SPECIES = ["cat", "dog", "rabbit", "other"];
const SEX = ["female", "male", "unknown"];
const AGE = ["baby", "young", "adult", "senior"];
const ANIMAL_STATUS = ["available", "reserved", "adopted", "hidden"];
const TRAITS = ["good-with-cats", "good-with-dogs", "good-with-children", "indoor-only", "needs-garden", "shy", "playful", "lap-cat", "pair-bonded", "special-needs"];
const HEALTH = ["vaccinated", "microchipped", "neutered", "flea-wormed", "vet-checked"];
const APP_STATUS = ["new", "reviewing", "home-check", "approved", "adopted", "declined"];
const MSG_STATUS = ["new", "replied"];
const MAX_IMAGE = 3 * 1024 * 1024;

const DEFAULT_SETTINGS = {
  rescueName: "Pawfamily",
  tagline: "Rescued pets, loving homes",
  town: "", region: "", email: "", phone: "",
  facebookUrl: "https://www.facebook.com/share/1CLxMBvaTP/",
  instagramUrl: "", donateUrl: "", charityNumber: "",
  currency: "£", defaultFee: null,
  feeIncludes: "Vet health check, first vaccinations, microchip, flea and worm treatment, and neutering when old enough.",
  announcement: "",
  aboutText: "",
};

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
async function getSettings(data) { return { ...DEFAULT_SETTINGS, ...(await data.getJSON("settings") || {}) }; }
const publicAnimal = a => ({
  id: a.id, slug: a.slug, name: a.name, species: a.species, breed: a.breed, sex: a.sex, ageGroup: a.ageGroup, birthDate: a.birthDate,
  status: a.status, fee: a.fee, summary: a.summary, story: a.story, photos: a.photos, traits: a.traits, health: a.health,
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
  name: r.text(100, { required: true, min: 2, label: "Your name" }),
  email: r.email(),
  phone: r.phone(),
  postcode: r.text(12, { required: true, label: "Postcode" }),
  homeType: r.oneOf(["house", "flat", "bungalow", "other"], { label: "Home type" }),
  outdoor: r.oneOf(["private-garden", "shared-garden", "balcony", "none"], { label: "Outdoor space" }),
  household: r.text(300, { required: true, label: "Who lives with you" }),
  otherPets: r.text(300, { label: "Other pets" }),
  experience: r.text(800, { label: "Experience" }),
  message: r.text(2000, { required: true, min: 10, label: "Your message" }),
  consent: r.bool(),
};
const messageSchema = {
  name: r.text(100, { required: true, min: 2, label: "Your name" }),
  email: r.email(),
  phone: r.phone(),
  topic: r.oneOf(["general", "adopting", "fostering", "volunteering", "rehoming"], { label: "Topic", fallback: "general" }),
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
  rescueName: r.text(60, { required: true, label: "Rescue name" }),
  tagline: r.text(120, { label: "Tagline" }),
  town: r.text(60, { label: "Town" }), region: r.text(60, { label: "Region" }),
  email: r.email({ required: false }), phone: r.phone(),
  facebookUrl: r.url(), instagramUrl: r.url(), donateUrl: r.url(),
  charityNumber: r.text(40, { label: "Charity number" }),
  currency: r.text(3, { required: true, label: "Currency symbol" }),
  defaultFee: r.money(),
  feeIncludes: r.text(400, { label: "What the fee includes" }),
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
  const [settings, animals, stories] = await Promise.all([getSettings(data), listRecords(data, "animals/"), listRecords(data, "stories/")]);
  return ok({
    settings,
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
  if (!v.consent) throw new HttpError(422, "Please check the highlighted fields.", { consent: "Please confirm we may store your details to process your application." });
  let animalName = "Any suitable pet";
  if (v.animalId && v.animalId !== "any") {
    const a = await ctx.data.getJSON(`animals/${v.animalId}`);
    if (!a || !["available", "reserved"].includes(a.status)) throw new HttpError(422, "That pet is no longer listed. Please choose another or 'Any suitable pet'.", { animalId: "No longer listed." });
    animalName = a.name;
  } else v.animalId = "any";
  const rec = { id: newId(), createdAt: nowIso(), status: "new", notes: "", animalName, ...v };
  await ctx.data.setJSON(`applications/${sortKey()}_${rec.id}`, rec);
  await limiter.hit();
  await notifyOwner(`New adoption application: ${animalName}`, [
    ["Pet", animalName], ["Name", v.name], ["Email", v.email], ["Phone", v.phone], ["Postcode", v.postcode],
    ["Home", `${v.homeType}, ${v.outdoor}`], ["Household", v.household], ["Other pets", v.otherPets], ["Experience", v.experience], ["Message", v.message],
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
    return ok({ animal: rec });
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
    return ok({ animal: rec });
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

async function adminRecords(req, ctx, id, { prefix, statuses, plural }) {
  const { data } = ctx;
  if (req.method === "GET" && !id) return ok({ [plural]: await listRecords(data, prefix) });
  const key = id && /^[a-f0-9]{24}$/.test(id) ? await findByKey(data, prefix, id) : null;
  const existing = key && await data.getJSON(key);
  if (!existing) return fail(404, "Not found.");
  if (req.method === "PUT") {
    const v = validate(await readJson(req), { status: r.oneOf(statuses, { label: "Status" }), notes: r.text(3000, { label: "Notes" }) });
    const rec = { ...existing, status: v.status, ...(prefix === "applications/" ? { notes: v.notes } : {}), updatedAt: nowIso() };
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
  const count = (list, s) => list.filter(x => x.status === s).length;
  return ok({
    animals: { total: animals.length, available: count(animals, "available"), reserved: count(animals, "reserved"), adopted: count(animals, "adopted"), hidden: count(animals, "hidden") },
    applications: { total: applications.length, new: count(applications, "new"), open: applications.filter(a => !["adopted", "declined"].includes(a.status)).length },
    messages: { total: messages.length, new: count(messages, "new") },
    stories: { total: stories.length, published: stories.filter(s => s.published).length },
    recentApplications: applications.slice(0, 5),
    recentMessages: messages.slice(0, 5),
  });
}

async function adminExport({ data }) {
  const [settings, animals, applications, messages, stories] = await Promise.all([
    getSettings(data), listRecords(data, "animals/"), listRecords(data, "applications/"), listRecords(data, "messages/"), listRecords(data, "stories/")]);
  const date = nowIso().slice(0, 10);
  return ok({ exportedAt: nowIso(), version: 1, settings, animals, applications, messages, stories },
    { "content-disposition": `attachment; filename="pawfamily-backup-${date}.json"` });
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
        case "settings": return adminSettings(req, stores);
        case "export": if (m === "GET") return adminExport(stores); break;
        case "security": return adminSecurity(req, ctx, creds);
      }
    }
    return fail(404, "Not found.");
  }
}
