// Storage adapter.
// Production: Netlify Blobs (strong consistency so the owner sees their own writes immediately).
// Local development and tests: plain files under PAWFAMILY_DATA_DIR.
// Every record lives under its own key, so concurrent writes never clobber each other.
import { promises as fs } from "node:fs";
import path from "node:path";

function fileStore(dir) {
  const fileFor = key => path.join(dir, encodeURIComponent(key));
  const metaFor = key => fileFor(key) + ".meta.json";
  return {
    async getJSON(key) {
      try { return JSON.parse(await fs.readFile(fileFor(key), "utf8")); }
      catch (e) { if (e.code === "ENOENT") return null; throw e; }
    },
    async setJSON(key, value) {
      await fs.mkdir(dir, { recursive: true });
      const tmp = fileFor(key) + ".tmp";
      await fs.writeFile(tmp, JSON.stringify(value));
      await fs.rename(tmp, fileFor(key));
    },
    async delete(key) {
      await fs.rm(fileFor(key), { force: true });
      await fs.rm(metaFor(key), { force: true });
    },
    async listKeys(prefix) {
      let names = [];
      try { names = await fs.readdir(dir); } catch (e) { if (e.code !== "ENOENT") throw e; }
      return names
        .filter(n => !n.endsWith(".meta.json") && !n.endsWith(".tmp"))
        .map(n => decodeURIComponent(n))
        .filter(k => k.startsWith(prefix))
        .sort();
    },
    async setBinary(key, bytes, contentType) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(fileFor(key), bytes);
      await fs.writeFile(metaFor(key), JSON.stringify({ contentType }));
    },
    async getBinary(key) {
      try {
        const data = await fs.readFile(fileFor(key));
        const meta = JSON.parse(await fs.readFile(metaFor(key), "utf8"));
        return { data, contentType: meta.contentType };
      } catch (e) { if (e.code === "ENOENT") return null; throw e; }
    },
  };
}

async function blobStore(name) {
  const { getStore } = await import("@netlify/blobs");
  const store = getStore({ name, consistency: "strong" });
  return {
    getJSON: key => store.get(key, { type: "json" }),
    setJSON: (key, value) => store.setJSON(key, value),
    delete: key => store.delete(key),
    async listKeys(prefix) {
      const { blobs } = await store.list({ prefix });
      return blobs.map(b => b.key).sort();
    },
    setBinary: (key, bytes, contentType) =>
      store.set(key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { metadata: { contentType } }),
    async getBinary(key) {
      const res = await store.getWithMetadata(key, { type: "arrayBuffer" });
      if (!res) return null;
      return { data: new Uint8Array(res.data), contentType: res.metadata?.contentType || "application/octet-stream" };
    },
  };
}

const cache = new Map();
export async function getStores() {
  const local = process.env.PAWFAMILY_DATA_DIR;
  const id = local || "netlify";
  if (!cache.has(id)) {
    cache.set(id, (async () => local
      ? { data: fileStore(path.join(local, "data")), images: fileStore(path.join(local, "images")) }
      : { data: await blobStore("pawfamily"), images: await blobStore("pawfamily-images") })());
  }
  return cache.get(id);
}

/** Load every JSON record under a prefix, newest first by createdAt. */
export async function listRecords(store, prefix) {
  const keys = await store.listKeys(prefix);
  const items = await Promise.all(keys.map(k => store.getJSON(k)));
  return items.filter(Boolean).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}
