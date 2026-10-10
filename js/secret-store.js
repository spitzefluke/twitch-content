// Kleine Geheimnisse nur in diesem Browser merken (z. B. das OBS-WebSocket-Passwort) –
// verschlüsselt mit AES-GCM. Der Schlüssel ist ein nicht exportierbarer CryptoKey in IndexedDB:
// er verlässt den Browser nie, auch nicht über „Website-Daten kopieren“. Klappt IndexedDB nicht
// (privates Fenster, gesperrte Website-Daten), wird nichts gespeichert – dann eben neu eintippen.
const DB = 'streamhelp-secrets';
const STORE = 'kv';
const KEY_ID = 'aes-key';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function aesKey() {
  const have = await run('readonly', (s) => s.get(KEY_ID));
  if (have) return have;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await run('readwrite', (s) => s.put(key, KEY_ID));
  return key;
}

export async function saveSecret(name, text) {
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(), new TextEncoder().encode(text));
    await run('readwrite', (s) => s.put({ iv, data }, `secret:${name}`));
    return true;
  } catch {
    return false;
  }
}

export async function loadSecret(name) {
  try {
    const row = await run('readonly', (s) => s.get(`secret:${name}`));
    if (!row) return null;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: row.iv }, await aesKey(), row.data);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

export async function forgetSecret(name) {
  try { await run('readwrite', (s) => s.delete(`secret:${name}`)); } catch { /* nichts gespeichert */ }
}
