// db.js — Capsule Vault IndexedDB layer (ES Module)
// Hand-rolled Dexie-style API. MV3 service worker safe.
// IndexedDB = no hard quota. Chrome uses available disk space (typically GBs).
// compare: chrome.storage.local = 10MB hard cap.

const DB_NAME    = "CapsuleVaultDB";
const DB_VERSION = 1;
const STORE      = "capsules";

// ─── Open / upgrade ──────────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        // Indexes for sorting and filtering without full table scans
        store.createIndex("createdAt", "createdAt", { unique: false });
        store.createIndex("source",    "source",    { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };

    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

// ─── Read all (newest first via createdAt index) ─────────────────────────────

export async function dbGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).index("createdAt").getAll();
    req.onsuccess = () => resolve([...req.result].reverse());
    req.onerror   = () => reject(req.error);
  });
}

// ─── Read single ─────────────────────────────────────────────────────────────

export async function dbGet(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  });
}

// ─── Upsert (add or update) ───────────────────────────────────────────────────

export async function dbPut(capsule) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).put(capsule);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function dbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror   = () => reject(req.error);
  });
}

// ─── Count ────────────────────────────────────────────────────────────────────

export async function dbCount() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

// ─── Clear all ────────────────────────────────────────────────────────────────

export async function dbClear() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).clear();
    req.onsuccess = () => resolve(true);
    req.onerror   = () => reject(req.error);
  });
}

// ─── Bulk insert (single transaction — fast for imports) ─────────────────────

export async function dbBulkPut(capsules) {
  if (!capsules.length) return 0;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    let   done  = 0;
    tx.oncomplete = () => resolve(done);
    tx.onerror    = (e) => reject(e.target.error);
    for (const cap of capsules) {
      const req = store.put(cap);
      req.onsuccess = () => done++;
    }
  });
}

// ─── Storage estimate (IndexedDB advantage: see real quota) ──────────────────

export async function dbEstimateSize() {
  try {
    if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      return {
        usageKB: Math.round(usage  / 1024),
        quotaMB: Math.round(quota  / 1024 / 1024)
      };
    }
  } catch { /* service workers may restrict this */ }
  return { usageKB: 0, quotaMB: 0 };
}
