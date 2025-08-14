async function send(msg) { return new Promise(res => chrome.runtime.sendMessage(msg, res)); }

async function load() {
	const res = await send({ type: 'getSettings' });
	if (!res?.ok) return;
	document.getElementById('freezeMinutes').value = res.settings.freezeMinutes;
	document.getElementById('respectPinned').checked = !!res.settings.respectPinned;
	document.getElementById('darkModeDefault').checked = !!res.settings.darkModeDefault;
	document.getElementById('defaultFontScale').value = res.settings.defaultFontScale || 1.0;
}

async function saveAll() {
	const settings = {
		freezeMinutes: Number(document.getElementById('freezeMinutes').value) || 15,
		respectPinned: document.getElementById('respectPinned').checked,
		darkModeDefault: document.getElementById('darkModeDefault').checked,
		defaultFontScale: Number(document.getElementById('defaultFontScale').value) || 1.0
	};
	await send({ type: 'saveSettings', settings });
	document.getElementById('status').textContent = 'Saved.';
	setTimeout(() => document.getElementById('status').textContent = '', 1500);
}

document.getElementById('saveAll').addEventListener('click', saveAll);

document.getElementById('savePass').addEventListener('click', async () => {
	const pass = (document.getElementById('passphrase').value || '').trim();
	await send({ type: 'setPassphrase', passphrase: pass || null });
	document.getElementById('status').textContent = pass ? 'Passphrase saved.' : 'Passphrase cleared.';
	setTimeout(() => document.getElementById('status').textContent = '', 1500);
});

load();