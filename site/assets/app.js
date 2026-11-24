// Pawfamily public website (single-page app, history routing). All dynamic text is escaped with esc().
import { esc, $, $$, LABELS, money, feeFor, reservationFeeFor, readyDate, ageText, fmtDate, LOGO, photo, toast, api, showFieldErrors, formError, busy, field, check, isPhone, resizeImage } from "./ui.js";

const ICON = {
  back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  share: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7"/><path d="M16 6l-4-4-4 4M12 2v13"/></svg>',
};
let navDepth = 0; // in-app navigations, so the phone back button can return to the previous page

let SITE = null; // { settings, animals, stories, parents, litters }
const filters = { species: "all", sex: "all", age: "all" };

/* ---------------- icons ---------------- */
const I = {
  records: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l7 3v6c0 5-3.5 9-7 11-3.5-2-7-6-7-11V5z"/><path d="M9 12l2 2 4-4"/></svg>',
  contract: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
  refund: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 109-9"/><path d="M3 4v5h5"/><path d="M12 8v4l3 2"/></svg>',
  delivery: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/></svg>',
  home: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/></svg>',
  heart: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z"/></svg>',
};

/* ---------------- helpers ---------------- */
const S = () => SITE.settings;
const listed = () => SITE.animals;
const parentById = id => (SITE.parents || []).find(p => p.id === id);
const byPriority = list => [...list].sort((a, b) => (a.status === "available" ? 0 : 1) - (b.status === "available" ? 0 : 1) || (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || String(b.createdAt).localeCompare(String(a.createdAt)));
const animalLine = a => [LABELS.sex[a.sex], ageText(a)].filter(Boolean).join(" · ");
const lowestFee = () => {
  const fees = listed().map(a => a.fee ?? S().defaultFee).filter(f => f !== null && f !== undefined);
  return fees.length ? Math.min(...fees) : S().defaultFee;
};
const fromFee = () => { const f = lowestFee(); return f !== null && f !== undefined ? money(f, S().currency) : ""; };
const feeSentence = () => (fromFee() ? `Kittens from <b>${esc(fromFee())}</b>` : "Kitten fees are shown on each kitten's page");
const defaultResFee = () => (S().defaultReservationFee !== null && S().defaultReservationFee !== undefined ? money(S().defaultReservationFee, S().currency) : "");
const placeLine = () => [S().town, S().region].filter(Boolean).join(", ");
const paras = text => String(text || "").split(/\n{2,}/).map(p => p.trim()).filter(Boolean).map(p => `<p>${esc(p)}</p>`).join("");
const readyText = a => { const d = readyDate(a, S()); if (!d) return ""; return d <= new Date() ? "Ready to go home now" : `Ready from ${fmtDate(d.toISOString())}`; };
const pairName = l => [parentById(l.mum)?.name, parentById(l.dad)?.name].filter(Boolean).join(" × ") || "New litter";

function card(a) {
  const fee = feeFor(a, S()), ready = a.status === "available" ? readyText(a) : "";
  return `<a class="card" href="/adopt/${esc(a.slug)}">
    ${photo(a.photos?.[0], `${a.name}, ${animalLine(a).toLowerCase()}`, { thumb: true, pill: `<span class="pill ${esc(a.status)}">${esc(LABELS.status[a.status])}</span>` })}
    <div class="info"><div class="top"><h3>${esc(a.name)}</h3></div>
      <span class="sub">${esc(animalLine(a))}${a.breed ? ` · ${esc(a.breed)}` : ""}</span>
      <span class="fee">${fee ? `Kitten fee ${esc(fee)}` : "Kitten fee: ask us"}</span>${ready ? `<span class="sub">${esc(ready)}</span>` : ""}</div></a>`;
}
const storyCard = s => `<article class="story">${s.photo ? photo(s.photo, s.animalName || s.title, { thumb: true }) : ""}<div class="body">
  ${s.animalName ? `<span class="who">${esc(s.animalName)}</span>` : ""}<h3>${esc(s.title)}</h3><p>${esc(s.body.length > 260 ? s.body.slice(0, 257).trim() + "…" : s.body)}</p></div></article>`;

const trustStrip = () => `<div class="trust o-trust"><div class="wrap">
  <div>${I.records}<b>Vet &amp; vaccination records</b><span>Health records come with every kitten</span></div>
  <div>${I.contract}<b>Contract &amp; receipts</b><span>A written receipt for every payment</span></div>
  <div>${I.refund}<b>Refundable reservation</b><span>Refunded if we can't deliver your kitten</span></div>
  <div>${I.delivery}<b>Delivered by the breeder</b><span>Personally, with all ownership documents</span></div></div></div>`;

const reserveBand = (extra = "") => `<section class="band ${extra}"><div class="wrap"><div><div class="eyebrow">Plan ahead</div>
  <h2>Reserve a kitten from an upcoming litter.</h2><p>See which litters are on the way, meet the parents, and reserve your place early.</p></div>
  <div class="btn-row"><a class="btn blush" href="/litters">Upcoming litters</a><a class="btn light on-dark" href="/parents">Meet the parents</a></div></div></section>`;

const stepsHtml = () => `<div class="steps">
  <div class="step"><div class="n">1</div><h3>Enquire</h3><p>Choose a kitten (or tell us what you're looking for) and answer a few quick questions.</p></div>
  <div class="step"><div class="n">2</div><h3>Chat</h3><p>We'll get in touch to talk about your home, your experience and the kitten that suits you best.</p></div>
  <div class="step"><div class="n">3</div><h3>Reserve or buy</h3><p>Reserve with a refundable reservation fee, or buy an available kitten. A deposit or full payment is due before delivery.</p></div>
  <div class="step"><div class="n">4</div><h3>Delivery</h3><p>We deliver your kitten personally, with the ownership documents and records, and check you're all set for the first days at home.</p></div></div>`;

const litterCard = l => {
  const m = parentById(l.mum), d = parentById(l.dad);
  return `<article class="litter"><div class="pair">${m ? photo(m.photo, m.name, { thumb: true }) : ""}${m && d ? '<span class="x">×</span>' : ""}${d ? photo(d.photo, d.name, { thumb: true }) : ""}</div>
    <h3>${esc(pairName(l))}</h3>
    <dl><dt>${l.status === "born" ? "Born" : "Expected"}</dt><dd>${esc(l.when)}</dd>${l.details ? `<dt>Details</dt><dd>${esc(l.details)}</dd>` : ""}</dl>
    <div><span class="pill plain">${esc(LABELS.litterStatus[l.status] || l.status)}</span></div>
    ${l.status !== "fully-reserved" ? `<div class="btn-row"><a class="btn sm" href="/how-to-adopt?intent=reserve&amp;litter=${encodeURIComponent(l.id)}#apply">Reserve from this litter</a><a class="btn light sm" href="/adopt#alerts">Get alerts</a></div>` : ""}</article>`;
};

/* ---------------- pages ---------------- */
function pHome() {
  const animals = byPriority(listed());
  const avail = animals.filter(a => a.status === "available");
  const hero = animals.find(a => a.photos?.length);
  const stories = SITE.stories.slice(0, 3), litters = (SITE.litters || []).slice(0, 2);
  return `
  <div class="home">
  <section class="hero o-hero"><div class="wrap">
    <div>
      <div class="eyebrow">Home-raised kittens${placeLine() ? ` · ${esc(placeLine())}` : ""}</div>
      <h1>Home-raised kittens, <em>ready to love</em>.</h1>
      <p class="lead lead-long">Our kittens are born and raised in our family home, litter-trained and socialised, and go to their new families with full health records and ownership documents.</p>
      <p class="lead lead-short">Meet our kittens. ${feeSentence()}.</p>
      <div class="btn-row"><a class="btn" href="/adopt">Meet our kittens</a><a class="btn light" href="/how-to-adopt">How it works</a></div>
      <p class="fee-note">${feeSentence()}${defaultResFee() ? ` · reservation fee ${esc(defaultResFee())}, refundable if we can't deliver` : " · refundable reservation fee"}.</p>
    </div>
    <div class="hero-pic">${hero ? photo(hero.photos[0], `${hero.name}, one of our kittens`, { eager: true }) : photo(null, "")}
      <a class="hero-card" href="/adopt"><span class="num">${avail.length}</span><span><b>${avail.length === 1 ? "Kitten" : "Kittens"} available</b><span>Meet them now →</span></span></a></div>
  </div></section>
  ${trustStrip()}
  <section class="sec o-pets"><div class="wrap">
    <div class="sec-head"><div><div class="eyebrow">Available now</div><h2><span class="lead-long">Meet our kittens</span><span class="lead-short">Our kittens</span></h2><p>Raised in our home, litter-trained and ready for their new families.</p></div>${animals.length ? `<a class="link" href="/adopt">See all${animals.length > 1 ? ` ${animals.length}` : ""}<span class="lead-long"> kittens</span> →</a>` : ""}</div>
    <div class="grid carousel">${animals.slice(0, 6).map(card).join("") || emptyKittens()}</div>
  </div></section>
  <section class="sec tint o-steps"><div class="wrap">
    <div class="sec-head"><div><div class="eyebrow">Simple and clear</div><h2>How it works</h2></div><a class="link" href="/how-to-adopt">Full details →</a></div>
    <div class="steps-full">${stepsHtml()}</div>
    <a class="steps-pills" href="/how-to-adopt" aria-label="How it works: enquire, chat, reserve or buy, delivery"><span>1 Enquire</span><i aria-hidden="true">›</i><span>2 Chat</span><i aria-hidden="true">›</i><span>3 Reserve</span><i aria-hidden="true">›</i><span>4 Delivery</span></a>
  </div></section>
  ${litters.length ? `<section class="sec o-litters"><div class="wrap"><div class="sec-head"><div><div class="eyebrow">On the way</div><h2>Upcoming litters</h2></div><a class="link" href="/litters">All litters →</a></div><div class="litters">${litters.map(litterCard).join("")}</div></div></section>` : ""}
  ${stories.length ? `<section class="sec tint o-stories"><div class="wrap"><div class="sec-head"><div><div class="eyebrow">Happy families</div><h2>Now in their forever homes</h2></div><a class="link" href="/happy-tails">More stories →</a></div><div class="stories carousel">${stories.map(storyCard).join("")}</div></div></section>` : ""}
  ${reserveBand("o-band")}
  </div>`;
}
const emptyKittens = () => `<div class="empty"><h3>New kittens coming soon</h3><p>All our kittens have gone to their new homes for now. See our upcoming litters, or get an email when kittens are available.</p>
  <div class="btn-row"><a class="btn sm" href="/litters">Upcoming litters</a><a class="btn light sm" href="/adopt#alerts">Get kitten alerts</a></div></div>`;

function pAdopt() {
  return `<div class="page-head"><div class="wrap"><div class="eyebrow">Kittens</div><h1>Our kittens</h1>
    <p class="lead">Raised in our home, litter-trained and socialised. ${feeSentence()}.</p></div></div>
    <section class="sec tight"><div class="wrap"><div class="filters" id="filters"></div><p class="count-line" id="countLine" aria-live="polite"></p><div class="grid" id="petGrid"></div></div></section>
    <section class="sec tint" id="alerts"><div class="wrap form-layout"><div class="form-card" id="alertsCard"></div>
      <aside class="side"><div><h3>How alerts work</h3><ul class="ticks"><li>Tell us what you're looking for</li><li>We email you as soon as a matching kitten is available</li><li>One click in any email to stop alerts</li></ul></div></aside></div></section>
    ${reserveBand()}`;
}
function renderAlertsForm() {
  const f = "alertsForm";
  const sel = (map, any) => `<option value="any">${any}</option>` + Object.entries(map).map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  $("#alertsCard").innerHTML = `<div class="eyebrow">Waiting list</div><h2>Not found your kitten yet?</h2><p class="muted">Get an email when a kitten matching your wishes is available.</p>
  <form class="stack mt-m" id="${f}" novalidate>
    <div class="hp" aria-hidden="true"><label for="${f}-website">Leave this empty</label><input id="${f}-website" name="website" tabindex="-1" autocomplete="off"></div>
    <div class="row2">${field(f, "name", "Your name", `<input <CONTROL autocomplete="name" maxlength="100">`)}${field(f, "email", "Email", `<input <CONTROL type="email" autocomplete="email" maxlength="200">`)}</div>
    <input type="hidden" name="species" value="cat">
    <div class="row2">${field(f, "sex", "Male or female", `<select <CONTROL>${sel({ female: "Female", male: "Male" }, "No preference")}</select>`)}
      ${field(f, "ageGroup", "Age", `<select <CONTROL>${sel(Object.fromEntries(Object.entries(LABELS.age).map(([k, l]) => [k, `${l} (${LABELS.ageHelp[k]})`])), "Any age")}</select>`)}</div>
    <label class="checkline"><input type="checkbox" name="consent" id="${f}-consent" aria-describedby="err-${f}-consent"><span>Email me about matching kittens. I can stop at any time (<a class="link" href="/privacy">privacy</a>).</span></label>
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
        <p class="muted">We'll email <b>${esc(d.email.trim())}</b> as soon as a matching kitten is available.</p></div>`;
      $("#alertsDone").focus();
    } catch (err) { busy(btn, false); showFieldErrors(form, err.fields); formError(form, err.message); }
  });
}
function renderAdoptGrid() {
  const all = listed();
  const species = [...new Set(all.map(a => a.species))];
  if (filters.species !== "all" && !species.includes(filters.species)) filters.species = "all";
  $("#filters").innerHTML = `<div class="chips" role="group" aria-label="Filter by availability">
      <button type="button" class="chip" data-f-species="all" aria-pressed="${filters.species === "all"}">All kittens<span class="c">${all.length}</span></button>
      ${species.length > 1 ? species.map(s => `<button type="button" class="chip" data-f-species="${esc(s)}" aria-pressed="${filters.species === s}">${esc(LABELS.speciesPlural[s])}<span class="c">${all.filter(a => a.species === s).length}</span></button>`).join("") : ""}</div>
    <div class="selects">
      <label class="sr-only" for="fSex">Male or female</label><select id="fSex" data-f="sex"><option value="all">Male or female</option>${["female", "male"].map(v => `<option value="${v}" ${filters.sex === v ? "selected" : ""}>${LABELS.sex[v]}</option>`).join("")}</select>
      <label class="sr-only" for="fAge">Age</label><select id="fAge" data-f="age"><option value="all">Any age</option>${Object.entries(LABELS.age).map(([v, l]) => `<option value="${v}" ${filters.age === v ? "selected" : ""}>${l} (${LABELS.ageHelp[v]})</option>`).join("")}</select></div>`;
  const list = byPriority(all).filter(a => (filters.species === "all" || a.species === filters.species) && (filters.sex === "all" || a.sex === filters.sex) && (filters.age === "all" || a.ageGroup === filters.age));
  $("#countLine").textContent = all.length ? `Showing ${list.length} of ${all.length} kitten${all.length === 1 ? "" : "s"}` : "";
  $("#petGrid").innerHTML = list.map(card).join("") || (all.length
    ? `<div class="empty"><h3>No kittens match</h3><p>Try a different filter, or get an email when the right kitten is available.</p><button class="btn light sm" type="button" data-reset-filters>Clear filters</button></div>`
    : emptyKittens());
}

function pPet(slug) {
  const a = listed().find(x => x.slug === slug);
  if (!a) return pNotFound("That kitten isn't listed any more. They may have gone to their new home already.");
  const s = S(), fee = feeFor(a, s), resFee = reservationFeeFor(a, s), ready = readyText(a);
  const pics = a.photos?.length ? a.photos : [null];
  const healthAll = Object.keys(LABELS.health);
  const pron = a.sex === "male" ? "his" : a.sex === "female" ? "her" : "their";
  const mum = parentById(a.mum), dad = parentById(a.dad);
  const chips = [LABELS.sex[a.sex], ageText(a), ...(a.traits || []).slice(0, 2).map(t => LABELS.traits[t] || t), ...(a.health?.includes("vaccinated") ? ["Vaccinated"] : [])].filter(Boolean);
  const longStory = (a.story || "").length > 260;
  const enquireHref = `/how-to-adopt?pet=${encodeURIComponent(a.slug)}#apply`;
  return `<div class="wrap profile">
    <div class="swipe-wrap"><div class="swipe" id="swipe" tabindex="0" aria-label="Photos of ${esc(a.name)}">${pics.map((p, i) => photo(p, `${a.name}, photo ${i + 1} of ${pics.length}`, { eager: i === 0 })).join("")}</div>
      <button class="swipe-btn back" type="button" data-back aria-label="Back">${ICON.back}</button>
      <button class="swipe-btn share" type="button" data-share="${esc(a.slug)}" aria-label="Share ${esc(a.name)}">${ICON.share}</button>
      ${pics.length > 1 ? `<span class="swipe-count" id="swipeCount" aria-hidden="true">1 / ${pics.length}</span>` : ""}</div>
    <div class="gallery">${photo(pics[0], `${a.name}, photo 1 of ${pics.length}`, { cls: "main", eager: true })}
      ${pics.length > 1 ? `<div class="thumbs">${pics.map((p, i) => `<button type="button" data-photo="${esc(p)}" data-index="${i}" aria-pressed="${i === 0}" aria-label="Show photo ${i + 1}"><img src="/api/images/${esc(p)}" alt="" loading="lazy" data-fallback></button>`).join("")}</div>` : ""}</div>
    <div>
      <div class="crumbs"><a href="/adopt">Our kittens</a> / ${esc(a.name)}</div>
      <span class="pill ${esc(a.status)}">${esc(LABELS.status[a.status])}</span>
      <h1>${esc(a.name)}</h1>
      <p class="desc">${esc(animalLine(a))}${a.breed ? ` · ${esc(a.breed)}` : ""}</p>
      ${a.summary ? `<p class="lead mt-s">${esc(a.summary)}</p>` : ""}
      <div class="fact-chips">${chips.map(c => `<span>${esc(c)}</span>`).join("")}</div>
      <dl class="facts">
        <div><dt>Breed</dt><dd>${esc(a.breed || "Ask us")}</dd></div><div><dt>Sex</dt><dd>${esc(LABELS.sex[a.sex])}</dd></div>
        <div><dt>Age</dt><dd>${esc(ageText(a))}</dd></div>${a.birthDate ? `<div><dt>Born</dt><dd>${esc(fmtDate(a.birthDate))}</dd></div>` : ""}
        ${ready ? `<div><dt>Going home</dt><dd>${esc(ready.replace("Ready to go home now", "Now").replace("Ready from ", ""))}</dd></div>` : ""}
      </dl>
      <div class="fee-box"><span class="eyebrow">Kitten fee</span><span class="amt">${fee ? esc(fee) : "Ask us"}</span>
        ${resFee ? `<p><b>Reservation fee ${esc(resFee)}</b>, refundable if we can't deliver ${esc(a.name)}.</p>` : `<p>Reservation fee refundable if we can't deliver ${esc(a.name)}.</p>`}
        ${s.feeIncludes ? `<p>Includes: ${esc(s.feeIncludes)}</p>` : ""}<p class="hint">Delivered personally by the breeder, with all ownership documents and records.</p></div>
      <div class="btn-row mt-m">${a.status === "reserved"
        ? `<a class="btn" href="/adopt#alerts">Join the waiting list</a><a class="btn light" href="${enquireHref}">Ask about ${esc(a.name)}</a>`
        : `<a class="btn" href="${enquireHref}">Enquire about ${esc(a.name)}</a>`}
        <button class="btn light" type="button" data-share="${esc(a.slug)}">Share</button></div>
      ${a.status === "reserved" ? `<p class="hint mt-s">${esc(a.name)} is reserved. Join the waiting list and we'll let you know about kittens like ${pron === "their" ? "them" : pron === "his" ? "him" : "her"}.</p>` : ""}
      ${a.story ? `<h2>About ${esc(a.name)}</h2><div class="story-text ${longStory ? "clamped" : ""}" id="storyText"><div class="prose">${paras(a.story)}</div></div>${longStory ? `<button class="link read-more" type="button" data-read-more>Read more about ${pron === "their" ? "them" : pron === "his" ? "him" : "her"}</button>` : ""}` : ""}
      ${a.traits?.length ? `<h2>Personality</h2><div class="tags">${a.traits.map(t => `<span class="tag">${esc(LABELS.traits[t] || t)}</span>`).join("")}</div>` : ""}
      ${mum || dad ? `<h2>${esc(a.name)}'s parents</h2><div class="parents-mini">${[mum, dad].filter(Boolean).map(p => `<a href="/parents">${photo(p.photo, p.name, { thumb: true })}<span><b>${esc(p.name)}</b><span>${esc(LABELS.role[p.role])}${p.colour ? ` · ${esc(p.colour)}` : ""}</span></span></a>`).join("")}</div>` : ""}
      <h2>Health</h2><ul class="ticks">${healthAll.map(h => `<li class="${a.health?.includes(h) ? "" : "no"}">${esc(LABELS.health[h])}${a.health?.includes(h) ? "" : " (not yet)"}</li>`).join("")}</ul>
      ${a.healthNotes ? `<p class="muted mt-s">${esc(a.healthNotes)}</p>` : ""}
    </div></div>
    <div class="sticky-apply"><div><span class="amt">${fee ? esc(fee) : "Ask us"}</span><small>Kitten fee${resFee ? ` · reservation ${esc(resFee)}` : ""}</small></div>
      <a class="btn" href="${a.status === "reserved" ? "/adopt#alerts" : enquireHref}">${a.status === "reserved" ? "Waiting list" : "Enquire"}</a></div>`;
}

function pHowTo() {
  const s = S(), res = defaultResFee();
  return `<div class="page-head"><div class="wrap"><div class="eyebrow">How it works</div><h1>How it works</h1>
    <p class="lead">From your first message to your kitten's first day at home: here's what to expect.</p></div></div>
    <section class="sec"><div class="wrap">${stepsHtml()}</div></section>
    <section class="sec tint"><div class="wrap"><div class="cards3">
      <div class="panel-card">${I.refund}<h3>Reservation fee</h3><p>${res ? `Reserve your kitten with a reservation fee of <b>${esc(res)}</b>.` : "Reserve your kitten with a reservation fee."} It's <b>refundable if we can't deliver your kitten</b>.</p></div>
      <div class="panel-card">${I.contract}<h3>Payment</h3><p>${esc(s.paymentInfo)}</p></div>
      <div class="panel-card">${I.delivery}<h3>Delivery</h3><p>${esc(s.deliveryInfo)}</p></div>
    </div></div></section>
    <section class="sec"><div class="wrap split">
      <div><div class="eyebrow">What's included</div><h2>Your kitten comes with</h2>
        <ul class="ticks mt-m">${Object.values(LABELS.docs).map(d => `<li>${esc(d)}</li>`).join("")}<li>Litter-trained and socialised in our home</li></ul>
        ${s.feeIncludes ? `<p class="muted mt-m">The kitten fee includes: ${esc(s.feeIncludes)}</p>` : ""}</div>
      <div><div class="eyebrow">Before you enquire</div><h2>Good to know</h2>
        <ul class="ticks"><li>You must be over 18, with permission to keep pets if you rent</li><li>Kittens go home from ${esc(s.goHomeWeeks || 13)} weeks old</li><li>A kitten needs time and patience to settle in</li><li>A cat can live 15 years or more: it's a lifelong commitment</li></ul></div>
    </div></section>
    <section class="sec tint" id="apply"><div class="wrap form-layout">
      <div class="form-card" id="applyCard"></div>
      <aside class="side"><div><h3>What happens next</h3><ul class="ticks"><li>We read every enquiry personally</li><li>We'll get back to you within 2 days</li><li>Your details are only used to reply to your enquiry (<a class="link" href="/privacy">privacy</a>)</li></ul></div>
        <div><h3>Questions?</h3><p class="muted">Read the <a class="link" href="/faq">FAQ</a> or <a class="link" href="/contact">send us a message</a>.</p></div></aside>
    </div></section>`;
}
const radios = (f, name, legend, options, checked = "") => `<fieldset class="field radios"><legend class="label">${esc(legend)}</legend>
  <div class="chips">${Object.entries(options).map(([v, l]) => `<label class="radio-chip"><input type="radio" name="${name}" value="${v}" ${v === checked ? "checked" : ""} aria-describedby="err-${f}-${name}"><span>${esc(l)}</span></label>`).join("")}</div>
  <span class="err" id="err-${f}-${name}"></span></fieldset>`;
function renderApplyForm() {
  const f = "application", q = new URLSearchParams(location.search);
  const pre = q.get("pet"), litter = (SITE.litters || []).find(l => l.id === q.get("litter"));
  const preIntent = q.get("intent") === "reserve" || litter ? "reserve" : "";
  const options = byPriority(listed()).map(a => `<option value="${esc(a.id)}" ${a.slug === pre ? "selected" : ""}>${esc(a.name)} (${esc(animalLine(a))}${a.status === "reserved" ? ", reserved" : ""})</option>`).join("");
  const preMessage = litter ? `I'd like to reserve a kitten from ${pairName(litter)} (${litter.when}).` : "";
  $("#applyCard").innerHTML = `<h2>Kitten enquiry</h2><p class="muted">A few quick questions so we can help you find the right kitten. Fields marked optional can be left blank.</p>
  <form class="stack mt-m" id="${f}" novalidate>
    <div class="hp" aria-hidden="true"><label for="${f}-website">Leave this empty</label><input id="${f}-website" name="website" tabindex="-1" autocomplete="off"></div>
    <div class="wizard-progress" aria-live="polite"><div class="labels"><span data-l="1">1 Your kitten</span><span data-l="2">2 About you</span><span data-l="3">3 Send</span></div><div class="bar"><i></i></div></div>
    <fieldset data-step="1"><legend>Your kitten</legend>
      ${field(f, "animalId", "Which kitten are you interested in?", `<select <CONTROL>${options}<option value="any" ${options && pre ? "" : "selected"}>Any available kitten</option></select>`)}
      ${radios(f, "intent", "Would you like to…", LABELS.intent, preIntent)}
      ${radios(f, "sexPreference", "Male or female?", LABELS.sexPref, "no-preference")}</fieldset>
    <fieldset data-step="2"><legend>About you</legend>
      <div class="row2">${field(f, "name", "Full name", `<input <CONTROL autocomplete="name" maxlength="100">`)}${field(f, "email", "Email", `<input <CONTROL type="email" autocomplete="email" maxlength="200">`)}</div>
      <div class="row2">${field(f, "phone", "Phone", `<input <CONTROL type="tel" autocomplete="tel" maxlength="30">`, { optional: true })}${field(f, "deliveryArea", "Town or postcode for delivery", `<input <CONTROL autocomplete="postal-code" maxlength="60">`)}</div>
      ${radios(f, "experience", "Do you already have experience with kittens?", { yes: "Yes", no: "No, this is my first" })}
      ${field(f, "experienceDetails", "Tell us a little about it", `<textarea <CONTROL maxlength="800" placeholder="Cats you've had before, and for how long."></textarea>`, { optional: true })}
      ${radios(f, "children", "Do you have children at home?", { no: "No", yes: "Yes" })}
      ${field(f, "childrenAges", "Children's ages", `<input <CONTROL maxlength="100" placeholder="For example: 6 and 9">`, { optional: true, hint: "Only if you have children at home." })}
      ${field(f, "otherPets", "Other pets", `<input <CONTROL maxlength="300" placeholder="For example: one dog, aged 4">`, { optional: true })}</fieldset>
    <fieldset data-step="3"><legend>Anything else</legend>
      ${field(f, "message", "Message", `<textarea <CONTROL maxlength="2000" placeholder="Anything you'd like to ask or tell us.">${esc(preMessage)}</textarea>`, { optional: true })}
      <label class="checkline"><input type="checkbox" name="consent" id="${f}-consent" aria-describedby="err-${f}-consent"><span>I agree that ${esc(S().rescueName)} may store these details to reply to my enquiry, as described in the <a class="link" href="/privacy">privacy notice</a>.</span></label>
      <span class="err" id="err-${f}-consent"></span></fieldset>
    <div class="wizard-nav"><button class="btn light prev" type="button">Back</button><button class="btn next" type="button">Continue</button></div>
    <div class="submit-row"><button class="btn" type="submit">Send enquiry</button></div>
  </form>`;
  const form = $("#" + f);
  const STEP_OF = { animalId: 1, intent: 1, sexPreference: 1, name: 2, email: 2, phone: 2, deliveryArea: 2, experience: 2, experienceDetails: 2, children: 2, childrenAges: 2, otherPets: 2, message: 3, consent: 3 };
  const validate = () => {
    const d = Object.fromEntries(new FormData(form)); d.consent = form.consent.checked;
    const errs = {};
    if (!d.intent) errs.intent = "Please choose whether you'd like to reserve or buy.";
    const n = check.required(d.name, "Your name") || check.min(d.name, 2, "Your name"); if (n) errs.name = n;
    const em = check.email(d.email); if (em) errs.email = em;
    const ph = check.phone(d.phone); if (ph) errs.phone = ph;
    const da = check.required(d.deliveryArea, "Town or postcode"); if (da) errs.deliveryArea = da;
    if (!d.experience) errs.experience = "Please choose an answer.";
    if (!d.children) errs.children = "Please choose an answer.";
    else if (d.children === "yes" && !String(d.childrenAges || "").trim()) errs.childrenAges = "Please tell us the children's ages.";
    if (!d.consent) errs.consent = "Please confirm we may store your details to reply to your enquiry.";
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
    showStep(step + 1); scrollToForm(); $(`fieldset[data-step="${step}"] input:not([type=hidden]), fieldset[data-step="${step}"] select, fieldset[data-step="${step}"] textarea`, form)?.focus({ preventScroll: true });
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
        <p class="muted">Your enquiry${pet ? ` about <b>${esc(pet.name)}</b>` : ""} has been sent. We'll be in touch soon at <b>${esc(d.email.trim())}</b>.</p>
        <a class="btn light sm" href="/adopt">Back to our kittens</a></div>`;
      $("#applyDone").focus();
    } catch (err) { busy(btn, false); showFieldErrors(form, err.fields); formError(form, err.message); }
  });
}

function pParents() {
  const parents = SITE.parents || [];
  const group = role => parents.filter(p => p.role === role);
  const pcard = p => `<article class="cat">${photo(p.photo, `${p.name}, our ${LABELS.role[p.role].toLowerCase()}`)}
    <span class="eyebrow">${esc(LABELS.role[p.role])}${p.born ? ` · Born ${esc(p.born)}` : ""}</span><h3>${esc(p.name)}</h3>
    <div class="sub">${[p.breed, p.colour].filter(Boolean).map(esc).join(" · ")}</div>
    ${p.about ? `<p class="note">${esc(p.about)}</p>` : ""}${p.healthNotes ? `<p class="muted">${esc(p.healthNotes)}</p>` : ""}</article>`;
  return `<div class="page-head"><div class="wrap"><div class="eyebrow">Meet the parents</div><h1>Our cats</h1>
    <p class="lead">Our mums and dads live with us as part of the family. Their temperament and health shape every litter.</p></div></div>
    <section class="sec tight"><div class="wrap">
      ${parents.length ? `${group("mum").length ? `<div class="sec-head"><h2>Mums</h2></div><div class="cats">${group("mum").map(pcard).join("")}</div>` : ""}
        ${group("dad").length ? `<div class="sec-head mt-l"><h2>Dads</h2></div><div class="cats">${group("dad").map(pcard).join("")}</div>` : ""}`
        : `<div class="empty"><h3>Coming soon</h3><p>Photos and details of our cats will appear here.</p></div>`}
    </div></section>${reserveBand()}`;
}

function pLitters() {
  const litters = SITE.litters || [];
  return `<div class="page-head"><div class="wrap"><div class="eyebrow">Plan ahead</div><h1>Upcoming litters</h1>
    <p class="lead">Reserve a kitten from a litter that's on the way. The reservation fee is refundable if we can't deliver your kitten.</p></div></div>
    <section class="sec tight"><div class="wrap"><div class="litters">${litters.map(litterCard).join("")
      || `<div class="empty"><h3>No litters planned right now</h3><p>Get an email as soon as new kittens are on the way.</p><a class="btn sm" href="/adopt#alerts">Get kitten alerts</a></div>`}</div></div></section>
    <section class="sec tint"><div class="wrap split"><div><div class="eyebrow">Meet the parents</div><h2>Healthy, happy parents</h2>
      <p class="lead">Every litter comes from cats who live with us as family pets.</p><div class="btn-row mt-m"><a class="btn light" href="/parents">Meet our cats</a></div></div>
      <div class="panel-card"><h3>How reserving works</h3><ul class="ticks"><li>Send an enquiry and choose "Reserve a kitten"</li><li>We'll chat about the litter and your wishes</li><li>A reservation fee secures your place, refundable if we can't deliver</li></ul></div></div></section>`;
}

function pStories() {
  const stories = SITE.stories;
  return `<div class="page-head"><div class="wrap"><div class="eyebrow">Happy families</div><h1>Happy tails</h1><p class="lead">Kittens from our home, now loved in theirs.</p></div></div>
    <section class="sec tight"><div class="wrap"><div class="stories">${stories.map(s => `<article class="story">${s.photo ? photo(s.photo, s.animalName || s.title) : ""}<div class="body">
      ${s.animalName ? `<span class="who">${esc(s.animalName)}</span>` : ""}<h3>${esc(s.title)}</h3><p>${esc(s.body)}</p><span class="hint">${esc(fmtDate(s.createdAt, true))}</span></div></article>`).join("")
      || `<div class="empty"><h3>Stories coming soon</h3><p>Stories from our kittens' new families will appear here.</p></div>`}</div></div></section>
    <section class="sec tint" id="share-story"><div class="wrap form-layout"><div class="form-card" id="storyCard"></div>
      <aside class="side"><div><h3>Got a kitten from us?</h3><p class="muted">We love hearing how our kittens are doing. Your story is checked by us before it appears here.</p></div></aside></div></section>`;
}
function renderStoryForm() {
  const f = "storyForm";
  let pic = null; // { dataUrl, thumbDataUrl }
  $("#storyCard").innerHTML = `<div class="eyebrow">Share your happy tail</div><h2>How is your kitten doing?</h2><p class="muted">Send us a photo and a few words. We'll add it here once we've had a look.</p>
  <form class="stack mt-m" id="${f}" novalidate>
    <div class="hp" aria-hidden="true"><label for="${f}-website">Leave this empty</label><input id="${f}-website" name="website" tabindex="-1" autocomplete="off"></div>
    <div class="row2">${field(f, "name", "Your name", `<input <CONTROL autocomplete="name" maxlength="100">`)}${field(f, "email", "Email", `<input <CONTROL type="email" autocomplete="email" maxlength="200">`, { hint: "Never shown on the website." })}</div>
    <div class="row2">${field(f, "animalName", "Your cat's name", `<input <CONTROL maxlength="60">`)}${field(f, "title", "Title", `<input <CONTROL maxlength="120" placeholder="For example: Tom's first week at home">`)}</div>
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
    for (const [k, l] of [["name", "Your name"], ["animalName", "Your cat's name"], ["title", "Title"], ["body", "Your story"]]) { const m = check.required(d[k], l); if (m) errs[k] = m; }
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
  return `<div class="page-head"><div class="wrap"><div class="eyebrow">About us</div><h1>About ${esc(s.rescueName)}</h1><p class="lead">${esc(s.tagline || "Home-raised kittens")}</p></div></div>
    <section class="sec"><div class="wrap split">
      <div class="prose"><div class="eyebrow">Our story</div><h2 class="mt-s">Raised with love, at home</h2>
        ${s.aboutText ? paras(s.aboutText) : `<p>${esc(s.rescueName)} is a small home breeder. Our kittens are born and raised in our family home, where they grow up with everyday sounds, people and gentle handling from day one.</p>
        <p>Every kitten is litter-trained and socialised before going home, vet checked and vaccinated, and comes with full health records and ownership documents.</p>
        <p>We deliver each kitten personally, so we can hand over everything you need and help your kitten settle into their new home.</p>`}</div>
      ${photo(byPriority(listed()).find(a => a.photos?.length)?.photos[0], "One of our kittens")}
    </div></section>
    <section class="sec tint"><div class="wrap"><div class="sec-head"><div><div class="eyebrow">Our promises</div><h2>How we work</h2></div></div>
      <div class="cards3">
        <div class="panel-card">${I.records}<h3>Health first</h3><p>Every kitten is vet checked and vaccinated, with records to prove it.</p></div>
        <div class="panel-card">${I.home}<h3>Raised in our home</h3><p>Litter-trained, socialised and used to family life before they leave us.</p></div>
        <div class="panel-card">${I.heart}<h3>Here for you</h3><p>Advice and support whenever you need it, long after your kitten goes home.</p></div></div>
      ${s.licenceNumber ? `<p class="muted mt-m">Licence number: ${esc(s.licenceNumber)}</p>` : ""}
    </div></section>${reserveBand()}`;
}

function faqData() {
  const s = S(), from = fromFee(), res = defaultResFee();
  return [
    ["Kittens & fees", [
      ["How much is a kitten?", `${from ? `Kittens start from ${from}, and each kitten's fee is shown on their page.` : "Each kitten's fee is shown on their page."}${s.feeIncludes ? ` The kitten fee includes: ${s.feeIncludes}` : ""}`],
      ["When can a kitten go home?", `From ${s.goHomeWeeks || 13} weeks old. Each kitten's page shows the date they're ready.`],
      ["Are your kittens litter-trained?", "Yes. Every kitten is litter-trained and socialised in our home before going to their new family."],
      ["Can I be told when kittens are available?", "Yes. Join the waiting list at the bottom of the Our kittens page, and we'll email you when a kitten matching your wishes is available."],
    ]],
    ["Reserving", [
      ["How do I reserve a kitten?", "Send an enquiry and choose \"Reserve a kitten\". We'll chat about the kitten and your wishes, then confirm your reservation."],
      ["How much is the reservation fee?", res ? `The reservation fee is ${res}, unless a kitten's page shows a different amount.` : "The reservation fee is shown on each kitten's page, or we'll confirm it when we chat."],
      ["Is the reservation fee refundable?", "Yes. If we can't deliver your kitten, your reservation fee is refunded."],
      ["Can I reserve from an upcoming litter?", "Yes. See our Upcoming litters page and use \"Reserve from this litter\"."],
    ]],
    ["Payment & delivery", [
      ["When do I pay?", s.paymentInfo],
      ["How does delivery work?", s.deliveryInfo],
      ["What comes with my kitten?", `${Object.values(LABELS.docs).join(", ")}.`],
    ]],
    ["After your kitten goes home", [
      ["Will you help after my kitten goes home?", "Absolutely. We're here for advice whenever you need it."],
      ["Can I share how my kitten is doing?", "We'd love that. Use the form on our Happy tails page to send a photo and a few words."],
    ]],
  ];
}
function pFaq() {
  return `<div class="page-head"><div class="wrap"><div class="eyebrow">Good to know</div><h1>Frequently asked questions</h1><p class="lead">Can't find your answer? <a class="link" href="/contact">Send us a message</a>.</p></div></div>
    <section class="sec tight"><div class="wrap faq">${faqData().map(([g, qs]) => `<div class="faq-group"><h2>${esc(g)}</h2>${qs.map(([q, a]) => `<details class="q"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</div>`).join("")}</div></section>`;
}

function pContact() {
  const s = S();
  return `<div class="page-head"><div class="wrap"><div class="eyebrow">Get in touch</div><h1>Contact us</h1><p class="lead">Questions about our kittens, reserving or delivery? We'll reply as soon as we can.</p></div></div>
    <section class="sec tight"><div class="wrap form-layout"><div class="form-card" id="contactCard"></div>
      <aside class="side"><div><h3>Other ways to reach us</h3><dl>
        ${s.email ? `<div><dt>Email</dt><dd>${esc(s.email)}</dd></div>` : ""}${s.phone ? `<div><dt>Phone</dt><dd>${esc(s.phone)}</dd></div>` : ""}
        ${placeLine() ? `<div><dt>Location</dt><dd>${esc(placeLine())}</dd></div>` : ""}
        ${s.facebookUrl ? `<div><dt>Facebook</dt><dd><a class="link" href="${esc(s.facebookUrl)}" target="_blank" rel="noopener noreferrer">Message us on Facebook</a></dd></div>` : ""}</dl></div>
        <div><h3>Interested in a kitten?</h3><p class="muted">The quickest way is to <a class="link" href="/how-to-adopt#apply">send an enquiry</a>.</p></div></aside>
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
      <h2>What we collect</h2><p>When you send an enquiry or a message, we collect the details you enter: your name, email address, phone number (optional), delivery town or postcode, and your answers about your experience, your household and the kitten you're looking for.</p>
      <p>If you reserve or buy a kitten, we also keep a record of payments, the delivery date and the documents handed over.</p>
      <p>If you join our waiting list, we keep your name, email and the kind of kitten you're looking for, only to email you when a matching kitten is available. Every alert has a link to stop them, which deletes your details immediately.</p>
      <p>If you send us a happy tail, we publish the story, photo and cat's name you choose to share once we've checked it. Your email is never shown.</p>
      <h2>Why we collect it</h2><p>We use it only to reply to your enquiry, arrange your reservation, payment and delivery, and keep the records we need for each kitten. Our lawful basis is your consent, taking steps towards a sale you asked for, and our legal duty to keep financial records.</p>
      <h2>Who can see it</h2><p>Only ${who}. We never sell or share your details for marketing. Data is stored securely with our website host (Netlify), and emails are delivered by our email provider.</p>
      <h2>How long we keep it</h2><p>Enquiries that don't lead to a sale are deleted within 12 months. Payment and sale records are kept for as long as the law requires for accounting.</p>
      <h2>Your rights</h2><p>You can ask to see, correct or delete your data at any time${s.email ? ` by emailing ${esc(s.email)}` : " by contacting us"}. You can also complain to the Information Commissioner's Office (ico.org.uk).</p>
      <h2>Cookies and visit counts</h2><p>The public website doesn't use tracking or advertising cookies. A single essential cookie is used only when the owner signs in to manage the site.</p>
      <p>We count how many times each page is viewed, so we know which kittens people are interested in. These counts are anonymous: no cookies, no IP addresses and nothing that identifies you is stored. If your browser sends a "Do Not Track" or "Global Privacy Control" signal, your visits aren't counted at all.</p>
    </div></section>`;
}

function pNotFound(msg = "We couldn't find that page.") {
  return `<div class="page-head"><div class="wrap"><div class="eyebrow">Not found</div><h1>Sorry, that's not here</h1><p class="lead">${esc(msg)}</p><div class="btn-row mt-m"><a class="btn" href="/adopt">Our kittens</a><a class="btn light" href="/">Home</a></div></div></div>`;
}

/* ---------------- layout ---------------- */
const NAV = [["/adopt", "Kittens"], ["/litters", "Litters"], ["/parents", "Parents"], ["/how-to-adopt", "How it works"], ["/happy-tails", "Happy tails"], ["/about", "About"], ["/faq", "FAQ"], ["/contact", "Contact"]];
function renderChrome() {
  const s = S();
  $("#brand").innerHTML = `${LOGO}<span><b>${esc(s.rescueName)}</b><small>${esc(s.tagline || "Home-raised kittens")}</small></span>`;
  const links = NAV.filter(([p]) => p !== "/happy-tails" || SITE.stories.length);
  $("#nav").innerHTML = links.map(([p, l]) => `<a href="${p}">${l}</a>`).join("");
  $("#drawerLinks").innerHTML = links.map(([p, l]) => `<a href="${p}">${l}</a>`).join("") + `<a class="btn" href="/adopt">Meet our kittens</a>`;
  const ann = $("#announce");
  let dismissed = ""; try { dismissed = localStorage.getItem("pf-announce-dismissed") || ""; } catch {}
  if (s.announcement && dismissed !== s.announcement) {
    ann.innerHTML = `<span class="announce-text">${esc(s.announcement)} <a href="/adopt">See our kittens →</a></span><button class="announce-x" type="button" data-dismiss-announce aria-label="Dismiss announcement">×</button>`;
    ann.hidden = false;
  } else ann.hidden = true;
  const year = new Date().getFullYear();
  $("#footer").innerHTML = `<div class="wrap"><div class="foot-grid">
    <div><a class="brand" href="/">${LOGO}<span><b>${esc(s.rescueName)}</b><small>${esc(s.tagline || "")}</small></span></a>
      <p>Home-raised kittens, litter-trained and socialised${placeLine() ? `, from ${esc(placeLine())}` : ""}.</p></div>
    <div><h4>Kittens</h4><ul><li><a href="/adopt">Our kittens</a></li><li><a href="/litters">Upcoming litters</a></li><li><a href="/parents">Meet the parents</a></li><li><a href="/adopt#alerts">Kitten alerts</a></li></ul></div>
    <div><h4>About</h4><ul><li><a href="/how-to-adopt">How it works</a></li><li><a href="/about">About us</a></li>${SITE.stories.length ? '<li><a href="/happy-tails">Happy tails</a></li>' : ""}<li><a href="/happy-tails#share-story">Share your happy tail</a></li><li><a href="/faq">FAQ</a></li><li><a href="/contact">Contact</a></li></ul></div>
    <div><h4>Get in touch</h4><ul>${s.email ? `<li>${esc(s.email)}</li>` : ""}${s.phone ? `<li>${esc(s.phone)}</li>` : ""}${placeLine() ? `<li>${esc(placeLine())}</li>` : ""}
      ${s.facebookUrl ? `<li><a href="${esc(s.facebookUrl)}" target="_blank" rel="noopener noreferrer">Facebook</a></li>` : ""}${s.instagramUrl ? `<li><a href="${esc(s.instagramUrl)}" target="_blank" rel="noopener noreferrer">Instagram</a></li>` : ""}</ul></div></div>
    <div class="foot-base"><span>© ${year} ${esc(s.rescueName)}${s.licenceNumber ? ` · Licence ${esc(s.licenceNumber)}` : ""}</span>
      <span><a href="/privacy">Privacy</a> · <a href="/admin/">Owner login</a></span></div></div>`;
}

/* ---------------- router ---------------- */
const ROUTES = [
  [/^\/$/, () => [pHome(), "Home-raised kittens"]],
  [/^\/adopt\/?$/, () => [pAdopt(), "Our kittens", () => { renderAdoptGrid(); renderAlertsForm(); }]],
  [/^\/adopt\/([a-z0-9-]+)\/?$/, m => { const a = listed().find(x => x.slug === m[1]); return [pPet(m[1]), a ? `${a.name}, ${animalLine(a).toLowerCase()}` : "Kitten not found"]; }],
  [/^\/how-to-adopt\/?$/, () => [pHowTo(), "How it works", renderApplyForm]],
  [/^\/parents\/?$/, () => [pParents(), "Meet the parents"]],
  [/^\/litters\/?$/, () => [pLitters(), "Upcoming litters"]],
  [/^\/happy-tails\/?$/, () => [pStories(), "Happy tails", renderStoryForm]],
  [/^\/about\/?$/, () => [pAbout(), "About us"]],
  [/^\/faq\/?$/, () => [pFaq(), "FAQ"]],
  [/^\/contact\/?$/, () => [pContact(), "Contact us", renderContactForm]],
  [/^\/privacy\/?$/, () => [pPrivacy(), "Privacy notice"]],
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
