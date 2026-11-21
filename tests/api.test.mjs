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

test("adoption application: validation, consent, honeypot, storage and status updates", async () => {
  const base = { animalId: animal.id, name: "Sam Lee", email: "sam@example.com", phone: "07700 900123", postcode: "AB1 2CD",
    homeType: "house", outdoor: "private-garden", household: "Two adults", otherPets: "", experience: "Had cats for years", message: "We would love to meet Bluebell.", consent: true };
  const missing = await call("POST", "/api/public/applications", { ...base, email: "bad", message: "hi" });
  assert.equal(missing.status, 422);
  assert.ok(missing.body.fields.email && missing.body.fields.message);
  assert.equal((await call("POST", "/api/public/applications", { ...base, consent: false })).status, 422);
  assert.equal((await call("POST", "/api/public/applications", { ...base, website: "http://spam" })).status, 422);
  assert.equal((await call("POST", "/api/public/applications", base, { headers: { origin: "https://evil.example" } })).status, 403);

  const okRes = await call("POST", "/api/public/applications", base);
  assert.equal(okRes.status, 200);
  const list = await call("GET", "/api/admin/applications", undefined, { auth: true });
  assert.equal(list.body.applications.length, 1);
  assert.equal(list.body.applications[0].animalName, "Bluebell");
  const id = list.body.applications[0].id;
  const upd = await call("PUT", `/api/admin/applications/${id}`, { status: "home-check", notes: "Visit Tuesday" }, { auth: true });
  assert.equal(upd.body.record.status, "home-check");
  assert.equal((await call("PUT", `/api/admin/applications/${id}`, { status: "bogus" }, { auth: true })).status, 422);
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
