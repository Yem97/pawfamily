// API tests: run with `npm test`. Uses a temporary file store; no network needed.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.PAWFAMILY_DATA_DIR = mkdtempSync(path.join(tmpdir(), "pawfamily-test-"));
process.env.ADMIN_EMAIL = "Owner@Example.com";
process.env.SESSION_SECRET = "x".repeat(40);
delete process.env.RESEND_API_KEY;

const { hashPassword, verifyPassword } = await import("../netlify/functions/lib/auth.mjs");
const { default: api } = await import("../netlify/functions/api.mjs");
const BASE = "https://pawfamily.test";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
let cookie = "", ipCounter = 0;

function call(method, p, body, { auth = false, headers = {}, ip } = {}) {
  const h = { ...headers };
  if (body !== undefined) h["content-type"] = "application/json";
  if (auth) { h.cookie = cookie; h["x-requested-with"] = "pawfamily"; }
  return api(new Request(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), { ip: ip || `10.0.0.${++ipCounter}` })
    .then(async res => ({ status: res.status, headers: res.headers, body: res.headers.get("content-type")?.includes("json") ? await res.json() : await res.arrayBuffer() }));
}
const validAnimal = (o = {}) => ({ name: "Bluebell", species: "cat", breed: "Ragdoll", sex: "female", ageGroup: "baby", birthDate: "2026-08-01",
  status: "available", fee: 150, summary: "Gentle and cuddly", story: "Found in a shed.", photos: [], traits: ["lap-cat", "bogus"], health: ["vaccinated"], healthNotes: "", featured: true, ...o });

before(async () => { process.env.ADMIN_PASSWORD_HASH = await hashPassword("correct horse battery"); });

test("password hashing verifies only the right password", async () => {
  const h = await hashPassword("s3cret-password");
  assert.equal(await verifyPassword("s3cret-password", h), true);
  assert.equal(await verifyPassword("wrong", h), false);
  assert.equal(await verifyPassword("x", "garbage"), false);
});

test("public site works on an empty store with default settings", async () => {
  const r = await call("GET", "/api/public/site");
  assert.equal(r.status, 200);
  assert.equal(r.body.settings.rescueName, "Pawfamily");
  assert.deepEqual(r.body.animals, []);
});

test("admin routes reject anonymous, header-less and cross-site requests", async () => {
  assert.equal((await call("GET", "/api/admin/animals")).status, 403);                                   // no custom header
  assert.equal((await call("GET", "/api/admin/animals", undefined, { headers: { "x-requested-with": "pawfamily" } })).status, 401);
  assert.equal((await call("GET", "/api/admin/animals", undefined, { headers: { "x-requested-with": "pawfamily", origin: "https://evil.example" } })).status, 403);
  assert.equal((await call("GET", "/api/admin/animals", undefined, { headers: { "x-requested-with": "pawfamily", cookie: "pf_session=forged.sig" } })).status, 401);
});

test("login: wrong password fails, lockout after 5, right password sets a secure cookie", async () => {
  const ip = "192.168.9.9";
  for (let i = 0; i < 5; i++) assert.equal((await call("POST", "/api/auth/login", { email: "owner@example.com", password: "nope" }, { ip })).status, 401);
  const locked = await call("POST", "/api/auth/login", { email: "owner@example.com", password: "correct horse battery" }, { ip });
  assert.equal(locked.status, 429);
  const good = await call("POST", "/api/auth/login", { email: "OWNER@example.com ", password: "correct horse battery" });
  assert.equal(good.status, 200);
  const sc = good.headers.get("set-cookie");
  assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/); assert.match(sc, /Secure/); assert.match(sc, /Path=\/api/);
  cookie = sc.split(";")[0];
  assert.equal((await call("GET", "/api/auth/me")).body.signedIn, false);
  assert.equal((await call("GET", "/api/auth/me", undefined, { headers: { cookie } })).body.signedIn, true);
});

let animal;
test("animal CRUD with validation and public visibility rules", async () => {
  const bad = await call("POST", "/api/admin/animals", validAnimal({ name: "", species: "dragon" }), { auth: true });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.fields.name && bad.body.fields.species);

  const img = await call("POST", "/api/admin/images", { dataUrl: PNG }, { auth: true });
  assert.equal(img.status, 200);
  const created = await call("POST", "/api/admin/animals", validAnimal({ photos: [img.body.id] }), { auth: true });
  assert.equal(created.status, 200);
  animal = created.body.animal;
  assert.match(animal.slug, /^bluebell-[a-f0-9]{5}$/);
  assert.deepEqual(animal.traits, ["lap-cat"]);                         // unknown trait dropped

  const pic = await call("GET", `/api/images/${img.body.id}`);
  assert.equal(pic.status, 200);
  assert.equal(pic.headers.get("content-type"), "image/png");

  let site = await call("GET", "/api/public/site");
  assert.equal(site.body.animals.length, 1);
  await call("PUT", `/api/admin/animals/${animal.id}`, validAnimal({ status: "hidden", photos: [img.body.id] }), { auth: true });
  site = await call("GET", "/api/public/site");
  assert.equal(site.body.animals.length, 0, "hidden animals are not public");
  await call("PUT", `/api/admin/animals/${animal.id}`, validAnimal({ photos: [img.body.id] }), { auth: true });
});

test("image upload rejects non-images, even when labelled as images", async () => {
  const fake = "data:image/png;base64," + Buffer.from("<script>alert(1)</script>").toString("base64");
  assert.equal((await call("POST", "/api/admin/images", { dataUrl: fake }, { auth: true })).status, 422);
  assert.equal((await call("POST", "/api/admin/images", { dataUrl: "data:text/html;base64,PGI+" }, { auth: true })).status, 422);
});

test("kitten enquiry: her questions, validation, consent, honeypot, payments, delivery and documents", async () => {
  const base = { animalId: animal.id, intent: "reserve", sexPreference: "female", name: "Sam Lee", email: "sam@example.com", phone: "07700 900123", deliveryArea: "LS1 4AP",
    experience: "yes", experienceDetails: "Two cats before", children: "yes", childrenAges: "6 and 9", otherPets: "", message: "", consent: true };
  const missing = await call("POST", "/api/public/applications", { ...base, email: "bad", intent: "", experience: "", deliveryArea: "" });
  assert.equal(missing.status, 422);
  assert.ok(missing.body.fields.email && missing.body.fields.intent && missing.body.fields.experience && missing.body.fields.deliveryArea);
  const noAges = await call("POST", "/api/public/applications", { ...base, childrenAges: "" });
  assert.equal(noAges.status, 422); assert.ok(noAges.body.fields.childrenAges, "children's ages needed when there are children");
  assert.equal((await call("POST", "/api/public/applications", { ...base, consent: false })).status, 422);
  assert.equal((await call("POST", "/api/public/applications", { ...base, website: "http://spam" })).status, 422);
  assert.equal((await call("POST", "/api/public/applications", base, { headers: { origin: "https://evil.example" } })).status, 403);

  assert.equal((await call("POST", "/api/public/applications", base)).status, 200, "message is optional");
  const list = await call("GET", "/api/admin/applications", undefined, { auth: true });
  assert.equal(list.body.applications.length, 1);
  const enq = list.body.applications[0];
  assert.equal(enq.animalName, "Bluebell"); assert.equal(enq.intent, "reserve"); assert.equal(enq.childrenAges, "6 and 9");

  const upd = await call("PUT", `/api/admin/applications/${enq.id}`, { status: "reserved", notes: "Called Tuesday", agreedFee: 150, depositAmount: 50, depositDate: "2026-11-20",
    paidInFullDate: "", deliveryDate: "2027-01-15", docs: ["contract", "vaccination-record", "bogus"] }, { auth: true });
  assert.equal(upd.status, 200);
  const rec = upd.body.record;
  assert.equal(rec.status, "reserved"); assert.equal(rec.depositAmount, 50); assert.equal(rec.deliveryDate, "2027-01-15", "future delivery dates allowed");
  assert.deepEqual(rec.docs, ["contract", "vaccination-record"], "unknown documents dropped");
  assert.equal((await call("PUT", `/api/admin/applications/${enq.id}`, { status: "adopted" }, { auth: true })).status, 422, "old rescue stages rejected");
  assert.equal((await call("PUT", `/api/admin/applications/${enq.id}`, { status: "paid", depositDate: "2099-01-01" }, { auth: true })).status, 422, "payment dates can't be in the future");
  const sum = await call("GET", "/api/admin/summary", undefined, { auth: true });
  assert.equal(sum.body.applications.reserved, 1);
});

test("parents and litters: owner manages them; only published litters are public", async () => {
  const mum = await call("POST", "/api/admin/parents", { name: "Clover", role: "mum", breed: "Ragdoll", colour: "Seal mitted", born: "2022", about: "Calm and gentle.", healthNotes: "", photo: "" }, { auth: true });
  const dad = await call("POST", "/api/admin/parents", { name: "Atlas", role: "dad", breed: "Ragdoll", colour: "Seal point", born: "2021", about: "", healthNotes: "", photo: "" }, { auth: true });
  assert.equal(mum.status, 200); assert.equal(dad.status, 200);
  assert.equal((await call("POST", "/api/admin/parents", { name: "", role: "aunt" }, { auth: true })).status, 422);
  await call("POST", "/api/admin/litters", { mum: mum.body.record.id, dad: dad.body.record.id, status: "expected", when: "March 2027", details: "Seal and blue", published: true }, { auth: true });
  await call("POST", "/api/admin/litters", { mum: mum.body.record.id, dad: dad.body.record.id, status: "planned", when: "Autumn 2027", details: "", published: false }, { auth: true });
  const site = (await call("GET", "/api/public/site")).body;
  assert.equal(site.parents.length, 2);
  assert.equal(site.litters.length, 1, "draft litters stay private");
  assert.equal(site.litters[0].when, "March 2027");
  const p = await call("PUT", `/api/admin/animals/${animal.id}`, validAnimal({ mum: mum.body.record.id, dad: dad.body.record.id, reservationFee: 50, photos: animal.photos }), { auth: true });
  assert.equal(p.body.animal.reservationFee, 50);
  const pub = (await call("GET", "/api/public/site")).body.animals[0];
  assert.equal(pub.mum, mum.body.record.id); assert.equal(pub.reservationFee, 50);
  assert.equal((await call("GET", "/api/admin/parents")).status, 403, "parents admin is private");
  await call("DELETE", `/api/admin/parents/${dad.body.record.id}`, undefined, { auth: true });
  assert.equal((await call("GET", "/api/public/site")).body.parents.length, 1);
});

test("public forms are rate limited per network", async () => {
  const msg = { name: "Spammer", email: "s@example.com", message: "Hello there friend", topic: "general" };
  const ip = "172.16.0.1";
  for (let i = 0; i < 5; i++) assert.equal((await call("POST", "/api/public/messages", msg, { ip })).status, 200);
  assert.equal((await call("POST", "/api/public/messages", msg, { ip })).status, 429);
});

test("stories, settings, summary and export", async () => {
  const s = await call("POST", "/api/admin/stories", { title: "Bluebell's new life", animalName: "Bluebell", body: "She now rules the sofa in her new home.", published: true }, { auth: true });
  assert.equal(s.status, 200);
  assert.equal((await call("GET", "/api/public/site")).body.stories.length, 1);

  const badSettings = await call("PUT", "/api/admin/settings", { rescueName: "", currency: "£", facebookUrl: "javascript:alert(1)" }, { auth: true });
  assert.equal(badSettings.status, 422);
  assert.ok(badSettings.body.fields.facebookUrl);
  const settings = await call("PUT", "/api/admin/settings", { rescueName: "Pawfamily", currency: "£", defaultFee: 120, town: "Leeds" }, { auth: true });
  assert.equal(settings.status, 200);
  assert.equal((await call("GET", "/api/public/site")).body.settings.defaultFee, 120);

  const sum = await call("GET", "/api/admin/summary", undefined, { auth: true });
  assert.equal(sum.body.animals.available, 1);
  assert.equal(sum.body.applications.new, 0);
  assert.equal(sum.body.messages.new, 5);
  const exp = await call("GET", "/api/admin/export", undefined, { auth: true });
  assert.match(exp.headers.get("content-disposition"), /pawfamily-backup-/);
  assert.equal(exp.body.animals.length, 1);
});

test("deleting an animal removes its photos; logout clears the cookie", async () => {
  const photo = animal.photos?.[0] || (await call("GET", "/api/admin/animals", undefined, { auth: true })).body.animals[0].photos[0];
  assert.equal((await call("DELETE", `/api/admin/animals/${animal.id}`, undefined, { auth: true })).status, 200);
  assert.equal((await call("GET", `/api/images/${photo}`)).status, 404);
  const out = await call("POST", "/api/auth/logout");
  assert.match(out.headers.get("set-cookie"), /Max-Age=0/);
});

test("unknown routes return JSON 404, not a crash", async () => {
  const r = await call("GET", "/api/nope");
  assert.equal(r.status, 404);
  assert.equal(r.body.ok, false);
});

test("security: change password and email, sign out other devices, Netlify reset still works", async () => {
  const login = (email, password) => call("POST", "/api/auth/login", { email, password });
  const first = await login("owner@example.com", "correct horse battery");
  assert.equal(first.status, 200);
  cookie = first.headers.get("set-cookie").split(";")[0];
  const otherDevice = (await login("owner@example.com", "correct horse battery")).headers.get("set-cookie").split(";")[0];

  const info = await call("GET", "/api/admin/security", undefined, { auth: true });
  assert.equal(info.body.source, "netlify");
  assert.equal(info.body.email, "owner@example.com");

  const wrong = await call("PUT", "/api/admin/security", { currentPassword: "nope", newEmail: "owner@example.com", newPassword: "a brand new password", confirmPassword: "a brand new password" }, { auth: true });
  assert.equal(wrong.status, 422); assert.ok(wrong.body.fields.currentPassword);
  const short = await call("PUT", "/api/admin/security", { currentPassword: "correct horse battery", newEmail: "owner@example.com", newPassword: "short", confirmPassword: "short" }, { auth: true });
  assert.ok(short.body.fields.newPassword);
  const mismatch = await call("PUT", "/api/admin/security", { currentPassword: "correct horse battery", newEmail: "owner@example.com", newPassword: "a brand new password", confirmPassword: "different one here" }, { auth: true });
  assert.ok(mismatch.body.fields.confirmPassword);
  const nothing = await call("PUT", "/api/admin/security", { currentPassword: "correct horse battery", newEmail: "owner@example.com" }, { auth: true });
  assert.equal(nothing.status, 422);

  const changed = await call("PUT", "/api/admin/security", { currentPassword: "correct horse battery", newEmail: "Her.Own@Example.com", newPassword: "a brand new password", confirmPassword: "a brand new password" }, { auth: true });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.email, "her.own@example.com");
  const oldCookie = cookie;
  cookie = changed.headers.get("set-cookie").split(";")[0];

  assert.equal((await call("GET", "/api/admin/summary", undefined, { auth: true })).status, 200, "this device stays signed in");
  assert.equal((await call("GET", "/api/admin/summary", undefined, { headers: { cookie: oldCookie, "x-requested-with": "pawfamily" } })).status, 401, "old session ended");
  assert.equal((await call("GET", "/api/admin/summary", undefined, { headers: { cookie: otherDevice, "x-requested-with": "pawfamily" } })).status, 401, "other device signed out");
  assert.equal((await login("owner@example.com", "correct horse battery")).status, 401, "temporary credentials no longer work");
  assert.equal((await login("her.own@example.com", "a brand new password")).status, 200, "new credentials work");
  assert.equal((await call("GET", "/api/admin/security", undefined, { auth: true })).body.source, "dashboard");
  const exp = await call("GET", "/api/admin/export", undefined, { auth: true });
  assert.ok(!JSON.stringify(exp.body).includes("scrypt$"), "password hash never appears in the backup");

  // Recovery: replacing ADMIN_PASSWORD_HASH in Netlify overrides the dashboard credentials.
  process.env.ADMIN_PASSWORD_HASH = await hashPassword("emergency reset 2026");
  assert.equal((await login("her.own@example.com", "a brand new password")).status, 401);
  assert.equal((await login("owner@example.com", "emergency reset 2026")).status, 200);
});

test("photo thumbnails: stored with the upload, served at /thumb, fall back to full size, deleted together", async () => {
  // The previous test ends with a Netlify-style password reset, so sign in again with the reset details.
  cookie = (await call("POST", "/api/auth/login", { email: "owner@example.com", password: "emergency reset 2026" })).headers.get("set-cookie").split(";")[0];
  const JPEG_1PX = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
  const up = await call("POST", "/api/admin/images", { dataUrl: PNG, thumbDataUrl: JPEG_1PX }, { auth: true });
  assert.equal(up.status, 200);
  const full = await call("GET", `/api/images/${up.body.id}`), small = await call("GET", `/api/images/${up.body.id}/thumb`);
  assert.equal(full.headers.get("content-type"), "image/png");
  assert.equal(small.headers.get("content-type"), "image/jpeg", "thumbnail served");
  const noThumb = await call("POST", "/api/admin/images", { dataUrl: PNG }, { auth: true });
  assert.equal((await call("GET", `/api/images/${noThumb.body.id}/thumb`)).headers.get("content-type"), "image/png", "falls back to the full photo");
  assert.equal((await call("GET", `/api/images/${up.body.id}/huge`)).status, 404, "unknown size rejected");
  const badThumb = await call("POST", "/api/admin/images", { dataUrl: PNG, thumbDataUrl: "data:image/png;base64," + Buffer.from("not an image").toString("base64") }, { auth: true });
  assert.equal(badThumb.status, 422, "thumbnail is checked like the photo");
  await call("DELETE", `/api/admin/images/${up.body.id}`, undefined, { auth: true });
  assert.equal((await call("GET", `/api/images/${up.body.id}/thumb`)).status, 404, "thumbnail deleted with the photo");
});
