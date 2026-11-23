// Monthly backups: a full export saved under backups/<yyyy-mm-dd>, newest 12 kept.
import { buildExport } from "./site.mjs";

export const BACKUPS_KEPT = 12;

export async function createBackup(data, keep = BACKUPS_KEPT) {
  const snapshot = await buildExport(data);
  const date = snapshot.exportedAt.slice(0, 10);
  await data.setJSON(`backups/${date}`, snapshot);
  const keys = (await data.listKeys("backups/")).sort();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - keep)).map(k => data.delete(k)));
  return {
    date,
    counts: { pets: snapshot.animals.length, applications: snapshot.applications.length, messages: snapshot.messages.length,
      stories: snapshot.stories.length, waitlist: snapshot.waitlist.length },
  };
}
