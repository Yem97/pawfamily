// Scheduled function: runs on the 1st of every month (Netlify cron), saves a full backup and tells the owner.
import { getStores } from "./lib/store.mjs";
import { createBackup, BACKUPS_KEPT } from "./lib/backup.mjs";
import { notifyOwner } from "./lib/email.mjs";

export const config = { schedule: "@monthly" };

export default async function monthlyBackup() {
  const { data } = await getStores();
  const result = await createBackup(data);
  await notifyOwner("Your monthly Pawfamily backup is saved", [
    ["Date", result.date], ["Pets", String(result.counts.pets)], ["Applications", String(result.counts.applications)],
    ["Messages", String(result.counts.messages)], ["Stories", String(result.counts.stories)], ["Waiting list", String(result.counts.waitlist)],
    ["Where", `Dashboard → Backup. The last ${BACKUPS_KEPT} monthly backups are kept.`],
  ]);
  console.log("Monthly backup saved", result);
  return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
}
