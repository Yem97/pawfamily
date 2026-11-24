// /sitemap.xml and /robots.txt, always pointing at the site's official address (publicOrigin).
import { getStores } from "./lib/store.mjs";
import { listedAnimals, publicOrigin } from "./lib/site.mjs";
import { listRecords } from "./lib/store.mjs";

export const config = { path: ["/sitemap.xml", "/robots.txt"] };

const PAGES = [["/", "daily", "1.0"], ["/adopt", "daily", "0.9"], ["/how-to-adopt", "monthly", "0.8"], ["/happy-tails", "weekly", "0.6"],
  ["/about", "monthly", "0.6"], ["/parents", "monthly", "0.7"], ["/litters", "weekly", "0.8"], ["/faq", "monthly", "0.6"], ["/contact", "yearly", "0.5"], ["/privacy", "yearly", "0.2"]];
const xmlEsc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));

export default async function seo(req) {
  const url = new URL(req.url), origin = publicOrigin(req);
  if (url.pathname === "/robots.txt") {
    return new Response(`User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`,
      { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
  }
  let animals = [], hasStories = false;
  try {
    const { data } = await getStores();
    animals = await listedAnimals(data);
    hasStories = (await listRecords(data, "stories/")).some(s => s.published);
  } catch (e) { console.error("sitemap: data unavailable", e?.message); }
  const urls = PAGES.filter(([p]) => p !== "/happy-tails" || hasStories).map(([p, freq, pri]) => `<url><loc>${xmlEsc(origin + p)}</loc><changefreq>${freq}</changefreq><priority>${pri}</priority></url>`);
  for (const a of animals) urls.push(`<url><loc>${xmlEsc(`${origin}/adopt/${a.slug}`)}</loc><lastmod>${xmlEsc(String(a.updatedAt || a.createdAt).slice(0, 10))}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`);
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`,
    { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=600" } });
}
