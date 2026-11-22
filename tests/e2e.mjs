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
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
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
assert.match(await page.textContent(".hero h1"), /Every rescue deserves/);
assert.ok(await page.isVisible("text=New friends coming soon"));
await page.screenshot({ path: path.join(SHOTS, "01-home-empty.png") });
step("empty home page renders with designed empty state");

// 2. Every public route renders
for (const [p, h] of [["/adopt", "Meet our pets"], ["/how-to-adopt", "How to adopt"], ["/about", "About Pawfamily"], ["/help", "Ways to help"], ["/faq", "Frequently asked"], ["/contact", "Contact us"], ["/privacy", "Privacy notice"], ["/nope", "Sorry"]]) {
  await page.goto(BASE + p); await page.waitForSelector("main h1");
  assert.match(await page.textContent("main h1"), new RegExp(h), p);
}
step("all 9 public pages + not-found render");

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
await admin.fill("#settings-email", "hello@pawfamilyfreehome.com"); await admin.fill("#settings-defaultFee", "150");
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
await admin.goto(BASE + "/admin/#pets"); await admin.waitForSelector("text=No pets yet");
await admin.click(".a-head [data-new-pet]"); await admin.waitForSelector("#pet");
await admin.click("#pet button[type=submit], button[form=pet]"); await admin.waitForSelector("#err-pet-name:not(:empty)"); step("pet editor requires a name");
await admin.setInputFiles("#petFiles", [photoPath, photoPath]); await admin.waitForFunction(() => document.querySelectorAll("#photoGrid img").length === 2);
await admin.click("[data-photo-remove='1']"); await admin.waitForFunction(() => document.querySelectorAll("#photoGrid img").length === 1);
await admin.fill("#pet-name", "Bluebell"); await admin.selectOption("#pet-ageGroup", "baby"); await admin.fill("#pet-breed", "Ragdoll");
await admin.fill("#pet-summary", "A gentle, floppy kitten who loves a lap."); await admin.fill("#pet-story", "Bluebell was found in a garden shed.\n\nNow she's healthy and ready for her family.");
await admin.check("input[name=traits][value=lap-cat]"); await admin.check("input[name=health][value=vaccinated]"); await admin.check("input[name=featured]");
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
assert.match(page.url(), /\/adopt\/bluebell-[a-f0-9]{5}$/);
await page.screenshot({ path: path.join(SHOTS, "06-profile.png"), fullPage: true });
step("public listing, filters, profile, fee and XSS-safe rendering");

// 7. Apply to adopt from the profile
await page.click("text=Apply to adopt Bluebell"); await page.waitForSelector("#application");
assert.equal(await page.$eval("#application-animalId", el => el.selectedOptions[0].textContent.startsWith("Bluebell")), true);
await page.click("#application button[type=submit]"); await page.waitForSelector("#err-application-name:not(:empty)");
assert.ok(await page.isVisible("#err-application-consent:not(:empty)"));
await page.fill("#application-name", "Sam Lee"); await page.fill("#application-email", "sam@example.com"); await page.fill("#application-postcode", "LS1 4AP");
await page.fill("#application-household", "Two adults"); await page.fill("#application-message", "We work from home and would adore Bluebell.");
await page.check("#application-consent"); await page.click("#application button[type=submit]");
await page.waitForSelector("#applyDone"); assert.match(await page.textContent("#applyDone"), /Thank you, Sam/);
step("adoption application: validation then successful submit");

// 8. Contact form
await page.goto(BASE + "/contact?topic=fostering"); await page.waitForSelector("#contact");
assert.equal(await page.inputValue("#contact-topic"), "fostering");
await page.fill("#contact-name", "Ava"); await page.fill("#contact-email", "ava@example.com"); await page.fill("#contact-message", "I'd love to foster kittens this spring.");
await page.click("#contact button[type=submit]"); await page.waitForSelector("#contactDone"); step("contact form submits with topic preselected");

// 9. Admin sees and processes them
await admin.goto(BASE + "/admin/#overview"); await admin.waitForSelector(".stats");
assert.match(await admin.textContent(".stat.hl"), /^1/);
await admin.screenshot({ path: path.join(SHOTS, "07-admin-overview.png") });
await admin.goto(BASE + "/admin/#applications"); await admin.waitForSelector("[data-app-status]");
const appId = await admin.getAttribute("[data-app-status]", "data-app-status");
await admin.selectOption(`[data-app-status="${appId}"]`, "home-check"); await admin.fill(`[data-notes="${appId}"]`, "Home visit booked Tuesday 2pm");
await admin.click(`[data-app-save="${appId}"]`); await admin.waitForSelector(".pill.home-check");
await admin.screenshot({ path: path.join(SHOTS, "08-admin-applications.png") });
await admin.goto(BASE + "/admin/#messages"); await admin.waitForSelector("[data-msg-toggle]"); await admin.click("[data-msg-toggle]"); await admin.waitForSelector(".pill.replied");
step("owner sees counts, moves application to home check with notes, marks message replied");

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

// 11. Backup, logout, session gone
const [dl] = await Promise.all([admin.waitForEvent("download"), (async () => { await admin.goto(BASE + "/admin/#backup"); await admin.click("#downloadBackup"); })()]);
assert.match(dl.suggestedFilename(), /^pawfamily-backup-\d{4}-\d{2}-\d{2}\.json$/);
await admin.click("#logout"); await admin.waitForSelector("#login");
const after = await admin.evaluate(() => fetch("/api/admin/summary", { headers: { "x-requested-with": "pawfamily" } }).then(r => r.status));
assert.equal(after, 401); step("backup downloads; sign-out ends the session");

// 12. Phone layout: no sideways scroll on any page, menu works
const phone = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
const m = await phone.newPage(); watch(m);
for (const p of ["/", "/adopt", "/how-to-adopt", "/about", "/help", "/faq", "/contact", "/privacy", "/happy-tails"]) {
  await m.goto(BASE + p); await m.waitForSelector("main h1");
  assert.equal(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `horizontal scroll on ${p}`);
}
await m.goto(BASE + "/"); await m.waitForSelector(".hero"); await m.screenshot({ path: path.join(SHOTS, "09-phone-home.png") });
await m.click("#menuBtn"); assert.ok(await m.isVisible("#drawer")); await m.screenshot({ path: path.join(SHOTS, "10-phone-menu.png") });
await m.goto(BASE + "/admin/"); await m.waitForSelector("#login");
assert.equal(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "horizontal scroll on admin");
step("phone: no horizontal scrolling on any page; menu opens");

await page.goto(BASE + "/"); await page.waitForSelector(".card"); await page.screenshot({ path: path.join(SHOTS, "11-home-full.png"), fullPage: true });

await browser.close(); server.kill();
if (problems.length) { console.error("\nProblems found:\n" + [...new Set(problems)].join("\n")); process.exit(1); }
console.log(`\nAll end-to-end checks passed. Screenshots: ${SHOTS}`);
