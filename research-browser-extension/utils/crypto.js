// utils/crypto.js - ES module

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
let aesKey = null; // Derived AES-GCM key kept in-memory only

export async function deriveKeyFromPassphrase(passphrase) {
	if (!passphrase) {
		aesKey = null;
		return null;
	}
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		textEncoder.encode(passphrase),
		{name: 'PBKDF2'},
		false,
		['deriveKey']
	);
	aesKey = await crypto.subtle.deriveKey(
		{
			name: 'PBKDF2',
			salt: textEncoder.encode('frb-salt-v1'),
			iterations: 100000,
			hash: 'SHA-256'
		},
		keyMaterial,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
	return aesKey;
}

export async function encryptJson(obj) {
	if (!aesKey) return { plain: true, data: obj };
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const data = textEncoder.encode(JSON.stringify(obj));
	const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, data);
	return { plain: false, iv: Array.from(iv), cipher: Array.from(new Uint8Array(cipher)) };
}

export async function decryptJson(payload) {
	if (!payload || payload.plain) return payload ? payload.data : null;
	if (!aesKey) throw new Error('No passphrase set');
	const iv = new Uint8Array(payload.iv);
	const cipher = new Uint8Array(payload.cipher);
	const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, cipher);
	return JSON.parse(textDecoder.decode(new Uint8Array(data)));
}