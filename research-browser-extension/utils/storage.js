// utils/storage.js - ES module for encrypted storage wrappers

import { encryptJson, decryptJson } from './crypto.js';

export async function getSecureItem(key) {
	const raw = (await chrome.storage.local.get(`secure:${key}`))[`secure:${key}`];
	if (!raw) return null;
	try {
		return await decryptJson(raw);
	} catch {
		return null;
	}
}

export async function setSecureItem(key, value) {
	const payload = await encryptJson(value);
	await chrome.storage.local.set({ [`secure:${key}`]: payload });
}

export async function removeSecureItem(key) {
	await chrome.storage.local.remove(`secure:${key}`);
}