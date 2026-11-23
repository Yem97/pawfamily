// Pet pages (/adopt/<slug>) are served with that pet's title, description and photo in the HTML <head>,
// so Facebook, WhatsApp and Google show a proper preview. The page itself is the normal single-page app.
import { getStores } from "./lib/store.mjs";
import { getSettings, listedAnimals, feeOf, speciesWords } from "./lib/site.mjs";

export const config = { path: "/adopt/:slug" };

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const setMeta = (html, attr, key, value) => {
  const re = new RegExp(`<meta ${attr}="${key}" content="[^"]*">`);
  const tag = `<meta ${attr}="${key}" content="${esc(value)}">`;
  return re.test(html) ? html.replace(re, tag) : html.replace("</head>", `${tag}\n</head>`);
};

export function petHead(html, { animal: a, settings: s, origin }) {
  const fee = feeOf(a, s);
  const kind = a.breed || speciesWords[a.species] || "pet";
  const line = [a.sex !== "unknown" ? a.sex : "", a.ageGroup, kind].filter(Boolean).join(" ");
  const title = `${a.name} · ${s.rescueName}`;
  const desc = `${a.name} is a ${line} looking for a loving home${s.town ? ` in ${s.town}` : ""}.${a.summary ? ` ${a.summary}` : ""}${fee ? ` Adoption fee ${fee}.` : ""}`.slice(0, 280);
  const url = `${origin}/adopt/${a.slug}`;
  const image = a.photos?.[0] ? `${origin}/api/images/${a.photos[0]}` : `${origin}/assets/og-image.jpg`;
  let out = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  out = setMeta(out, "name", "description", desc);
  out = setMeta(out, "property", "og:type", "article");
  out = setMeta(out, "property", "og:title", `Meet ${a.name}: ${line} looking for a home`);
  out = setMeta(out, "property", "og:description", desc);
  out = setMeta(out, "property", "og:image", image);
  out = setMeta(out, "property", "og:url", url);
  out = setMeta(out, "property", "og:site_name", s.rescueName);
  out = setMeta(out, "name", "twitter:card", "summary_large_image");
  out = out.replace("</head>", `<link rel="canonical" href="${esc(url)}">\n</head>`);
  return out;
}

export default async function share(req, context) {
  const url = new URL(req.url);
  const slug = context?.params?.slug || url.pathname.split("/")[2] || "";
  let shell;
  try {
    const res = await fetch(new URL("/index.html", url), { headers: { accept: "text/html" } });
    if (!res.ok) throw new Error(`shell ${res.status}`);
    shell = await res.text();
  } catch (e) {
    console.error("share: could not load the page shell", e?.message);
    return Response.redirect(`${url.origin}/adopt`, 302);
  }
  let html = shell;
  try {
    const { data } = await getStores();
    const [settings, animals] = await Promise.all([getSettings(data), listedAnimals(data)]);
    const animal = animals.find(a => a.slug === slug);
    if (animal) html = petHead(shell, { animal, settings, origin: url.origin });
  } catch (e) {
    console.error("share: could not load pet data", e?.message); // fall back to the plain page
  }
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
}
