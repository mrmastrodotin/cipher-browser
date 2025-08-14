(function() {
	// Inject minimal styles
	const style = document.createElement('style');
	style.textContent = `
		.scholar-focus-highlight { background: #ffec8b; padding: 0 1px; }
		#sf-notes-toggle { position: fixed; right: 12px; bottom: 12px; z-index: 2147483647; background: #1f2937; color: #fff; border: none; border-radius: 18px; padding: 8px 12px; box-shadow: 0 2px 8px rgba(0,0,0,.2); font: 13px/1.2 system-ui; }
		#sf-sidebar { position: fixed; top: 0; right: 0; width: 320px; height: 100%; background: #111827; color: #e5e7eb; z-index: 2147483646; box-shadow: -2px 0 12px rgba(0,0,0,.3); transform: translateX(100%); transition: transform .2s ease; display: flex; flex-direction: column; }
		#sf-sidebar.open { transform: translateX(0); }
		#sf-sidebar header { padding: 10px 12px; background: #0b1220; font-weight: 600; display: flex; align-items: center; justify-content: space-between; }
		#sf-sidebar .body { padding: 10px; overflow: auto; gap: 8px; display: flex; flex-direction: column; }
		#sf-sidebar input, #sf-sidebar textarea, #sf-sidebar select { width: 100%; background: #0f172a; color: #e5e7eb; border: 1px solid #334155; border-radius: 6px; padding: 6px 8px; font: 13px/1.4 system-ui; }
		#sf-mini-toolbar { position: absolute; background: #111827; color: #e5e7eb; border: 1px solid #374151; border-radius: 6px; padding: 4px 6px; font: 12px system-ui; display: none; z-index: 2147483647; box-shadow: 0 2px 8px rgba(0,0,0,.3); }
		#sf-mini-toolbar button { background: transparent; color: #e5e7eb; border: none; margin: 0 4px; cursor: pointer; }
	`;
	document.documentElement.appendChild(style);

	// Sidebar toggle
	const toggleBtn = document.createElement('button');
	toggleBtn.id = 'sf-notes-toggle';
	toggleBtn.textContent = 'Notes';
	document.documentElement.appendChild(toggleBtn);

	const sidebar = document.createElement('aside');
	sidebar.id = 'sf-sidebar';
	sidebar.innerHTML = `
		<header>
			<span>Scholar Focus Notes</span>
			<button id="sf-close" title="Close" style="background:transparent;border:none;color:#9ca3af">✕</button>
		</header>
		<div class="body">
			<label>Tags (comma-separated)</label>
			<input id="sf-tags" placeholder="e.g. methods, experiment-1" />
			<label>Note</label>
			<textarea id="sf-note" rows="10" placeholder="Write your note..." ></textarea>
			<button id="sf-save" style="background:#2563eb;border:none;color:#fff;border-radius:6px;padding:8px">Save Note</button>
			<div style="font-size:12px;color:#9ca3af">Highlights are saved automatically per page.</div>
		</div>
	`;
	document.documentElement.appendChild(sidebar);

	function openSidebar(open) {
		sidebar.classList.toggle('open', open);
	}

	document.getElementById('sf-close').addEventListener('click', () => openSidebar(false));
	toggleBtn.addEventListener('click', () => openSidebar(!sidebar.classList.contains('open')));

	const noteEl = sidebar.querySelector('#sf-note');
	const tagsEl = sidebar.querySelector('#sf-tags');
	sidebar.querySelector('#sf-save').addEventListener('click', async () => {
		await chrome.runtime.sendMessage({ type: 'saveNote', url: location.href, note: { text: noteEl.value, tags: tagsEl.value, updatedAt: Date.now() } });
	});

	(async () => {
		const res = await chrome.runtime.sendMessage({ type: 'getNote', url: location.href });
		if (res?.ok && res.note) {
			noteEl.value = res.note.text || '';
			tagsEl.value = res.note.tags || '';
		}
	})();

	// Highlighting
	const mini = document.createElement('div');
	mini.id = 'sf-mini-toolbar';
	mini.innerHTML = `<button id="sf-btn-hl">Highlight</button><button id="sf-btn-clr">Clear</button>`;
	document.documentElement.appendChild(mini);

	let currentSelection = null;
	function saveSelection() {
		const sel = window.getSelection();
		if (!sel.rangeCount) return null;
		return sel.getRangeAt(0).cloneRange();
	}
	function getXPathForNode(node) {
		const idx = (sib, name) => {
			let i = 1;
			for (let s = sib.previousSibling; s; s = s.previousSibling) if (s.nodeName === name) i++;
			return i;
		};
		const segs = [];
		for (; node && node.nodeType === 1; node = node.parentNode) {
			let name = node.nodeName.toLowerCase();
			segs.unshift(name + '[' + idx(node, node.nodeName) + ']');
		}
		return '/' + segs.join('/');
	}
	function getTextOffsetInNode(node, container, offset) {
		// Flatten text content up to the container offset
		if (container.nodeType === Node.TEXT_NODE) {
			return offset;
		}
		let count = 0;
		const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
		while (walker.nextNode()) {
			const n = walker.currentNode;
			if (n === container) return count + offset;
			count += n.textContent.length;
		}
		return count;
	}
	function restoreRange(anchorXPath, startOffset, endOffset) {
		const evaluator = new XPathEvaluator();
		const result = evaluator.evaluate(anchorXPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
		const anchor = result.singleNodeValue;
		if (!anchor) return null;
		const walker = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT, null);
		let startNode = null, endNode = null;
		let seen = 0;
		while (walker.nextNode()) {
			const n = walker.currentNode;
			const nextSeen = seen + n.textContent.length;
			if (!startNode && startOffset <= nextSeen) startNode = n;
			if (!endNode && endOffset <= nextSeen) { endNode = n; break; }
			seen = nextSeen;
		}
		if (!startNode || !endNode) return null;
		const r = document.createRange();
		const startPos = startOffset - (seen - endNode.textContent.length);
		// recompute properly by walking again
		let seen2 = 0; let sNode = null; let eNode = null; let sOff = 0; let eOff = 0;
		const walker2 = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT, null);
		while (walker2.nextNode()) {
			const n = walker2.currentNode;
			const next = seen2 + n.textContent.length;
			if (!sNode && startOffset <= next) { sNode = n; sOff = startOffset - seen2; }
			if (!eNode && endOffset <= next) { eNode = n; eOff = endOffset - seen2; break; }
			seen2 = next;
		}
		if (!sNode || !eNode) return null;
		r.setStart(sNode, sOff);
		r.setEnd(eNode, eOff);
		return r;
	}
	function wrapRange(range) {
		const span = document.createElement('span');
		span.className = 'scholar-focus-highlight';
		range.surroundContents(span);
	}
	async function persistHighlights() {
		const xPath = getXPathForNode(document.body);
		const highlights = Array.from(document.querySelectorAll('span.scholar-focus-highlight')).map(el => {
			// Compute offsets relative to body subtree
			const r = document.createRange();
			r.selectNodeContents(document.body);
			const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
			let seen = 0; let startOff = 0; let endOff = 0; let foundStart = false;
			while (walker.nextNode()) {
				const n = walker.currentNode;
				if (!foundStart && n === el.firstChild) { startOff = seen; foundStart = true; }
				if (n === el.lastChild) { endOff = seen + n.textContent.length; break; }
				seen += n.textContent.length;
			}
			return { anchorXPath: xPath, start: startOff, end: endOff };
		});
		await chrome.runtime.sendMessage({ type: 'saveHighlights', url: location.href, highlights });
	}

	function showMiniToolbar(x, y) {
		mini.style.left = x + 'px';
		mini.style.top = y + 'px';
		mini.style.display = 'block';
	}
	function hideMiniToolbar() {
		mini.style.display = 'none';
	}

	document.addEventListener('mouseup', (e) => {
		const sel = window.getSelection();
		if (sel && sel.toString().trim()) {
			currentSelection = saveSelection();
			showMiniToolbar(e.pageX + 6, e.pageY + 6);
		} else {
			hideMiniToolbar();
		}
	});

	mini.querySelector('#sf-btn-hl').addEventListener('click', async () => {
		if (!currentSelection) return;
		try {
			wrapRange(currentSelection);
			await persistHighlights();
		} catch {}
		hideMiniToolbar();
	});
	mini.querySelector('#sf-btn-clr').addEventListener('click', async () => {
		for (const el of Array.from(document.querySelectorAll('span.scholar-focus-highlight'))) {
			const parent = el.parentNode; while (el.firstChild) parent.insertBefore(el.firstChild, el); parent.removeChild(el);
		}
		await persistHighlights();
		hideMiniToolbar();
	});

	(async () => {
		try {
			const res = await chrome.runtime.sendMessage({ type: 'getHighlights', url: location.href });
			if (res?.ok && Array.isArray(res.highlights)) {
				for (const h of res.highlights) {
					const range = restoreRange(h.anchorXPath || '/html/body', h.start, h.end);
					if (range) try { wrapRange(range); } catch {}
				}
			}
		} catch {}
	})();
})();