'use strict';
// Nuvo Labs cards tracker. Plain JavaScript, no build step. All text is inserted with textContent (no HTML injection).
const API = (window.NUVO_API_URL || '').replace(/\/+$/, '');
const S = { token: localStorage.getItem('nuvo_token'), user: null, users: [], meta: null, view: 'board', month: null,
  filters: { owner: '', role: '', type: '' }, timer: null, cards: [], report: null };

// ---------------------------------------------------------------- tiny DOM helper
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  fill(el, kids);
  return el;
}
function fill(el, ...kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.appendChild(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const $app = document.getElementById('app');

// ---------------------------------------------------------------- helpers
const money = (cents) => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMin = (m) => { m = Math.round(m || 0); const hr = Math.floor(m / 60); return hr ? `${hr}h ${m % 60}m` : `${m}m`; };
const fmtDate = (iso) => iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const toLocalInput = (iso) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const currentMonth = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
const monthOptions = () => { const out = []; const d = new Date(); for (let i = 0; i < 12; i++) { out.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')); d.setMonth(d.getMonth() - 1); } return out; };

function toast(msg, bad) {
  const t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, msg);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }
  if (res.status === 401 && S.token && path !== '/api/login') { logout(); throw new Error('Please log in again'); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
const act = async (fn, okMsg) => { try { await fn(); if (okMsg) toast(okMsg); } catch (e) { toast(e.message, true); } };
const userName = (id) => (S.users.find((u) => u.id === id) || {}).name || '';

// ---------------------------------------------------------------- session
function logout() {
  localStorage.removeItem('nuvo_token');
  Object.assign(S, { token: null, user: null, timer: null });
  render();
}
async function boot() {
  if (!S.token) return render();
  try {
    const [me, meta, users] = await Promise.all([api('/api/me'), api('/api/meta'), api('/api/users')]);
    S.user = me.user; S.meta = meta; S.users = users.users; S.month = S.month || currentMonth();
    await refresh();
  } catch (e) { if (!S.token) return; toast(e.message, true); }
  render();
}
async function refresh() {
  const tasks = [api('/api/timer').then((r) => { S.timer = r.timer; })];
  if (S.view === 'board') tasks.push(api('/api/cards?month=' + S.month).then((r) => { S.cards = r.cards; }));
  if (S.view === 'dashboard' || S.view === 'bonus') tasks.push(api('/api/report?month=' + S.month).then((r) => { S.report = r; }));
  if (S.view === 'team') tasks.push(api('/api/users').then((r) => { S.users = r.users; }));
  await Promise.all(tasks);
}
async function go(view) { S.view = view; await act(refresh); render(); }

// ---------------------------------------------------------------- views
function render() {
  $app.replaceChildren();
  if (!S.token || !S.user) return $app.appendChild(loginView());
  $app.appendChild(topBar());
  const main = h('main');
  $app.appendChild(main);
  if (S.view === 'board') main.appendChild(boardView());
  if (S.view === 'dashboard') main.appendChild(dashboardView());
  if (S.view === 'bonus') main.appendChild(bonusView());
  if (S.view === 'team') main.appendChild(teamView());
}

function loginView() {
  const err = h('div', { class: 'err' });
  const name = h('input', { placeholder: 'Your name', autocomplete: 'username' });
  const pw = h('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
  const submit = async () => {
    err.textContent = '';
    try {
      const r = await api('/api/login', { method: 'POST', body: { name: name.value, password: pw.value } });
      S.token = r.token; localStorage.setItem('nuvo_token', r.token); await boot();
    } catch (e) { err.textContent = e.message; }
  };
  pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  return h('div', { class: 'login' },
    h('div', { class: 'logo' }, 'Nuvo ', h('span', {}, 'Labs')),
    h('p', { class: 'sub' }, 'Work cards: who is doing what, and how long it takes.'),
    h('label', {}, 'Name'), name, h('label', {}, 'Password'), pw, err,
    h('button', { class: 'btn', onclick: submit }, 'Log in'));
}

function topBar() {
  const tabs = [['board', 'Board'], ['dashboard', 'Dashboard'], ['bonus', 'Bonus tracker'], ['team', 'Team']];
  const timer = S.timer ? h('div', { class: 'timer' }, h('span', {}, S.timer.card_title), h('b', { id: 'tick' }, '0:00'),
    h('button', { class: 'btn sm', onclick: () => act(async () => { await api('/api/timer/stop', { method: 'POST' }); await refresh(); render(); }, 'Timer stopped') }, 'Stop')) : null;
  return h('div', { class: 'top' },
    h('div', { class: 'logo' }, 'Nuvo ', h('span', {}, 'Labs'), ' · Cards'),
    h('div', { class: 'tabs' }, tabs.map(([k, l]) => h('button', { class: 'tab' + (S.view === k ? ' on' : ''), onclick: () => go(k) }, l))),
    h('div', { class: 'right' }, timer,
      h('span', {}, S.user.name),
      h('button', { class: 'btn ghost sm', onclick: changePassword }, 'Password'),
      h('button', { class: 'btn ghost sm', onclick: logout }, 'Log out')));
}
setInterval(() => {
  const el = document.getElementById('tick');
  if (!el || !S.timer) return;
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(S.timer.start_at)) / 1000));
  el.textContent = `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}, 1000);

function monthPicker() {
  return h('select', { onchange: async (e) => { S.month = e.target.value; await act(refresh); render(); } },
    monthOptions().map((m) => h('option', { value: m, selected: m === S.month }, m)));
}

// ---------------------------------------------------------------- board
function badges(c) {
  const out = [];
  if (c.type === 'client') out.push(h('span', { class: 'tag lime' }, c.client || 'Client'));
  else out.push(h('span', { class: 'tag' }, 'Internal'));
  if (c.timer_running_by) out.push(h('span', { class: 'tag run' }, 'Timer running'));
  if (c.status !== 'Done' && Date.parse(c.due) < Date.now()) out.push(h('span', { class: 'tag red' }, 'Late'));
  if (c.status === 'To pick' && Date.now() - Date.parse(c.created_at) > 48 * 3600000) out.push(h('span', { class: 'tag warn' }, 'Unpicked 48h+'));
  if (c.status === 'Done' && c.on_time === 0) out.push(h('span', { class: 'tag red' }, 'Delivered late'));
  return out;
}
function boardView() {
  const f = S.filters;
  const sel = (key, label, opts) => h('select', { onchange: (e) => { f[key] = e.target.value; render(); } },
    h('option', { value: '' }, label), opts.map(([v, t]) => h('option', { value: v, selected: f[key] === v }, t)));
  const cards = S.cards.filter((c) => (!f.owner || c.owner_id === f.owner) && (!f.role || c.role === f.role) && (!f.type || c.type === f.type));
  const cols = S.meta.statuses.map((st) => {
    const list = cards.filter((c) => c.status === st).sort((a, b) => Date.parse(a.due) - Date.parse(b.due));
    return h('div', { class: 'col' },
      h('h3', {}, st, h('span', {}, list.length)),
      list.length ? list.map(tile) : h('div', { class: 'empty' }, 'Nothing here'));
  });
  return h('div', {},
    h('h1', {}, 'Board'),
    h('p', { class: 'sub' }, 'Every task is a card. Pick it, run the timer, submit it, get it checked.'),
    h('div', { class: 'bar' },
      sel('owner', 'Everyone', S.users.filter((u) => u.active).map((u) => [u.id, u.name])),
      sel('role', 'All roles', S.meta.roles.map((r) => [r, r])),
      sel('type', 'Client and internal', [['client', 'Client'], ['internal', 'Internal']]),
      h('span', { class: 'note' }, 'Done cards shown for'), monthPicker(),
      h('span', { class: 'grow' }),
      S.user.is_admin ? h('button', { class: 'btn', onclick: () => openCard(null) }, '+ New card') : null),
    h('div', { class: 'board' }, cols));
}
function tile(c) {
  return h('div', { class: 'tile', onclick: () => openCard(c.id) },
    h('div', { class: 't' }, c.title),
    h('div', { class: 'meta' }, h('span', { class: 'tag' }, c.role), badges(c)),
    h('div', { class: 'meta', style: 'margin-top:8px' },
      h('span', {}, c.owner_name || 'No owner'), h('span', {}, '·'), h('span', {}, 'Due ' + fmtDate(c.due)),
      h('span', {}, '·'), h('span', {}, `${fmtMin(c.logged_minutes)} / ${fmtMin(c.planned_minutes)}`),
      c.points ? h('span', { class: 'tag' }, c.points + ' pts') : null));
}

// ---------------------------------------------------------------- card drawer
async function openCard(id) {
  let detail = null;
  if (id) { try { detail = await api('/api/cards/' + id); } catch (e) { return toast(e.message, true); } }
  const card = detail ? detail.card : null;
  const close = () => { shade.remove(); };
  const reload = async () => { close(); await refresh(); render(); if (id) openCard(id); };
  const shade = h('div', { class: 'shade', onclick: (e) => { if (e.target === shade) close(); } });
  const drawer = h('div', { class: 'drawer' });
  shade.appendChild(drawer);
  const isAdmin = S.user.is_admin;
  const isOwner = card && card.owner_id === S.user.id;
  const canEditAll = isAdmin;
  const canEditSome = isOwner && card.status !== 'Done';

  const f = {
    title: h('input', { value: card ? card.title : '', disabled: !canEditAll && !!card }),
    goal: h('textarea', {}, card ? card.goal || '' : ''),
    role: h('select', { disabled: !canEditAll && !!card }, S.meta.roles.map((r) => h('option', { value: r, selected: card && card.role === r }, r))),
    type: h('select', { disabled: !canEditAll && !!card }, S.meta.types.map((t) => h('option', { value: t, selected: card && card.type === t }, t === 'client' ? 'Client work' : 'Internal work'))),
    client: h('input', { value: card ? card.client || '' : '', placeholder: 'Client name', disabled: !canEditAll && !!card }),
    owner: h('select', { disabled: !canEditAll && !!card }, h('option', { value: '' }, 'No owner (anyone can pick)'),
      S.users.filter((u) => u.active).map((u) => h('option', { value: u.id, selected: card && card.owner_id === u.id }, u.name))),
    due: h('input', { type: 'datetime-local', value: card ? toLocalInput(card.due) : '', disabled: !canEditAll && !!card }),
    hours: h('input', { type: 'number', step: '0.25', min: '0', value: card ? (card.planned_minutes / 60) : '', disabled: !(canEditAll || canEditSome) && !!card }),
    points: h('input', { type: 'number', min: '0', max: '200', value: card ? card.points : '', disabled: !canEditAll && !!card }),
  };
  if (card && !canEditAll && !canEditSome) f.goal.setAttribute('disabled', '');
  const presets = h('select', { onchange: (e) => { if (e.target.value) f.points.value = e.target.value; } },
    h('option', { value: '' }, 'Points preset…'), S.meta.point_presets.map((p) => h('option', { value: p.points }, `${p.label} (${p.points})`)));

  const body = () => ({
    title: f.title.value, goal: f.goal.value, role: f.role.value, type: f.type.value, client: f.client.value,
    owner_id: f.owner.value || null, due: f.due.value ? new Date(f.due.value).toISOString() : '',
    planned_minutes: Math.round(Number(f.hours.value || 0) * 60), points: Number(f.points.value || 0),
  });
  const save = () => act(async () => {
    if (!card) { await api('/api/cards', { method: 'POST', body: body() }); close(); await refresh(); render(); }
    else if (isAdmin) { await api('/api/cards/' + id, { method: 'PATCH', body: body() }); await reload(); }
    else { await api('/api/cards/' + id, { method: 'PATCH', body: { planned_minutes: body().planned_minutes, goal: f.goal.value } }); await reload(); }
  }, 'Saved');

  const buttons = [];
  if (!card || isAdmin || canEditSome) buttons.push(h('button', { class: 'btn', onclick: save }, card ? 'Save changes' : 'Create card'));
  if (card) {
    const post = (path, body, msg) => act(async () => { await api(path, { method: 'POST', body }); await reload(); }, msg);
    if (card.status === 'To pick') buttons.push(h('button', { class: 'btn', onclick: () => post(`/api/cards/${id}/pick`, {}, 'Picked. It is yours.') }, 'Pick this card'));
    if (isOwner && ['Picked', 'In progress'].includes(card.status)) {
      if (S.timer && S.timer.card_id === id) buttons.push(h('button', { class: 'btn ghost', onclick: () => post('/api/timer/stop', {}, 'Timer stopped') }, 'Stop timer'));
      else buttons.push(h('button', { class: 'btn', onclick: () => post(`/api/cards/${id}/timer/start`, {}, 'Timer started') }, 'Start timer'));
      buttons.push(h('button', { class: 'btn', onclick: () => post(`/api/cards/${id}/status`, { status: 'Waiting for check' }, 'Sent for checking') }, 'Submit for check'));
    }
    if (isOwner && card.status === 'Waiting for check') buttons.push(h('button', { class: 'btn ghost', onclick: () => post(`/api/cards/${id}/status`, { status: 'In progress' }, 'Back in progress') }, 'Take back'));
    if (isAdmin) buttons.push(h('button', { class: 'btn danger', onclick: () => { if (confirm('Delete this card?')) act(async () => { await api('/api/cards/' + id, { method: 'DELETE' }); close(); await refresh(); render(); }, 'Deleted'); } }, 'Delete'));
  }

  let checkBox = null;
  if (card && card.status === 'Waiting for check' && !isOwner && (isAdmin || card.owner_is_admin)) {
    const note = h('textarea', { placeholder: 'Check note (required if it needs fixing)' });
    checkBox = h('div', { class: 'box' }, h('b', {}, 'Check this work'), note,
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => act(async () => { await api(`/api/cards/${id}/check`, { method: 'POST', body: { pass: true, note: note.value } }); await reload(); }, 'Passed. Points count now.') }, 'Pass'),
        h('button', { class: 'btn danger', onclick: () => act(async () => { await api(`/api/cards/${id}/check`, { method: 'POST', body: { pass: false, note: note.value } }); await reload(); }, 'Sent back') }, 'Needs fixing')));
  }

  fill(drawer, 
    h('div', { class: 'bar' }, h('span', { class: 'pill' }, card ? card.status : 'New card'), h('span', { class: 'grow' }),
      h('button', { class: 'btn ghost sm', onclick: close }, 'Close')),
    h('h1', {}, card ? card.title : 'New card'),
    card ? h('div', { class: 'meta' }, badges(card), h('span', {}, `${fmtMin(card.logged_minutes)} logged of ${fmtMin(card.planned_minutes)} planned`)) : null,
    h('label', {}, 'Title'), f.title, h('label', {}, 'Goal'), f.goal,
    h('div', { class: 'row2' }, h('div', {}, h('label', {}, 'Role'), f.role), h('div', {}, h('label', {}, 'Type'), f.type)),
    h('label', {}, 'Client'), f.client,
    h('div', { class: 'row2' }, h('div', {}, h('label', {}, 'Owner'), f.owner), h('div', {}, h('label', {}, 'Due'), f.due)),
    h('div', { class: 'row2' }, h('div', {}, h('label', {}, 'Planned hours'), f.hours),
      h('div', {}, h('label', {}, 'Points (count after the check)'), f.points, isAdmin ? h('div', { style: 'margin-top:6px' }, presets) : null)),
    h('div', { class: 'actions' }, buttons),
    card && card.check_note ? h('div', { class: 'box' }, h('b', {}, 'Last check note: '), card.check_note) : null,
    checkBox);

  if (detail) {
    fill(drawer, 
      h('h2', {}, 'Time log'),
      detail.logs.length ? detail.logs.map((l) => h('div', { class: 'ev' }, h('b', {}, l.user_name), ' ' + fmtDate(l.start_at) + ' to ' + (l.end_at ? fmtDate(l.end_at) : 'running'),
        l.end_at ? ' · ' + fmtMin((Date.parse(l.end_at) - Date.parse(l.start_at)) / 60000) : '')) : h('div', { class: 'empty' }, 'No time logged yet'),
      h('h2', {}, 'History'),
      detail.events.map((e) => h('div', { class: 'ev' }, fmtDate(e.at) + ' · ', h('b', {}, e.user_name || 'System'), ' ' + e.type.replace(/_/g, ' ') + (e.detail ? ': ' + e.detail : ''))));
  }
  document.body.appendChild(shade);
}

// ---------------------------------------------------------------- dashboard
function dashboardView() {
  const r = S.report;
  const rows = r.rows.map((x) => h('tr', {},
    h('td', {}, x.name), h('td', {}, x.committed), h('td', {}, x.on_time),
    h('td', {}, x.reliability === null ? '—' : h('span', { class: x.reliability >= 80 ? 'good' : 'badc' }, x.reliability + '%')),
    h('td', {}, fmtMin(x.planned_minutes)), h('td', {}, fmtMin(x.logged_minutes)), h('td', {}, x.done), h('td', {}, x.points)));
  const roleRows = [];
  for (const role of S.meta.roles) {
    const total = r.rows.reduce((s, x) => s + (x.minutes_by_role[role] || 0), 0);
    if (!total) continue;
    roleRows.push(h('tr', {}, h('td', {}, role), h('td', {}, 'Level ' + S.meta.difficulty[role]),
      r.rows.map((x) => h('td', {}, x.minutes_by_role[role] ? fmtMin(x.minutes_by_role[role]) : '—')), h('td', {}, fmtMin(total))));
  }
  return h('div', {},
    h('h1', {}, 'Dashboard'),
    h('p', { class: 'sub' }, 'Reliability is cards delivered on time divided by cards due in the month. Points only count after the check.'),
    h('div', { class: 'bar' }, monthPicker()),
    h('div', { class: 'wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Person', 'Cards due', 'On time', 'Reliability', 'Planned', 'Logged', 'Cards done', 'Points'].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows))),
    h('h2', {}, 'Hours by role'),
    roleRows.length ? h('div', { class: 'wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Role'), h('th', {}, 'Difficulty'), r.rows.map((x) => h('th', {}, x.name)), h('th', {}, 'Total'))),
      h('tbody', {}, roleRows))) : h('div', { class: 'empty' }, 'No time logged this month yet'),
    h('p', { class: 'note' }, 'Use the hours by role to check the difficulty levels after a month or two.'));
}

// ---------------------------------------------------------------- bonus tracker
function bonusView() {
  const r = S.report;
  const isAdmin = S.user.is_admin;
  const pool = h('input', { type: 'number', min: '0', step: '0.01', value: (r.bonus_pool_cents / 100).toFixed(2), disabled: !isAdmin, style: 'width:140px' });
  const savePool = () => act(async () => { S.report = await api('/api/bonus/' + S.month, { method: 'PUT', body: { bonus_pool: pool.value } }); render(); }, 'Bonus pool saved');
  const rows = r.rows.map((x) => {
    const src = h('input', { type: 'number', min: '0', step: '0.01', value: (x.sourcing_cents / 100).toFixed(2), disabled: !isAdmin });
    const paid = h('input', { type: 'checkbox', checked: x.paid, disabled: !isAdmin, style: 'width:auto' });
    if (isAdmin) {
      src.addEventListener('change', () => act(async () => { S.report = await api(`/api/payouts/${S.month}/${x.user_id}`, { method: 'PUT', body: { sourcing: src.value } }); render(); }, 'Saved'));
      paid.addEventListener('change', () => act(async () => { S.report = await api(`/api/payouts/${S.month}/${x.user_id}`, { method: 'PUT', body: { paid: paid.checked } }); render(); }, 'Saved'));
    }
    return h('tr', {}, h('td', {}, x.name), h('td', {}, x.points), h('td', {}, x.points_share + '%'), h('td', {}, money(x.bonus_cents)),
      h('td', {}, src), h('td', {}, h('b', {}, money(x.total_cents))), h('td', {}, paid));
  });
  rows.push(h('tr', { class: 'total' }, h('td', {}, 'Total'), h('td', {}, r.total_points), h('td', {}, r.total_points ? '100%' : '—'),
    h('td', {}, money(r.totals.bonus_cents)), h('td', {}, money(r.totals.sourcing_cents)), h('td', {}, money(r.totals.total_cents)), h('td', {}, '')));
  return h('div', {},
    h('h1', {}, 'Bonus tracker'),
    h('p', { class: 'sub' }, 'Bonus pool ÷ total points = money per point. Sourcing cuts are paid on top, for 3 months per client.'),
    h('div', { class: 'bar' }, monthPicker(), h('span', { class: 'note' }, 'Bonus pool ($)'), pool,
      isAdmin ? h('button', { class: 'btn', onclick: savePool }, 'Save pool') : null,
      h('span', { class: 'note' }, r.total_points ? `= ${money(Math.round(r.per_point_cents))} a point` : 'No points yet this month')),
    h('div', { class: 'cream' }, h('div', { class: 'wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Person', 'Points', 'Share of points', 'Bonus', 'Sourcing cut ($)', 'Total to pay', 'Paid?'].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows)))),
    h('p', { class: 'note' }, 'Bonus cents are rounded so they add up exactly to the pool. Only admins can change the pool, sourcing cuts and the paid box.'));
}

// ---------------------------------------------------------------- team
function teamView() {
  const isAdmin = S.user.is_admin;
  const rows = S.users.map((u) => h('tr', {},
    h('td', {}, u.name, u.is_admin ? h('span', { class: 'tag lime', style: 'margin-left:8px' }, 'Admin') : null),
    h('td', {}, u.title || ''), h('td', {}, u.active ? 'Active' : 'Inactive'),
    h('td', {}, isAdmin ? h('div', { class: 'actions', style: 'margin:0' },
      h('button', { class: 'btn ghost sm', onclick: () => { const p = prompt('New password for ' + u.name + ' (min 6 characters)'); if (p) act(async () => { await api('/api/users/' + u.id, { method: 'PATCH', body: { password: p } }); }, 'Password reset'); } }, 'Reset password'),
      u.id !== S.user.id ? h('button', { class: 'btn ghost sm', onclick: () => act(async () => { await api('/api/users/' + u.id, { method: 'PATCH', body: { active: !u.active } }); await refresh(); render(); }, 'Updated') }, u.active ? 'Deactivate' : 'Activate') : null) : '')));
  let add = null;
  if (isAdmin) {
    const n = h('input', { placeholder: 'Name' }); const t = h('input', { placeholder: 'Role or title' }); const p = h('input', { type: 'password', placeholder: 'Starting password' });
    add = h('div', {}, h('h2', {}, 'Add a person'), h('div', { class: 'bar' }, n, t, p,
      h('button', { class: 'btn', onclick: () => act(async () => { await api('/api/users', { method: 'POST', body: { name: n.value, title: t.value, password: p.value } }); await refresh(); render(); }, 'Person added') }, 'Add')));
  }
  return h('div', {}, h('h1', {}, 'Team'), h('p', { class: 'sub' }, 'Everyone logs in with their own name and password.'),
    h('div', { class: 'wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Name', 'Role', 'Status', ''].map((x) => h('th', {}, x)))), h('tbody', {}, rows))), add);
}

function changePassword() {
  const oldP = prompt('Current password'); if (!oldP) return;
  const newP = prompt('New password (min 6 characters)'); if (!newP) return;
  act(() => api('/api/me/password', { method: 'POST', body: { old_password: oldP, new_password: newP } }), 'Password changed');
}

boot();
