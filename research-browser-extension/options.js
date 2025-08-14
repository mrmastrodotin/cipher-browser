// options.js

async function getSettings() {
	const res = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
	return res.settings || {};
}

async function setSettings(obj) {
	await chrome.runtime.sendMessage({ type: 'SET_SETTINGS', settings: obj });
}

async function load() {
	const s = await getSettings();
	document.getElementById('inactivity').value = s.inactivityMinutesToFreeze ?? 20;
	document.getElementById('freezePinned').checked = !!s.freezePinnedTabs;
	document.getElementById('adblock').checked = !!s.adblockEnabled;
	document.getElementById('offline').checked = !!s.offlineCacheEnabled;
	document.getElementById('fontScale').value = s.fontScale ?? 1.0;
	document.getElementById('fontScaleVal').textContent = (s.fontScale ?? 1.0).toFixed(2);
	document.getElementById('exclusions').value = (s.freezeExclusions || []).join('\n');
	await loadSnapshots();
}

async function loadSnapshots() {
	const all = (await chrome.storage.local.get('secure:snapshots'))['secure:snapshots'];
	const container = document.getElementById('snapshots');
	container.innerHTML = '';
	if (!all) {
		container.textContent = 'No snapshots yet.';
		return;
	}
	const res = await chrome.runtime.sendMessage({ type: 'SECURE_GET', key: 'snapshots' });
	const list = res && res.value ? res.value : [];
	for (const s of list) {
		const div = document.createElement('div');
		div.className = 'snapshot';
		div.textContent = `${s.name} — ${new Date(s.createdAt).toLocaleString()}`;
		const btn = document.createElement('button');
		btn.textContent = 'Restore';
		btn.addEventListener('click', async () => {
			await chrome.runtime.sendMessage({ type: 'LOAD_SNAPSHOT', snapshotId: s.id });
		});
		div.appendChild(btn);
		container.appendChild(div);
	}
}

document.getElementById('fontScale').addEventListener('input', (e) => {
	document.getElementById('fontScaleVal').textContent = parseFloat(e.target.value).toFixed(2);
});

document.getElementById('save').addEventListener('click', async () => {
	const settings = {
		inactivityMinutesToFreeze: parseInt(document.getElementById('inactivity').value || '20', 10),
		freezePinnedTabs: document.getElementById('freezePinned').checked,
		adblockEnabled: document.getElementById('adblock').checked,
		offlineCacheEnabled: document.getElementById('offline').checked,
		fontScale: parseFloat(document.getElementById('fontScale').value || '1.0'),
		freezeExclusions: document.getElementById('exclusions').value.split('\n').map(s => s.trim()).filter(Boolean)
	};
	await setSettings(settings);
	document.getElementById('status').textContent = 'Saved.';
	setTimeout(() => document.getElementById('status').textContent = '', 1500);
});

document.getElementById('save-pass').addEventListener('click', async () => {
	const pass = document.getElementById('passphrase').value;
	await chrome.runtime.sendMessage({ type: 'SET_PASSPHRASE', passphrase: pass || null });
	document.getElementById('status').textContent = pass ? 'Passphrase set.' : 'Passphrase cleared.';
	setTimeout(() => document.getElementById('status').textContent = '', 1500);
});

load();