'use strict';
process.env.INITIAL_PASSWORD = 'testpass1';
process.env.TEAM_TZ_OFFSET_MIN = '0';
const assert = require('node:assert/strict');
const { start } = require('./server');

(async () => {
  const server = await start(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (method, path, token, body) => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json() };
  };
  const login = async (name, password = 'testpass1') => (await call('POST', '/api/login', null, { name, password })).data;

  // auth
  assert.equal((await call('GET', '/api/cards')).status, 401);
  assert.equal((await call('POST', '/api/login', null, { name: 'Saad', password: 'nope' })).status, 401);
  const A = await login('ayqan haider'); const S = await login('Saad'); const Y = await login('Yaseen');
  assert.ok(A.token && A.user.is_admin && !S.user.is_admin);

  // permissions: only admin creates cards
  const due = new Date(Date.now() + 86400000).toISOString();
  const mk = { title: 'Edit 3 reels', role: 'Video editing', type: 'client', client: 'HVAC Co', due, planned_minutes: 180, points: 30 };
  assert.equal((await call('POST', '/api/cards', S.token, mk)).status, 403);
  assert.equal((await call('POST', '/api/cards', A.token, { ...mk, role: 'Nope' })).status, 400);
  const c1 = (await call('POST', '/api/cards', A.token, mk)).data.id;
  assert.ok(c1);

  // pick, timer, submit
  assert.equal((await call('POST', `/api/cards/${c1}/timer/start`, S.token)).status, 403);
  assert.equal((await call('POST', `/api/cards/${c1}/pick`, S.token)).status, 200);
  assert.equal((await call('POST', `/api/cards/${c1}/pick`, Y.token)).status, 400);
  assert.equal((await call('POST', `/api/cards/${c1}/timer/start`, S.token)).status, 200);
  assert.equal((await call('POST', `/api/cards/${c1}/timer/start`, S.token)).status, 409);
  assert.equal((await call('GET', '/api/timer', S.token)).data.timer.card_id, c1);
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal((await call('POST', '/api/timer/stop', S.token)).status, 200);
  assert.equal((await call('POST', `/api/cards/${c1}/status`, S.token, { status: 'Waiting for check' })).status, 200);

  // checking: owner can't, non-admin can't (owner is not admin), admin can
  assert.equal((await call('POST', `/api/cards/${c1}/check`, S.token, { pass: true })).status, 403);
  assert.equal((await call('POST', `/api/cards/${c1}/check`, Y.token, { pass: true })).status, 403);
  assert.equal((await call('POST', `/api/cards/${c1}/check`, A.token, { pass: false })).status, 400); // needs a note
  assert.equal((await call('POST', `/api/cards/${c1}/check`, A.token, { pass: false, note: 'Fix intro' })).status, 200);
  assert.equal((await call('POST', `/api/cards/${c1}/status`, S.token, { status: 'Waiting for check' })).status, 200);
  assert.equal((await call('POST', `/api/cards/${c1}/check`, A.token, { pass: true, note: 'good' })).status, 200);
  const det = (await call('GET', `/api/cards/${c1}`, A.token)).data;
  assert.equal(det.card.status, 'Done'); assert.equal(det.card.on_time, 1);
  assert.ok(det.events.length >= 6); assert.equal(det.logs.length, 1);

  // admin-owned card is checked by another team member
  const c2 = (await call('POST', '/api/cards', A.token, { title: 'Train team', role: 'Training and appraisal', type: 'internal', due, points: 2, owner_id: A.user.id })).data.id;
  assert.equal((await call('POST', `/api/cards/${c2}/status`, A.token, { status: 'Waiting for check' })).status, 200);
  assert.equal((await call('POST', `/api/cards/${c2}/check`, A.token, { pass: true })).status, 403);
  assert.equal((await call('POST', `/api/cards/${c2}/check`, Y.token, { pass: true })).status, 200);

  // late card counts against reliability
  const past = new Date(Date.now() - 86400000).toISOString();
  const c3 = (await call('POST', '/api/cards', A.token, { title: 'Late thing', role: 'Cold calling', type: 'internal', due: past, points: 5, owner_id: Y.user.id })).data.id;
  assert.ok(c3);

  // report + bonus math (cents add up exactly)
  const month = new Date().toISOString().slice(0, 7);
  assert.equal((await call('PUT', `/api/bonus/${month}`, S.token, { bonus_pool: 100 })).status, 403);
  const rep = (await call('PUT', `/api/bonus/${month}`, A.token, { bonus_pool: 1000.01 })).data;
  assert.equal(rep.total_points, 32);
  assert.equal(rep.bonus_pool_cents, 100001);
  assert.equal(rep.totals.bonus_cents, 100001);
  const saad = rep.rows.find((r) => r.name === 'Saad'); const ayqan = rep.rows.find((r) => r.name === 'Ayqan Haider'); const yas = rep.rows.find((r) => r.name === 'Yaseen');
  assert.equal(saad.points, 30); assert.equal(saad.reliability, 100); assert.equal(ayqan.points, 2);
  assert.equal(yas.committed, 1); assert.equal(yas.reliability, 0); assert.equal(yas.late, 1);
  assert.ok(saad.logged_minutes >= 0 && saad.minutes_by_role['Video editing'] >= 0);
  const rep2 = (await call('PUT', `/api/payouts/${month}/${yas.user_id}`, A.token, { sourcing: 150, paid: true })).data;
  const yas2 = rep2.rows.find((r) => r.name === 'Yaseen');
  assert.equal(yas2.sourcing_cents, 15000); assert.equal(yas2.paid, true); assert.equal(rep2.totals.total_cents, 100001 + 15000);

  // users admin
  assert.equal((await call('POST', '/api/users', S.token, { name: 'X', password: 'abcdef' })).status, 403);
  const nu = (await call('POST', '/api/users', A.token, { name: 'New Person', title: 'Builder', password: 'abcdef' })).data.user;
  assert.equal((await login('new person', 'abcdef')).user.name, 'New Person');
  assert.equal((await call('PATCH', `/api/users/${nu.id}`, A.token, { active: false })).status, 200);
  assert.equal((await call('POST', '/api/login', null, { name: 'New Person', password: 'abcdef' })).status, 401);
  assert.equal((await call('POST', '/api/me/password', S.token, { old_password: 'testpass1', new_password: 'newpass99' })).status, 200);
  assert.equal((await login('Saad', 'newpass99')).user.name, 'Saad');

  // board listing + delete
  const list = (await call('GET', '/api/cards?month=' + month, S.token)).data.cards;
  assert.equal(list.length, 3);
  assert.equal((await call('DELETE', `/api/cards/${c3}`, A.token)).status, 200);
  assert.equal((await call('GET', '/api/cards', S.token)).data.cards.length, 2);
  assert.equal((await call('GET', '/api/nothing', A.token)).status, 404);

  console.log('ALL TESTS PASSED');
  server.close(); process.exit(0);
})().catch((e) => { console.error('TEST FAILED', e); process.exit(1); });
