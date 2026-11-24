// End-to-end browser test: `npm run test:e2e`. Starts the dev server on a temp store and drives Chromium.
// Fails on any JavaScript error or Content-Security-Policy violation.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { hashPassword } from "../netlify/functions/lib/auth.mjs";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = await import("playwright")); }

const SHOTS = process.env.SHOTS_DIR || mkdtempSync(path.join(tmpdir(), "pawfamily-shots-"));
const PORT = 8899, BASE = `http://localhost:${PORT}`;
const PASSWORD = "test-password-123";
const env = { ...process.env, PORT: String(PORT), PAWFAMILY_DATA_DIR: mkdtempSync(path.join(tmpdir(), "pawfamily-e2e-")),
  ADMIN_EMAIL: "owner@pawfamily.test", ADMIN_PASSWORD_HASH: await hashPassword(PASSWORD), SESSION_SECRET: "s".repeat(48) };
const server = spawn(process.execPath, ["scripts/dev-server.mjs"], { env, stdio: ["ignore", "pipe", "inherit"] });
process.on("exit", () => server.kill()); // never leave the server running, even when a check fails
process.on("uncaughtException", e => { console.error(e); process.exit(1); });
process.on("unhandledRejection", e => { console.error(e); process.exit(1); });
await new Promise((res, rej) => { server.stdout.on("data", d => String(d).includes("running") && res()); setTimeout(() => rej(new Error("server did not start")), 8000); });

// A real JPEG made by the browser itself, to upload as a pet photo.
const problems = [];
const browser = await chromium.launch();
// A normal desktop browser identity: the site (correctly) doesn't count "HeadlessChrome" visits.
const REAL_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, userAgent: REAL_UA });
await ctx.addInitScript(() => document.addEventListener("securitypolicyviolation", e => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`)));
const watch = page => {
  page.on("pageerror", e => problems.push(`JS error: ${e.message}`));
  // Expected by design: 401 (wrong password / after sign-out), 422 (rejected input), 404. JS errors and CSP violations still fail.
  page.on("console", m => { if (m.type() === "error" && !/fonts\.(googleapis|gstatic)|Failed to load resource: (net::|the server responded with a status of (401|404|422))/i.test(m.text())) problems.push(m.text()); });
};
const page = await ctx.newPage(); watch(page);
const step = (name) => console.log("✓", name);

// 1. Empty public site
await page.goto(BASE + "/"); await page.waitForSelector(".hero h1");
assert.match(await page.textContent(".hero h1"), /Home-raised kittens/);
assert.ok(await page.isVisible("text=New kittens coming soon"));
await page.screenshot({ path: path.join(SHOTS, "01-home-empty.png") });
step("empty home page renders with designed empty state");

// 2. Every public route renders
const RETIRED = /meet before you pay|never ask (you )?(for|to) pay|rescue|foster|donat|home check/i; // claims and wording that no longer apply
for (const [p, h] of [["/", "Home-raised"], ["/adopt", "Our kittens"], ["/how-to-adopt", "How it works"], ["/parents", "Our cats"], ["/litters", "Upcoming litters"], ["/about", "About Pawfamily"], ["/happy-tails", "Happy tails"], ["/faq", "Frequently asked"], ["/contact", "Contact us"], ["/privacy", "Privacy notice"], ["/nope", "Sorry"]]) {
  await page.goto(BASE + p); await page.waitForSelector("main h1");
  assert.match(await page.textContent("main h1"), new RegExp(h), p);
  const text = await page.textContent("body");
  assert.ok(!RETIRED.test(text), `old rescue wording or retired promise on ${p}: ${text.match(RETIRED)?.[0]}`);
  assert.ok(!/video call|visit (us|the kitten)|meet (the|your) kitten in person/i.test(text), `site stays neutral about meeting (${p})`);
}
step("all 10 public pages + not-found render; no rescue wording or retired promises; neutral about meeting");

// 3. Admin login: wrong then right
const admin = await ctx.newPage(); watch(admin);
await admin.goto(BASE + "/admin/"); await admin.waitForSelector("#login");
await admin.screenshot({ path: path.join(SHOTS, "02-admin-login.png") });
await admin.fill("#login-email", "owner@pawfamily.test"); await admin.fill("#login-password", "wrong-one");
await admin.click("#login button"); await admin.waitForSelector(".form-error");
assert.match(await admin.textContent(".form-error"), /don't match/);
await admin.fill("#login-password", PASSWORD); await admin.click("#login button");
await admin.waitForSelector(".a-head h1"); step("admin sign-in rejects wrong password, accepts right one");

// 4. Settings
await admin.goto(BASE + "/admin/#settings"); await admin.waitForSelector("#settings");
await admin.fill("#settings-town", "Leeds"); await admin.fill("#settings-region", "West Yorkshire");
await admin.fill("#settings-email", "hello@pawfamilyfreehome.com"); await admin.fill("#settings-defaultFee", "150"); await admin.fill("#settings-defaultReservationFee", "50");
await admin.fill("#settings-announcement", "Kitten season: new arrivals every week");
await admin.fill("#settings-facebookUrl", "javascript:alert(1)"); await admin.click("#settings button[type=submit]");
await admin.waitForSelector("#err-settings-facebookUrl:not(:empty)"); step("settings reject unsafe links");
await admin.fill("#settings-facebookUrl", "https://www.facebook.com/share/1CLxMBvaTP/"); await admin.click("#settings button[type=submit]");
await admin.waitForSelector("#toast.show"); step("settings saved");

// 5. Add a pet with a real photo
const jpeg = await admin.evaluate(() => { const c = document.createElement("canvas"); c.width = 900; c.height = 1100; const g = c.getContext("2d");
  const grd = g.createLinearGradient(0, 0, 900, 1100); grd.addColorStop(0, "#f3e6d3"); grd.addColorStop(1, "#7b5236"); g.fillStyle = grd; g.fillRect(0, 0, 900, 1100);
  g.fillStyle = "#fff"; g.beginPath(); g.arc(450, 520, 240, 0, 7); g.fill(); return c.toDataURL("image/jpeg", .9).split(",")[1]; });
const photoPath = path.join(env.PAWFAMILY_DATA_DIR, "bluebell.jpg"); writeFileSync(photoPath, Buffer.from(jpeg, "base64"));
// Parents (with photos) and a litter
for (const [name, role] of [["Clover", "mum"], ["Atlas", "dad"]]) {
  await admin.goto(BASE + "/admin/#parents"); await admin.waitForSelector(".a-head [data-edit-parent]");
  await admin.click(".a-head [data-edit-parent]"); await admin.waitForSelector("#parent");
  await admin.fill("#parent-name", name); await admin.selectOption("#parent-role", role); await admin.fill("#parent-breed", "Ragdoll");
  await admin.setInputFiles("#parentFile", photoPath); await admin.waitForSelector("#parentPic img");
  await admin.click("button[form=parent]"); await admin.waitForSelector(`.list b.t:text-is("${name}")`);
}
await admin.goto(BASE + "/admin/#litters"); await admin.click(".a-head [data-edit-litter]"); await admin.waitForSelector("#litter");
await admin.selectOption("#litter-mum", { label: "Clover" }); await admin.selectOption("#litter-dad", { label: "Atlas" }); await admin.fill("#litter-when", "March 2027");
await admin.click("button[form=litter]"); await admin.waitForSelector("text=Clover × Atlas");
step("owner adds parents with photos and a published litter");

await admin.goto(BASE + "/admin/#pets"); await admin.waitForSelector("text=No kittens yet");
await admin.click(".a-head [data-new-pet]"); await admin.waitForSelector("#pet");
await admin.click("#pet button[type=submit], button[form=pet]"); await admin.waitForSelector("#err-pet-name:not(:empty)"); step("pet editor requires a name");
await admin.setInputFiles("#petFiles", [photoPath, photoPath]); await admin.waitForFunction(() => document.querySelectorAll("#photoGrid img").length === 2);
await admin.click("[data-photo-remove='1']"); await admin.waitForFunction(() => document.querySelectorAll("#photoGrid img").length === 1);
await admin.fill("#pet-name", "Bluebell"); await admin.selectOption("#pet-ageGroup", "baby"); await admin.fill("#pet-breed", "Ragdoll");
await admin.fill("#pet-summary", "A gentle, floppy kitten who loves a lap."); await admin.fill("#pet-story", "Bluebell was found in a garden shed.\n\nNow she's healthy and ready for her family.");
await admin.check("input[name=traits][value=lap-cat]"); await admin.check("input[name=health][value=vaccinated]"); await admin.check("input[name=featured]");
await admin.selectOption("#pet-mum", { label: "Clover" }); await admin.selectOption("#pet-dad", { label: "Atlas" });
await admin.screenshot({ path: path.join(SHOTS, "03-pet-editor.png") });
await admin.click("button[form=pet]"); await admin.waitForSelector("text=Bluebell");
await admin.waitForSelector(".list img"); step("pet created with photo upload (resize → upload → save)");
// a second pet, reserved, with a script-like name to prove escaping
await admin.click(".a-head [data-new-pet]"); await admin.waitForSelector("#pet");
await admin.fill("#pet-name", "<img src=x onerror=alert(1)>Otis"); await admin.selectOption("#pet-sex", "male"); await admin.selectOption("#pet-status", "reserved"); await admin.fill("#pet-fee", "95");
await admin.click("button[form=pet]"); await admin.waitForFunction(() => document.querySelectorAll(".list > li").length === 2);
await admin.screenshot({ path: path.join(SHOTS, "04-admin-pets.png") });
step("second pet created (reserved, custom fee, hostile name)");

// 6. Public site shows pets, filters, profile, escaping
await page.goto(BASE + "/adopt"); await page.waitForSelector(".card");
assert.equal(await page.locator(".card").count(), 2);
assert.equal(await page.locator("main img[src='x']").count(), 0, "hostile name must not become an element");
assert.ok((await page.textContent("main")).includes("<img src=x onerror=alert(1)>Otis"), "hostile name shown as plain text");
await page.selectOption("#fSex", "male"); assert.equal(await page.locator(".card").count(), 1);
await page.selectOption("#fSex", "all");
assert.ok(await page.isVisible("#announce")); assert.match(await page.textContent("#announce"), /Kitten season/);
await page.screenshot({ path: path.join(SHOTS, "05-adopt.png") });
await page.click(".card:has-text('Bluebell')"); await page.waitForSelector(".profile h1");
assert.equal(await page.textContent(".profile h1"), "Bluebell");
assert.match(await page.textContent(".fee-box"), /£150/);
assert.match(await page.textContent(".fee-box"), /Reservation fee £50, refundable if we can't deliver Bluebell/);
assert.ok(await page.isVisible('.parents-mini a:has-text("Clover")') && await page.isVisible('.parents-mini a:has-text("Atlas")'), "parents shown on the kitten page");
assert.match(page.url(), /\/adopt\/bluebell-[a-f0-9]{5}$/);
await page.screenshot({ path: path.join(SHOTS, "06-profile.png"), fullPage: true });
step("public listing, filters, profile, fee and XSS-safe rendering");

// 7. Enquiry from the kitten page: her questions
await page.click("text=Enquire about Bluebell"); await page.waitForSelector("#application");
assert.equal(await page.$eval("#application-animalId", el => el.selectedOptions[0].textContent.startsWith("Bluebell")), true);
await page.click("#application button[type=submit]"); await page.waitForSelector("#err-application-intent:not(:empty)");
for (const f of ["name", "deliveryArea", "experience", "children", "consent"]) assert.ok(await page.isVisible(`#err-application-${f}:not(:empty)`), `error shown for ${f}`);
await page.click('label.radio-chip:has(input[name=intent][value=reserve])'); await page.click('label.radio-chip:has(input[name=sexPreference][value=female])');
await page.fill("#application-name", "Sam Lee"); await page.fill("#application-email", "sam@example.com"); await page.fill("#application-deliveryArea", "LS1 4AP");
await page.click('label.radio-chip:has(input[name=experience][value=yes])'); await page.click('label.radio-chip:has(input[name=children][value=yes])');
await page.check("#application-consent"); await page.click("#application button[type=submit]");
await page.waitForSelector("#err-application-childrenAges:not(:empty)");
await page.fill("#application-childrenAges", "6 and 9"); await page.click("#application button[type=submit]");
await page.waitForSelector("#applyDone"); assert.match(await page.textContent("#applyDone"), /Thank you, Sam/);
step("enquiry: her questions (reserve/buy, male/female, experience, children + ages), validation, sent");

// 8. Contact form
await page.goto(BASE + "/contact?topic=delivery"); await page.waitForSelector("#contact");
assert.equal(await page.inputValue("#contact-topic"), "delivery");
await page.fill("#contact-name", "Ava"); await page.fill("#contact-email", "ava@example.com"); await page.fill("#contact-message", "Do you deliver to York?");
await page.click("#contact button[type=submit]"); await page.waitForSelector("#contactDone"); step("contact form submits with topic preselected");

// 9. Admin sees and processes them
await admin.goto(BASE + "/admin/#overview"); await admin.waitForSelector(".stats");
assert.match(await admin.textContent(".stat.hl"), /^1/);
await admin.screenshot({ path: path.join(SHOTS, "07-admin-overview.png") });
await admin.goto(BASE + "/admin/#applications"); await admin.waitForSelector("[data-app-status]");
const appId = await admin.getAttribute("[data-app-status]", "data-app-status");
const today = new Date().toISOString().slice(0, 10);
await admin.selectOption(`[data-app-status="${appId}"]`, "reserved"); await admin.fill(`[data-notes="${appId}"]`, "Called Tuesday, wants Bluebell");
await admin.fill(`#agreedFee-${appId}`, "150"); await admin.fill(`#depositAmount-${appId}`, "50"); await admin.fill(`#depositDate-${appId}`, today); await admin.fill(`#deliveryDate-${appId}`, "2027-01-15");
await admin.check(`[data-enquiry="${appId}"] [data-doc="contract"]`); await admin.check(`[data-enquiry="${appId}"] [data-doc="vaccination-record"]`);
await admin.click(`[data-app-save="${appId}"]`); await admin.waitForSelector(".pill.reserved");
assert.match(await admin.textContent(`[data-enquiry="${appId}"]`), /balance £100/);
assert.equal(await admin.isChecked(`[data-enquiry="${appId}"] [data-doc="contract"]`), true, "documents checklist saved");
assert.equal(await admin.inputValue(`#deliveryDate-${appId}`), "2027-01-15");
await admin.screenshot({ path: path.join(SHOTS, "08-admin-applications.png") });
await admin.goto(BASE + "/admin/#messages"); await admin.waitForSelector("[data-msg-toggle]"); await admin.click("[data-msg-toggle]"); await admin.waitForSelector(".pill.replied");
step("owner sees counts, reserves the enquiry with deposit, balance, delivery date and documents; marks message replied");

// 10. Status change hides pet; story publishes and nav link appears
await admin.goto(BASE + "/admin/#pets"); await admin.waitForSelector("[data-pet-status]");
const otisSel = admin.locator("[data-pet-status]").nth(1); await otisSel.selectOption("adopted"); await admin.waitForSelector("#toast.show");
await admin.goto(BASE + "/admin/#stories"); await admin.click(".a-head [data-edit-story]"); await admin.waitForSelector("#story");
await admin.fill("#story-title", "Pebble's first week at home"); await admin.fill("#story-animalName", "Pebble"); await admin.fill("#story-body", "Pebble has claimed the sunniest windowsill and purrs all evening.");
await admin.click("button[form=story]"); await admin.waitForSelector(".pill.published");
await page.goto(BASE + "/adopt"); await page.waitForSelector(".card"); assert.equal(await page.locator(".card").count(), 1, "adopted pet hidden from site");
assert.ok(await page.isVisible("#nav a[href='/happy-tails']"), "Happy tails link appears once a story exists");
await page.goto(BASE + "/happy-tails"); await page.waitForSelector(".story"); step("adopted pets leave the site; stories publish");

// 10b. Owner replaces the temporary sign-in details from the dashboard
await admin.goto(BASE + "/admin/#overview"); await admin.waitForSelector(".stats");
assert.ok(await admin.isVisible("text=signed in with the temporary password"));
await admin.goto(BASE + "/admin/#settings"); await admin.waitForSelector("#security");
await admin.fill("#security-newPassword", "short"); await admin.fill("#security-currentPassword", PASSWORD);
await admin.click("#security button[type=submit]"); await admin.waitForSelector("#err-security-newPassword:not(:empty)");
await admin.fill("#security-newEmail", "her.own@pawfamily.test"); await admin.fill("#security-newPassword", "my own lovely password");
await admin.fill("#security-confirmPassword", "my own lovely password"); await admin.fill("#security-currentPassword", "wrong password");
await admin.click("#security button[type=submit]"); await admin.waitForSelector("#err-security-currentPassword:not(:empty)");
await admin.fill("#security-newPassword", "my own lovely password"); await admin.fill("#security-confirmPassword", "my own lovely password");
await admin.fill("#security-currentPassword", PASSWORD); await admin.click("#security button[type=submit]");
await admin.waitForSelector("text=Last changed"); await admin.screenshot({ path: path.join(SHOTS, "12-admin-security.png"), fullPage: true });
await admin.click("#logout"); await admin.waitForSelector("#login");
await admin.fill("#login-email", "owner@pawfamily.test"); await admin.fill("#login-password", PASSWORD); await admin.click("#login button");
await admin.waitForSelector(".form-error"); // temporary details no longer work
await admin.fill("#login-email", "her.own@pawfamily.test"); await admin.fill("#login-password", "my own lovely password"); await admin.click("#login button");
await admin.waitForSelector(".stats"); assert.ok(!(await admin.isVisible("text=signed in with the temporary password")));
step("owner sets own email + password; temporary details stop working; reminder disappears");

// 10c. New features as a visitor and as the owner
// Parents and litters pages; reserving from a litter
await page.goto(BASE + "/parents"); await page.waitForSelector(".cat h3");
assert.equal(await page.locator(".cat h3").count(), 2);
await page.goto(BASE + "/litters"); await page.waitForSelector(".litter h3");
assert.match(await page.textContent(".litter h3"), /Clover × Atlas/);
await page.screenshot({ path: path.join(SHOTS, "14-litters.png") });
await page.click("text=Reserve from this litter"); await page.waitForSelector("#application");
assert.equal(await page.isChecked("input[name=intent][value=reserve]"), true, "reserve preselected");
assert.match(await page.inputValue("#application-message"), /Clover × Atlas \(March 2027\)/);
step("parents and litters pages; 'Reserve from this litter' preselects reserve and names the litter");

// Waiting list
await page.goto(BASE + "/adopt#alerts"); await page.waitForSelector("#alertsForm");
await page.click("#alertsForm button[type=submit]"); await page.waitForSelector("#err-alertsForm-name:not(:empty)");
await page.fill("#alertsForm-name", "Leo"); await page.fill("#alertsForm-email", "leo@example.com"); await page.selectOption("#alertsForm-sex", "female");
await page.check("#alertsForm-consent"); await page.click("#alertsForm button[type=submit]"); await page.waitForSelector("#alertsDone");
await admin.goto(BASE + "/admin/#waitlist"); await admin.waitForSelector("text=Leo");
assert.ok(await admin.isVisible("text=Alerts are switched off"), "owner told alerts need email set up");
await admin.screenshot({ path: path.join(SHOTS, "15-admin-waitlist.png") });
step("waiting list: visitor joins with validation; owner sees them; email-off notice shown");

// Happy tail submission with photo, then approval
await page.goto(BASE + "/happy-tails#share-story"); await page.waitForSelector("#storyForm");
await page.fill("#storyForm-name", "Grace"); await page.fill("#storyForm-email", "grace@example.com"); await page.fill("#storyForm-animalName", "Nutmeg");
await page.fill("#storyForm-title", "Nutmeg's first month"); await page.fill("#storyForm-body", "Nutmeg loves the garden and sleeps on our bed every night.");
await page.setInputFiles("#storyForm-photo", photoPath); await page.waitForSelector("text=Photo ready");
await page.check("#storyForm-consent"); await page.click("#storyForm button[type=submit]"); await page.waitForSelector("#storyDone");
await page.goto(BASE + "/happy-tails"); await page.waitForSelector(".stories");
assert.equal(await page.locator(".story h3", { hasText: "Nutmeg's first month" }).count(), 0, "not public before approval");
await admin.goto(BASE + "/admin/#overview"); await admin.waitForSelector(".stats");
assert.ok(await admin.isVisible("text=waiting for your approval"));
await admin.goto(BASE + "/admin/#stories"); await admin.waitForSelector("[data-approve-story]");
await admin.click("[data-approve-story]"); await admin.waitForSelector("#toast.show");
await page.goto(BASE + "/happy-tails"); await page.waitForSelector(".story h3");
assert.equal(await page.locator(".story h3", { hasText: "Nutmeg's first month" }).count(), 1, "public after approval");
assert.equal(await page.locator(".story img").count() >= 1, true, "photo shown");
step("happy tails: visitor sends story + photo; hidden until owner approves; then published");

// Share preview + sitemap + robots
const petSlug = await page.evaluate(async () => (await (await fetch("/api/public/site")).json()).animals[0].slug);
const petHtml = await page.evaluate(async s => (await fetch(`/adopt/${s}`)).text(), petSlug);
assert.match(petHtml, /<meta property="og:title" content="Meet Bluebell/);
assert.match(petHtml, /<meta property="og:image" content="http:\/\/localhost:\d+\/api\/images\/[a-f0-9]{24}">/);
await page.goto(BASE + `/adopt/${petSlug}`); await page.waitForSelector(".profile h1"); // the page still works as normal
const sitemap = await page.evaluate(async () => (await fetch("/sitemap.xml")).text());
assert.ok(sitemap.includes(`/adopt/${petSlug}</loc>`));
assert.match(await page.evaluate(async () => (await fetch("/robots.txt")).text()), /Sitemap: http:\/\/localhost:\d+\/sitemap\.xml/);
step("pet pages carry Facebook/Google previews; sitemap lists pets; robots points to it");

// Visitors
await admin.goto(BASE + "/admin/#visitors"); await admin.waitForSelector(".stats");
const views30 = Number(await admin.textContent(".stats .stat:nth-child(2) b"));
assert.ok(views30 > 0, "page views were counted");
assert.ok(await admin.isVisible("svg[aria-label^='Daily page views']"));
await admin.screenshot({ path: path.join(SHOTS, "16-admin-visitors.png"), fullPage: true });
assert.ok(!(await admin.isVisible('.a-nav a[href="#more"]')), "phone-only More item hidden on desktop");
step(`visitors: anonymous views counted (${views30} in this test) with chart and top pets`);

// Backups
await admin.goto(BASE + "/admin/#backup"); await admin.waitForSelector("#backupNow");
await admin.click("#backupNow"); await admin.waitForSelector("[data-backup-dl]");
const [bdl] = await Promise.all([admin.waitForEvent("download"), admin.click("[data-backup-dl]")]);
assert.match(bdl.suggestedFilename(), /^pawfamily-backup-\d{4}-\d{2}-\d{2}\.json$/);
step("backups: save now, listed, downloadable");

// 11. Backup, logout, session gone
const [dl] = await Promise.all([admin.waitForEvent("download"), (async () => { await admin.goto(BASE + "/admin/#backup"); await admin.click("#downloadBackup"); })()]);
assert.match(dl.suggestedFilename(), /^pawfamily-backup-\d{4}-\d{2}-\d{2}\.json$/);
await admin.click("#logout"); await admin.waitForSelector("#login");
const after = await admin.evaluate(() => fetch("/api/admin/summary", { headers: { "x-requested-with": "pawfamily" } }).then(r => r.status));
assert.equal(after, 401); step("backup downloads; sign-out ends the session");

// 12. Phone layout: four common phone sizes, no sideways scrolling anywhere
await page.goto(BASE + "/adopt"); await page.waitForSelector(".card");
const slug = await page.evaluate(async () => (await (await fetch("/api/public/site")).json()).animals[0].slug);
const PUBLIC = ["/", "/adopt", "/adopt/" + slug, "/how-to-adopt", "/parents", "/litters", "/about", "/faq", "/contact", "/privacy", "/happy-tails"];
for (const [w, h, label] of [[360, 740, "small Android"], [375, 667, "iPhone SE"], [393, 852, "iPhone 15"], [412, 915, "Pixel"]]) {
  const c = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
  const pg = await c.newPage(); watch(pg);
  for (const p of PUBLIC) {
    await pg.goto(BASE + p); await pg.waitForSelector("main h1");
    assert.equal(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `horizontal scroll on ${p} (${label})`);
  }
  await pg.goto(BASE + "/admin/"); await pg.waitForSelector("#login");
  assert.equal(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `horizontal scroll on admin (${label})`);
  await c.close();
}
step("phone: no horizontal scrolling on 12 pages at 4 phone sizes (360–412 px)");

// 13. Phone design: pets first, swipeable cards, tab bar, dismissible announcement
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const m = await phone.newPage(); watch(m);
await m.goto(BASE + "/"); await m.waitForSelector(".hero h1");
await m.screenshot({ path: path.join(SHOTS, "09-phone-home.png") });
assert.ok(await m.isVisible("#tabbar"), "bottom tab bar visible");
assert.equal(await m.getAttribute('#tabbar a[data-tab="home"]', "aria-current"), "page");
assert.ok(!(await m.isVisible(".hero-pic")), "big hero photo hidden on phones");
const yPets = (await m.locator(".o-pets").boundingBox()).y, yTrust = (await m.locator(".o-trust").boundingBox()).y;
assert.ok(yPets < yTrust, "pets appear before the trust badges");
assert.equal(await m.$eval(".o-pets .carousel", el => getComputedStyle(el).display), "flex", "home pets are a swipeable row");
assert.ok(await m.isVisible("#announce")); await m.click("[data-dismiss-announce]"); assert.ok(!(await m.isVisible("#announce")));
await m.reload(); await m.waitForSelector(".hero h1"); assert.ok(!(await m.isVisible("#announce")), "dismissal remembered");
step("phone home: pets first, swipeable cards, tab bar, announcement dismissal remembered");

// 14. Phone pets page: 2 per row, sticky filters
await m.click('#tabbar a[data-tab="pets"]'); await m.waitForSelector(".card");
assert.equal(await m.$eval("#petGrid", el => getComputedStyle(el).gridTemplateColumns.split(" ").length), 2, "two pets per row");
assert.equal(await m.$eval("#filters", el => getComputedStyle(el).position), "sticky");
await m.screenshot({ path: path.join(SHOTS, "10-phone-pets.png") });
step("phone pets: 2 per row with sticky filter bar");

// 15. Phone profile: sticky Apply bar replaces the tab bar; back button returns
await m.click(".card"); await m.waitForSelector(".profile h1");
assert.ok(await m.isVisible(".sticky-apply"), "sticky apply bar visible");
assert.ok(!(await m.isVisible("#tabbar")), "tab bar hidden behind the apply bar");
assert.match(await m.textContent(".sticky-apply"), /£150/);
assert.ok(await m.isVisible(".fact-chips") && !(await m.isVisible(".facts")), "facts shown as chips");
await m.screenshot({ path: path.join(SHOTS, "11-phone-profile.png") });
await m.click("[data-back]"); await m.waitForSelector("#petGrid"); assert.match(m.url(), /\/adopt$/);
await m.click(".card"); await m.waitForSelector(".sticky-apply");
step("phone kitten page: swipe gallery, fact chips, sticky £150 Enquire bar, back button");

// 16. Phone enquiry: 3 short steps
await m.click(".sticky-apply .btn"); await m.waitForSelector("#application.wizard");
assert.ok(await m.isVisible('fieldset[data-step="1"]') && !(await m.isVisible('fieldset[data-step="2"]')), "only step 1 shown");
assert.ok(!(await m.isVisible("#application button[type=submit]")), "send button waits for the last step");
await m.click(".wizard-nav .next"); await m.waitForSelector("#err-application-intent:not(:empty)");
assert.ok(!(await m.isVisible("#err-application-name:not(:empty)")), "only this step's fields are checked");
await m.click('label.radio-chip:has(input[name=intent][value=buy])');
await m.screenshot({ path: path.join(SHOTS, "12-phone-apply-step1.png") });
await m.click(".wizard-nav .next"); await m.waitForSelector('fieldset[data-step="2"].on');
await m.fill("#application-name", "Mia Patel"); await m.fill("#application-email", "mia@example.com"); await m.fill("#application-deliveryArea", "LS6 2AB");
await m.click('label.radio-chip:has(input[name=experience][value=no])'); await m.click('label.radio-chip:has(input[name=children][value=no])');
await m.click(".wizard-nav .next"); await m.waitForSelector('fieldset[data-step="3"].on');
await m.click(".wizard-nav .prev"); await m.waitForSelector('fieldset[data-step="2"].on');
assert.equal(await m.inputValue("#application-name"), "Mia Patel", "answers kept when going back");
await m.click(".wizard-nav .next"); await m.waitForSelector('fieldset[data-step="3"].on');
await m.check("#application-consent");
await m.click("#application button[type=submit]"); await m.waitForSelector("#applyDone");
step("phone enquiry: 3 steps, per-step checks, answers kept, sent");

// 17. Owner dashboard on a phone
await m.goto(BASE + "/admin/"); await m.waitForSelector("#login");
await m.fill("#login-email", "her.own@pawfamily.test"); await m.fill("#login-password", "my own lovely password"); await m.click("#login button");
await m.waitForSelector(".stats");
assert.equal(await m.$eval(".a-nav", el => getComputedStyle(el).position), "fixed", "bottom navigation");
assert.ok(await m.isVisible(".fab"), "floating add button");
await m.screenshot({ path: path.join(SHOTS, "13-phone-dashboard.png") });
await m.click('.a-nav a[href="#more"]'); await m.waitForSelector(".more-links");
assert.ok(await m.isVisible('.more-links a[href="#settings"]') && await m.isVisible('.more-links a[href="#parents"]') && await m.isVisible('.more-links a[href="#litters"]'));
await m.click('.a-nav a[href="#applications"]'); await m.waitForSelector("details.app-more");
assert.equal(await m.$eval("details.app-more", d => d.open), false, "application details start collapsed on phones");
await m.click('.a-nav a[href="#pets"]'); await m.waitForSelector(".fab"); await m.click(".fab"); await m.waitForSelector("#pet");
await m.click("[data-close]");
step("phone dashboard: bottom nav, More page, collapsed details, floating + Add kitten");

await page.goto(BASE + "/"); await page.waitForSelector(".card"); await page.screenshot({ path: path.join(SHOTS, "11-home-full.png"), fullPage: true });

await browser.close(); server.kill();
if (problems.length) { console.error("\nProblems found:\n" + [...new Set(problems)].join("\n")); process.exit(1); }
console.log(`\nAll end-to-end checks passed. Screenshots: ${SHOTS}`);
