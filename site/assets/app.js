// Pawfamily public website (single-page app, history routing). All dynamic text is escaped with esc().
import { esc, $, $$, LABELS, money, feeFor, ageText, fmtDate, LOGO, PAW, photo, toast, api, showFieldErrors, formError, busy, field, check, isPhone, resizeImage } from "./ui.js";

const ICON = {
  back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  share: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7"/><path d="M16 6l-4-4-4 4M12 2v13"/></svg>',
};
let navDepth = 0; // in-app navigations, so the phone back button can return to the previous page

let SITE = null; // { settings, animals, stories }
const filters = { species: "all", sex: "all", age: "all" };

/* ---------------- icons ---------------- */
const I = {
  meet: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 4.5a3 3 0 010 6M18 14.5c2 .8 3 2.8 3 5.5"/></svg>',
  vet: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l7 3v6c0 5-3.5 9-7 11-3.5-2-7-6-7-11V5z"/><path d="M9 12l2 2 4-4"/></svg>',
  home: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/></svg>',
  heart: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z"/></svg>',
  foster: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M12 17s-3-1.8-3-4a1.6 1.6 0 013-.9 1.6 1.6 0 013 .9c0 2.2-3 4-3 4z"/></svg>',
  hands: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 11V6a1.5 1.5 0 013 0v4M10 10V4.5a1.5 1.5 0 013 0V10M13 10V5.5a1.5 1.5 0 013 0V12"/><path d="M16 9.5a1.5 1.5 0 013 0V14a7 7 0 01-7 7h-1a6 6 0 01-5.2-3L3.5 14a1.5 1.5 0 012.6-1.5L7 14"/></svg>',
  gift: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12M12 8S10.5 3 8 4s1 4 4 4zM12 8s1.5-5 4-4-1 4-4 4z"/></svg>',
};

/* ---------------- helpers ---------------- */
const S = () => SITE.settings;
const listed = () => SITE.animals;
const byPriority = list => [...list].sort((a, b) => (a.status === "available" ? 0 : 1) - (b.status === "available" ? 0 : 1) || (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || String(b.createdAt).localeCompare(String(a.createdAt)));
const animalLine = a => [LABELS.species[a.species], LABELS.sex[a.sex], ageText(a)].filter(Boolean).join(" · ");
const lowestFee = () => {
  const fees = listed().map(a => a.fee ?? S().defaultFee).filter(f => f !== null && f !== undefined);
  return fees.length ? Math.min(...fees) : S().defaultFee;
};
const feeSentence = () => {
  const f = lowestFee();
  return f !== null && f !== undefined ? `Adoption fees from <b>${esc(money(f, S().currency))}</b>, covering vet care` : "An adoption fee applies, covering vet care";
};
const placeLine = () => [S().town, S().region].filter(Boolean).join(", ");
const paras = text => String(text || "").split(/\n{2,}/).map(p => p.trim()).filter(Boolean).map(p => `<p>${esc(p)}</p>`).join("");

function card(a) {
  const fee = feeFor(a, S());
  return `<a class="card" href="/adopt/${esc(a.slug)}">
    ${photo(a.photos?.[0], `${a.name}, ${animalLine(a).toLowerCase()}`, { thumb: true, pill: `<span class="pill ${esc(a.status)}">${esc(LABELS.status[a.status])}</span>` })}
    <div class="info"><div class="top"><h3>${esc(a.name)}</h3></div>
      <span class="sub">${esc(animalLine(a))}${a.breed ? ` · ${esc(a.breed)}` : ""}</span>
      <span class="fee">${fee ? `Adoption fee ${esc(fee)}` : "Adoption fee: ask us"}</span></div></a>`;
}
const storyCard = s => `<article class="story">${s.photo ? photo(s.photo, s.animalName || s.title, { thumb: true }) : ""}<div class="body">
  ${s.animalName ? `<span class="who">${esc(s.animalName)}</span>` : ""}<h3>${esc(s.title)}</h3><p>${esc(s.body.length > 260 ? s.body.slice(0, 257).trim() + "…" : s.body)}</p></div></article>`;

const trustStrip = () => `<div class="trust o-trust"><div class="wrap">
  <div>${I.meet}<b>Meet before you pay</b><span>No fee until you've met your pet</span></div>
  <div>${I.vet}<b>Vet checked</b><span>Health checked, vaccinated and microchipped</span></div>
  <div>${I.home}<b>Home checks</b><span>Every adoption has a home visit and agreement</span></div>
  <div>${I.heart}<b>Support for life</b><span>We're here long after adoption day</span></div></div></div>`;

const helpBand = (extra = "") => `<section class="band ${extra}"><div class="wrap"><div><div class="eyebrow">Every rescue needs a team</div>
  <h2>Can't adopt right now? You can still help.</h2><p>Foster a pet while they wait for a home, volunteer with us, or donate towards vet bills.</p></div>
  <div class="btn-row"><a class="btn blush" href="/help">Ways to help</a>${S().donateUrl ? '<a class="btn light on-dark" href="/donate">Donate</a>' : ""}</div></div></section>`;

/* ---------------- pages ---------------- */
function pHome() {
  const animals = byPriority(listed());
  const avail = animals.filter(a => a.status === "available");
  const hero = animals.find(a => a.photos?.length);
  const stories = SITE.stories.slice(0, 3);
  return `
  <div class="home">
  <section class="hero o-hero"><div class="wrap">
    <div>
      <div class="eyebrow">Pet rescue &amp; rehoming${placeLine() ? ` · ${esc(placeLine())}` : ""}</div>
      <h1>Every rescue deserves <em>a family</em>.</h1>
      <p class="lead lead-long">We rescue cats and other pets, nurse them back to health, and match each one with a loving home. Meet the pets waiting for you.</p>
      <p class="lead lead-short">Meet the pets waiting for a home. ${feeSentence()}.</p>
      <div class="btn-row"><a class="btn" href="/adopt">Meet our pets</a><a class="btn light" href="/how-to-adopt">How adoption works</a></div>
      <p class="fee-note">${feeSentence()}, vaccinations and microchipping.</p>
    </div>
    <div class="hero-pic">${hero ? photo(hero.photos[0], `${hero.name}, one of our rescue pets`, { eager: true }) : photo(null, "")}
      <a class="hero-card" href="/adopt"><span class="num">${avail.length}</span><span><b>${avail.length === 1 ? "Pet" : "Pets"} looking for a home</b><span>Meet them now →</span></span></a></div>
  </div></section>
  ${trustStrip()}
  <section class="sec o-pets"><div class="wrap">
    <div class="sec-head"><div><div class="eyebrow">Looking for a home</div><h2><span class="lead-long">Meet our pets</span><span class="lead-short">Looking for a home</span></h2><p>Each one has been vet checked and is ready to meet their new family.</p></div>${animals.length ? `<a class="link" href="/adopt">See all${animals.length > 1 ? ` ${animals.length}` : ""}<span class="lead-long"> pets</span> →</a>` : ""}</div>
    <div class="grid carousel">${animals.slice(0, 6).map(card).join("") || emptyPets()}</div>
  </div></section>
  <section class="sec tint o-steps"><div class="wrap">
    <div class="sec-head"><div><div class="eyebrow">Simple and safe</div><h2>How adoption works</h2></div><a class="link" href="/how-to-adopt">Full details →</a></div>
    <div class="steps-full">${stepsHtml()}</div>
    <a class="steps-pills" href="/how-to-adopt" aria-label="How adoption works: apply, chat, meet, adopt"><span>1 Apply</span><i aria-hidden="true">›</i><span>2 Chat</span><i aria-hidden="true">›</i><span>3 Meet</span><i aria-hidden="true">›</i><span>4 Adopt</span></a>
  </div></section>
  ${stories.length ? `<section class="sec o-stories"><div class="wrap"><div class="sec-head"><div><div class="eyebrow">Happy tails</div><h2>Now living their best lives</h2></div><a class="link" href="/happy-tails">More stories →</a></div><div class="stories carousel">${stories.map(storyCard).join("")}</div></div></section>` : ""}
  ${helpBand("o-band")}
  </div>`;
}
const emptyPets = () => `<div class="empty"><h3>New friends coming soon</h3><p>All our pets have found homes for now. Follow us${S().facebookUrl ? " on Facebook" : ""} to meet new arrivals first, or register your interest.</p>
  <div class="btn-row">${S().facebookUrl ? `<a class="btn sm" href="${esc(S().facebookUrl)}" target="_blank" rel="noopener noreferrer">Follow on Facebook</a>` : ""}<a class="btn light sm" href="/adopt#alerts">Get new-pet alerts</a></div></div>`;
const stepsHtml = () => `<div class="steps">
  <div class="step"><div class="n">1</div><h3>Apply</h3><p>Choose a pet (or tell us what you're looking for) and fill in a short application.</p></div>
  <div class="step"><div class="n">2</div><h3>Chat</h3><p>We'll call to talk about your home, routine and the pet that would suit you best.</p></div>
  <div class="step"><div class="n">3</div><h3>Meet &amp; home check</h3><p>Meet your pet in person, and we'll visit your home to make sure it's a great fit.</p></div>
  <div class="step"><div class="n">4</div><h3>Adopt</h3><p>Sign the adoption agreement, pay the adoption fee, and welcome your pet home.</p></div></div>`;

function pAdopt() {
  return `<div class="page-head"><div class="wrap"><div class="eyebrow">Adopt</div><h1>Meet our pets</h1>
    <p class="lead">Every pet has been vet checked, vaccinated and microchipped. ${feeSentence()}.</p></div></div>
    <section class="sec tight"><div class="wrap"><div class="filters" id="filters"></div><p class="count-line" id="countLine" aria-live="polite"></p><div class="grid" id="petGrid"></div></div></section>
    <section class="sec tint" id="alerts"><div class="wrap form-layout"><div class="form-card" id="alertsCard"></div>
      <aside class="side"><div><h3>How alerts work</h3><ul class="ticks"><li>Tell us what you're looking for</li><li>We email you the moment a matching pet is listed</li><li>One click in any email to stop alerts</li></ul></div></aside></div></section>
    ${helpBand()}`;
}
function renderAlertsForm() {
  const f = "alertsForm";
  const sel = (map, any) => `<option value="any">${any}</option>` + Object.entries(map).map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  $("#alertsCard").innerHTML = `<div class="eyebrow">Waiting list</div><h2>Not found the one yet?</h2><p class="muted">Get an email when a pet matching your wishes arrives.</p>
  <form class="stack mt-m" id="${f}" novalidate>
    <div class="hp" aria-hidden="true"><label for="${f}-website">Leave this empty</label><input id="${f}-website" name="website" tabindex="-1" autocomplete="off"></div>
    <div class="row2">${field(f, "name", "Your name", `<input <CONTROL autocomplete="name" maxlength="100">`)}${field(f, "email", "Email", `<input <CONTROL type="email" autocomplete="email" maxlength="200">`)}</div>
    <div class="row2">${field(f, "species", "Type of pet", `<select <CONTROL>${sel(LABELS.species, "Any type")}</select>`)}${field(f, "sex", "Sex", `<select <CONTROL>${sel({ female: "Female", male: "Male" }, "Any sex")}</select>`)}</div>
    ${field(f, "ageGroup", "Age", `<select <CONTROL>${sel(Object.fromEntries(Object.entries(LABELS.age).map(([k, l]) => [k, `${l} (${LABELS.ageHelp[k]})`])), "Any age")}</select>`)}
    <label class="checkline"><input type="checkbox" name="consent" id="${f}-consent" aria-describedby="err-${f}-consent"><span>Email me about matching pets. I can stop at any time (<a class="link" href="/privacy">privacy</a>).</span></label>
    <span class="err" id="err-${f}-consent"></span>
    <div><button class="btn" type="submit">Get alerts</button></div></form>`;
  const form = $("#" + f);
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form)); d.consent = form.consent.checked;
    const errs = {};
    const n = check.required(d.name, "Your name") || check.min(d.name, 2, "Your name"); if (n) errs.name = n;
    const em = check.email(d.email); if (em) errs.email = em;
    if (!d.consent) errs.consent = "Please tick to confirm we may email you.";
    formError(form, ""); if (showFieldErrors(form, errs)) return;
    const btn = $("button[type=submit]", form); busy(btn, true, "Saving…");
    try {
      const res = await api("/api/public/waitlist", { method: "POST", body: d });
      $("#alertsCard").innerHTML = `<div class="done" tabindex="-1" id="alertsDone"><div class="ok" aria-hidden="true">✓</div><h3>${res.already ? "You're already on the list" : "You're on the list"}</h3>
        <p class="muted">We'll email <b>${esc(d.email.trim())}</b> as soon as a matching pet is listed.</p></div>`;
      $("#alertsDone").focus();
    } catch (err) { busy(btn, false); showFieldErrors(form, err.fields); formError(form, err.message); }
  });
}
function renderAdoptGrid() {
  const all = listed();
  const species = [...new Set(all.map(a => a.species))];
  if (filters.species !== "all" && !species.includes(filters.species)) filters.species = "all";
  $("#filters").innerHTML = `<div class="chips" role="group" aria-label="Filter by type">
      <button type="button" class="chip" data-f-species="all" aria-pressed="${filters.species === "all"}">All pets<span class="c">${all.length}</span></button>
      ${species.map(s => `<button type="button" class="chip" data-f-species="${esc(s)}" aria-pressed="${filters.species === s}">${esc(LABELS.speciesPlural[s])}<span class="c">${all.filter(a => a.species === s).length}</span></button>`).join("")}</div>
    <div class="selects">
      <label class="sr-only" for="fSex">Sex</label><select id="fSex" data-f="sex"><option value="all">Any sex</option>${["female", "male"].map(v => `<option value="${v}" ${filters.sex === v ? "selected" : ""}>${LABELS.sex[v]}</option>`).join("")}</select>
      <label class="sr-only" for="fAge">Age</label><select id="fAge" data-f="age"><option value="all">Any age</option>${Object.entries(LABELS.age).map(([v, l]) => `<option value="${v}" ${filters.age === v ? "selected" : ""}>${l} (${LABELS.ageHelp[v]})</option>`).join("")}</select></div>`;
  const list = byPriority(all).filter(a => (filters.species === "all" || a.species === filters.species) && (filters.sex === "all" || a.sex === filters.sex) && (filters.age === "all" || a.ageGroup === filters.age));
  $("#countLine").textContent = all.length ? `Showing ${list.length} of ${all.length} pet${all.length === 1 ? "" : "s"}` : "";
  $("#petGrid").innerHTML = list.map(card).join("") || (all.length
    ? `<div class="empty"><h3>No pets match</h3><p>Try a different filter, or register your interest and we'll tell you when the right pet arrives.</p><button class="btn light sm" type="button" data-reset-filters>Clear filters</button></div>`
    : emptyPets());
}

function pPet(slug) {
  const a = listed().find(x => x.slug === slug);
  if (!a) return pNotFound("That pet isn't listed any more. They may have found their home already.");
  const fee = feeFor(a, S());
  const pics = a.photos?.length ? a.photos : [null];
  const healthAll = Object.keys(LABELS.health);
  const pron = a.sex === "male" ? "his" : a.sex === "female" ? "her" : "their";
  const chips = [LABELS.sex[a.sex], ageText(a), ...(a.traits || []).slice(0, 2).map(t => LABELS.traits[t] || t), ...(a.health?.includes("vaccinated") ? ["Vaccinated"] : [])].filter(Boolean);
  const longStory = (a.story || "").length > 260;
  const applyHref = `/how-to-adopt?pet=${encodeURIComponent(a.slug)}#apply`;
  return `<div class="wrap profile">
    <div class="swipe-wrap"><div class="swipe" id="swipe" tabindex="0" aria-label="Photos of ${esc(a.name)}">${pics.map((p, i) => photo(p, `${a.name}, photo ${i + 1} of ${pics.length}`, { eager: i === 0 })).join("")}</div>
      <button class="swipe-btn back" type="button" data-back aria-label="Back">${ICON.back}</button>
      <button class="swipe-btn share" type="button" data-share="${esc(a.slug)}" aria-label="Share ${esc(a.name)}">${ICON.share}</button>
      ${pics.length > 1 ? `<span class="swipe-count" id="swipeCount" aria-hidden="true">1 / ${pics.length}</span>` : ""}</div>
    <div class="gallery">${photo(pics[0], `${a.name}, photo 1 of ${pics.length}`, { cls: "main", eager: true })}
      ${pics.length > 1 ? `<div class="thumbs">${pics.map((p, i) => `<button type="button" data-photo="${esc(p)}" data-index="${i}" aria-pressed="${i === 0}" aria-label="Show photo ${i + 1}"><img src="/api/images/${esc(p)}" alt="" loading="lazy" data-fallback></button>`).join("")}</div>` : ""}</div>
    <div>
      <div class="crumbs"><a href="/adopt">Meet our pets</a> / ${esc(a.name)}</div>
      <span class="pill ${esc(a.status)}">${esc(LABELS.status[a.status])}</span>
      <h1>${esc(a.name)}</h1>
      <p class="desc">${esc(animalLine(a))}${a.breed ? ` · ${esc(a.breed)}` : ""}</p>
      ${a.summary ? `<p class="lead mt-s">${esc(a.summary)}</p>` : ""}
      <div class="fact-chips">${chips.map(c => `<span>${esc(c)}</span>`).join("")}</div>
      <dl class="facts">
        <div><dt>Type</dt><dd>${esc(LABELS.species[a.species])}</dd></div><div><dt>Breed</dt><dd>${esc(a.breed || "Mixed / unknown")}</dd></div>
        <div><dt>Sex</dt><dd>${esc(LABELS.sex[a.sex])}</dd></div><div><dt>Age</dt><dd>${esc(ageText(a))}</dd></div>
        ${a.birthDate ? `<div><dt>Born</dt><dd>${esc(fmtDate(a.birthDate))}</dd></div><div><dt>Age group</dt><dd>${esc(LABELS.age[a.ageGroup])}</dd></div>` : ""}
      </dl>
      <div class="fee-box"><span class="eyebrow">Adoption fee</span><span class="amt">${fee ? esc(fee) : "Ask us"}</span>${S().feeIncludes ? `<p>Includes: ${esc(S().feeIncludes)}</p>` : ""}<p class="hint">Paid only after you've met ${esc(a.name)} and your home check is approved.</p></div>
      <div class="btn-row mt-m"><a class="btn" href="/how-to-adopt?pet=${encodeURIComponent(a.slug)}#apply">${a.status === "reserved" ? `Apply as a backup home` : `Apply to adopt ${esc(a.name)}`}</a>
        <button class="btn light" type="button" data-share="${esc(a.slug)}">Share</button></div>
      ${a.status === "reserved" ? `<p class="hint mt-s">${esc(a.name)} is reserved. If the adoption doesn't go ahead, we'll contact backup applicants.</p>` : ""}
      ${a.story ? `<h2>${esc(a.name)}'s story</h2><div class="story-text ${longStory ? "clamped" : ""}" id="storyText"><div class="prose">${paras(a.story)}</div></div>${longStory ? `<button class="link read-more" type="button" data-read-more>Read ${pron} full story</button>` : ""}` : ""}
      ${a.traits?.length ? `<h2>Personality</h2><div class="tags">${a.traits.map(t => `<span class="tag">${esc(LABELS.traits[t] || t)}</span>`).join("")}</div>` : ""}
      <h2>Health</h2><ul class="ticks">${healthAll.map(h => `<li class="${a.health?.includes(h) ? "" : "no"}">${esc(LABELS.health[h])}${a.health?.includes(h) ? "" : " (not yet)"}</li>`).join("")}</ul>
      ${a.healthNotes ? `<p class="muted mt-s">${esc(a.healthNotes)}</p>` : ""}
    </div></div>
    <div class="sticky-apply"><div><span class="amt">${fee ? esc(fee) : "Ask us"}</span><small>Adoption fee · pay after you meet</small></div>
      <a class="btn" href="${applyHref}">${a.status === "reserved" ? "Apply as backup" : "Apply to adopt"}</a></div>`;
}

function pHowTo() {
  return `<div class="page-head"><div class="wrap"><div class="eyebrow">Adopting with us</div><h1>How to adopt</h1>
    <p class="lead">Our process makes sure every pet goes to the right home, and that you feel confident and supported.</p></div></div>
    <section class="sec">${'<div class="wrap">' + stepsHtml() + "</div>"}</section>
    <section class="sec tint"><div class="wrap split">
      <div><div class="eyebrow">Adoption fee</div><h2>What your fee covers</h2>
        <p class="lead">${feeSentence()}. ${S().feeIncludes ? esc(S().feeIncludes) : ""}</p>
        <ul class="ticks mt-m"><li>You only pay after meeting your pet and passing the home check</li><li>We never ask for payment to "reserve" or deliver a pet you haven't met</li><li>Your fee goes straight back into rescuing the next pet</li></ul></div>
      <div><div class="eyebrow">Before you apply</div><h2>What we look for</h2>
        <ul class="ticks"><li>Over 18, with permission to keep pets if you rent</li><li>A safe home, ideally away from busy roads for cats who go outside</li><li>Time to help your new pet settle in</li><li>Commitment for the whole of your pet's life</li></ul></div>
    </div></section>
    <section class="sec" id="apply"><div class="wrap form-layout">
      <div class="form-card" id="applyCard"></div>
      <aside class="side"><div><h3>What happens next</h3><ul class="ticks"><li>We read every application personally</li><li>We'll contact you within 3 days</li><li>Your details are only used for your application (<a class="link" href="/privacy">privacy</a>)</li></ul></div>
        <div><h3>Questions?</h3><p class="muted">Read the <a class="link" href="/faq">FAQ</a> or <a class="link" href="/contact">send us a message</a>.</p></div></aside>
    </div></section>`;
}
function renderApplyForm() {
  const f = "application", pre = new URLSearchParams(location.search).get("pet"); // not "apply": that id is the section anchor
  const options = byPriority(listed()).map(a => `<option value="${esc(a.id)}" ${a.slug === pre ? "selected" : ""}>${esc(a.name)} (${esc(animalLine(a))}${a.status === "reserved" ? ", reserved" : ""})</option>`).join("");
  $("#applyCard").innerHTML = `<h2>Adoption application</h2><p class="muted">Takes about 5 minutes. Fields marked optional can be left blank.</p>
  <form class="stack mt-m" id="${f}" novalidate>
    <div class="hp" aria-hidden="true"><label for="${f}-website">Leave this empty</label><input id="${f}-website" name="website" tabindex="-1" autocomplete="off"></div>
    <div class="wizard-progress" aria-live="polite"><div class="labels"><span data-l="1">1 You</span><span data-l="2">2 Your home</span><span data-l="3">3 Message &amp; send</span></div><div class="bar"><i></i></div></div>
    <fieldset data-step="1"><legend>The pet</legend>
      ${field(f, "animalId", "Who would you like to adopt?", `<select <CONTROL>${options}<option value="any" ${options && pre ? "" : "selected"}>Any suitable pet</option></select>`)}</fieldset>
    <fieldset data-step="1"><legend>About you</legend>
      <div class="row2">${field(f, "name", "Full name", `<input <CONTROL autocomplete="name" maxlength="100">`)}${field(f, "email", "Email", `<input <CONTROL type="email" autocomplete="email" maxlength="200">`)}</div>
      <div class="row2">${field(f, "phone", "Phone", `<input <CONTROL type="tel" autocomplete="tel" maxlength="30">`, { optional: true })}${field(f, "postcode", "Postcode", `<input <CONTROL autocomplete="postal-code" maxlength="12">`, { hint: "So we can plan your home check." })}</div></fieldset>
    <fieldset data-step="2"><legend>Your home</legend>
      <div class="row2">${field(f, "homeType", "Type of home", `<select <CONTROL>${Object.entries(LABELS.homeType).map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>`)}
        ${field(f, "outdoor", "Outdoor space", `<select <CONTROL>${Object.entries(LABELS.outdoor).map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>`)}</div>
      ${field(f, "household", "Who lives with you?", `<input <CONTROL maxlength="300" placeholder="For example: two adults and a 9-year-old">`)}
      ${field(f, "otherPets", "Other pets", `<input <CONTROL maxlength="300" placeholder="For example: one neutered male cat, aged 5">`, { optional: true })}
      ${field(f, "experience", "Experience with pets", `<textarea <CONTROL maxlength="800" placeholder="Pets you've had before, and anything you've learned."></textarea>`, { optional: true })}</fieldset>
    <fieldset data-step="3"><legend>Anything else</legend>
      ${field(f, "message", "Why would this pet suit your home?", `<textarea <CONTROL maxlength="2000" placeholder="Your routine, how much time you're at home, what you're hoping for…"></textarea>`)}
      <label class="checkline"><input type="checkbox" name="consent" id="${f}-consent" aria-describedby="err-${f}-consent"><span>I agree that ${esc(S().rescueName)} may store these details to process my application, as described in the <a class="link" href="/privacy">privacy notice</a>.</span></label>
      <span class="err" id="err-${f}-consent"></span></fieldset>
    <div class="wizard-nav"><button class="btn light prev" type="button">Back</button><button class="btn next" type="button">Continue</button></div>
    <div class="submit-row"><button class="btn" type="submit">Send application</button></div>
  </form>`;
  const form = $("#" + f);
  const STEP_OF = { animalId: 1, name: 1, email: 1, phone: 1, postcode: 1, homeType: 2, outdoor: 2, household: 2, otherPets: 2, experience: 2, message: 3, consent: 3 };
  const validate = () => {
    const d = Object.fromEntries(new FormData(form)); d.consent = form.consent.checked;
    const errs = {};
    for (const [k, l] of [["name", "Your name"], ["postcode", "Postcode"], ["household", "Who lives with you"], ["message", "Your message"]]) { const m = check.required(d[k], l); if (m) errs[k] = m; }
    if (!errs.name) { const m = check.min(d.name, 2, "Your name"); if (m) errs.name = m; }
    if (!errs.message) { const m = check.min(d.message, 10, "Your message"); if (m) errs.message = m; }
    const em = check.email(d.email); if (em) errs.email = em;
    const ph = check.phone(d.phone); if (ph) errs.phone = ph;
    if (!d.consent) errs.consent = "Please confirm we may store your details to process your application.";
    return { d, errs };
  };
  let step = 1;
  const showStep = n => {
    step = n;
    $$("fieldset[data-step]", form).forEach(fs => fs.classList.toggle("on", Number(fs.dataset.step) === n));
    form.classList.toggle("first", n === 1); form.classList.toggle("last", n === 3);
    $$(".wizard-progress [data-l]", form).forEach(l => l.classList.toggle("on", Number(l.dataset.l) <= n));
    $(".wizard-progress .bar i", form).style.width = `${(n / 3) * 100}%`;
  };
  wizardSync = () => { if (!form.isConnected) return; form.classList.toggle("wizard", isPhone()); if (isPhone()) showStep(step); };
  wizardSync();
  const scrollToForm = () => $("#applyCard").scrollIntoView({ block: "start", behavior: "smooth" });
  $(".wizard-nav .next", form).addEventListener("click", () => {
    const stepErrs = Object.fromEntries(Object.entries(validate().errs).filter(([k]) => STEP_OF[k] === step));
    formError(form, "");
    if (showFieldErrors(form, stepErrs)) return;
    showStep(step + 1); scrollToForm(); $(`fieldset[data-step="${step}"] input, fieldset[data-step="${step}"] select, fieldset[data-step="${step}"] textarea`, form)?.focus({ preventScroll: true });
  });
  $(".wizard-nav .prev", form).addEventListener("click", () => { showFieldErrors(form, {}); showStep(step - 1); scrollToForm(); });
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const { d, errs } = validate();
    formError(form, "");
    if (form.classList.contains("wizard") && Object.keys(errs).length) showStep(Math.min(...Object.keys(errs).map(k => STEP_OF[k] || 3)));
    if (showFieldErrors(form, errs)) return;
    const btn = $("button[type=submit]", form); busy(btn, true, "Sending…");
    try {
      await api("/api/public/applications", { method: "POST", body: d });
      const pet = listed().find(a => a.id === d.animalId);
      $("#applyCard").innerHTML = `<div class="done" tabindex="-1" id="applyDone"><div class="ok" aria-hidden="true">✓</div><h3>Thank you, ${esc(d.name.trim().split(/\s+/)[0])}!</h3>
        <p class="muted">Your application${pet ? ` for <b>${esc(pet.name)}</b>` : ""} has been sent. We'll be in touch within 3 days at <b>${esc(d.email.trim())}</b>.</p>
        <a class="btn light sm" href="/adopt">Back to our pets</a></div>`;
      $("#applyDone").focus();
    } catch (err) {
      busy(btn, false);
      if (!showFieldErrors(form, err.fields)) formError(form, err.message);
      else formError(form, err.message);
    }
  });
}

function pStories() {
  const stories = SITE.stories;
  return `<div class="page-head"><div class="wrap"><div class="eyebrow">Happy tails</div><h1>Adoption stories</h1><p class="lead">Every one of these pets was rescued and is now loved in a home of their own.</p></div></div>
    <section class="sec tight"><div class="wrap"><div class="stories">${stories.map(s => `<article class="story">${s.photo ? photo(s.photo, s.animalName || s.title) : ""}<div class="body">
      ${s.animalName ? `<span class="who">${esc(s.animalName)}</span>` : ""}<h3>${esc(s.title)}</h3><p>${esc(s.body)}</p><span class="hint">${esc(fmtDate(s.createdAt, true))}</span></div></article>`).join("")
      || `<div class="empty"><h3>Stories coming soon</h3><p>Our first adoption stories will appear here.</p></div>`}</div></div></section>
    <section class="sec tint" id="share-story"><div class="wrap form-layout"><div class="form-card" id="storyCard"></div>
      <aside class="side"><div><h3>Adopted from us?</h3><p class="muted">We love hearing how our pets are doing. Your story is checked by us before it appears here.</p></div></aside></div></section>`;
}
function renderStoryForm() {
  const f = "storyForm";
  let pic = null; // { dataUrl, thumbDataUrl }
  $("#storyCard").innerHTML = `<div class="eyebrow">Share your happy tail</div><h2>How is your pet doing?</h2><p class="muted">Send us a photo and a few words. We'll add it here once we've had a look.</p>
  <form class="stack mt-m" id="${f}" novalidate>
    <div class="hp" aria-hidden="true"><label for="${f}-website">Leave this empty</label><input id="${f}-website" name="website" tabindex="-1" autocomplete="off"></div>
    <div class="row2">${field(f, "name", "Your name", `<input <CONTROL autocomplete="name" maxlength="100">`)}${field(f, "email", "Email", `<input <CONTROL type="email" autocomplete="email" maxlength="200">`, { hint: "Never shown on the website." })}</div>
    <div class="row2">${field(f, "animalName", "Your pet's name", `<input <CONTROL maxlength="60">`)}${field(f, "title", "Title", `<input <CONTROL maxlength="120" placeholder="For example: Tom's first week at home">`)}</div>
    ${field(f, "body", "Your story", `<textarea <CONTROL maxlength="3000" placeholder="How they settled in, their favourite spot, what they've brought to your home…"></textarea>`)}
    <div class="field"><label for="${f}-photo">Photo <span class="opt">(optional)</span></label><input id="${f}-photo" type="file" accept="image/*"><span class="hint" id="${f}-photoHint">One clear photo works best.</span></div>
    <label class="checkline"><input type="checkbox" name="consent" id="${f}-consent" aria-describedby="err-${f}-consent"><span>I'm happy for ${esc(S().rescueName)} to publish my story, photo and first name.</span></label>
    <span class="err" id="err-${f}-consent"></span>
    <div><button class="btn" type="submit">Send my story</button></div></form>`;
  const form = $("#" + f);
  $(`#${f}-photo`).addEventListener("change", async e => {
    const file = e.target.files[0]; pic = null; if (!file) return;
    const hint = $(`#${f}-photoHint`); hint.textContent = "Preparing photo…";
    try { const [dataUrl, thumbDataUrl] = await Promise.all([resizeImage(file), resizeImage(file, 600, 0.78)]); pic = { dataUrl, thumbDataUrl }; hint.textContent = "Photo ready ✓"; }
    catch (err) { e.target.value = ""; hint.textContent = err.message || "That photo couldn't be read. Try a JPG or PNG."; }
  });
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form)); d.consent = form.consent.checked;
    const errs = {};
    for (const [k, l] of [["name", "Your name"], ["animalName", "Your pet's name"], ["title", "Title"], ["body", "Your story"]]) { const m = check.required(d[k], l); if (m) errs[k] = m; }
    if (!errs.body) { const m = check.min(d.body, 20, "Your story"); if (m) errs.body = m; }
    const em = check.email(d.email); if (em) errs.email = em;
    if (!d.consent) errs.consent = "Please confirm we may publish your story.";
    formError(form, ""); if (showFieldErrors(form, errs)) return;
    const btn = $("button[type=submit]", form); busy(btn, true, "Sending…");
    try {
      await api("/api/public/stories", { method: "POST", body: { ...d, ...(pic || {}) } });
      $("#storyCard").innerHTML = `<div class="done" tabindex="-1" id="storyDone"><div class="ok" aria-hidden="true">✓</div><h3>Thank you, ${esc(d.name.trim().split(/\s+/)[0])}!</h3>
        <p class="muted">We've received ${esc(d.animalName.trim())}'s story. It will appear here once we've had a look.</p></div>`;
      $("#storyDone").focus();
    } catch (err) { busy(btn, false); showFieldErrors(form, err.fields); formError(form, err.message); }
  });
}

function pAbout() {
  const s = S();
  return `<div class="page-head"><div class="wrap"><div class="eyebrow">About us</div><h1>About ${esc(s.rescueName)}</h1><p class="lead">${esc(s.tagline || "Rescued pets, loving homes")}</p></div></div>
    <section class="sec"><div class="wrap split">
      <div class="prose"><div class="eyebrow">Our story</div><h2 class="mt-s">Why we rescue</h2>
        ${s.aboutText ? paras(s.aboutText) : `<p>${esc(s.rescueName)} began with one simple belief: every animal deserves a safe, loving home. We take in cats and other pets who've been abandoned, neglected or simply need a fresh start.</p>
        <p>Each pet lives with us while they recover. We get them vet checked, vaccinated, microchipped and neutered, and we get to know their personality so we can match them with exactly the right family.</p>
        <p>The adoption fee covers part of that care and helps us rescue the next pet in need.</p>`}</div>
      ${photo(byPriority(listed()).find(a => a.photos?.length)?.photos[0], "One of our rescue pets")}
    </div></section>
    <section class="sec tint"><div class="wrap"><div class="sec-head"><div><div class="eyebrow">Our promises</div><h2>How we work</h2></div></div>
      <div class="cards3">
        <div class="panel-card">${I.vet}<h3>Health first</h3><p>No pet is rehomed until they're healthy, vet checked, vaccinated and microchipped.</p></div>
        <div class="panel-card">${I.home}<h3>The right match</h3><p>We get to know every pet and every family, so adoptions last a lifetime.</p></div>
        <div class="panel-card">${I.heart}<h3>Always here</h3><p>If your circumstances ever change, we'll always take our pets back.</p></div></div>
      ${s.charityNumber ? `<p class="muted mt-m">Registered charity number ${esc(s.charityNumber)}.</p>` : ""}
    </div></section>${helpBand()}`;
}

function pHelp() {
  const s = S();
  return `<div class="page-head"><div class="wrap"><div class="eyebrow">Get involved</div><h1>Ways to help</h1><p class="lead">Every rescue relies on kind people. Here's how you can make a difference.</p></div></div>
    <section class="sec tight"><div class="wrap"><div class="cards3">
      <div class="panel-card">${I.foster}<h3>Foster</h3><p>Give a rescue pet a temporary home while they wait for their family. We cover food and vet costs.</p><a class="btn light sm" href="/contact?topic=fostering">Ask about fostering</a></div>
      <div class="panel-card">${I.hands}<h3>Volunteer</h3><p>Help with transport, home checks, photos, social media or fundraising. Every hour counts.</p><a class="btn light sm" href="/contact?topic=volunteering">Offer to volunteer</a></div>
      <div class="panel-card">${I.gift}<h3>Donate</h3><p>Donations pay for vaccinations, neutering and emergency vet treatment.</p>
        <a class="btn ${s.donateUrl ? "" : "light"} sm" href="/donate">${s.donateUrl ? "Donate" : "How to donate"}</a></div>
    </div></div></section>
    <section class="sec tint"><div class="wrap split"><div><div class="eyebrow">Need to rehome your pet?</div><h2>We're here to help, without judgement</h2>
      <p class="lead">Life changes. If you can no longer care for your pet, get in touch and we'll do our best to help find them a safe new home.</p>
      <div class="btn-row mt-m"><a class="btn" href="/contact?topic=rehoming">Talk to us</a></div></div>
      <div class="panel-card"><h3>Follow our rescues</h3><p>See new arrivals, updates and urgent appeals first.</p>${s.facebookUrl ? `<a class="btn light sm" href="${esc(s.facebookUrl)}" target="_blank" rel="noopener noreferrer">Follow on Facebook</a>` : ""}${s.instagramUrl ? `<a class="btn light sm" href="${esc(s.instagramUrl)}" target="_blank" rel="noopener noreferrer">Follow on Instagram</a>` : ""}</div>
    </div></section>`;
}

function pDonate() {
  const s = S(), url = s.donateUrl;
  return `<div class="page-head"><div class="wrap"><div class="eyebrow">Donate</div><h1>Help us rescue the next pet</h1>
    <p class="lead">${esc(s.rescueName)} relies on kind people. Every donation goes straight into caring for animals waiting for a home.</p></div></div>
    <section class="sec tight"><div class="wrap split">
      <div><h2>What your donation pays for</h2>
        <ul class="ticks mt-m"><li>Vaccinations and microchips</li><li>Neutering and spaying</li><li>Flea, worm and parasite treatment</li><li>Emergency and ongoing vet care</li><li>Food, litter and bedding while pets wait for their family</li></ul>
        ${s.charityNumber ? `<p class="muted mt-m">We're a registered charity (number ${esc(s.charityNumber)}). If you're a UK taxpayer, ask us about Gift Aid: it adds 25% to your donation at no cost to you.</p>` : ""}</div>
      <div class="panel-card"><h3>Make a donation</h3>
        ${url ? `<p>You'll be taken to our secure donation page. We never see or store your card details.</p><div class="btn-row"><a class="btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Donate now ↗</a></div>`
          : `<p>Online donations are coming soon. In the meantime, please <a class="link" href="/contact?topic=general">get in touch</a> and we'll tell you how to help.</p>`}
        <p class="hint">Can't donate? <a class="link" href="/help">Fostering, volunteering and sharing our posts</a> help just as much.</p></div>
    </div></section>`;
}

function faqData() {
  const s = S(), fee = lowestFee();
  return [
    ["Adopting", [
      ["How much does it cost to adopt?", `${fee !== null && fee !== undefined ? `Adoption fees start from ${money(fee, s.currency)}, and each pet's fee is shown on their profile.` : "Each pet's adoption fee is shown on their profile."} ${s.feeIncludes ? `The fee includes: ${s.feeIncludes}` : ""}`],
      ["Why is there an adoption fee?", "The fee covers part of the vet care each pet receives before adoption and helps us rescue the next animal. It also shows a genuine commitment to giving a pet a home."],
      ["When do I pay?", "Only after you've met your pet in person and your home check has been approved. We will never ask you to pay to reserve, transport or deliver a pet you haven't met."],
      ["Can I adopt if I rent?", "Yes, as long as your landlord agrees to pets. We may ask to see written permission."],
    ]],
    ["The process", [
      ["How long does it take?", "Usually one to two weeks from application to adoption, depending on home check availability."],
      ["What is a home check?", "A friendly visit (sometimes by video) to see where your pet will live and answer your questions. It's about setting you both up for success, not judging your home."],
      ["Can I be told when a new pet arrives?", "Yes. Join the waiting list at the bottom of the Meet our pets page, and we'll email you when a pet matching your wishes is listed."],
      ["Can I meet a pet before applying?", "Please apply first. It helps us arrange the right introductions, and there's no commitment until you've met and decided."],
    ]],
    ["After adoption", [
      ["What if it doesn't work out?", "Contact us. We'll always take our pets back and help find them a new home."],
      ["Will you help after adoption?", "Absolutely. We offer advice and support for the whole of your pet's life."],
      ["Can I share how my pet is doing?", "We'd love that. Use the form on our Happy tails page to send a photo and a few words."],
    ]],
  ];
}
function pFaq() {
  return `<div class="page-head"><div class="wrap"><div class="eyebrow">Good to know</div><h1>Frequently asked questions</h1><p class="lead">Can't find your answer? <a class="link" href="/contact">Send us a message</a>.</p></div></div>
    <section class="sec tight"><div class="wrap faq">${faqData().map(([g, qs]) => `<div class="faq-group"><h2>${esc(g)}</h2>${qs.map(([q, a]) => `<details class="q"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</div>`).join("")}</div></section>`;
}

function pContact() {
  const s = S();
  return `<div class="page-head"><div class="wrap"><div class="eyebrow">Get in touch</div><h1>Contact us</h1><p class="lead">Questions about adopting, fostering, volunteering or rehoming? We'll reply as soon as we can.</p></div></div>
    <section class="sec tight"><div class="wrap form-layout"><div class="form-card" id="contactCard"></div>
      <aside class="side"><div><h3>Other ways to reach us</h3><dl>
        ${s.email ? `<div><dt>Email</dt><dd>${esc(s.email)}</dd></div>` : ""}${s.phone ? `<div><dt>Phone</dt><dd>${esc(s.phone)}</dd></div>` : ""}
        ${placeLine() ? `<div><dt>Location</dt><dd>${esc(placeLine())}</dd></div>` : ""}<div><dt>Visits</dt><dd>By appointment only</dd></div>
        ${s.facebookUrl ? `<div><dt>Facebook</dt><dd><a class="link" href="${esc(s.facebookUrl)}" target="_blank" rel="noopener noreferrer">Message us on Facebook</a></dd></div>` : ""}</dl></div>
        <div><h3>Looking to adopt?</h3><p class="muted">The quickest way is to <a class="link" href="/how-to-adopt#apply">apply online</a>.</p></div></aside>
    </div></section>`;
}
function renderContactForm() {
  const f = "contact", topic = new URLSearchParams(location.search).get("topic") || "general";
  $("#contactCard").innerHTML = `<h2>Send a message</h2>
  <form class="stack mt-m" id="${f}" novalidate>
    <div class="hp" aria-hidden="true"><label for="${f}-website">Leave this empty</label><input id="${f}-website" name="website" tabindex="-1" autocomplete="off"></div>
    <div class="row2">${field(f, "name", "Your name", `<input <CONTROL autocomplete="name" maxlength="100">`)}${field(f, "email", "Email", `<input <CONTROL type="email" autocomplete="email" maxlength="200">`)}</div>
    <div class="row2">${field(f, "phone", "Phone", `<input <CONTROL type="tel" autocomplete="tel" maxlength="30">`, { optional: true })}
      ${field(f, "topic", "What's it about?", `<select <CONTROL>${Object.entries(LABELS.topic).map(([v, l]) => `<option value="${v}" ${v === topic ? "selected" : ""}>${l}</option>`).join("")}</select>`)}</div>
    ${field(f, "message", "Message", `<textarea <CONTROL maxlength="3000"></textarea>`)}
    <div><button class="btn" type="submit">Send message</button></div></form>`;
  const form = $("#" + f);
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form)), errs = {};
    const n = check.required(d.name, "Your name") || check.min(d.name, 2, "Your name"); if (n) errs.name = n;
    const em = check.email(d.email); if (em) errs.email = em;
    const ph = check.phone(d.phone); if (ph) errs.phone = ph;
    const m = check.required(d.message, "Your message") || check.min(d.message, 10, "Your message"); if (m) errs.message = m;
    formError(form, "");
    if (showFieldErrors(form, errs)) return;
    const btn = $("button[type=submit]", form); busy(btn, true, "Sending…");
    try {
      await api("/api/public/messages", { method: "POST", body: d });
      $("#contactCard").innerHTML = `<div class="done" tabindex="-1" id="contactDone"><div class="ok" aria-hidden="true">✓</div><h3>Message sent</h3><p class="muted">Thank you, ${esc(d.name.trim().split(/\s+/)[0])}. We'll reply to <b>${esc(d.email.trim())}</b> as soon as we can.</p></div>`;
      $("#contactDone").focus();
    } catch (err) { busy(btn, false); showFieldErrors(form, err.fields); formError(form, err.message); }
  });
}

function pPrivacy() {
  const s = S(), who = esc(s.rescueName);
  return `<div class="page-head"><div class="wrap"><div class="eyebrow">Your data</div><h1>Privacy notice</h1><p class="lead">How ${who} uses the information you give us.</p></div></div>
    <section class="sec tight"><div class="wrap prose">
      <h2>What we collect</h2><p>When you apply to adopt or send us a message, we collect the details you enter: your name, email address, phone number (optional), postcode and information about your home and household.</p>
      <p>If you join our waiting list, we keep your name, email and the kind of pet you're looking for, only to email you when a matching pet arrives. Every alert has a link to stop them, which deletes your details immediately.</p>
      <p>If you send us a happy tail, we publish the story, photo and pet's name you choose to share once we've checked it. Your email is never shown.</p>
      <h2>Why we collect it</h2><p>We use it only to process your application or reply to your message, arrange meetings and home checks, and keep a record of adoptions for the welfare of our animals. Our lawful basis is your consent and our legitimate interest in rehoming animals safely.</p>
      <h2>Who can see it</h2><p>Only ${who}. We never sell or share your details for marketing. Data is stored securely with our website host (Netlify), and emails are delivered by our email provider.</p>
      <h2>How long we keep it</h2><p>Applications that don't lead to an adoption are deleted within 12 months. Adoption records are kept for as long as needed for the animal's welfare.</p>
      <h2>Your rights</h2><p>You can ask to see, correct or delete your data at any time${s.email ? ` by emailing ${esc(s.email)}` : " by contacting us"}. You can also complain to the Information Commissioner's Office (ico.org.uk).</p>
      <h2>Cookies and visit counts</h2><p>The public website doesn't use tracking or advertising cookies. A single essential cookie is used only when the rescue's owner signs in to manage the site.</p>
      <p>We count how many times each page is viewed, so we know which pets people are interested in. These counts are anonymous: no cookies, no IP addresses and nothing that identifies you is stored. If your browser sends a "Do Not Track" or "Global Privacy Control" signal, your visits aren't counted at all.</p>
      <h2>Donations</h2><p>Donations are handled by our payment provider on their own secure page. We never see or store your card details.</p>
    </div></section>`;
}

function pNotFound(msg = "We couldn't find that page.") {
  return `<div class="page-head"><div class="wrap"><div class="eyebrow">Not found</div><h1>Sorry, that's not here</h1><p class="lead">${esc(msg)}</p><div class="btn-row mt-m"><a class="btn" href="/adopt">Meet our pets</a><a class="btn light" href="/">Home</a></div></div></div>`;
}

/* ---------------- layout ---------------- */
const NAV = [["/adopt", "Adopt"], ["/how-to-adopt", "How to adopt"], ["/happy-tails", "Happy tails"], ["/about", "About"], ["/help", "Help us"], ["/faq", "FAQ"], ["/contact", "Contact"]];
function renderChrome() {
  const s = S();
  $("#brand").innerHTML = `${LOGO}<span><b>${esc(s.rescueName)}</b><small>${esc(s.tagline || "Rescue & rehoming")}</small></span>`;
  const links = NAV.filter(([p]) => p !== "/happy-tails" || SITE.stories.length);
  $("#nav").innerHTML = links.map(([p, l]) => `<a href="${p}">${l}</a>`).join("");
  $("#drawerLinks").innerHTML = links.map(([p, l]) => `<a href="${p}">${l}</a>`).join("") + `<a class="btn" href="/adopt">Meet our pets</a>`;
  const ann = $("#announce");
  let dismissed = ""; try { dismissed = localStorage.getItem("pf-announce-dismissed") || ""; } catch {}
  if (s.announcement && dismissed !== s.announcement) {
    ann.innerHTML = `<span class="announce-text">${esc(s.announcement)} <a href="/adopt">See our pets →</a></span><button class="announce-x" type="button" data-dismiss-announce aria-label="Dismiss announcement">×</button>`;
    ann.hidden = false;
  } else ann.hidden = true;
  const year = new Date().getFullYear();
  $("#footer").innerHTML = `<div class="wrap"><div class="foot-grid">
    <div><a class="brand" href="/">${LOGO}<span><b>${esc(s.rescueName)}</b><small>${esc(s.tagline || "")}</small></span></a>
      <p>Rescuing pets and finding them loving forever homes${placeLine() ? ` in and around ${esc(placeLine())}` : ""}.</p></div>
    <div><h4>Adopt</h4><ul><li><a href="/adopt">Meet our pets</a></li><li><a href="/how-to-adopt">How to adopt</a></li><li><a href="/how-to-adopt#apply">Apply online</a></li>${SITE.stories.length ? '<li><a href="/happy-tails">Happy tails</a></li>' : ""}<li><a href="/happy-tails#share-story">Share your happy tail</a></li><li><a href="/adopt#alerts">New-pet alerts</a></li></ul></div>
    <div><h4>Rescue</h4><ul><li><a href="/about">About us</a></li><li><a href="/help">Ways to help</a></li><li><a href="/donate">Donate</a></li><li><a href="/faq">FAQ</a></li><li><a href="/contact">Contact</a></li></ul></div>
    <div><h4>Get in touch</h4><ul>${s.email ? `<li>${esc(s.email)}</li>` : ""}${s.phone ? `<li>${esc(s.phone)}</li>` : ""}${placeLine() ? `<li>${esc(placeLine())}</li>` : ""}
      ${s.facebookUrl ? `<li><a href="${esc(s.facebookUrl)}" target="_blank" rel="noopener noreferrer">Facebook</a></li>` : ""}${s.instagramUrl ? `<li><a href="${esc(s.instagramUrl)}" target="_blank" rel="noopener noreferrer">Instagram</a></li>` : ""}</ul></div></div>
    <div class="foot-base"><span>© ${year} ${esc(s.rescueName)}${s.charityNumber ? ` · Registered charity ${esc(s.charityNumber)}` : ""}</span>
      <span><a href="/privacy">Privacy</a> · <a href="/admin/">Owner login</a></span></div></div>`;
}

/* ---------------- router ---------------- */
const ROUTES = [
  [/^\/$/, () => [pHome(), "Rescued pets, loving homes"]],
  [/^\/adopt\/?$/, () => [pAdopt(), "Meet our pets", () => { renderAdoptGrid(); renderAlertsForm(); }]],
  [/^\/adopt\/([a-z0-9-]+)\/?$/, m => { const a = listed().find(x => x.slug === m[1]); return [pPet(m[1]), a ? `${a.name}, ${animalLine(a).toLowerCase()}` : "Pet not found"]; }],
  [/^\/how-to-adopt\/?$/, () => [pHowTo(), "How to adopt", renderApplyForm]],
  [/^\/happy-tails\/?$/, () => [pStories(), "Happy tails", renderStoryForm]],
  [/^\/about\/?$/, () => [pAbout(), "About us"]],
  [/^\/help\/?$/, () => [pHelp(), "Ways to help"]],
  [/^\/faq\/?$/, () => [pFaq(), "FAQ"]],
  [/^\/contact\/?$/, () => [pContact(), "Contact us", renderContactForm]],
  [/^\/privacy\/?$/, () => [pPrivacy(), "Privacy notice"]],
  [/^\/donate\/?$/, () => [pDonate(), "Donate"]],
];
function render({ focus = true } = {}) {
  const path = location.pathname;
  let html, title, after;
  for (const [re, fn] of ROUTES) { const m = path.match(re); if (m) { [html, title, after] = fn(m); break; } }
  if (!html) { html = pNotFound(); title = "Page not found"; }
  const main = $("#main");
  main.innerHTML = `<div class="view-in">${html}</div>`;
  document.title = `${title} · ${S().rescueName}`;
  after?.();
  document.body.classList.add("has-tabbar");
  document.body.classList.toggle("has-sticky", Boolean($(".sticky-apply", main)));
  countView(path);
  const tab = path === "/" ? "home" : path.startsWith("/adopt") ? "pets" : path.startsWith("/how-to-adopt") ? "apply" : path.startsWith("/contact") ? "contact" : "";
  $$("#tabbar a").forEach(a => (a.dataset.tab === tab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  const sw = $("#swipe", main);
  if (sw && $("#swipeCount", main)) sw.addEventListener("scroll", () => { $("#swipeCount", main).textContent = `${Math.round(sw.scrollLeft / sw.clientWidth) + 1} / ${sw.children.length}`; }, { passive: true });
  const navPath = "/" + (path.split("/")[1] || "");
  $$("#nav a, #drawerLinks a").forEach(a => (a.getAttribute("href") === navPath ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  closeMenu();
  if (location.hash) requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView());
  else window.scrollTo(0, 0);
  if (focus) main.focus({ preventScroll: true });
}
function countView(path) {
  if (navigator.doNotTrack === "1" || navigator.globalPrivacyControl) return;
  try { const k = "pf-seen:" + path; if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, "1"); } catch { /* storage blocked: still count */ }
  fetch("/api/public/hit", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) }).catch(() => {});
}
function closeMenu() { $("#drawer").classList.remove("open"); $("#menuBtn").setAttribute("aria-expanded", "false"); }

document.addEventListener("click", e => {
  const a = e.target.closest("a[href]");
  if (a && a.origin === location.origin && !a.target && !a.hasAttribute("download") && !e.metaKey && !e.ctrlKey && !e.shiftKey && !a.pathname.startsWith("/admin") && !a.pathname.startsWith("/api")) {
    e.preventDefault();
    if (a.pathname === location.pathname && a.search === location.search && a.hash) { document.getElementById(a.hash.slice(1))?.scrollIntoView({ behavior: "smooth" }); history.replaceState(null, "", a.href); return; }
    history.pushState(null, "", a.href); navDepth++; render(); return;
  }
  const b = e.target.closest("button"); if (!b) return;
  if (b.hasAttribute("data-dismiss-announce")) { try { localStorage.setItem("pf-announce-dismissed", S().announcement); } catch {} $("#announce").hidden = true; return; }
  if (b.hasAttribute("data-back")) { if (navDepth > 0) { navDepth--; history.back(); } else { history.pushState(null, "", "/adopt"); render(); } return; }
  if (b.hasAttribute("data-read-more")) { $("#storyText")?.classList.remove("clamped"); b.remove(); return; }
  if (b.id === "menuBtn") { const open = $("#drawer").classList.toggle("open"); b.setAttribute("aria-expanded", String(open)); return; }
  if (b.dataset.fSpecies) { filters.species = b.dataset.fSpecies; renderAdoptGrid(); return; }
  if (b.hasAttribute("data-reset-filters")) { Object.assign(filters, { species: "all", sex: "all", age: "all" }); renderAdoptGrid(); return; }
  if (b.dataset.photo) {
    const main = $(".gallery .ph.main");
    main.innerHTML = `<img src="/api/images/${esc(b.dataset.photo)}" alt="Photo ${Number(b.dataset.index) + 1}" data-fallback>`;
    $$(".thumbs button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); return;
  }
  if (b.dataset.share) {
    const url = `${location.origin}/adopt/${b.dataset.share}`;
    if (navigator.share) navigator.share({ title: document.title, url }).catch(() => {});
    else navigator.clipboard?.writeText(url).then(() => toast("Link copied"), () => toast(url));
  }
});
document.addEventListener("change", e => { const f = e.target.dataset?.f; if (f) { filters[f] = e.target.value; renderAdoptGrid(); } });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });
window.addEventListener("popstate", () => render({ focus: false }));
let wizardSync = () => {};
matchMedia("(max-width: 760px)").addEventListener("change", () => wizardSync());

/* ---------------- boot ---------------- */
(async function boot() {
  try {
    SITE = await api("/api/public/site");
  } catch (err) {
    $("#main").innerHTML = `<div class="page-head"><div class="wrap"><h1>We'll be right back</h1><p class="lead">The site couldn't load just now (${esc(err.message)}). Please refresh in a moment.</p><div class="btn-row mt-m"><button class="btn" type="button" id="retry">Try again</button></div></div></div>`;
    $("#retry")?.addEventListener("click", () => location.reload());
    return;
  }
  renderChrome();
  render({ focus: false });
})();
