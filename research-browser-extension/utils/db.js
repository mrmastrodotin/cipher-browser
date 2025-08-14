// utils/db.js - ES module IndexedDB helpers for offline resources

const DB_NAME = 'frb-db';
const DB_VERSION = 1;
let dbPromise;

function getDb() {
	if (!dbPromise) {
		dbPromise = new Promise((resolve, reject) => {
			const open = indexedDB.open(DB_NAME, DB_VERSION);
			open.onupgradeneeded = () => {
				const db = open.result;
				if (!db.objectStoreNames.contains('resources')) {
					db.createObjectStore('resources', { keyPath: 'url' });
				}
			};
			open.onsuccess = () => resolve(open.result);
			open.onerror = () => reject(open.error);
		});
	}
	return dbPromise;
}

async function withStore(type, storeName, callback) {
	const db = await getDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(storeName, type);
		const store = tx.objectStore(storeName);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		callback(store);
	});
}

export async function putResource(record) {
	return withStore('readwrite', 'resources', (s) => s.put(record));
}

export async function getResource(url) {
	return new Promise(async (resolve, reject) => {
		await withStore('readonly', 'resources', (s) => {
			const r = s.get(url);
			r.onsuccess = () => resolve(r.result);
			r.onerror = () => reject(r.error);
		});
	});
}

export async function listResources() {
	return new Promise(async (resolve, reject) => {
		const items = [];
		await withStore('readonly', 'resources', (s) => {
			const req = s.openCursor();
			req.onsuccess = () => {
				const c = req.result;
				if (c) { items.push(c.value); c.continue(); } else { resolve(items); }
			};
			req.onerror = () => reject(req.error);
		});
	});
}