// Tests for: waiting list + alerts, happy-tail submissions, visit stats, backups, share previews, sitemap/robots.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.PAWFAMILY_DATA_DIR = mkdtempSync(path.join(tmpdir(), "pawfamily-features-"));
process.env.ADMIN_EMAIL = "owner@example.com";
process.env.SESSION_SECRET = "f".repeat(40);
process.env.RESEND_API_KEY = "re_test_dummy";
process.env.NOTIFY_EMAIL = "owner@example.com";
process.env.MAIL_FROM = "Pawfamily <alerts@pawfamilyfreehome.com>";

// Capture outgoing emails instead of calling Resend.
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).startsWith("https://api.resend.com/")) { sent.push(JSON.parse(opts.body)); return new Response("{}", { status: 200 }); }
  if (String(url).endsWith("/index.html")) return new Response(`<!doctype html><html><head><title>Pawfamily</title><meta name="description" content="x"><meta property="og:title" content="x"><meta property="og:image" content="/assets/og-image.jpg"></head><body></body></html>`, { status: 200 });
  return realFetch(url, opts);
};

const { hashPassword } = await import("../netlify/functions/lib/auth.mjs");
const { default: api } = await import("../netlify/functions/api.mjs");
const { default: share } = await import("../netlify/functions/share.mjs");
const { default: seo } = await import("../netlify/functions/seo.mjs");
const { default: monthlyBackup } = await import("../netlify/functions/backup.mjs");
const BASE = "https://pawfamily.test";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
let cookie = "", n = 0;
const call = (method, p, body, { auth = false, headers = {}, ip } = {}) => {
  const h = { ...headers };
  if (body !== undefined) h["content-type"] = "application/json";
  if (auth) { h.cookie = cookie; h["x-requested-with"] = "pawfamily"; }
  return api(new Request(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), { ip: ip || `10.1.0.${++n}` })
    .then(async r => ({ status: r.status, headers: r.headers, text: await r.clone().text(), body: r.headers.get("content-type")?.includes("json") ? await r.json() : null }));
};
const pet = (o = {}) => ({ name: "Bluebell", species: "cat", breed: "Ragdoll", sex: "female", ageGroup: "baby", birthDate: "", status: "available", fee: 150, summary: "Loves a lap.", story: "", photos: [], traits: [], health: [], healthNotes: "", featured: false, ...o });

before(async () => {
  process.env.ADMIN_PASSWORD_HASH = await hashPassword("features-password");
  cookie = (await call("POST", "/api/auth/login", { email: "owner@example.com", password: "features-password" })).headers.get("set-cookie").split(";")[0];
});

test("waiting list: validation, consent, duplicates ignored, token never exposed", async () => {
  const bad = await call("POST", "/api/public/waitlist", { name: "", email: "nope", consent: true });
  assert.equal(bad.status, 422); assert.ok(bad.body.fields.name && bad.body.fields.email);
  assert.equal((await call("POST", "/api/public/waitlist", { name: "Ann", email: "ann@example.com", consent: false })).status, 422);
  const join = { name: "Ann", email: "ann@example.com", species: "cat", sex: "female", ageGroup: "any", consent: true };
  assert.equal((await call("POST", "/api/public/waitlist", join)).status, 200);
  assert.equal((await call("POST", "/api/public/waitlist", join)).body.already, true, "duplicate ignored");
  await call("POST", "/api/public/waitlist", { name: "Dan", email: "dan@example.com", species: "dog", sex: "any", ageGroup: "any", consent: true });
  const list = await call("GET", "/api/admin/waitlist", undefined, { auth: true });
  assert.equal(list.body.waitlist.length, 2);
  assert.ok(!JSON.stringify(list.body).includes('"token"'), "unsubscribe tokens are never sent to the dashboard");
});

let bluebell;
test("alerts: a matching pet emails only matching people, once; unsubscribe works", async () => {
  sent.length = 0;
  const created = await call("POST", "/api/admin/animals", pet(), { auth: true });
  bluebell = created.body.animal;
  assert.equal(created.body.alerted, 1, "Ann (female cat) alerted, Dan (dog) not");
  const mail = sent.find(m => m.to.includes("ann@example.com"));
  assert.ok(mail && mail.subject.includes("Bluebell"));
  assert.ok(mail.html.includes(`/adopt/${bluebell.slug}`) && mail.html.includes("unsubscribe"));
  assert.ok(!sent.some(m => m.to.includes("dan@example.com")));

  await call("PUT", `/api/admin/animals/${bluebell.id}`, pet({ status: "reserved" }), { auth: true });
  const again = await call("PUT", `/api/admin/animals/${bluebell.id}`, pet(), { auth: true });
  assert.equal(again.body.alerted, 0, "never alerted twice about the same pet");

  const unsub = mail.html.match(/href="([^"]*unsubscribe[^"]*)"/)[1].replaceAll("&amp;", "&");
  const page = await call("GET", new URL(unsub).pathname + new URL(unsub).search);
  assert.equal(page.status, 200); assert.match(page.text, /unsubscribed/);
  assert.match((await call("GET", new URL(unsub).pathname + new URL(unsub).search)).text, /already been used/);
  const tampered = await call("GET", "/api/public/waitlist/unsubscribe?id=000000000000000000000000&t=" + "a".repeat(32));
  assert.match(tampered.text, /isn't valid/);
  assert.equal((await call("GET", "/api/admin/waitlist", undefined, { auth: true })).body.waitlist.length, 1);
});

test("happy tails: public submissions wait for approval, then publish", async () => {
  sent.length = 0;
  const bad = await call("POST", "/api/public/stories", { name: "Sue", email: "sue@example.com", animalName: "Tom", title: "Tom at home", body: "short", consent: true });
  assert.equal(bad.status, 422); assert.ok(bad.body.fields.body);
  const fake = await call("POST", "/api/public/stories", { name: "Sue", email: "sue@example.com", animalName: "Tom", title: "Tom at home", body: "Tom has settled in beautifully with us.", consent: true, dataUrl: "data:image/png;base64," + Buffer.from("<svg/>").toString("base64") });
  assert.equal(fake.status, 422, "non-image upload rejected");
  const ok1 = await call("POST", "/api/public/stories", { name: "Sue", email: "sue@example.com", animalName: "Tom", title: "Tom at home", body: "Tom has settled in beautifully with us.", consent: true, dataUrl: PNG, thumbDataUrl: PNG });
  assert.equal(ok1.status, 200);
  assert.ok(sent.some(m => m.subject.includes("happy tail")), "owner told");
  assert.equal((await call("GET", "/api/public/site")).body.stories.length, 0, "not public until approved");
  const stories = (await call("GET", "/api/admin/stories", undefined, { auth: true })).body.stories;
  const st = stories[0];
  assert.equal(st.submitted, true); assert.equal(st.published, false); assert.equal(st.submittedBy.name, "Sue");
  assert.equal((await call("GET", "/api/admin/summary", undefined, { auth: true })).body.stories.pending, 1);
  await call("PUT", `/api/admin/stories/${st.id}`, { title: st.title, animalName: st.animalName, body: st.body, photo: st.photo, published: true }, { auth: true });
  assert.equal((await call("GET", "/api/public/site")).body.stories.length, 1, "published after approval");
  const ip = "172.20.0.9";
  for (let i = 0; i < 3; i++) await call("POST", "/api/public/stories", { name: "Spam", email: "s@example.com", animalName: "X", title: "Spam", body: "spam spam spam spam spam", consent: true }, { ip });
  assert.equal((await call("POST", "/api/public/stories", { name: "Spam", email: "s@example.com", animalName: "X", title: "Spam", body: "spam spam spam spam spam", consent: true }, { ip })).status, 429);
});

test("stats: anonymous counts, bots ignored, junk paths ignored", async () => {
  const hit = (path, ua = "Mozilla/5.0") => api(new Request(BASE + "/api/public/hit", { method: "POST", headers: { "content-type": "application/json", "user-agent": ua }, body: JSON.stringify({ path }) }), {});
  for (const p of ["/", "/", "/adopt", `/adopt/${bluebell.slug}`, `/adopt/${bluebell.slug}`]) assert.equal((await hit(p)).status, 204);
  await hit("/", "facebookexternalhit/1.1"); await hit("/<script>"); await hit("https://evil.example/");
  const st = (await call("GET", "/api/admin/stats?days=7", undefined, { auth: true })).body;
  assert.equal(st.total, 5);
  assert.equal(st.days.length, 7);
  assert.deepEqual(st.topPets[0], { key: "Bluebell", views: 2 });
  assert.equal(st.topPages.find(p => p.key === "/").views, 2);
  assert.equal((await call("GET", "/api/admin/stats")).status, 403, "stats are private");
});

test("backups: saved on demand and by the monthly schedule, listed, downloadable, without secrets", async () => {
  sent.length = 0;
  const made = await call("POST", "/api/admin/backups", undefined, { auth: true });
  assert.equal(made.status, 200); assert.equal(made.body.counts.pets, 1);
  const sched = await monthlyBackup(); assert.equal(sched.status, 200);
  assert.ok(sent.some(m => m.subject.includes("monthly")), "owner told about the monthly backup");
  const list = (await call("GET", "/api/admin/backups", undefined, { auth: true })).body.backups;
  assert.equal(list.length, 1, "same-day backups replace each other");
  const dl = await call("GET", `/api/admin/backups/${list[0]}`, undefined, { auth: true });
  assert.match(dl.headers.get("content-disposition"), /pawfamily-backup-/);
  assert.ok(!dl.text.includes("scrypt$") && !dl.text.includes('"token"'), "no password hashes or unsubscribe tokens in backups");
  assert.equal((await call("GET", `/api/admin/backups/${list[0]}`)).status, 403);
});

test("share previews: pet pages carry the pet's title, description, photo and canonical URL", async () => {
  const withPhoto = await call("POST", "/api/admin/images", { dataUrl: PNG }, { auth: true });
  await call("PUT", `/api/admin/animals/${bluebell.id}`, pet({ photos: [withPhoto.body.id], name: "Bluebell <b>" }), { auth: true });
  const slug = (await call("GET", "/api/public/site")).body.animals[0].slug;
  const res = await share(new Request(`${BASE}/adopt/${slug}`), { params: { slug } });
  const html = await res.text();
  assert.match(html, /<title>Bluebell &lt;b&gt; · Pawfamily<\/title>/, "title set and escaped");
  assert.match(html, new RegExp(`<meta property="og:image" content="${BASE}/api/images/${withPhoto.body.id}">`), "absolute photo URL");
  assert.match(html, /<meta property="og:title" content="Meet Bluebell &lt;b&gt;: female baby Ragdoll looking for a home">/);
  assert.match(html, /Kitten fee £150/);
  assert.match(html, new RegExp(`<link rel="canonical" href="${BASE}/adopt/${slug}">`));
  const missing = await (await share(new Request(`${BASE}/adopt/nobody-12345`), { params: { slug: "nobody-12345" } })).text();
  assert.match(missing, /<title>Pawfamily<\/title>/, "unknown pets get the normal page");
});

test("sitemap and robots", async () => {
  const sm = await (await seo(new Request(`${BASE}/sitemap.xml`))).text();
  assert.match(sm, /<loc>https:\/\/pawfamily\.test\/<\/loc>/);
  assert.match(sm, /\/adopt\/bluebell-b-[a-f0-9]{5}<\/loc>/);
  assert.match(sm, /\/happy-tails<\/loc>/, "listed once a story is published");
  const rb = await (await seo(new Request(`${BASE}/robots.txt`))).text();
  assert.match(rb, /Disallow: \/admin\//); assert.match(rb, /Sitemap: https:\/\/pawfamily\.test\/sitemap\.xml/);
});
