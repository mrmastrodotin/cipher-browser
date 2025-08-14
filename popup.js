async function send(msg) { return new Promise(res => chrome.runtime.sendMessage(msg, res)); }

function openResults(query, mode) {
	const url = chrome.runtime.getURL('search.html') + `?q=${encodeURIComponent(query)}&mode=${encodeURIComponent(mode)}`;
	chrome.tabs.create({ url });
}

document.getElementById('go').addEventListener('click', () => {
	const q = document.getElementById('q').value.trim();
	if (q) openResults(q, document.getElementById('mode').value);
});

document.getElementById('saveSession').addEventListener('click', async () => {
	const name = `Session ${new Date().toLocaleString()}`;
	await send({ type: 'saveSession', name });
	await loadSessions();
});

document.getElementById('listSessions').addEventListener('click', async () => {
	const el = document.getElementById('sessions');
	el.style.display = el.style.display === 'none' ? 'block' : 'none';
});

async function loadSessions() {
	const box = document.getElementById('sessions');
	box.innerHTML = '';
	const res = await send({ type: 'listSessions' });
	if (!res?.ok) return;
	res.sessions.forEach((s, i) => {
		const div = document.createElement('div');
		div.className = 'row';
		div.style.margin = '4px 0';
		div.innerHTML = `<span>${s.name || 'Session'} • ${new Date(s.createdAt).toLocaleString()}</span> <button data-i="${i}">Restore</button>`;
		div.querySelector('button').addEventListener('click', async () => {
			await send({ type: 'restoreSession', index: i });
		});
		box.appendChild(div);
	});
}

async function loadTabs() {
	const res = await send({ type: 'listTabs' });
	const box = document.getElementById('tabs');
	box.innerHTML = '';
	if (!res?.ok) return;
	for (const t of res.tabs) {
		const div = document.createElement('div');
		div.className = 'tab';
		const img = document.createElement('img');
		img.src = t.preview || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0nNDgnIGhlaWdodD0nMzAnIHhtbG5zPSdodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Zyc+PHJlY3Qgd2lkdGg9JzQ4JyBoZWlnaHQ9JzMwJyBmaWxsPScjMTExODI3Jy8+PC9zdmc+';
		const meta = document.createElement('div');
		meta.innerHTML = `<div class="title">${t.title || 'Tab'}</div><div class="small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:210px;">${t.url || ''}</div>`;
		const actions = document.createElement('div');
		const pin = document.createElement('button'); pin.textContent = t.pinned ? 'Unpin' : 'Pin';
		pin.addEventListener('click', async () => { await send({ type: 'togglePin', tabId: t.id, pinned: !t.pinned }); await loadTabs(); });
		const fr = document.createElement('button'); fr.textContent = t.discarded ? 'Reload' : 'Freeze';
		fr.addEventListener('click', async () => {
			if (t.discarded) { chrome.tabs.reload(t.id); } else { await send({ type: 'discardTab', tabId: t.id }); }
			setTimeout(loadTabs, 500);
		});
		actions.append(pin, fr);
		div.append(img, meta, actions);
		box.appendChild(div);
	}
}

document.getElementById('refreshTabs').addEventListener('click', (e) => { e.preventDefault(); loadTabs(); });

(async function init() {
	await loadSessions();
	await loadTabs();
})();