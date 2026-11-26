'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
let db;
try { db = new Database(path.join(DATA_DIR, 'mgeo.db')); }
catch (e) { console.error(`[MGEO] Não consegui abrir o banco em ${DATA_DIR}: ${e.message}. Confira a montagem do volume em /data e as permissões.`); process.exit(1); }
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nome            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash      TEXT NOT NULL,
  whatsapp        TEXT,
  perfil          TEXT,
  funcao          TEXT,
  uf              TEXT,
  municipio       TEXT,
  empresa         TEXT,
  area_faixa      TEXT,
  interesses      TEXT NOT NULL DEFAULT '[]',
  origem          TEXT,
  origem_outro    TEXT,
  termos_versao   TEXT,
  termos_em       TEXT,
  contato_ok      INTEGER NOT NULL DEFAULT 0,
  contato_em      TEXT,
  role            TEXT NOT NULL DEFAULT 'cliente',
  status          TEXT NOT NULL DEFAULT 'ativo',
  quente_desde    TEXT,
  contatado_em    TEXT,
  contatado_por   TEXT,
  obs             TEXT,
  criado_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  criado_por      TEXT,
  ultimo_acesso   TEXT,
  total_acessos   INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  criado_em   TEXT NOT NULL,
  expira_em   TEXT NOT NULL,
  dispositivo TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS resets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  expira_em   TEXT NOT NULL,
  tentativas  INTEGER NOT NULL DEFAULT 0,
  usado       INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL,
  em          TEXT NOT NULL,
  dispositivo TEXT,
  meta        TEXT
);
CREATE INDEX IF NOT EXISTS events_em ON events(em);
CREATE INDEX IF NOT EXISTS events_user ON events(user_id, em);
CREATE TABLE IF NOT EXISTS usage_daily (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dia      TEXT NOT NULL,
  minutos  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, dia)
);
CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
INSERT OR IGNORE INTO config (chave, valor) VALUES ('auto_aprovar', '1');
`);

// colunas novas (bancos já existentes ganham a coluna sem perder dados)
const colunas = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!colunas.includes('portal_id')) db.exec('ALTER TABLE users ADD COLUMN portal_id TEXT');       // id do usuário no Portal MGEO
if (!colunas.includes('portal_papel')) db.exec('ALTER TABLE users ADD COLUMN portal_papel TEXT'); // papel no portal no último login

const getConfig = k => { const r = db.prepare('SELECT valor FROM config WHERE chave = ?').get(k); return r ? r.valor : null; };
const setConfig = (k, v) => db.prepare('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(k, String(v));

module.exports = { db, getConfig, setConfig, DATA_DIR };
