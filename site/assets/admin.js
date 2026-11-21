// Pawfamily owner dashboard. Talks to /api/admin/* with the session cookie + X-Requested-With header.
import { esc, $, $$, LABELS, money, ageText, fmtDate, fmtDateTime, LOGO, photo, toast, api, showFieldErrors, formError, busy, field, resizeImage } from "./ui.js";

const A = (path, opts = {}) => api(path, { ...opts, admin: true });
let me = { signedIn: false, configured: true };
let settings = null;
const dlg = $("#dlg");

/* ---------------- auth ---------------- */
async function guarded(fn) {
  try { return await fn(); }
  catch (err) {
    if (err.status === 401) { me.signedIn = false; renderLogin("Your session has ended. Please sign in again."); return null; }
    throw err;
  }
}
function renderLogin(notice = "") {
  $("#topActions").innerHTML = `<a class="btn light sm" href="/">View website</a>`;
  $("#root").innerHTML = `<div class="login form-card"><div class="eyebrow">Owner login</div><h1>Welcome back</h1>
    <p class="muted">Sign in to manage pets, applications and your website.</p>
    ${!me.configured ? `<div class="setup-note mt-m"><b>Sign-in isn't set up yet.</b> In Netlify, add <code>ADMIN_EMAIL</code>, <code>ADMIN_PASSWORD_HASH</code> and <code>SESSION_SECRET</code>, then redeploy. See <code>docs/SETUP.md</code>.</div>` : ""}
    ${notice ? `<div class="form-error mt-m" role="alert">${esc(notice)}</div>` : ""}
    <form class="stack mt-m" id="login" novalidate>
      ${field("login", "email", "Email", `<input <CONTROL type="email" autocomplete="username" required>`)}
      ${field("login", "password", "Password", `<input <CONTROL type="password" autocomplete="current-password" required>`)}
      <button class="btn" type="submit">Sign in</button></form></div>`;
  const form = $("#login");
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    const errs = {}; if (!d.email.trim()) errs.email = "Enter your email."; if (!d.password) errs.password = "Enter your password.";
    formError(form, ""); if (showFieldErrors(form, errs)) return;
    const btn = $("button", form); busy(btn, true, "Signing in…");
    try { await api("/api/auth/login", { method: "POST", body: d }); me.signedIn = true; location.hash = "#overview"; route(); }
    catch (err) { busy(btn, false); formError(form, err.message); form.password.value = ""; form.password.focus(); }
  });
  $("#login-email").focus();
}

/* ---------------- shell ---------------- */
const NAV = [["overview", "Overview"], ["pets", "Pets"], ["applications", "Applications"], ["messages", "Messages"], ["stories", "Happy tails"], ["settings", "Settings"], ["backup", "Backup"]];
let counts = { applications: 0, messages: 0 };
function shell(view, html) {
  $("#topActions").innerHTML = `<a class="btn light sm" href="/" target="_blank" rel="noopener">View website ↗</a><button class="btn sm" type="button" id="logout">Sign out</button>`;
  $("#root").innerHTML = `<div class="admin"><nav class="a-nav" aria-label="Dashboard">${NAV.map(([id, l]) => `<a href="#${id}" ${id === view ? 'aria-current="page"' : ""}>${l}${counts[id] ? `<span class="badge" aria-label="${counts[id]} new">${counts[id]}</span>` : ""}</a>`).join("")}</nav>
    <section id="view" class="view-in">${html}</section></div>`;
}
async function refreshCounts() {
  const s = await A("/api/admin/summary");
  counts = { applications: s.applications.new, messages: s.messages.new };
  return s;
}

/* ---------------- overview ---------------- */
async function vOverview() {
  const s = await refreshCounts();
  const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening";
  shell("overview", `<div class="a-head"><div><h1>${greeting}</h1><p>Here's what's happening at ${esc(settings.rescueName)}.</p></div><button class="btn sm" type="button" data-new-pet>+ Add a pet</button></div>
    <div class="stats">
      <a class="stat hl" href="#applications"><b>${s.applications.new}</b><span>New applications</span></a>
      <a class="stat" href="#messages"><b>${s.messages.new}</b><span>New messages</span></a>
      <a class="stat" href="#pets"><b>${s.animals.available}</b><span>Pets available</span></a>
      <a class="stat" href="#pets"><b>${s.animals.reserved}</b><span>Reserved</span></a></div>
    ${!settings.email || !settings.town ? `<div class="setup-note">Finish your setup: add your contact email and town in <a class="link" href="#settings">Settings</a> so adopters can find you.</div><br>` : ""}
    <div class="box"><h2>Latest applications <a class="link" href="#applications">View all</a></h2>
      ${s.recentApplications.length ? `<ul class="list">${s.recentApplications.map(a => `<li class="text"><div><b class="t">${esc(a.name)}</b> <span class="pill ${esc(a.status)}">${esc(LABELS.appStatus[a.status])}</span>
        <div class="s">For ${esc(a.animalName)} · ${esc(fmtDateTime(a.createdAt))}</div></div><div class="ctrl"><a class="btn light sm" href="#applications">Open</a></div></li>`).join("")}</ul>`
        : `<div class="pad muted">No applications yet. They'll appear here as soon as someone applies.</div>`}</div>
    <div class="box"><h2>Latest messages <a class="link" href="#messages">View all</a></h2>
      ${s.recentMessages.length ? `<ul class="list">${s.recentMessages.map(m => `<li class="text"><div><b class="t">${esc(m.name)}</b> <span class="pill ${esc(m.status)}">${m.status === "new" ? "New" : "Replied"}</span>
        <div class="s">${esc(LABELS.topic[m.topic] || m.topic)} · ${esc(fmtDateTime(m.createdAt))}</div></div><div class="ctrl"><a class="btn light sm" href="#messages">Open</a></div></li>`).join("")}</ul>`
        : `<div class="pad muted">No messages yet.</div>`}</div>`);
}

/* ---------------- pets ---------------- */
let pets = [];
const petPayload = a => ({ name: a.name, species: a.species, breed: a.breed || "", sex: a.sex, ageGroup: a.ageGroup, birthDate: a.birthDate || "", status: a.status,
  fee: a.fee ?? "", summary: a.summary || "", story: a.story || "", photos: a.photos || [], traits: a.traits || [], health: a.health || [], healthNotes: a.healthNotes || "", featured: Boolean(a.featured) });
async function vPets() {
  await refreshCounts();
  pets = (await A("/api/admin/animals")).animals;
  const order = { available: 0, reserved: 1, hidden: 2, adopted: 3 };
  pets.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
  shell("pets", `<div class="a-head"><div><h1>Pets</h1><p>Change a status here and the website updates straight away. Hidden and adopted pets don't appear on the website.</p></div><button class="btn sm" type="button" data-new-pet>+ Add a pet</button></div>
    <div class="box">${pets.length ? `<ul class="list">${pets.map(a => `<li>${photo(a.photos?.[0], a.name)}
      <div><b class="t">${esc(a.name)}</b>${a.featured ? ' <span class="pill plain">Featured</span>' : ""}
        <div class="s">${esc(LABELS.species[a.species])} · ${esc(LABELS.sex[a.sex])} · ${esc(ageText(a))} · ${a.fee !== null && a.fee !== undefined ? esc(money(a.fee, settings.currency)) : settings.defaultFee !== null ? `${esc(money(settings.defaultFee, settings.currency))} (default)` : "Fee not set"} · ${(a.photos || []).length} photo${(a.photos || []).length === 1 ? "" : "s"}</div></div>
      <div class="ctrl"><label class="sr-only" for="st-${esc(a.id)}">Status for ${esc(a.name)}</label>
        <select id="st-${esc(a.id)}" data-pet-status="${esc(a.id)}">${Object.entries(LABELS.status).map(([v, l]) => `<option value="${v}" ${a.status === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        ${a.status === "available" || a.status === "reserved" ? `<a class="btn light sm" href="/adopt/${esc(a.slug)}" target="_blank" rel="noopener">View</a>` : ""}
        <button class="btn light sm" type="button" data-edit-pet="${esc(a.id)}">Edit</button>
        <button class="btn danger sm" type="button" data-delete-pet="${esc(a.id)}">Delete</button></div></li>`).join("")}</ul>`
      : `<div class="pad"><div class="empty"><h3>No pets yet</h3><p>Add your first pet with a few photos and their story. They'll appear on the website as soon as you save.</p><button class="btn sm" type="button" data-new-pet>+ Add a pet</button></div></div>`}</div>`);
}

let editorUploads = new Set(); // photos uploaded in the open editor, cleaned up if cancelled
function openDialog(title, bodyHtml, footHtml, onClose) {
  dlg.innerHTML = `<div class="d-head"><h2 id="dlgTitle">${esc(title)}</h2><button class="x" type="button" data-close aria-label="Close">×</button></div><div class="d-body">${bodyHtml}</div><div class="d-foot">${footHtml}</div>`;
  dlg.onclose = onClose || null;
  dlg.showModal();
  $("input, select, textarea", dlg)?.focus();
}

function petEditor(id) {
  const existing = pets.find(p => p.id === id);
  const a = existing ? { ...existing } : { name: "", species: "cat", breed: "", sex: "female", ageGroup: "young", birthDate: "", status: "available", fee: null, summary: "", story: "", photos: [], traits: [], health: ["vet-checked"], healthNotes: "", featured: false };
  const photos = [...(a.photos || [])];
  editorUploads = new Set();
  const f = "pet";
  const opts = (map, v) => Object.entries(map).map(([k, l]) => `<option value="${k}" ${v === k ? "selected" : ""}>${l}</option>`).join("");
  const boxes = (name, map, sel) => `<div class="checks">${Object.entries(map).map(([k, l]) => `<label class="checkline"><input type="checkbox" name="${name}" value="${k}" ${sel.includes(k) ? "checked" : ""}><span>${esc(l)}</span></label>`).join("")}</div>`;
  openDialog(existing ? `Edit ${a.name}` : "Add a pet", `<form class="stack" id="${f}" novalidate>
    <fieldset><legend>Photos</legend><div class="photo-grid" id="photoGrid"></div>
      <div class="field"><label for="petFiles">Add photos <span class="opt">(up to 8, first is the main photo)</span></label><input id="petFiles" type="file" accept="image/*" multiple>
      <span class="hint">Bright, close-up photos work best. They're resized automatically.</span></div></fieldset>
    <fieldset><legend>About the pet</legend>
      <div class="row2">${field(f, "name", "Name", `<input <CONTROL maxlength="60" value="${esc(a.name)}">`)}${field(f, "species", "Type", `<select <CONTROL>${opts(LABELS.species, a.species)}</select>`)}</div>
      <div class="row2">${field(f, "breed", "Breed", `<input <CONTROL maxlength="80" value="${esc(a.breed)}" placeholder="For example: Ragdoll, or Domestic shorthair">`, { optional: true })}${field(f, "sex", "Sex", `<select <CONTROL>${opts(LABELS.sex, a.sex)}</select>`)}</div>
      <div class="row2">${field(f, "ageGroup", "Age group", `<select <CONTROL>${Object.entries(LABELS.age).map(([k, l]) => `<option value="${k}" ${a.ageGroup === k ? "selected" : ""}>${l} (${LABELS.ageHelp[k]})</option>`).join("")}</select>`)}
        ${field(f, "birthDate", "Date of birth", `<input <CONTROL type="date" value="${esc(a.birthDate)}">`, { optional: true, hint: "Estimate if unknown. Used to show exact age." })}</div>
      ${field(f, "summary", "Short summary", `<input <CONTROL maxlength="180" value="${esc(a.summary)}" placeholder="One line shown at the top of their page">`, { optional: true })}
      ${field(f, "story", "Their story", `<textarea <CONTROL class="tall" maxlength="5000" placeholder="How they came to you, their personality, what kind of home would suit them. Leave a blank line between paragraphs.">${esc(a.story)}</textarea>`, { optional: true })}</fieldset>
    <fieldset><legend>Personality</legend>${boxes("traits", LABELS.traits, a.traits || [])}</fieldset>
    <fieldset><legend>Health</legend>${boxes("health", LABELS.health, a.health || [])}
      ${field(f, "healthNotes", "Health notes", `<textarea <CONTROL maxlength="600" placeholder="Any conditions, medication or diet adopters should know about.">${esc(a.healthNotes)}</textarea>`, { optional: true })}</fieldset>
    <fieldset><legend>Listing</legend>
      <div class="row2">${field(f, "status", "Status", `<select <CONTROL>${opts(LABELS.status, a.status)}</select>`)}
        ${field(f, "fee", `Adoption fee (${settings.currency})`, `<input <CONTROL type="number" min="0" step="1" inputmode="decimal" value="${a.fee ?? ""}" placeholder="${settings.defaultFee ?? ""}">`, { optional: true, hint: settings.defaultFee !== null ? `Leave blank to use your default (${money(settings.defaultFee, settings.currency)}).` : "Leave blank to show 'Ask us'. Set a default in Settings." })}</div>
      <label class="checkline"><input type="checkbox" name="featured" ${a.featured ? "checked" : ""}><span>Feature on the home page</span></label></fieldset>
  </form>`, `<button class="btn" type="submit" form="${f}">${existing ? "Save changes" : "Add pet"}</button><button class="btn light" type="button" data-close>Cancel</button>`,
  async () => { // cleanup photos uploaded but never saved
    const orphans = [...editorUploads]; editorUploads = new Set();
    await Promise.all(orphans.map(pid => A(`/api/admin/images/${pid}`, { method: "DELETE" }).catch(() => {})));
  });

  const drawPhotos = () => {
    $("#photoGrid").innerHTML = photos.map((p, i) => p.startsWith("uploading")
      ? `<div class="ph uploading">Uploading…</div>`
      : `<div class="ph">${i === 0 ? '<span class="main-tag">Main</span>' : ""}<img src="/api/images/${esc(p)}" alt="Photo ${i + 1}" data-fallback>
        <div class="tools">${i > 0 ? `<button type="button" data-photo-main="${i}">Make main</button>` : "<span></span>"}<button type="button" data-photo-remove="${i}">Remove</button></div></div>`).join("")
      || `<p class="hint">No photos yet. Pets with photos get far more applications.</p>`;
    $("#petFiles").disabled = photos.length >= 8;
  };
  drawPhotos();
  $("#petFiles").addEventListener("change", async e => {
    const files = [...e.target.files].slice(0, 8 - photos.length); e.target.value = "";
    for (const file of files) {
      const slot = `uploading-${Math.random()}`; photos.push(slot); drawPhotos();
      try {
        const dataUrl = await resizeImage(file);
        const { id: pid } = await guarded(() => A("/api/admin/images", { method: "POST", body: { dataUrl } }));
        photos[photos.indexOf(slot)] = pid; editorUploads.add(pid);
      } catch (err) { photos.splice(photos.indexOf(slot), 1); toast(err.message || "That photo couldn't be uploaded.", { error: true }); }
      drawPhotos();
    }
  });
  $("#photoGrid").addEventListener("click", async e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.photoMain) { const [p] = photos.splice(Number(b.dataset.photoMain), 1); photos.unshift(p); }
    if (b.dataset.photoRemove) {
      const [p] = photos.splice(Number(b.dataset.photoRemove), 1);
      if (editorUploads.has(p)) { editorUploads.delete(p); A(`/api/admin/images/${p}`, { method: "DELETE" }).catch(() => {}); }
    }
    drawPhotos();
  });
  const form = $("#" + f);
  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (photos.some(p => p.startsWith("uploading"))) { toast("Please wait for photos to finish uploading."); return; }
    const fd = new FormData(form);
    const body = { ...Object.fromEntries(fd), traits: fd.getAll("traits"), health: fd.getAll("health"), featured: form.featured.checked, photos: [...photos] };
    if (!body.name.trim()) { showFieldErrors(form, { name: "Give the pet a name." }); return; }
    const btn = $(`button[form="${f}"]`); busy(btn, true);
    try {
      await guarded(() => A(existing ? `/api/admin/animals/${existing.id}` : "/api/admin/animals", { method: existing ? "PUT" : "POST", body }));
      editorUploads = new Set(); dlg.close();
      toast(existing ? `${body.name} saved` : `${body.name} added to the website`);
      if (location.hash === "#pets") vPets(); else location.hash = "#pets";
    } catch (err) { busy(btn, false); showFieldErrors(form, err.fields); formError(form, err.message); }
  });
}

/* ---------------- applications ---------------- */
let appFilter = "open";
async function vApplications() {
  const list = (await A("/api/admin/applications")).applications;
  await refreshCounts();
  const shown = list.filter(a => appFilter === "all" || (appFilter === "open" ? !["adopted", "declined"].includes(a.status) : a.status === appFilter));
  const chip = (v, l, n) => `<button type="button" class="chip" data-app-filter="${v}" aria-pressed="${appFilter === v}">${l}<span class="c">${n}</span></button>`;
  shell("applications", `<div class="a-head"><div><h1>Applications</h1><p>Move each application through the stages and keep private notes. Applicants can't see these.</p></div></div>
    <div class="chips mt-s">${chip("open", "Open", list.filter(a => !["adopted", "declined"].includes(a.status)).length)}${Object.entries(LABELS.appStatus).map(([v, l]) => chip(v, l, list.filter(a => a.status === v).length)).join("")}${chip("all", "All", list.length)}</div><br>
    <div class="box">${shown.length ? `<ul class="list">${shown.map(a => `<li class="text"><div>
      <b class="t">${esc(a.name)}</b> <span class="pill ${esc(a.status)}">${esc(LABELS.appStatus[a.status])}</span>
      <div class="s">For <b>${esc(a.animalName)}</b> · received ${esc(fmtDateTime(a.createdAt))}</div>
      <dl class="kv"><dt>Email</dt><dd>${esc(a.email)}</dd>${a.phone ? `<dt>Phone</dt><dd>${esc(a.phone)}</dd>` : ""}<dt>Postcode</dt><dd>${esc(a.postcode)}</dd>
        <dt>Home</dt><dd>${esc(LABELS.homeType[a.homeType] || a.homeType)}, ${esc(LABELS.outdoor[a.outdoor] || a.outdoor)}</dd><dt>Household</dt><dd>${esc(a.household)}</dd>
        ${a.otherPets ? `<dt>Other pets</dt><dd>${esc(a.otherPets)}</dd>` : ""}${a.experience ? `<dt>Experience</dt><dd>${esc(a.experience)}</dd>` : ""}</dl>
      <div class="msg">${esc(a.message)}</div>
      <div class="notes"><label class="hint" for="n-${esc(a.id)}">Private notes</label><textarea id="n-${esc(a.id)}" data-notes="${esc(a.id)}" maxlength="3000" placeholder="Call notes, home check date…">${esc(a.notes || "")}</textarea></div></div>
      <div class="ctrl"><label class="sr-only" for="as-${esc(a.id)}">Stage</label><select id="as-${esc(a.id)}" data-app-status="${esc(a.id)}">${Object.entries(LABELS.appStatus).map(([v, l]) => `<option value="${v}" ${a.status === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        <button class="btn sm" type="button" data-app-save="${esc(a.id)}">Save</button><button class="btn danger sm" type="button" data-app-delete="${esc(a.id)}">Delete</button></div></li>`).join("")}</ul>`
      : `<div class="pad muted">${list.length ? "No applications at this stage." : "No applications yet. When someone applies on the website, it appears here (and in your email if alerts are set up)."}</div>`}</div>`);
}

/* ---------------- messages ---------------- */
async function vMessages() {
  const list = (await A("/api/admin/messages")).messages;
  await refreshCounts();
  shell("messages", `<div class="a-head"><div><h1>Messages</h1><p>From the contact form. Reply by email or phone, then mark as replied.</p></div></div>
    <div class="box">${list.length ? `<ul class="list">${list.map(m => `<li class="text"><div><b class="t">${esc(m.name)}</b> <span class="pill ${esc(m.status)}">${m.status === "new" ? "New" : "Replied"}</span>
      <div class="s">${esc(LABELS.topic[m.topic] || m.topic)} · ${esc(fmtDateTime(m.createdAt))}</div>
      <dl class="kv"><dt>Email</dt><dd>${esc(m.email)}</dd>${m.phone ? `<dt>Phone</dt><dd>${esc(m.phone)}</dd>` : ""}</dl><div class="msg">${esc(m.message)}</div></div>
      <div class="ctrl"><button class="btn ${m.status === "new" ? "" : "light"} sm" type="button" data-msg-toggle="${esc(m.id)}" data-next="${m.status === "new" ? "replied" : "new"}">${m.status === "new" ? "Mark replied" : "Mark as new"}</button>
        <button class="btn danger sm" type="button" data-msg-delete="${esc(m.id)}">Delete</button></div></li>`).join("")}</ul>`
      : `<div class="pad muted">No messages yet.</div>`}</div>`);
}

/* ---------------- stories ---------------- */
let stories = [];
async function vStories() {
  await refreshCounts();
  stories = (await A("/api/admin/stories")).stories;
  shell("stories", `<div class="a-head"><div><h1>Happy tails</h1><p>Adoption success stories. Published stories appear on the website and build trust with new adopters.</p></div><button class="btn sm" type="button" data-edit-story="new">+ Add a story</button></div>
    <div class="box">${stories.length ? `<ul class="list">${stories.map(s => `<li>${photo(s.photo, s.title)}<div><b class="t">${esc(s.title)}</b> <span class="pill ${s.published ? "published" : "draft"}">${s.published ? "Published" : "Draft"}</span>
      <div class="s">${esc(s.animalName || "")}${s.animalName ? " · " : ""}${esc(fmtDate(s.createdAt))}</div></div>
      <div class="ctrl"><button class="btn light sm" type="button" data-edit-story="${esc(s.id)}">Edit</button><button class="btn danger sm" type="button" data-delete-story="${esc(s.id)}">Delete</button></div></li>`).join("")}</ul>`
      : `<div class="pad muted">No stories yet. When a pet settles into their new home, ask the family for a photo and a few words.</div>`}</div>`);
}
function storyEditor(id) {
  const existing = stories.find(s => s.id === id);
  const s = existing ? { ...existing } : { title: "", animalName: "", body: "", photo: "", published: true };
  let pic = s.photo; editorUploads = new Set();
  const f = "story";
  openDialog(existing ? "Edit story" : "Add a story", `<form class="stack" id="${f}" novalidate>
    ${field(f, "title", "Title", `<input <CONTROL maxlength="120" value="${esc(s.title)}" placeholder="For example: Bluebell's first Christmas at home">`)}
    ${field(f, "animalName", "Pet's name", `<input <CONTROL maxlength="60" value="${esc(s.animalName)}">`, { optional: true })}
    ${field(f, "body", "Story", `<textarea <CONTROL class="tall" maxlength="5000">${esc(s.body)}</textarea>`)}
    <div class="field"><span class="label">Photo <span class="opt">(optional)</span></span><div class="photo-grid" id="storyPic"></div><input id="storyFile" type="file" accept="image/*" aria-label="Upload story photo"></div>
    <label class="checkline"><input type="checkbox" name="published" ${s.published ? "checked" : ""}><span>Published on the website</span></label></form>`,
    `<button class="btn" type="submit" form="${f}">Save story</button><button class="btn light" type="button" data-close>Cancel</button>`,
    async () => { const o = [...editorUploads]; editorUploads = new Set(); await Promise.all(o.map(p => A(`/api/admin/images/${p}`, { method: "DELETE" }).catch(() => {}))); });
  const draw = () => { $("#storyPic").innerHTML = pic ? `<div class="ph"><img src="/api/images/${esc(pic)}" alt="Story photo" data-fallback><div class="tools"><span></span><button type="button" id="storyPicRemove">Remove</button></div></div>` : ""; };
  draw();
  $("#storyPic").addEventListener("click", e => { if (e.target.id === "storyPicRemove") { if (editorUploads.has(pic)) { editorUploads.delete(pic); A(`/api/admin/images/${pic}`, { method: "DELETE" }).catch(() => {}); } pic = ""; draw(); } });
  $("#storyFile").addEventListener("change", async e => {
    const file = e.target.files[0]; e.target.value = ""; if (!file) return;
    try { const dataUrl = await resizeImage(file); const { id: pid } = await guarded(() => A("/api/admin/images", { method: "POST", body: { dataUrl } })); if (editorUploads.has(pic)) A(`/api/admin/images/${pic}`, { method: "DELETE" }).catch(() => {}); pic = pid; editorUploads.add(pid); draw(); }
    catch (err) { toast(err.message || "Upload failed.", { error: true }); }
  });
  const form = $("#" + f);
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const body = { ...Object.fromEntries(new FormData(form)), published: form.published.checked, photo: pic || "" };
    const btn = $(`button[form="${f}"]`); busy(btn, true);
    try { await guarded(() => A(existing ? `/api/admin/stories/${existing.id}` : "/api/admin/stories", { method: existing ? "PUT" : "POST", body })); editorUploads = new Set(); dlg.close(); toast("Story saved"); vStories(); }
    catch (err) { busy(btn, false); showFieldErrors(form, err.fields); formError(form, err.message); }
  });
}

/* ---------------- settings ---------------- */
async function vSettings() {
  await refreshCounts();
  settings = (await A("/api/admin/settings")).settings;
  const f = "settings", s = settings;
  const inp = (name, label, opts = {}, attrs = "") => field(f, name, label, `<input <CONTROL ${attrs} value="${esc(s[name] ?? "")}">`, opts);
  shell("settings", `<div class="a-head"><div><h1>Settings</h1><p>These details appear across your whole website.</p></div></div>
    <div class="box"><div class="pad"><form class="stack" id="${f}" novalidate>
      <fieldset><legend>Your rescue</legend>
        <div class="row2">${inp("rescueName", "Rescue name", {}, 'maxlength="60"')}${inp("tagline", "Tagline", { optional: true }, 'maxlength="120"')}</div>
        <div class="row2">${inp("town", "Town", { optional: true }, 'maxlength="60"')}${inp("region", "County or region", { optional: true }, 'maxlength="60"')}</div>
        ${inp("charityNumber", "Registered charity number", { optional: true, hint: "Shown in the footer and About page if set." }, 'maxlength="40"')}
        ${field(f, "aboutText", "About your rescue", `<textarea <CONTROL class="tall" maxlength="5000" placeholder="Your story: why you started rescuing, how you care for animals. Leave a blank line between paragraphs.">${esc(s.aboutText)}</textarea>`, { optional: true, hint: "Leave blank to use the standard text." })}</fieldset>
      <fieldset><legend>Contact &amp; social</legend>
        <div class="row2">${inp("email", "Public email", { optional: true }, 'type="email" maxlength="200"')}${inp("phone", "Public phone", { optional: true }, 'type="tel" maxlength="30"')}</div>
        <div class="row2">${inp("facebookUrl", "Facebook page link", { optional: true }, 'type="url" maxlength="300"')}${inp("instagramUrl", "Instagram link", { optional: true }, 'type="url" maxlength="300"')}</div>
        ${inp("donateUrl", "Donation link", { optional: true, hint: "For example a PayPal, JustGiving or Ko-fi page." }, 'type="url" maxlength="300"')}</fieldset>
      <fieldset><legend>Adoption fees</legend>
        <div class="row2">${inp("currency", "Currency symbol", {}, 'maxlength="3"')}${field(f, "defaultFee", "Default adoption fee", `<input <CONTROL type="number" min="0" step="1" inputmode="decimal" value="${s.defaultFee ?? ""}">`, { optional: true, hint: "Used when a pet has no fee of its own." })}</div>
        ${field(f, "feeIncludes", "What the fee includes", `<textarea <CONTROL maxlength="400">${esc(s.feeIncludes)}</textarea>`, { optional: true })}</fieldset>
      <fieldset><legend>Announcement bar</legend>
        ${inp("announcement", "Message at the top of every page", { optional: true, hint: "For example: 'Kitten season is here: 6 kittens looking for homes'. Leave blank to hide." }, 'maxlength="160"')}</fieldset>
      <div><button class="btn" type="submit">Save settings</button></div></form></div></div>`);
  const form = $("#" + f);
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = $("button[type=submit]", form); busy(btn, true); formError(form, "");
    try { settings = (await guarded(() => A("/api/admin/settings", { method: "PUT", body: Object.fromEntries(new FormData(form)) }))).settings; busy(btn, false); showFieldErrors(form, {}); toast("Settings saved"); renderBrand(); }
    catch (err) { busy(btn, false); showFieldErrors(form, err.fields); formError(form, err.message); }
  });
}

/* ---------------- backup ---------------- */
async function vBackup() {
  await refreshCounts();
  shell("backup", `<div class="a-head"><div><h1>Backup</h1><p>Download everything (pets, applications, messages, stories and settings) as one file.</p></div></div>
    <div class="box"><div class="pad"><p>We recommend downloading a backup once a month and keeping it somewhere safe, like Google Drive. Photos stay on the website and aren't included in the file.</p>
      <div class="btn-row mt-m"><button class="btn" type="button" id="downloadBackup">Download backup</button></div>
      <p class="hint mt-m">The file contains adopters' personal details. Store it privately and delete old copies you no longer need.</p></div></div>`);
}
async function downloadBackup(btn) {
  busy(btn, true, "Preparing…");
  try {
    const data = await guarded(() => A("/api/admin/export"));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = `pawfamily-backup-${new Date().toISOString().slice(0, 10)}.json`; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000); toast("Backup downloaded");
  } catch (err) { toast(err.message, { error: true }); }
  busy(btn, false);
}

/* ---------------- events ---------------- */
function confirmStep(btn, run) {
  if (btn.dataset.armed) return run();
  const label = btn.textContent; btn.dataset.armed = "1"; btn.textContent = "Click again to confirm";
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = label; } }, 3500);
}
const act = fn => guarded(fn).catch(err => toast(err.message, { error: true }));
document.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.hasAttribute("data-close")) { dlg.close(); return; }
  if (b.id === "logout") { act(async () => { await api("/api/auth/logout", { method: "POST" }); me.signedIn = false; location.hash = ""; renderLogin(); toast("Signed out"); }); return; }
  if (b.hasAttribute("data-new-pet")) return petEditor(null);
  if (b.dataset.editPet) return petEditor(b.dataset.editPet);
  if (b.dataset.deletePet) return confirmStep(b, () => act(async () => { await A(`/api/admin/animals/${b.dataset.deletePet}`, { method: "DELETE" }); toast("Pet deleted"); vPets(); }));
  if (b.dataset.appFilter) { appFilter = b.dataset.appFilter; act(vApplications); return; }
  if (b.dataset.appSave) {
    const id = b.dataset.appSave;
    return act(async () => { busy(b, true); await A(`/api/admin/applications/${id}`, { method: "PUT", body: { status: $(`[data-app-status="${CSS.escape(id)}"]`).value, notes: $(`[data-notes="${CSS.escape(id)}"]`).value } }); toast("Application updated"); vApplications(); });
  }
  if (b.dataset.appDelete) return confirmStep(b, () => act(async () => { await A(`/api/admin/applications/${b.dataset.appDelete}`, { method: "DELETE" }); toast("Application deleted"); vApplications(); }));
  if (b.dataset.msgToggle) return act(async () => { await A(`/api/admin/messages/${b.dataset.msgToggle}`, { method: "PUT", body: { status: b.dataset.next } }); vMessages(); });
  if (b.dataset.msgDelete) return confirmStep(b, () => act(async () => { await A(`/api/admin/messages/${b.dataset.msgDelete}`, { method: "DELETE" }); toast("Message deleted"); vMessages(); }));
  if (b.dataset.editStory) return storyEditor(b.dataset.editStory === "new" ? null : b.dataset.editStory);
  if (b.dataset.deleteStory) return confirmStep(b, () => act(async () => { await A(`/api/admin/stories/${b.dataset.deleteStory}`, { method: "DELETE" }); toast("Story deleted"); vStories(); }));
  if (b.id === "downloadBackup") return downloadBackup(b);
});
document.addEventListener("change", e => {
  const t = e.target;
  if (t.dataset.petStatus) {
    const a = pets.find(p => p.id === t.dataset.petStatus);
    act(async () => { await A(`/api/admin/animals/${a.id}`, { method: "PUT", body: { ...petPayload(a), status: t.value } }); toast(`${a.name} is now ${LABELS.status[t.value].toLowerCase()}`); vPets(); });
  }
});
dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });
window.addEventListener("hashchange", route);

/* ---------------- router & boot ---------------- */
const VIEWS = { overview: vOverview, pets: vPets, applications: vApplications, messages: vMessages, stories: vStories, settings: vSettings, backup: vBackup };
function renderBrand() { $("#adminBrand").innerHTML = `${LOGO}<span><b>${esc(settings?.rescueName || "Pawfamily")}</b><small>Owner dashboard</small></span>`; }
async function route() {
  if (!me.signedIn) return renderLogin();
  const view = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : "overview";
  try {
    if (!settings) settings = (await A("/api/admin/settings")).settings;
    renderBrand();
    await guarded(VIEWS[view]);
    $("#main").focus({ preventScroll: true }); window.scrollTo(0, 0);
  } catch (err) { $("#root").innerHTML = `<div class="form-error" role="alert">${esc(err.message)}</div>`; }
}
(async function boot() {
  renderBrand();
  try { me = await api("/api/auth/me"); } catch { me = { signedIn: false, configured: true }; }
  route();
})();
