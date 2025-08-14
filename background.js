// Core background logic for Scholar Focus (MV3 service worker)

// Settings defaults
const DEFAULT_SETTINGS = {
	freezeMinutes: 15,
	respectPinned: true,
	customNoFreezeList: [], // array of URL patterns or hosts
	darkModeDefault: true,
	defaultFontScale: 1.0
};

// Cached settings in memory
let currentSettings = { ...DEFAULT_SETTINGS };

// In-memory previews keyed by tabId -> dataUrl
const tabPreviews = new Map();

// Key management (derived via PBKDF2 from passphrase)
let derivedCryptoKey = null; // CryptoKey for AES-GCM

async function deriveKeyFromPassphrase(passphrase) {
	if (!passphrase) return null;
	const enc = new TextEncoder();
	const salt = enc.encode('scholar-focus-salt-v1');
	const baseKey = await crypto.subtle.importKey(
		'raw',
		enc.encode(passphrase),
		{name: 'PBKDF2'},
		false,
		['deriveKey']
	);
	return crypto.subtle.deriveKey(
		{
			name: 'PBKDF2',
			salt,
			iterations: 150000,
			hash: 'SHA-256'
		},
		baseKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

async function encryptObject(obj) {
	const data = new TextEncoder().encode(JSON.stringify(obj));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	if (!derivedCryptoKey) return { plaintext: obj }; // No encryption if no key
	const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, derivedCryptoKey, data);
	return { ciphertext: Array.from(new Uint8Array(cipher)), iv: Array.from(iv) };
}

async function decryptObject(payload) {
	if (!payload) return null;
	if (payload.plaintext) return payload.plaintext;
	if (!derivedCryptoKey) return null;
	const { ciphertext, iv } = payload;
	const ct = new Uint8Array(ciphertext);
	const ivArr = new Uint8Array(iv);
	const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivArr }, derivedCryptoKey, ct);
	return JSON.parse(new TextDecoder().decode(plainBuf));
}

// Storage helpers
async function getLocal(key, fallback = null) {
	const res = await chrome.storage.local.get(key);
	return key in res ? res[key] : fallback;
}

async function setLocal(obj) { return chrome.storage.local.set(obj); }

async function loadSettings() {
	const saved = await getLocal('settings');
	if (saved) currentSettings = { ...DEFAULT_SETTINGS, ...saved };
	const passphrase = await getLocal('passphrase');
	if (passphrase) derivedCryptoKey = await deriveKeyFromPassphrase(passphrase);
}

chrome.runtime.onInstalled.addListener(async () => {
	await loadSettings();
	chrome.alarms.create('freezeCheck', { periodInMinutes: 1 });
	chrome.contextMenus.create({ id: 'toggleNoFreeze', title: 'Toggle Freeze Protection for this Site', contexts: ['page'] });
});

chrome.runtime.onStartup.addListener(async () => {
	await loadSettings();
	chrome.alarms.create('freezeCheck', { periodInMinutes: 1 });
});

chrome.storage.onChanged.addListener(async (changes, area) => {
	if (area === 'local') {
		if (changes.settings) currentSettings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
		if (changes.passphrase) derivedCryptoKey = changes.passphrase.newValue ? await deriveKeyFromPassphrase(changes.passphrase.newValue) : null;
	}
});

// Context menu handler
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
	if (info.menuItemId === 'toggleNoFreeze' && tab && tab.url) {
		const url = new URL(tab.url);
		const host = url.host;
		const list = new Set(currentSettings.customNoFreezeList || []);
		if (list.has(host)) list.delete(host); else list.add(host);
		await setLocal({ settings: { ...currentSettings, customNoFreezeList: Array.from(list) } });
	}
});

// Freeze logic via alarm
chrome.alarms.onAlarm.addListener(async (alarm) => {
	if (alarm.name !== 'freezeCheck') return;
	try {
		const tabs = await chrome.tabs.query({});
		const now = Date.now();
		for (const t of tabs) {
			if (t.active || t.audible || t.discarded || t.autoDiscardable === false) continue;
			if (currentSettings.respectPinned && t.pinned) continue;
			if (!t.url || t.url.startsWith('chrome://') || t.url.startsWith('chrome-extension://')) continue;
			try {
				const host = new URL(t.url).host;
				if (currentSettings.customNoFreezeList?.includes(host)) continue;
			} catch {}
			const last = t.lastAccessed || now;
			if (now - last > currentSettings.freezeMinutes * 60 * 1000) {
				try { await chrome.tabs.discard(t.id); } catch {}
			}
		}
	} catch {}
});

// Capture previews for active tabs
async function captureActiveTabPreview(windowId) {
	try {
		const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 60 });
		const [activeTab] = await chrome.tabs.query({ active: true, windowId });
		if (activeTab && dataUrl) tabPreviews.set(activeTab.id, dataUrl);
	} catch {}
}

chrome.tabs.onActivated.addListener(async (activeInfo) => { await captureActiveTabPreview(activeInfo.windowId); });
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => { if (tab.active && changeInfo.status === 'complete') await captureActiveTabPreview(tab.windowId); });

// Session snapshots
async function saveCurrentSession(name) {
	const tabs = await chrome.tabs.query({ currentWindow: true });
	const data = tabs.map(t => ({ url: t.url, pinned: t.pinned, title: t.title }));
	const payload = await encryptObject({ name, createdAt: Date.now(), tabs: data });
	const sessions = (await getLocal('sessions', [])) || [];
	sessions.unshift(payload);
	await setLocal({ sessions });
}

async function listSessions() {
	const sessionsEnc = (await getLocal('sessions', [])) || [];
	const decoded = [];
	for (const s of sessionsEnc) { try { decoded.push(await decryptObject(s)); } catch { decoded.push(null); } }
	return decoded.filter(Boolean);
}

async function restoreSession(index) {
	const sessionsEnc = (await getLocal('sessions', [])) || [];
	if (!sessionsEnc[index]) return false;
	const session = await decryptObject(sessionsEnc[index]);
	if (!session) return false;
	for (const t of session.tabs) { try { await chrome.tabs.create({ url: t.url, pinned: !!t.pinned, active: false }); } catch {} }
	return true;
}

// Search aggregation helpers
async function fetchJSON(url) { const res = await fetch(url); if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); }

async function searchCrossref(q) {
	const url = `https://api.crossref.org/works?rows=20&query=${encodeURIComponent(q)}`;
	const json = await fetchJSON(url);
	const items = json.message.items || [];
	return items.map(it => ({
		source: 'Crossref',
		title: it.title?.[0] || 'Untitled',
		authors: (it.author || []).map(a => `${a.given || ''} ${a.family || ''}`.trim()).filter(Boolean),
		year: (it['published-print']?.['date-parts']?.[0]?.[0]) || (it['published-online']?.['date-parts']?.[0]?.[0]) || null,
		citations: it['is-referenced-by-count'] || 0,
		url: it.URL || it.link?.[0]?.URL || null,
		doi: it.DOI || null,
		abstract: it.abstract ? it.abstract.replace(/<[^>]+>/g, '') : ''
	}));
}

async function searchArxiv(q) {
	const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}&start=0&max_results=20`;
	const res = await fetch(url);
	if (!res.ok) throw new Error('HTTP ' + res.status);
	const text = await res.text();
	const entries = Array.from(text.matchAll(/<entry>[\s\S]*?<\/entry>/g)).map(m => m[0]);
	return entries.map(entry => {
		const get = (tag) => (entry.match(new RegExp(`<${tag}[^>]*>([\s\S]*?)<\/${tag}>`)) || [,''])[1].replace(/\s+/g,' ').trim();
		const title = get('title');
		const summary = get('summary');
		const yearMatch = get('published').slice(0,4);
		const linkMatch = entry.match(/<link[^>]+href="([^"]+)"[^>]*rel="alternate"/);
		const pdfMatch = entry.match(/<link[^>]+href="([^"]+)"[^>]*type="application\/pdf"/);
		const authors = Array.from(entry.matchAll(/<name>(.*?)<\/name>/g)).map(m => m[1]);
		return { source: 'arXiv', title, authors, year: yearMatch ? Number(yearMatch) : null, citations: 0, url: pdfMatch?.[1] || linkMatch?.[1] || null, doi: null, abstract: summary };
	});
}

async function searchPubMed(q) {
	const esearch = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=20&term=${encodeURIComponent(q)}`;
	const es = await fetchJSON(esearch);
	const ids = es.esearchresult?.idlist || [];
	if (!ids.length) return [];
	const esum = await fetchJSON(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}`);
	const res = [];
	for (const id of ids) {
		const doc = esum.result?.[id];
		if (!doc) continue;
		res.push({ source: 'PubMed', title: doc.title, authors: (doc.authors || []).map(a => a.name), year: doc.pubdate ? Number((doc.pubdate.match(/\d{4}/) || [null])[0]) : null, citations: 0, url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`, doi: doc.elocationid?.includes('doi') ? doc.elocationid.replace(/.*doi:\s*/, '') : null, abstract: '' });
	}
	return res;
}

function scoreResult(q, item, mode) {
	const qTerms = q.toLowerCase().split(/\s+/).filter(Boolean);
	const title = (item.title || '').toLowerCase();
	const abstract = (item.abstract || '').toLowerCase();
	const recency = item.year ? (new Date().getFullYear() - item.year) : 10;
	let relevance = 0;
	for (const t of qTerms) { relevance += (title.includes(t) ? 3 : 0) + (abstract.includes(t) ? 1 : 0); }
	const citations = item.citations || 0;
	if (mode === 'relevant') return relevance * 3 + Math.max(0, 10 - recency) + Math.log10(citations + 1);
	if (mode === 'newest') return -recency;
	if (mode === 'cited') return Math.log10(citations + 1);
	return relevance;
}

async function aggregatedSearch(q, mode = 'relevant') {
	const cacheKey = `cache_search_${mode}_${q.toLowerCase()}`;
	const cached = await getLocal(cacheKey);
	if (cached) return cached;
	let all = [];
	try { all = all.concat(await searchCrossref(q)); } catch {}
	try { all = all.concat(await searchArxiv(q)); } catch {}
	try { all = all.concat(await searchPubMed(q)); } catch {}
	const seen = new Set();
	const uniq = [];
	for (const it of all) {
		const k = `${(it.title||'').toLowerCase()}::${it.year||''}`;
		if (seen.has(k)) continue; seen.add(k); uniq.push(it);
	}
	uniq.sort((a,b) => scoreResult(q, b, mode) - scoreResult(q, a, mode));
	await setLocal({ [cacheKey]: uniq });
	return uniq;
}

// Messaging
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	(async () => {
		try {
			if (msg.type === 'getSettings') return sendResponse({ ok: true, settings: currentSettings });
			if (msg.type === 'saveSettings') { await setLocal({ settings: { ...currentSettings, ...msg.settings } }); return sendResponse({ ok: true }); }
			if (msg.type === 'setPassphrase') { await setLocal({ passphrase: msg.passphrase || null }); return sendResponse({ ok: true }); }
			if (msg.type === 'saveSession') { await saveCurrentSession(msg.name || 'Session'); return sendResponse({ ok: true }); }
			if (msg.type === 'listSessions') { const sessions = await listSessions(); return sendResponse({ ok: true, sessions }); }
			if (msg.type === 'restoreSession') { const ok = await restoreSession(msg.index); return sendResponse({ ok }); }
			if (msg.type === 'listTabs') {
				const tabs = await chrome.tabs.query({ currentWindow: true });
				const items = await Promise.all(tabs.map(async t => ({ id: t.id, title: t.title, url: t.url, pinned: t.pinned, discarded: t.discarded, preview: tabPreviews.get(t.id) || null })));
				return sendResponse({ ok: true, tabs: items });
			}
			if (msg.type === 'togglePin') { await chrome.tabs.update(msg.tabId, { pinned: msg.pinned }); return sendResponse({ ok: true }); }
			if (msg.type === 'discardTab') { try { await chrome.tabs.discard(msg.tabId); } catch {} return sendResponse({ ok: true }); }
			if (msg.type === 'aggregatedSearch') { const results = await aggregatedSearch(msg.query, msg.mode || 'relevant'); return sendResponse({ ok: true, results }); }
			if (msg.type === 'getHighlights') { const key = `highlights_${msg.url}`; const payload = await getLocal(key); const items = payload ? await decryptObject(payload) : []; return sendResponse({ ok: true, highlights: items || [] }); }
			if (msg.type === 'saveHighlights') { const key = `highlights_${msg.url}`; const payload = await encryptObject(msg.highlights || []); await setLocal({ [key]: payload }); return sendResponse({ ok: true }); }
			if (msg.type === 'saveNote') { const key = `notes_${msg.url}`; const payload = await encryptObject(msg.note || {}); await setLocal({ [key]: payload }); return sendResponse({ ok: true }); }
			if (msg.type === 'getNote') { const key = `notes_${msg.url}`; const payload = await getLocal(key); const note = payload ? await decryptObject(payload) : null; return sendResponse({ ok: true, note }); }
			if (msg.type === 'downloadURL') { const id = await chrome.downloads.download({ url: msg.url, filename: msg.filename || undefined, conflictAction: 'uniquify' }); return sendResponse({ ok: true, id }); }
		} catch (e) { return sendResponse({ ok: false, error: String(e) }); }
	})();
	return true;
});