// Shared site data helpers used by the API, the share-preview function, SEO and backups.
import { listRecords } from "./store.mjs";

// The site's one official address. Google, Facebook/WhatsApp previews and the sitemap always use it,
// whichever address a page was opened on. SITE_URL (Netlify env var) overrides it if the domain ever changes.
export const PRIMARY_ORIGIN = "https://pawfamilyrehoming.com";
const PRODUCTION_HOSTS = /(^|\.)pawfamilyrehoming\.com$|\.netlify\.app$/i;
export function publicOrigin(req) {
  const url = new URL(req.url);
  const env = (globalThis.Netlify?.env?.get?.("SITE_URL") ?? process.env.SITE_URL ?? "").trim().replace(/\/+$/, "");
  if (env && /^https:\/\/[a-z0-9.-]+$/i.test(env)) return env;
  return PRODUCTION_HOSTS.test(url.hostname) ? PRIMARY_ORIGIN : url.origin; // local dev and tests keep their own address
}

export const DEFAULT_SETTINGS = {
  rescueName: "Pawfamily",
  tagline: "Home-raised kittens",
  town: "", region: "", email: "", phone: "",
  facebookUrl: "https://www.facebook.com/share/1CLxMBvaTP/",
  instagramUrl: "", licenceNumber: "",
  currency: "£", defaultFee: null, defaultReservationFee: null, goHomeWeeks: 13,
  feeIncludes: "Vet health check, vaccinations, microchip, flea and worm treatment, ownership documents and a starter pack.",
  deliveryInfo: "Every kitten is delivered personally by the breeder, together with all ownership documents and records.",
  paymentInfo: "A deposit or full payment is due before delivery. You receive a written receipt for every payment and a sales contract.",
  announcement: "",
  aboutText: "",
};

export async function getSettings(data) {
  return { ...DEFAULT_SETTINGS, ...(await data.getJSON("settings") || {}) };
}

export const isListed = a => a && (a.status === "available" || a.status === "reserved");

export async function listedAnimals(data) {
  return (await listRecords(data, "animals/")).filter(isListed);
}

/** Full data export (backups and the dashboard download). Never includes credentials, rate limits or stats. */
export async function buildExport(data) {
  const [settings, animals, applications, messages, stories, waitlist, parents, litters] = await Promise.all([
    getSettings(data), listRecords(data, "animals/"), listRecords(data, "applications/"), listRecords(data, "messages/"),
    listRecords(data, "stories/"), listRecords(data, "waitlist/"), listRecords(data, "parents/"), listRecords(data, "litters/")]);
  return { exportedAt: new Date().toISOString(), version: 3, settings, animals, applications, messages, stories, parents, litters,
    waitlist: waitlist.map(({ token, ...w }) => w) };
}

export const ageWords = { baby: "baby", young: "young", adult: "adult", senior: "senior" };
export const speciesWords = { cat: "cat", dog: "dog", rabbit: "rabbit", other: "pet" };
export const money = (n, cur = "£") => (n === null || n === undefined || n === "" ? "" : cur + Number(n).toLocaleString("en-GB"));
export const feeOf = (a, s) => money(a.fee ?? s.defaultFee, s.currency);
