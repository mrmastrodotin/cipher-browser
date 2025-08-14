function openResults(query, mode) {
	const url = chrome.runtime.getURL('search.html') + `?q=${encodeURIComponent(query)}&mode=${encodeURIComponent(mode)}`;
	chrome.tabs.create({ url });
}

document.getElementById('go').addEventListener('click', () => {
	const q = document.getElementById('q').value.trim();
	if (q) openResults(q, document.getElementById('mode').value);
});

const timerEl = document.getElementById('timer');
let interval = null; let remaining = 0; let isWork = true;
function fmt(s) { const m = Math.floor(s/60).toString().padStart(2,'0'); const sec = (s%60).toString().padStart(2,'0'); return `${m}:${sec}`; }

function tick() {
	remaining--; if (remaining < 0) { isWork = !isWork; remaining = (isWork ? Number(work.value) : Number(rest.value)) * 60; }
	timerEl.textContent = `${isWork ? 'Work' : 'Rest'} ${fmt(remaining)}`;
}

const work = document.getElementById('work');
const rest = document.getElementById('rest');

document.getElementById('start').addEventListener('click', () => {
	if (interval) clearInterval(interval);
	isWork = true; remaining = Number(work.value) * 60; timerEl.textContent = fmt(remaining);
	interval = setInterval(tick, 1000);
});

document.getElementById('stop').addEventListener('click', () => { if (interval) clearInterval(interval); interval = null; timerEl.textContent = '00:00'; });

const dark = document.getElementById('dark');
const fontScale = document.getElementById('fontScale');

async function initAppearance() {
	const res = await new Promise(res => chrome.runtime.sendMessage({ type: 'getSettings' }, res));
	if (res?.ok) {
		dark.checked = !!res.settings.darkModeDefault;
		fontScale.value = res.settings.defaultFontScale || 1.0;
	}
	applyAppearance();
}

function applyAppearance() {
	document.body.style.background = dark.checked ? '#0b1220' : '#f8fafc';
	document.body.style.color = dark.checked ? '#e5e7eb' : '#0b1220';
	document.documentElement.style.setProperty('--scale', fontScale.value);
}

dark.addEventListener('change', async () => {
	applyAppearance();
	const res = await new Promise(res => chrome.runtime.sendMessage({ type: 'getSettings' }, res));
	if (res?.ok) {
		const updated = { ...res.settings, darkModeDefault: dark.checked };
		await new Promise(res2 => chrome.runtime.sendMessage({ type: 'saveSettings', settings: updated }, res2));
	}
});

fontScale.addEventListener('input', async () => {
	applyAppearance();
	const res = await new Promise(res => chrome.runtime.sendMessage({ type: 'getSettings' }, res));
	if (res?.ok) {
		const updated = { ...res.settings, defaultFontScale: Number(fontScale.value) };
		await new Promise(res2 => chrome.runtime.sendMessage({ type: 'saveSettings', settings: updated }, res2));
	}
});

// To-Do & Projects
const todosEl = document.getElementById('todos');
const titleEl = document.getElementById('taskTitle');
const dueEl = document.getElementById('taskDue');
const projEl = document.getElementById('taskProject');
const filterProjectEl = document.getElementById('filterProject');
const templateEl = document.getElementById('template');

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

async function getTodos() { return (await chrome.storage.local.get('todos')).todos || []; }
async function setTodos(todos) { return chrome.storage.local.set({ todos }); }

function templateItems(key) {
	switch (key) {
		case 'litrev': return [
			{ title: 'Define research question', project: 'LitReview' },
			{ title: 'Gather seed papers (10+)', project: 'LitReview' },
			{ title: 'Skim and tag themes', project: 'LitReview' },
			{ title: 'Write 1-page synthesis', project: 'LitReview' }
		];
		case 'experiment': return [
			{ title: 'Draft protocol', project: 'Experiment' },
			{ title: 'Prepare materials', project: 'Experiment' },
			{ title: 'Run pilot', project: 'Experiment' },
			{ title: 'Analyze pilot results', project: 'Experiment' }
		];
		case 'draft': return [
			{ title: 'Outline sections', project: 'Draft' },
			{ title: 'Write introduction', project: 'Draft' },
			{ title: 'Write methods', project: 'Draft' },
			{ title: 'Collect figures', project: 'Draft' }
		];
		default: return [];
	}
}

async function addTemplate(key) {
	const todos = await getTodos();
	const items = templateItems(key).map(t => ({ id: uid(), title: t.title, project: t.project, due: '', done: false }));
	await setTodos([...todos, ...items]);
	await renderTodos();
}

document.getElementById('addTask').addEventListener('click', async () => {
	const title = titleEl.value.trim(); if (!title) return;
	const due = dueEl.value; const project = projEl.value.trim();
	const todos = await getTodos();
	todos.push({ id: uid(), title, due, project, done: false });
	await setTodos(todos);
	titleEl.value = ''; dueEl.value = ''; projEl.value = '';
	await renderTodos();
});

templateEl.addEventListener('change', async () => { const val = templateEl.value; if (!val) return; await addTemplate(val); templateEl.value = ''; });

filterProjectEl.addEventListener('change', renderTodos);

async function renderTodos() {
	const todos = await getTodos();
	const filter = filterProjectEl.value;
	const projects = Array.from(new Set(todos.map(t => t.project).filter(Boolean)));
	filterProjectEl.innerHTML = '<option value="">All Projects</option>' + projects.map(p => `<option value="${p}">${p}</option>`).join('');
	const list = todos.filter(t => !filter || t.project === filter);
	todosEl.innerHTML = '';
	for (const t of list) {
		const row = document.createElement('div');
		row.className = 'todo';
		row.innerHTML = `
			<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" ${t.done ? 'checked' : ''} data-id="${t.id}" /> <span ${t.done ? 'style="text-decoration:line-through;color:#9ca3af"' : ''}>${t.title}</span></label>
			<div class="small">${t.project || ''}</div>
			<div class="small">${t.due || ''}</div>
			<div><button data-del="${t.id}">Delete</button></div>
		`;
		row.querySelector('input[type="checkbox"]').addEventListener('change', async (e) => {
			const id = e.currentTarget.getAttribute('data-id');
			const items = await getTodos();
			const idx = items.findIndex(x => x.id === id);
			if (idx >= 0) { items[idx].done = e.currentTarget.checked; await setTodos(items); }
		});
		row.querySelector('button[data-del]').addEventListener('click', async (e) => {
			const id = e.currentTarget.getAttribute('data-del');
			const items = await getTodos();
			await setTodos(items.filter(x => x.id !== id));
			await renderTodos();
		});
		todosEl.appendChild(row);
	}
}

(async function init() {
	await initAppearance();
	await renderTodos();
})();