// Context Vault — IndexedDB

const DB = "ContextVaultDB";
const VER = 1;
const STORE = "memories";
let conn = null;

function open() {
  if (conn) return Promise.resolve(conn);
  return new Promise((ok, fail) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = e => { if (!e.target.result.objectStoreNames.contains(STORE)) e.target.result.createObjectStore(STORE, { keyPath: "id" }); };
    r.onsuccess = e => { conn = e.target.result; conn.onclose = () => { conn = null; }; ok(conn); };
    r.onerror = e => fail(e.target.error);
  });
}

function go(mode, fn) {
  return open().then(db => new Promise((ok, fail) => {
    const tx = db.transaction(STORE, mode);
    const s = tx.objectStore(STORE);
    const r = fn(s);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  }));
}

export const dbPut = m => go("readwrite", s => s.put(m));
export const dbGet = id => go("readonly", s => s.get(id));
export const dbGetAll = () => go("readonly", s => s.getAll());
export const dbDelete = id => go("readwrite", s => s.delete(id));
export const dbCount = () => go("readonly", s => s.count());
export const dbClear = () => go("readwrite", s => s.clear());

export async function dbGetRecent(limit = 250) {
  const all = await dbGetAll();
  all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return all.slice(0, limit);
}

export async function dbBulkPut(items) {
  const db = await open();
  const tx = db.transaction(STORE, "readwrite");
  const s = tx.objectStore(STORE);
  for (const i of items) s.put(i);
}
