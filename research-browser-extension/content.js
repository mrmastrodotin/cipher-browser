// content.js - Annotation, notes, and reading tools injected into pages

(() => {
	let annotationEnabled = false;
	let darkModeEnabled = false;
	let fontScale = 1.0;
	let pageNotes = [];

	// Create floating toolbar
	const toolbar = document.createElement('div');
	toolbar.id = 'frb-toolbar';
	toolbar.innerHTML = `
		<button id="frb-toggle-annot">Annotate</button>
		<button id="frb-add-note">Add Note</button>
		<button id="frb-highlight">Highlight</button>
		<button id="frb-dark">Dark</button>
		<label style="margin-left:8px;">A−<input id="frb-font" type="range" min="0.8" max="1.6" step="0.05" value="1.0"/>A+</label>
	`;
	document.documentElement.appendChild(toolbar);

	const style = document.createElement('style');
	style.textContent = `
		:root.frb-dark, :root.frb-dark body { background:#111 !important; color:#e6e6e6 !important; }
		#frb-toolbar { position: fixed; z-index: 2147483647; bottom: 16px; right: 16px; background: rgba(32,32,32,0.95); color: #fff; padding: 8px; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,0.35); font-family: system-ui, sans-serif; }
		#frb-toolbar button { margin: 0 4px; padding: 6px 8px; font-size: 13px; }
		#frb-toolbar input[type=range] { vertical-align: middle; }
		mark.frb-highlight { background: #ffe58a; padding: 0 2px; }
		.frb-note { position: absolute; background: #fffbe6; border: 1px solid #f0d962; padding: 6px 8px; border-radius: 6px; max-width: 240px; z-index: 2147483600; box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
	`;
	document.documentElement.appendChild(style);

	function toggleAnnotation() {
		annotationEnabled = !annotationEnabled;
		toolbar.querySelector('#frb-toggle-annot').textContent = annotationEnabled ? 'Annotate ✓' : 'Annotate';
	}

	function toggleDark() {
		darkModeEnabled = !darkModeEnabled;
		document.documentElement.classList.toggle('frb-dark', darkModeEnabled);
	}

	function setFontScale(scale) {
		fontScale = scale;
		document.documentElement.style.setProperty('font-size', `${scale}em`);
	}

	function createNoteAtPosition(x, y) {
		const note = document.createElement('div');
		note.className = 'frb-note';
		note.contentEditable = 'true';
		note.textContent = 'Note...';
		note.style.left = x + 'px';
		note.style.top = y + 'px';
		document.body.appendChild(note);
		const entry = { id: 'n-' + Date.now(), text: '', x, y };
		note.addEventListener('input', () => {
			entry.text = note.textContent || '';
			persist();
		});
		pageNotes.push(entry);
		persist();
	}

	function highlightSelection() {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return;
		const range = sel.getRangeAt(0);
		if (range.collapsed) return;
		const mark = document.createElement('mark');
		mark.className = 'frb-highlight';
		range.surroundContents(mark);
		persist();
		try { sel.removeAllRanges(); } catch {}
	}

	document.addEventListener('keydown', (e) => {
		if (e.altKey && e.shiftKey && e.code === 'KeyA') {
			toggleAnnotation();
		}
	});

	document.addEventListener('dblclick', (e) => {
		if (!annotationEnabled) return;
		createNoteAtPosition(e.pageX, e.pageY);
	});

	toolbar.querySelector('#frb-toggle-annot').addEventListener('click', toggleAnnotation);
	toolbar.querySelector('#frb-add-note').addEventListener('click', (e) => {
		createNoteAtPosition(window.scrollX + window.innerWidth - 300, window.scrollY + 80);
	});
	toolbar.querySelector('#frb-highlight').addEventListener('click', highlightSelection);
	toolbar.querySelector('#frb-dark').addEventListener('click', toggleDark);
	toolbar.querySelector('#frb-font').addEventListener('input', (e) => setFontScale(parseFloat(e.target.value)));

	async function persist() {
		try {
			const key = `notes:${location.href}`;
			const highlights = Array.from(document.querySelectorAll('mark.frb-highlight')).map((m) => m.textContent || '');
			await chrome.runtime.sendMessage({ type: 'SECURE_SET', key, value: { highlights, notes: pageNotes, updatedAt: Date.now() } });
			await chrome.runtime.sendMessage({ type: 'UPDATE_NOTES_INDEX', page: { url: location.href, title: document.title } });
		} catch {}
	}

	async function restore() {
		try {
			const key = `notes:${location.href}`;
			const res = await chrome.runtime.sendMessage({ type: 'SECURE_GET', key });
			const data = res && res.value ? res.value : null;
			if (data) {
				for (const text of data.highlights || []) {
					const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
					let node;
					while ((node = walker.nextNode())) {
						const idx = node.nodeValue.indexOf(text);
						if (idx >= 0) {
							const range = document.createRange();
							range.setStart(node, idx);
							range.setEnd(node, idx + text.length);
							const mark = document.createElement('mark');
							mark.className = 'frb-highlight';
							range.surroundContents(mark);
							break;
						}
					}
				}
				for (const n of data.notes || []) {
					const note = document.createElement('div');
					note.className = 'frb-note';
					note.contentEditable = 'true';
					note.textContent = n.text || '';
					note.style.left = n.x + 'px';
					note.style.top = n.y + 'px';
					document.body.appendChild(note);
				}
				pageNotes = data.notes || [];
			}
		} catch {}
	}

	restore();
})();