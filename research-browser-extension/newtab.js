// newtab.js

const searchBox = document.getElementById('search');

searchBox.addEventListener('keydown', async (e) => {
	if (e.key === 'Enter') {
		const q = searchBox.value.trim();
		if (!q) return;
		const url = chrome.runtime.getURL('search.html') + `#q=${encodeURIComponent(q)}`;
		window.location.href = url;
	}
});

let timer;

document.getElementById('pomo-start').addEventListener('click', () => {
	const mins = parseInt(document.getElementById('pomo-mins').value || '25', 10);
	startPomodoro(mins);
});

function startPomodoro(minutes) {
	clearInterval(timer);
	const end = Date.now() + minutes * 60000;
	timer = setInterval(() => {
		const remaining = Math.max(0, end - Date.now());
		const m = Math.floor(remaining / 60000);
		const s = Math.floor((remaining % 60000) / 1000);
		document.getElementById('pomo-countdown').textContent = `${m}:${s.toString().padStart(2, '0')}`;
		if (remaining <= 0) clearInterval(timer);
	}, 1000);
}

(async () => {
	const res = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
	const s = res.settings || {};
	document.documentElement.classList.toggle('dark', !!s.darkMode);
	document.documentElement.style.setProperty('font-size', `${s.fontScale || 1.0}em`);
})();

document.getElementById('toggle-dark').addEventListener('click', async () => {
	const res = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
	const s = res.settings || {};
	s.darkMode = !s.darkMode;
	await chrome.runtime.sendMessage({ type: 'SET_SETTINGS', settings: s });
	document.documentElement.classList.toggle('dark', !!s.darkMode);
});

document.getElementById('font').addEventListener('input', async (e) => {
	const scale = parseFloat(e.target.value || '1.0');
	const res = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
	const s = res.settings || {};
	s.fontScale = scale;
	await chrome.runtime.sendMessage({ type: 'SET_SETTINGS', settings: s });
	document.documentElement.style.setProperty('font-size', `${scale}em`);
});