async function send(msg) { return new Promise(res => chrome.runtime.sendMessage(msg, res)); }

function getParam(name) { const u = new URL(location.href); return u.searchParams.get(name) || ''; }

async function runSearch() {
	const q = document.getElementById('q').value.trim();
	if (!q) return;
	document.getElementById('status').textContent = 'Searching...';
	const mode = document.getElementById('mode').value;
	let res;
	try { res = await send({ type: 'aggregatedSearch', query: q, mode }); } catch (e) { res = { ok: false }; }
	if (!res?.ok) { document.getElementById('status').textContent = 'Offline: showing cached results if available.'; res = await send({ type: 'aggregatedSearch', query: q, mode }); } else { document.getElementById('status').textContent = ''; }
	renderResults(res.results || []);
}

function esc(s) { return (s||'').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

function renderResults(items) {
	const box = document.getElementById('results');
	box.innerHTML = '';
	for (const it of items) {
		const div = document.createElement('div');
		div.className = 'card';
		const isPdf = (it.url || '').toLowerCase().endsWith('.pdf');
		div.innerHTML = `
			<h3>${esc(it.title)}</h3>
			<div class="meta">${esc(it.source)} • ${esc((it.authors||[]).join(', '))} • ${it.year || ''} • ${it.citations ? it.citations + ' citations' : ''}</div>
			<div class="meta">${esc(it.abstract?.slice(0, 300) || '')}${it.abstract && it.abstract.length > 300 ? '…' : ''}</div>
			<div class="actions">
				<a href="${it.url}" target="_blank">Open</a>
				${it.doi ? `<a href="https://doi.org/${it.doi}" target="_blank">DOI</a>` : ''}
				${isPdf ? `<button data-url="${it.url}">Save Offline</button>` : ''}
			</div>
		`;
		if (isPdf) {
			div.querySelector('button[data-url]').addEventListener('click', async (e) => {
				const url = e.currentTarget.getAttribute('data-url');
				const name = (it.title || 'paper').replace(/[^a-z0-9_\-]+/gi,'_') + '.pdf';
				await send({ type: 'downloadURL', url, filename: name });
			});
		}
		box.appendChild(div);
	}
}

(function init() {
	const q = getParam('q'); const mode = getParam('mode') || 'relevant';
	document.getElementById('q').value = q;
	document.getElementById('mode').value = mode;
	document.getElementById('go').addEventListener('click', runSearch);
	if (q) runSearch();
})();