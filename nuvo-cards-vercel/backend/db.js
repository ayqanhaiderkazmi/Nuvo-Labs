'use strict';
// Tiny database adapter. Postgres when DATABASE_URL is set (Render), SQLite otherwise (local dev and tests).
// All SQL uses "?" placeholders and portable types (TEXT, INTEGER) so it runs on both.
const usePg = !!process.env.DATABASE_URL;
let pool = null;
let lite = null;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, title TEXT, is_admin INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, goal TEXT, role TEXT NOT NULL, type TEXT NOT NULL, client TEXT,
    owner_id TEXT, due TEXT NOT NULL, planned_minutes INTEGER NOT NULL DEFAULT 0, points INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, submitted_at TEXT,
    checked_by TEXT, checked_at TEXT, on_time INTEGER, check_note TEXT, deleted INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS time_logs (
    id TEXT PRIMARY KEY, card_id TEXT NOT NULL, user_id TEXT NOT NULL, start_at TEXT NOT NULL, end_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS card_events (
    id TEXT PRIMARY KEY, card_id TEXT NOT NULL, user_id TEXT, type TEXT NOT NULL, detail TEXT, at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS bonus_months (month TEXT PRIMARY KEY, bonus_pool_cents INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS payouts (
    month TEXT NOT NULL, user_id TEXT NOT NULL, sourcing_cents INTEGER NOT NULL DEFAULT 0,
    paid INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (month, user_id))`,
  `CREATE TABLE IF NOT EXISTS objectives (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_cards_owner ON cards(owner_id)`,
  `CREATE INDEX IF NOT EXISTS idx_logs_card ON time_logs(card_id)`,
  `CREATE INDEX IF NOT EXISTS idx_events_card ON card_events(card_id)`,
];

function toPg(sql) { let i = 0; return sql.replace(/\?/g, () => '$' + (++i)); }
const clean = (p) => p.map((v) => (v === undefined ? null : v));

async function init() {
  if (usePg) {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
      max: process.env.VERCEL ? 1 : 5, // serverless: one connection per instance
      idleTimeoutMillis: 10000,
    });
  } else {
    const { DatabaseSync } = require('node:sqlite');
    lite = new DatabaseSync(process.env.SQLITE_PATH || ':memory:');
  }
  for (const stmt of SCHEMA) await run(stmt, []);
}
async function all(sql, params = []) {
  params = clean(params);
  if (usePg) return (await pool.query(toPg(sql), params)).rows;
  return lite.prepare(sql).all(...params).map((r) => ({ ...r }));
}
async function get(sql, params = []) { return (await all(sql, params))[0]; }
async function run(sql, params = []) {
  params = clean(params);
  if (usePg) { await pool.query(toPg(sql), params); return; }
  lite.prepare(sql).run(...params);
}
async function close() { if (pool) await pool.end(); if (lite) lite.close(); }

module.exports = { init, all, get, run, close, usePg };
