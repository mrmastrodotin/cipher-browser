// popup.js

const tabsListElem = document.getElementById('tabs-list');

async function refreshTabs() {
	const tabs = await chrome.tabs.query({ currentWindow: true });
	tabsListElem.innerHTML = '';
	for (const t of tabs) {
		const row = document.createElement('div');
		row.className = 'tab-row';
		const suspended = t.url?.includes('/suspended.html');
		row.innerHTML = `
			<img class="fav" src="${t.favIconUrl || ''}" onerror="this.style.visibility='hidden'"/>
			<span class="title">${t.title}</span>
			<button class="freeze">${suspended ? 'Resume' : 'Freeze'}</button>
		`;
		row.querySelector('.freeze').addEventListener('click', async () => {
			if (suspended) {
				await chrome.runtime.sendMessage({ type: 'RESUME_TAB', tabId: t.id });
			} else {
				await chrome.runtime.sendMessage({ type: 'FREEZE_TAB', tabId: t.id });
			}
			refreshTabs();
		});
		row.addEventListener('mouseenter', async () => {
			const res = await chrome.runtime.sendMessage({ type: 'SECURE_GET', key: `suspended:${t.id}` });
			const data = res && res.value ? res.value : null;
			if (data && data.previewDataUrl && !row.querySelector('img.preview')) {
				const img = document.createElement('img');
				img.className = 'preview';
				img.src = data.previewDataUrl;
				row.appendChild(img);
			}
		});
		tabsListElem.appendChild(row);
	}
}

refreshTabs();

// Freeze inactive now

document.getElementById('freeze-inactive').addEventListener('click', async () => {
	await chrome.runtime.sendMessage({ type: 'FREEZE_INACTIVE_NOW' });
	refreshTabs();
});

// Save snapshot

document.getElementById('save-snapshot').addEventListener('click', async () => {
	await chrome.runtime.sendMessage({ type: 'SAVE_SNAPSHOT' });
});

// Pomodoro
let pomoTimer = null;

document.getElementById('pomo-start').addEventListener('click', () => {
	const mins = parseInt(document.getElementById('pomo-mins').value || '25', 10);
	startPomodoro(mins);
});

function startPomodoro(minutes) {
	clearInterval(pomoTimer);
	const end = Date.now() + minutes * 60000;
	pomoTimer = setInterval(() => {
		const remaining = Math.max(0, end - Date.now());
		const m = Math.floor(remaining / 60000);
		const s = Math.floor((remaining % 60000) / 1000);
		document.getElementById('pomo-countdown').textContent = `${m}:${s.toString().padStart(2, '0')}`;
		if (remaining <= 0) {
			clearInterval(pomoTimer);
			chrome.notifications?.create({ type: 'basic', iconUrl: 'assets/icon128.png', title: 'Pomodoro', message: 'Time for a break!' });
		}
	}, 1000);
}

// Quick research search

document.getElementById('open-aggregator').addEventListener('click', async () => {
	const url = chrome.runtime.getURL('search.html');
	await chrome.tabs.create({ url });
});

document.getElementById('quick-search').addEventListener('keydown', async (e) => {
	if (e.key === 'Enter') {
		const q = e.currentTarget.value.trim();
		if (!q) return;
		const url = chrome.runtime.getURL('search.html') + `#q=${encodeURIComponent(q)}`;
		await chrome.tabs.create({ url });
	}
});