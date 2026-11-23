// Shared site data helpers used by the API, the share-preview function, SEO and backups.
import { listRecords } from "./store.mjs";

export const DEFAULT_SETTINGS = {
  rescueName: "Pawfamily",
  tagline: "Rescued pets, loving homes",
  town: "", region: "", email: "", phone: "",
  facebookUrl: "https://www.facebook.com/share/1CLxMBvaTP/",
  instagramUrl: "", donateUrl: "", charityNumber: "",
  currency: "£", defaultFee: null,
  feeIncludes: "Vet health check, first vaccinations, microchip, flea and worm treatment, and neutering when old enough.",
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
  const [settings, animals, applications, messages, stories, waitlist] = await Promise.all([
    getSettings(data), listRecords(data, "animals/"), listRecords(data, "applications/"), listRecords(data, "messages/"),
    listRecords(data, "stories/"), listRecords(data, "waitlist/")]);
  return { exportedAt: new Date().toISOString(), version: 2, settings, animals, applications, messages, stories,
    waitlist: waitlist.map(({ token, ...w }) => w) };
}

export const ageWords = { baby: "baby", young: "young", adult: "adult", senior: "senior" };
export const speciesWords = { cat: "cat", dog: "dog", rabbit: "rabbit", other: "pet" };
export const money = (n, cur = "£") => (n === null || n === undefined || n === "" ? "" : cur + Number(n).toLocaleString("en-GB"));
export const feeOf = (a, s) => money(a.fee ?? s.defaultFee, s.currency);
