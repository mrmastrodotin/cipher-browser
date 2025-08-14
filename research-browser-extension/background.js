// background.js - MV3 Service Worker (ESM)
// Provides: tab freezing/suspension, session snapshots, cross-database search, encrypted storage glue, context menus, alarms

import { deriveKeyFromPassphrase } from './utils/crypto.js';
import { getSecureItem, setSecureItem, removeSecureItem } from './utils/storage.js';
import { putResource } from './utils/db.js';

const DEFAULT_SETTINGS = {
	inactivityMinutesToFreeze: 20,
	freezePinnedTabs: false,
	adblockEnabled: true,
	darkMode: true,
	fontScale: 1.0,
	freezeExclusions: [],
	offlineCacheEnabled: true
};

const SUSPENDED_PAGE = 'suspended.html';

// Tracks last-active timestamp per tabId and tab freeze state
const tabState = new Map();

chrome.runtime.onInstalled.addListener(async () => {
	const current = await getSecureItem('settings');
	if (!current) {
		await setSecureItem('settings', DEFAULT_SETTINGS);
	}
	chrome.contextMenus.removeAll(() => {
		chrome.contextMenus.create({ id: 'freeze_tab', title: 'Freeze Tab', contexts: ['page'] });
		chrome.contextMenus.create({ id: 'pin_no_freeze', title: 'Pin Tab (No Freeze)', contexts: ['page'] });
		chrome.contextMenus.create({ id: 'save_offline', title: 'Save Resource Offline', contexts: ['link', 'page'] });
	});
	chrome.alarms.create('checkFreeze', { periodInMinutes: 1 });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
	if (!tab || !tab.id) return;
	switch (info.menuItemId) {
		case 'freeze_tab':
			await freezeTab(tab.id);
			break;
		case 'pin_no_freeze':
			await chrome.tabs.update(tab.id, { pinned: true });
			break;
		case 'save_offline':
			if (info.linkUrl) await saveResourceOffline(info.linkUrl); else if (tab.url) await saveResourceOffline(tab.url);
			break;
	}
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
	if (alarm.name !== 'checkFreeze') return;
	await checkAndFreezeInactiveTabs();
});

chrome.tabs.onActivated.addListener(({ tabId }) => { tabState.set(tabId, { lastActiveAt: Date.now(), isSuspended: false }); });

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
	if (changeInfo.status === 'complete') {
		const state = tabState.get(tabId) || {};
		state.lastActiveAt = Date.now();
		state.isSuspended = isSuspendedUrl(tab.url);
		tabState.set(tabId, state);
	}
});

chrome.tabs.onRemoved.addListener((tabId) => { tabState.delete(tabId); });

chrome.commands.onCommand.addListener(async (command) => { if (command === 'save-snapshot') await saveSessionSnapshot(); });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	(async () => {
		try {
			switch (message.type) {
				case 'SET_PASSPHRASE':
					await deriveKeyFromPassphrase(message.passphrase || '');
					sendResponse({ ok: true });
					break;
				case 'SECURE_GET': {
					const value = await getSecureItem(message.key);
					sendResponse({ ok: true, value });
					break;
				}
				case 'SECURE_SET':
					await setSecureItem(message.key, message.value);
					sendResponse({ ok: true });
					break;
				case 'FREEZE_TAB':
					await freezeTab(message.tabId || sender.tab.id);
					sendResponse({ ok: true });
					break;
				case 'RESUME_TAB':
					await resumeSuspendedTab(sender.tab.id);
					sendResponse({ ok: true });
					break;
				case 'FREEZE_INACTIVE_NOW':
					await checkAndFreezeInactiveTabs();
					sendResponse({ ok: true });
					break;
				case 'SAVE_SNAPSHOT':
					await saveSessionSnapshot(message.name);
					sendResponse({ ok: true });
					break;
				case 'LOAD_SNAPSHOT':
					await restoreSessionSnapshot(message.snapshotId);
					sendResponse({ ok: true });
					break;
				case 'SEARCH_AGGREGATE': {
					const results = await aggregateSearch(message.query, message.filters || {});
					sendResponse({ ok: true, results });
					break;
				}
				case 'SAVE_OFFLINE_RESOURCE':
					await saveResourceOffline(message.url);
					sendResponse({ ok: true });
					break;
				case 'GET_SETTINGS': {
					const settings = (await getSecureItem('settings')) || DEFAULT_SETTINGS;
					sendResponse({ ok: true, settings });
					break;
				}
				case 'SET_SETTINGS': {
					const merged = { ...((await getSecureItem('settings')) || DEFAULT_SETTINGS), ...(message.settings || {}) };
					await setSecureItem('settings', merged);
					sendResponse({ ok: true });
					break;
				}
				case 'UPDATE_NOTES_INDEX': {
					const index = (await getSecureItem('notes:index')) || [];
					const existing = index.find((i) => i.url === message.page.url);
					if (existing) { existing.title = message.page.title || existing.title; existing.updatedAt = Date.now(); }
					else index.push({ url: message.page.url, title: message.page.title || message.page.url, tags: [], updatedAt: Date.now() });
					await setSecureItem('notes:index', index);
					sendResponse({ ok: true });
					break;
				}
				default:
					sendResponse({ ok: false, error: 'Unknown message' });
			}
		} catch (error) {
			console.error('Message handling error', error);
			sendResponse({ ok: false, error: error && (error.message || String(error)) });
		}
	})();
	return true;
});

function isSuspendedUrl(url) {
	try { const u = new URL(url); return u.protocol === 'chrome-extension:' && u.pathname.endsWith('/' + SUSPENDED_PAGE); } catch { return false; }
}

async function checkAndFreezeInactiveTabs() {
	const settings = (await getSecureItem('settings')) || DEFAULT_SETTINGS;
	const now = Date.now();
	const tabs = await chrome.tabs.query({});
	for (const tab of tabs) {
		if (!tab.id || !tab.url) continue;
		if (tab.pinned && !settings.freezePinnedTabs) continue;
		if (isSuspendedUrl(tab.url)) continue;
		if (settings.freezeExclusions.some((pattern) => tab.url.includes(pattern))) continue;
		const state = tabState.get(tab.id) || { lastActiveAt: now };
		const minutes = (now - (state.lastActiveAt || now)) / 60000;
		if (minutes >= settings.inactivityMinutesToFreeze) await freezeTab(tab.id);
	}
}

async function freezeTab(tabId) {
	const tab = await chrome.tabs.get(tabId);
	if (!tab || !tab.url) return;
	let previewDataUrl = null;
	try { if (tab.active) previewDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 60 }); } catch {}
	const record = { originalUrl: tab.url, title: tab.title || tab.url, favIconUrl: tab.favIconUrl || null, previewDataUrl, frozenAt: Date.now() };
	await setSecureItem(`suspended:${tab.id}`, record);
	const suspendedUrl = chrome.runtime.getURL(`${SUSPENDED_PAGE}?u=${encodeURIComponent(tab.url)}&t=${encodeURIComponent(record.title)}`);
	await chrome.tabs.update(tabId, { url: suspendedUrl });
	const state = tabState.get(tabId) || {}; state.isSuspended = true; tabState.set(tabId, state);
}

async function resumeSuspendedTab(tabId) {
	const record = await getSecureItem(`suspended:${tabId}`);
	if (!record || !record.originalUrl) return;
	await chrome.tabs.update(tabId, { url: record.originalUrl });
	await removeSecureItem(`suspended:${tabId}`);
	const state = tabState.get(tabId) || {}; state.isSuspended = false; tabState.set(tabId, state);
}

async function saveSessionSnapshot(optionalName) {
	const windows = await chrome.windows.getAll({ populate: true });
	const snapshot = [];
	for (const win of windows) {
		const tabs = (win.tabs || []).map((t) => ({ url: t.url, pinned: t.pinned, title: t.title }));
		snapshot.push({ windowType: win.type, focused: win.focused, tabs });
	}
	const all = (await getSecureItem('snapshots')) || [];
	const id = `${Date.now()}`;
	all.push({ id, name: optionalName || `Snapshot ${new Date().toLocaleString()}`, createdAt: Date.now(), snapshot });
	await setSecureItem('snapshots', all);
	return id;
}

async function restoreSessionSnapshot(snapshotId) {
	const all = (await getSecureItem('snapshots')) || [];
	const entry = all.find((s) => s.id === snapshotId) || all[all.length - 1];
	if (!entry) return;
	for (const win of entry.snapshot) {
		const created = await chrome.windows.create({});
		for (const tab of win.tabs) await chrome.tabs.create({ windowId: created.id, url: tab.url, pinned: tab.pinned });
	}
}

async function aggregateSearch(query, filters) {
	const cacheKey = `searchCache:${query}`;
	const cached = await getSecureItem(cacheKey);
	if (cached) return cached;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 15000);
	try {
		const [crossref, arxiv, pubmed, semsch] = await Promise.allSettled([
			fetchJson(`https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=20`, controller.signal),
			fetchXmlArxiv(`https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=20`, controller.signal),
			fetchJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=20&term=${encodeURIComponent(query)}`, controller.signal),
			fetchJson(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=20&fields=title,authors,year,citationCount,url,openAccessPdf`, controller.signal)
		]);
		const results = [];
		if (crossref.status === 'fulfilled' && crossref.value?.message?.items) {
			for (const it of crossref.value.message.items) results.push({ source: 'CrossRef', title: it.title && it.title[0], url: it.URL || it.link?.[0]?.URL || null, published: it['published-print']?.['date-parts']?.[0]?.[0] || it.created?.['date-time'], authors: (it.author || []).map((a) => `${a.given || ''} ${a.family || ''}`.trim()), citations: it['is-referenced-by-count'] || 0, openAccessPdf: null });
		}
		if (arxiv.status === 'fulfilled' && Array.isArray(arxiv.value)) for (const it of arxiv.value) results.push({ source: 'arXiv', title: it.title, url: it.link, published: it.published, authors: it.authors, citations: 0, openAccessPdf: it.pdf });
		if (pubmed.status === 'fulfilled' && Array.isArray(pubmed.value?.esearchresult?.idlist)) for (const id of pubmed.value.esearchresult.idlist) results.push({ source: 'PubMed', title: `PubMed ID ${id}`, url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`, published: null, authors: [], citations: 0, openAccessPdf: null });
		if (semsch.status === 'fulfilled' && Array.isArray(semsch.value?.data)) for (const p of semsch.value.data) results.push({ source: 'SemanticScholar', title: p.title, url: p.url, published: p.year, authors: (p.authors || []).map((a) => a.name), citations: p.citationCount || 0, openAccessPdf: p.openAccessPdf?.url || null });
		const newest = !!filters.newest; const highlyCited = !!filters.highlyCited;
		results.sort((a, b) => { const c = (b.citations || 0) - (a.citations || 0); const y = (Number(b.published) || 0) - (Number(a.published) || 0); if (newest && y) return y; if (highlyCited && c) return c; return c || y; });
		await setSecureItem(cacheKey, results);
		return results;
	} finally { clearTimeout(timeout); }
}

async function fetchJson(url, signal) { const res = await fetch(url, { signal }); if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); }

async function fetchXmlArxiv(url, signal) {
	const res = await fetch(url, { signal }); if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const text = await res.text(); const doc = new DOMParser().parseFromString(text, 'text/xml');
	return Array.from(doc.querySelectorAll('entry')).map((e) => ({ title: e.querySelector('title')?.textContent?.trim(), link: e.querySelector('id')?.textContent?.trim(), pdf: Array.from(e.querySelectorAll('link')).find(l => l.getAttribute('type') === 'application/pdf')?.getAttribute('href') || null, published: e.querySelector('published')?.textContent, authors: Array.from(e.querySelectorAll('author > name')).map(n => n.textContent) }));
}

async function saveResourceOffline(url) {
	try {
		const res = await fetch(url);
		if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
		const blob = await res.blob();
		await putResource({ url, savedAt: Date.now(), blob });
		return true;
	} catch (e) {
		console.warn('Offline save failed, falling back to download', e);
		try { await chrome.downloads.download({ url }); } catch {}
		return false;
	}
}