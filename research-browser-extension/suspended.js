// suspended.js

function getParam(name) {
	const u = new URL(window.location.href);
	return u.searchParams.get(name);
}

const originalUrl = getParam('u');
const title = getParam('t');

document.getElementById('title').textContent = title || 'Suspended';

(async () => {
	// Try to load preview from storage
	try {
		const tab = await chrome.tabs.getCurrent?.();
		if (tab && tab.id) {
			const res = await chrome.runtime.sendMessage({ type: 'SECURE_GET', key: `suspended:${tab.id}` });
			const data = res && res.value ? res.value : null;
			if (data && data.previewDataUrl) {
				document.getElementById('preview').src = data.previewDataUrl;
			}
		}
	} catch {}
})();

async function resume() {
	await chrome.runtime.sendMessage({ type: 'RESUME_TAB' });
}

document.getElementById('resume').addEventListener('click', resume);

document.addEventListener('keydown', (e) => {
	if (e.key === 'Enter' || e.key === 'F5' || (e.ctrlKey && e.key.toLowerCase() === 'r')) {
		resume();
	}
});