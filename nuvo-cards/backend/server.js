'use strict';
const http = require('http');
const crypto = require('crypto');
const db = require('./db');

// ---------------------------------------------------------------- config
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET || (IS_PROD ? null : 'dev-only-secret');
if (!JWT_SECRET) throw new Error('JWT_SECRET must be set in production');
const ORIGINS = (process.env.FRONTEND_ORIGIN || '*').split(',').map((s) => s.trim()).filter(Boolean);
const TZ_OFFSET_MIN = parseInt(process.env.TEAM_TZ_OFFSET_MIN || '300', 10); // Pakistan = UTC+5

const ROLES = [
  'Video editing', 'Motion graphics', 'Graphic design', 'Building', 'Cold calling',
  'Lead generation and qualifying', 'Cold emails and DMs', 'Training and appraisal',
];
const DIFFICULTY = {
  'Cold emails and DMs': 2, 'Lead generation and qualifying': 3, 'Video editing': 3, 'Graphic design': 3,
  'Training and appraisal': 3, 'Motion graphics': 4, 'Cold calling': 4, Building: 5,
};
const STATUSES = ['To pick', 'Picked', 'In progress', 'Waiting for check', 'Done'];
const TYPES = ['client', 'internal'];
const POINT_PRESETS = [
  { label: '25 quality outreach touches', points: 2 }, { label: 'A booked call that is held', points: 6 },
  { label: 'Run a sales call', points: 5 }, { label: 'Proposal sent within 24 hours', points: 3 },
  { label: 'Client signs and pays (closing)', points: 15 }, { label: 'Demo agent built or improved', points: 10 },
  { label: 'Client build live (20 to 40)', points: 30 }, { label: 'Website page built', points: 4 },
  { label: 'Weekly client care', points: 3 }, { label: 'Monthly client report', points: 3 },
  { label: '20 test calls on a new build', points: 4 }, { label: 'Social post published', points: 3 },
  { label: 'Teaching a 30-minute session', points: 2 },
];

// ---------------------------------------------------------------- helpers
const uid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const monthOf = (iso) => new Date(Date.parse(iso) + TZ_OFFSET_MIN * 60000).toISOString().slice(0, 7);
const validMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m || '');
const b64 = (b) => Buffer.from(b).toString('base64url');

function signJwt(payload) {
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7 * 86400 }));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(head + '.' + body).digest('base64url');
  return `${head}.${body}.${sig}`;
}
function verifyJwt(token) {
  const parts = (token || '').split('.');
  if (parts.length !== 3) return null;
  const expect = crypto.createHmac('sha256', JWT_SECRET).update(parts[0] + '.' + parts[1]).digest();
  let given;
  try { given = Buffer.from(parts[2], 'base64url'); } catch { return null; }
  if (given.length !== expect.length || !crypto.timingSafeEqual(given, expect)) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return p.exp > Date.now() / 1000 ? p : null;
  } catch { return null; }
}
function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
}
function checkPw(pw, stored) {
  const [salt, hash] = (stored || '').split(':');
  if (!salt || !hash) return false;
  const a = crypto.scryptSync(pw, salt, 32);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);
const forbid = (m = 'Not allowed') => new HttpError(403, m);
const notFound = (m = 'Not found') => new HttpError(404, m);

// simple login rate limit: 10 tries per 15 min per ip+name
const attempts = new Map();
function rateLimit(key) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < 15 * 60000);
  if (list.length >= 10) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
  list.push(now);
  attempts.set(key, list);
}

async function event(cardId, userId, type, detail) {
  await db.run('INSERT INTO card_events (id, card_id, user_id, type, detail, at) VALUES (?,?,?,?,?,?)',
    [uid(), cardId, userId, type, detail || null, nowIso()]);
}

function publicUser(u) {
  return { id: u.id, name: u.name, title: u.title, is_admin: !!u.is_admin, active: !!u.active };
}

// ---------------------------------------------------------------- cards
async function loadCards() {
  const [cards, logs, users] = await Promise.all([
    db.all('SELECT * FROM cards WHERE deleted = 0'),
    db.all('SELECT card_id, user_id, start_at, end_at FROM time_logs'),
    db.all('SELECT id, name, is_admin FROM users'),
  ]);
  const uMap = new Map(users.map((u) => [u.id, u]));
  const mins = new Map();
  const running = new Map();
  const now = Date.now();
  for (const l of logs) {
    const end = l.end_at ? Date.parse(l.end_at) : now;
    mins.set(l.card_id, (mins.get(l.card_id) || 0) + Math.max(0, (end - Date.parse(l.start_at)) / 60000));
    if (!l.end_at) running.set(l.card_id, l.user_id);
  }
  return cards.map((c) => ({
    ...c,
    owner_name: c.owner_id ? (uMap.get(c.owner_id) || {}).name || null : null,
    owner_is_admin: c.owner_id ? !!(uMap.get(c.owner_id) || {}).is_admin : false,
    checked_by_name: c.checked_by ? (uMap.get(c.checked_by) || {}).name || null : null,
    logged_minutes: Math.round(mins.get(c.id) || 0),
    timer_running_by: running.get(c.id) || null,
  }));
}

function cleanCardInput(b, partial) {
  const out = {};
  if (!partial || b.title !== undefined) {
    const t = String(b.title || '').trim();
    if (!t || t.length > 200) throw bad('Title is required (max 200 characters)');
    out.title = t;
  }
  if (b.goal !== undefined) out.goal = String(b.goal || '').slice(0, 2000);
  if (!partial || b.role !== undefined) {
    if (!ROLES.includes(b.role)) throw bad('Unknown role');
    out.role = b.role;
  }
  if (!partial || b.type !== undefined) {
    if (!TYPES.includes(b.type)) throw bad('Type must be client or internal');
    out.type = b.type;
  }
  if (b.client !== undefined) out.client = String(b.client || '').slice(0, 120);
  if (!partial || b.due !== undefined) {
    if (!b.due || Number.isNaN(Date.parse(b.due))) throw bad('A valid due date is required');
    out.due = new Date(b.due).toISOString();
  }
  if (b.planned_minutes !== undefined) {
    const m = Math.round(Number(b.planned_minutes));
    if (!Number.isFinite(m) || m < 0 || m > 6000) throw bad('Planned time must be between 0 and 100 hours');
    out.planned_minutes = m;
  }
  if (b.points !== undefined) {
    const p = Math.round(Number(b.points));
    if (!Number.isFinite(p) || p < 0 || p > 200) throw bad('Points must be between 0 and 200');
    out.points = p;
  }
  return out;
}

async function getCard(id) {
  const c = await db.get('SELECT * FROM cards WHERE id = ? AND deleted = 0', [id]);
  if (!c) throw notFound('Card not found');
  return c;
}
async function stopTimers(userId, cardId) {
  const where = cardId ? 'user_id = ? AND card_id = ? AND end_at IS NULL' : 'user_id = ? AND end_at IS NULL';
  await db.run(`UPDATE time_logs SET end_at = ? WHERE ${where}`, cardId ? [nowIso(), userId, cardId] : [nowIso(), userId]);
}

// ---------------------------------------------------------------- reports
async function report(month) {
  const [users, cards, logs, bonusRow, payouts] = await Promise.all([
    db.all('SELECT * FROM users WHERE active = 1 ORDER BY created_at'),
    db.all('SELECT * FROM cards WHERE deleted = 0'),
    db.all('SELECT * FROM time_logs'),
    db.get('SELECT * FROM bonus_months WHERE month = ?', [month]),
    db.all('SELECT * FROM payouts WHERE month = ?', [month]),
  ]);
  const now = Date.now();
  const rows = users.map((u) => ({
    user_id: u.id, name: u.name, title: u.title,
    committed: 0, on_time: 0, late: 0, planned_minutes: 0, logged_minutes: 0, points: 0, done: 0,
    minutes_by_role: {}, points_by_role: {},
  }));
  const byId = new Map(rows.map((r) => [r.user_id, r]));
  const cardById = new Map(cards.map((c) => [c.id, c]));

  for (const c of cards) {
    const r = c.owner_id ? byId.get(c.owner_id) : null;
    if (!r) continue;
    if (monthOf(c.due) === month && c.status !== 'To pick') {
      r.committed += 1;
      r.planned_minutes += c.planned_minutes;
      const deliveredOnTime = c.submitted_at && Date.parse(c.submitted_at) <= Date.parse(c.due)
        && (c.status === 'Waiting for check' || c.status === 'Done');
      if (deliveredOnTime) r.on_time += 1;
      else if (Date.parse(c.due) < now) r.late += 1;
    }
    if (c.status === 'Done' && c.checked_at && monthOf(c.checked_at) === month) {
      r.points += c.points;
      r.done += 1;
      r.points_by_role[c.role] = (r.points_by_role[c.role] || 0) + c.points;
    }
  }
  for (const l of logs) {
    if (monthOf(l.start_at) !== month) continue;
    const r = byId.get(l.user_id);
    if (!r) continue;
    const m = Math.max(0, ((l.end_at ? Date.parse(l.end_at) : now) - Date.parse(l.start_at)) / 60000);
    r.logged_minutes += m;
    const card = cardById.get(l.card_id);
    const role = card ? card.role : 'Other';
    r.minutes_by_role[role] = (r.minutes_by_role[role] || 0) + m;
  }
  const payMap = new Map(payouts.map((p) => [p.user_id, p]));
  const totalPoints = rows.reduce((s, r) => s + r.points, 0);
  const poolCents = bonusRow ? bonusRow.bonus_pool_cents : 0;
  // largest-remainder rounding so the bonus cents add up exactly to the pool
  const raw = rows.map((r) => (totalPoints ? (poolCents * r.points) / totalPoints : 0));
  const floors = raw.map(Math.floor);
  let left = totalPoints ? poolCents - floors.reduce((a, b) => a + b, 0) : 0;
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < left; k++) floors[order[k % order.length][1]] += 1;

  rows.forEach((r, i) => {
    r.logged_minutes = Math.round(r.logged_minutes);
    for (const k of Object.keys(r.minutes_by_role)) r.minutes_by_role[k] = Math.round(r.minutes_by_role[k]);
    r.reliability = r.committed ? Math.round((r.on_time / r.committed) * 1000) / 10 : null;
    r.points_share = totalPoints ? Math.round((r.points / totalPoints) * 1000) / 10 : 0;
    r.bonus_cents = floors[i];
    const p = payMap.get(r.user_id);
    r.sourcing_cents = p ? p.sourcing_cents : 0;
    r.paid = p ? !!p.paid : false;
    r.total_cents = r.bonus_cents + r.sourcing_cents;
  });
  return {
    month, rows, total_points: totalPoints, bonus_pool_cents: poolCents,
    per_point_cents: totalPoints ? Math.round((poolCents / totalPoints) * 100) / 100 : 0,
    totals: {
      bonus_cents: rows.reduce((s, r) => s + r.bonus_cents, 0),
      sourcing_cents: rows.reduce((s, r) => s + r.sourcing_cents, 0),
      total_cents: rows.reduce((s, r) => s + r.total_cents, 0),
    },
  };
}

// ---------------------------------------------------------------- routes
const routes = [];
function route(method, path, opts, handler) {
  if (typeof opts === 'function') { handler = opts; opts = {}; }
  const keys = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, opts, handler });
}

route('GET', '/api/health', { auth: false }, async () => ({ ok: true, time: nowIso() }));

route('POST', '/api/login', { auth: false }, async ({ body, ip }) => {
  const name = String(body.name || '').trim();
  const pw = String(body.password || '');
  if (!name || !pw) throw bad('Name and password are required');
  rateLimit(ip + '|' + name.toLowerCase());
  const u = await db.get('SELECT * FROM users WHERE lower(name) = ? AND active = 1', [name.toLowerCase()]);
  if (!u || !checkPw(pw, u.pass_hash)) throw new HttpError(401, 'Wrong name or password');
  return { token: signJwt({ sub: u.id }), user: publicUser(u) };
});

route('GET', '/api/me', async ({ user }) => ({ user: publicUser(user) }));

route('POST', '/api/me/password', async ({ user, body }) => {
  const pw = String(body.new_password || '');
  if (pw.length < 6) throw bad('Password must be at least 6 characters');
  if (!checkPw(String(body.old_password || ''), user.pass_hash)) throw forbid('Current password is wrong');
  await db.run('UPDATE users SET pass_hash = ? WHERE id = ?', [hashPw(pw), user.id]);
  return { ok: true };
});

route('GET', '/api/meta', async () => ({
  roles: ROLES, difficulty: DIFFICULTY, statuses: STATUSES, types: TYPES, point_presets: POINT_PRESETS,
  tz_offset_min: TZ_OFFSET_MIN,
}));

route('GET', '/api/users', async () => {
  const rows = await db.all('SELECT * FROM users ORDER BY created_at');
  return { users: rows.map(publicUser) };
});

route('POST', '/api/users', { admin: true }, async ({ body }) => {
  const name = String(body.name || '').trim();
  const pw = String(body.password || '');
  if (!name || name.length > 60) throw bad('Name is required');
  if (pw.length < 6) throw bad('Password must be at least 6 characters');
  if (await db.get('SELECT id FROM users WHERE lower(name) = ?', [name.toLowerCase()])) throw bad('That name is already used');
  const id = uid();
  await db.run('INSERT INTO users (id, name, title, is_admin, active, pass_hash, created_at) VALUES (?,?,?,?,?,?,?)',
    [id, name, String(body.title || '').slice(0, 80), body.is_admin ? 1 : 0, 1, hashPw(pw), nowIso()]);
  return { user: publicUser(await db.get('SELECT * FROM users WHERE id = ?', [id])) };
});

route('PATCH', '/api/users/:id', { admin: true }, async ({ params, body, user }) => {
  const u = await db.get('SELECT * FROM users WHERE id = ?', [params.id]);
  if (!u) throw notFound('User not found');
  if (body.active === false && u.id === user.id) throw bad('You cannot deactivate yourself');
  if (body.title !== undefined) await db.run('UPDATE users SET title = ? WHERE id = ?', [String(body.title).slice(0, 80), u.id]);
  if (body.active !== undefined) await db.run('UPDATE users SET active = ? WHERE id = ?', [body.active ? 1 : 0, u.id]);
  if (body.password !== undefined) {
    if (String(body.password).length < 6) throw bad('Password must be at least 6 characters');
    await db.run('UPDATE users SET pass_hash = ? WHERE id = ?', [hashPw(String(body.password)), u.id]);
  }
  return { user: publicUser(await db.get('SELECT * FROM users WHERE id = ?', [u.id])) };
});

route('GET', '/api/cards', async ({ query }) => {
  const month = validMonth(query.month) ? query.month : monthOf(nowIso());
  let cards = await loadCards();
  // show every open card, but only Done cards checked in the chosen month
  cards = cards.filter((c) => c.status !== 'Done' || (c.checked_at && monthOf(c.checked_at) === month));
  return { cards, month };
});

route('GET', '/api/cards/:id', async ({ params }) => {
  const card = (await loadCards()).find((c) => c.id === params.id);
  if (!card) throw notFound('Card not found');
  const [logs, events, users] = await Promise.all([
    db.all('SELECT * FROM time_logs WHERE card_id = ? ORDER BY start_at', [params.id]),
    db.all('SELECT * FROM card_events WHERE card_id = ? ORDER BY at', [params.id]),
    db.all('SELECT id, name FROM users'),
  ]);
  const names = new Map(users.map((u) => [u.id, u.name]));
  return {
    card,
    logs: logs.map((l) => ({ ...l, user_name: names.get(l.user_id) || '?' })),
    events: events.map((e) => ({ ...e, user_name: names.get(e.user_id) || '' })),
  };
});

route('POST', '/api/cards', { admin: true }, async ({ body, user }) => {
  const c = cleanCardInput(body, false);
  let ownerId = null;
  if (body.owner_id) {
    const o = await db.get('SELECT id FROM users WHERE id = ? AND active = 1', [body.owner_id]);
    if (!o) throw bad('Owner not found');
    ownerId = o.id;
  }
  const id = uid();
  await db.run(
    `INSERT INTO cards (id, title, goal, role, type, client, owner_id, due, planned_minutes, points, status, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, c.title, c.goal || '', c.role, c.type, c.client || '', ownerId, c.due, c.planned_minutes || 0, c.points || 0,
      ownerId ? 'Picked' : 'To pick', user.id, nowIso()]);
  await event(id, user.id, 'created', c.title);
  return { id };
});

route('PATCH', '/api/cards/:id', async ({ params, body, user }) => {
  const card = await getCard(params.id);
  const isOwner = card.owner_id === user.id;
  if (!user.is_admin && !isOwner) throw forbid();
  if (card.status === 'Done' && !user.is_admin) throw forbid('Done cards are locked');
  let changes;
  if (user.is_admin) {
    changes = cleanCardInput(body, true);
    if (body.owner_id !== undefined) {
      if (body.owner_id) {
        const o = await db.get('SELECT id FROM users WHERE id = ? AND active = 1', [body.owner_id]);
        if (!o) throw bad('Owner not found');
        changes.owner_id = o.id;
        if (card.status === 'To pick') changes.status = 'Picked';
      } else {
        if (card.status === 'Done') throw bad('A done card keeps its owner');
        changes.owner_id = null;
        changes.status = 'To pick';
        await stopTimers(card.owner_id, card.id);
      }
    }
  } else {
    changes = {};
    if (body.planned_minutes !== undefined) changes.planned_minutes = cleanCardInput({ planned_minutes: body.planned_minutes }, true).planned_minutes;
    if (body.goal !== undefined) changes.goal = String(body.goal || '').slice(0, 2000);
  }
  const keys = Object.keys(changes);
  if (!keys.length) return { ok: true };
  await db.run(`UPDATE cards SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE id = ?`, [...keys.map((k) => changes[k]), card.id]);
  await event(card.id, user.id, 'edited', keys.join(', '));
  return { ok: true };
});

route('DELETE', '/api/cards/:id', { admin: true }, async ({ params, user }) => {
  const card = await getCard(params.id);
  await db.run('UPDATE cards SET deleted = 1 WHERE id = ?', [card.id]);
  await db.run('UPDATE time_logs SET end_at = ? WHERE card_id = ? AND end_at IS NULL', [nowIso(), card.id]);
  await event(card.id, user.id, 'deleted', card.title);
  return { ok: true };
});

route('POST', '/api/cards/:id/pick', async ({ params, user }) => {
  const card = await getCard(params.id);
  if (card.status !== 'To pick' || card.owner_id) throw bad('This card is already picked');
  await db.run('UPDATE cards SET owner_id = ?, status = ? WHERE id = ?', [user.id, 'Picked', card.id]);
  await event(card.id, user.id, 'picked', null);
  return { ok: true };
});

route('POST', '/api/cards/:id/status', async ({ params, body, user }) => {
  const card = await getCard(params.id);
  if (card.owner_id !== user.id && !user.is_admin) throw forbid('Only the owner can move this card');
  const to = body.status;
  if (!['Picked', 'In progress', 'Waiting for check'].includes(to)) throw bad('Use check to finish a card');
  if (card.status === 'To pick' || card.status === 'Done') throw bad('This card cannot be moved from here');
  if (!card.owner_id) throw bad('Pick the card first');
  const sets = ['status = ?'];
  const vals = [to];
  if (to === 'Waiting for check') {
    sets.push('submitted_at = ?'); vals.push(nowIso());
    await stopTimers(card.owner_id, card.id);
  } else if (card.status === 'Waiting for check') {
    sets.push('submitted_at = NULL');
  }
  await db.run(`UPDATE cards SET ${sets.join(', ')} WHERE id = ?`, [...vals, card.id]);
  await event(card.id, user.id, to === 'Waiting for check' ? 'submitted' : 'moved', to);
  return { ok: true };
});

route('POST', '/api/cards/:id/check', async ({ params, body, user }) => {
  const card = await getCard(params.id);
  if (card.status !== 'Waiting for check') throw bad('Card is not waiting for a check');
  const owner = card.owner_id ? await db.get('SELECT id, is_admin FROM users WHERE id = ?', [card.owner_id]) : null;
  if (card.owner_id === user.id) throw forbid('You cannot check your own work');
  // Ayqan (admin) checks everyone. When an admin owns the card, any other team member checks it.
  if (!user.is_admin && !(owner && owner.is_admin)) throw forbid('Only an admin can check this card');
  const note = String(body.note || '').slice(0, 1000);
  if (body.pass) {
    const onTime = card.submitted_at && Date.parse(card.submitted_at) <= Date.parse(card.due) ? 1 : 0;
    await db.run('UPDATE cards SET status = ?, checked_by = ?, checked_at = ?, on_time = ?, check_note = ? WHERE id = ?',
      ['Done', user.id, nowIso(), onTime, note, card.id]);
    await event(card.id, user.id, 'check_passed', note);
  } else {
    if (!note) throw bad('Say what needs fixing');
    await db.run('UPDATE cards SET status = ?, submitted_at = NULL, check_note = ? WHERE id = ?', ['In progress', note, card.id]);
    await event(card.id, user.id, 'check_failed', note);
  }
  return { ok: true };
});

route('GET', '/api/timer', async ({ user }) => {
  const l = await db.get('SELECT * FROM time_logs WHERE user_id = ? AND end_at IS NULL', [user.id]);
  if (!l) return { timer: null };
  const c = await db.get('SELECT id, title FROM cards WHERE id = ?', [l.card_id]);
  return { timer: { card_id: l.card_id, card_title: c ? c.title : '', start_at: l.start_at } };
});

route('POST', '/api/cards/:id/timer/start', async ({ params, user }) => {
  const card = await getCard(params.id);
  if (card.owner_id !== user.id) throw forbid('Only the owner can log time');
  if (!['Picked', 'In progress'].includes(card.status)) throw bad('Start the timer on a picked or in-progress card');
  const running = await db.get('SELECT card_id FROM time_logs WHERE user_id = ? AND end_at IS NULL', [user.id]);
  if (running) throw new HttpError(409, 'You already have a timer running. Stop it first.');
  await db.run('INSERT INTO time_logs (id, card_id, user_id, start_at) VALUES (?,?,?,?)', [uid(), card.id, user.id, nowIso()]);
  if (card.status === 'Picked') await db.run('UPDATE cards SET status = ? WHERE id = ?', ['In progress', card.id]);
  await event(card.id, user.id, 'timer_start', null);
  return { ok: true };
});

route('POST', '/api/timer/stop', async ({ user }) => {
  const l = await db.get('SELECT * FROM time_logs WHERE user_id = ? AND end_at IS NULL', [user.id]);
  if (!l) throw bad('No timer is running');
  await stopTimers(user.id);
  await event(l.card_id, user.id, 'timer_stop', null);
  return { ok: true };
});

route('GET', '/api/report', async ({ query }) => {
  const month = validMonth(query.month) ? query.month : monthOf(nowIso());
  return report(month);
});

route('PUT', '/api/bonus/:month', { admin: true }, async ({ params, body }) => {
  if (!validMonth(params.month)) throw bad('Month must look like 2026-11');
  const dollars = Number(body.bonus_pool);
  if (!Number.isFinite(dollars) || dollars < 0 || dollars > 10000000) throw bad('Bonus pool must be a number of dollars');
  await db.run(
    'INSERT INTO bonus_months (month, bonus_pool_cents) VALUES (?, ?) ON CONFLICT (month) DO UPDATE SET bonus_pool_cents = excluded.bonus_pool_cents',
    [params.month, Math.round(dollars * 100)]);
  return report(params.month);
});

route('PUT', '/api/payouts/:month/:userId', { admin: true }, async ({ params, body }) => {
  if (!validMonth(params.month)) throw bad('Month must look like 2026-11');
  const u = await db.get('SELECT id FROM users WHERE id = ?', [params.userId]);
  if (!u) throw notFound('User not found');
  const cur = await db.get('SELECT * FROM payouts WHERE month = ? AND user_id = ?', [params.month, u.id]);
  let sourcing = cur ? cur.sourcing_cents : 0;
  let paid = cur ? cur.paid : 0;
  if (body.sourcing !== undefined) {
    const d = Number(body.sourcing);
    if (!Number.isFinite(d) || d < 0 || d > 10000000) throw bad('Sourcing cut must be a number of dollars');
    sourcing = Math.round(d * 100);
  }
  if (body.paid !== undefined) paid = body.paid ? 1 : 0;
  await db.run(
    `INSERT INTO payouts (month, user_id, sourcing_cents, paid) VALUES (?,?,?,?)
     ON CONFLICT (month, user_id) DO UPDATE SET sourcing_cents = excluded.sourcing_cents, paid = excluded.paid`,
    [params.month, u.id, sourcing, paid]);
  return report(params.month);
});

// ---------------------------------------------------------------- server
function corsHeaders(req) {
  const origin = req.headers.origin;
  const h = {
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  if (ORIGINS.includes('*')) h['Access-Control-Allow-Origin'] = '*';
  else if (origin && ORIGINS.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}
function send(req, res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', ...corsHeaders(req) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 100000) { reject(new HttpError(413, 'Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { reject(bad('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

async function handle(req, res) {
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, corsHeaders(req)); return res.end(); }
    const url = new URL(req.url, 'http://x');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path === '/') return send(req, res, 200, { name: 'Nuvo Labs cards API', ok: true });
    let found = null;
    let params = {};
    let pathMatched = false;
    for (const r of routes) {
      const m = r.re.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== req.method) continue;
      found = r;
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      break;
    }
    if (!found) throw pathMatched ? new HttpError(405, 'Method not allowed') : notFound('No such endpoint');
    let user = null;
    if (found.opts.auth !== false) {
      const auth = req.headers.authorization || '';
      const payload = verifyJwt(auth.startsWith('Bearer ') ? auth.slice(7) : '');
      if (!payload) throw new HttpError(401, 'Please log in');
      user = await db.get('SELECT * FROM users WHERE id = ? AND active = 1', [payload.sub]);
      if (!user) throw new HttpError(401, 'Please log in');
      if (found.opts.admin && !user.is_admin) throw forbid('Admins only');
    }
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const out = await found.handler({ req, res, params, query: Object.fromEntries(url.searchParams), body, user, ip });
    send(req, res, 200, out);
  } catch (e) {
    if (e instanceof HttpError) return send(req, res, e.status, { error: e.message });
    console.error(e);
    send(req, res, 500, { error: 'Something went wrong on the server' });
  }
}

async function seedUsers() {
  const n = await db.get('SELECT COUNT(*) AS n FROM users');
  if (Number(n.n) > 0) return;
  let pw = process.env.INITIAL_PASSWORD;
  let generated = false;
  if (!pw) { pw = crypto.randomBytes(6).toString('hex'); generated = true; }
  const team = [
    ['Ayqan Haider', 'CEO', 1], ['Saad', 'Motion graphics and building', 0],
    ['Yaseen', 'Lead generation, cold emails and DMs', 0], ['Ehtesham', 'Lead generation, cold emails and DMs', 0],
  ];
  for (const [name, title, admin] of team) {
    await db.run('INSERT INTO users (id, name, title, is_admin, active, pass_hash, created_at) VALUES (?,?,?,?,?,?,?)',
      [uid(), name, title, admin, 1, hashPw(pw), nowIso()]);
  }
  console.log('Seeded the team: Ayqan Haider (admin), Saad, Yaseen, Ehtesham.');
  if (generated) console.log('Starting password for everyone (change it after login):', pw);
  else console.log('Everyone starts with the INITIAL_PASSWORD you set. Change it after login.');
}

async function start(port = PORT) {
  await db.init();
  await seedUsers();
  const server = http.createServer(handle);
  await new Promise((r) => server.listen(port, r));
  console.log(`Nuvo cards API on port ${server.address().port} (${db.usePg ? 'Postgres' : 'SQLite'})`);
  return server;
}

module.exports = { start };
if (require.main === module) start().catch((e) => { console.error(e); process.exit(1); });
