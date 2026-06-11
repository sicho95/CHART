const DB_NAME = "chart_incident_registry";
const DB_VERSION = 1;
const STORES = [
  "projects",
  "contacts",
  "incidents",
  "events",
  "checkpoints",
  "closures",
  "reports",
  "attachments",
  "syncQueue"
];

let dbPromise;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      STORES.forEach((name) => {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: "id" });
          if (name !== "projects") store.createIndex("projectId", "projectId", { unique: false });
          if (["incidents", "events", "checkpoints"].includes(name)) {
            store.createIndex("incidentId", "incidentId", { unique: false });
          }
          if (["incidents", "events", "checkpoints", "closures"].includes(name)) {
            store.createIndex("createdAt", "createdAt", { unique: false });
          }
        }
      });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  return dbPromise;
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getAll(storeName) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });
}

export async function getOne(storeName, id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).get(id);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || null);
  });
}

export async function put(storeName, value) {
  const db = await openDb();
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).put(value);
  await txDone(tx);
  return value;
}

export async function putMany(storeName, values) {
  const db = await openDb();
  const tx = db.transaction(storeName, "readwrite");
  const store = tx.objectStore(storeName);
  values.forEach((value) => store.put(value));
  await txDone(tx);
  return values;
}

export async function remove(storeName, id) {
  const db = await openDb();
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).delete(id);
  await txDone(tx);
}

export async function clearStore(storeName) {
  const db = await openDb();
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).clear();
  await txDone(tx);
}

export async function clearAll() {
  await Promise.all(STORES.map((store) => clearStore(store)));
}

export async function exportData() {
  const entries = await Promise.all(STORES.map(async (store) => [store, await getAll(store)]));
  return {
    schema: "chart.v1",
    exportedAt: new Date().toISOString(),
    data: Object.fromEntries(entries)
  };
}

export async function importData(payload) {
  if (!payload || payload.schema !== "chart.v1" || !payload.data) {
    throw new Error("Format d'import CHART invalide.");
  }
  await clearAll();
  for (const store of STORES) {
    await putMany(store, payload.data[store] || []);
  }
}

export { STORES };
