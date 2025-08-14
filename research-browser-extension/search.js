// search.js

const q = document.getElementById('q');
const resultsEl = document.getElementById('results');
const statusEl = document.getElementById('status');

function parseHash() {
	const h = new URL(window.location.href).hash.slice(1);
	const params = new URLSearchParams(h);
	return { q: params.get('q') || '' };
}

async function runSearch() {
	const query = q.value.trim();
	if (!query) return;
	statusEl.textContent = 'Searching across databases...';
	resultsEl.innerHTML = '';
	try {
		const filters = { newest: document.getElementById('newest').checked, highlyCited: document.getElementById('highlyCited').checked };
		const res = await chrome.runtime.sendMessage({ type: 'SEARCH_AGGREGATE', query, filters });
		const items = res.results || [];
		statusEl.textContent = `Found ${items.length} results`;
		for (const it of items) {
			const card = document.createElement('div');
			card.className = 'result';
			const authors = (it.authors || []).join(', ');
			card.innerHTML = `
				<div class="meta">${it.source} • ${it.published || ''} • citations: ${it.citations || 0}</div>
				<div class="title">${it.title || '(untitled)'}</div>
				<div class="authors">${authors}</div>
				<div class="actions">
					<a target="_blank" href="${it.url || '#'}">Open</a>
					${it.openAccessPdf ? `<a target="_blank" href="${it.openAccessPdf}">PDF</a>` : ''}
					<button class="save" data-url="${it.openAccessPdf || it.url || ''}">Save offline</button>
				</div>
			`;
			card.querySelector('.save').addEventListener('click', async (e) => {
				const url = e.currentTarget.getAttribute('data-url');
				if (!url) return;
				await chrome.runtime.sendMessage({ type: 'SAVE_OFFLINE_RESOURCE', url });
				(e.currentTarget).textContent = 'Saved';
			});
			resultsEl.appendChild(card);
		}
	} catch (e) {
		statusEl.textContent = 'Search failed. Please try again.';
	}
}

q.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });
document.getElementById('go').addEventListener('click', runSearch);

const init = parseHash();
if (init.q) {
	q.value = init.q;
	runSearch();
}