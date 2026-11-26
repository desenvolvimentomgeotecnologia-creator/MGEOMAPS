'use strict';
/* MGEO PDF – servidor (Express + SQLite) */
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const nodemailer = require('nodemailer');
const { db, getConfig, setConfig } = require('./db');
const portal = require('./portal');

const PORT = +process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SESSION_DAYS = 90;
const TERMOS_VERSAO = '2026-11';
const TZ = '-3 hours'; // horário de Brasília para agrupar por dia

const PERFIS = ['usina', 'fornecedor', 'produtor', 'consultor', 'outro'];
const FUNCOES = ['gerente', 'supervisor', 'tecnico', 'operador'];
const AREAS = ['ate_500', '500_1000', '1000_5000', '5000_20000', 'acima_20000'];
const ORIGENS = ['indicacao', 'equipe_mgeo', 'instagram', 'whatsapp', 'google', 'linkedin', 'youtube', 'evento', 'outro'];
const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
const EVENTOS = ['app_open', 'map_import', 'map_open', 'gps_on', 'offline_download', 'modo'];
// ADMs fixos: continuam ADM mesmo que o papel no portal mude
const ADMINS_FIXOS = (process.env.ADMIN_EMAILS || 'benati@mgeotecnologia.com,lucas@mgeotecnologia.com').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

/* ---------- utilidades ---------- */
const now = () => new Date().toISOString();
const addDays = (d) => new Date(Date.now() + d * 864e5).toISOString();
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const str = (v, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const oneOf = (v, list) => (list.includes(v) ? v : null);
const emailOk = e => /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/.test(e);
const senhaOk = s => typeof s === 'string' && s.length >= 8 && s.length <= 128 && /[A-Za-z]/.test(s) && /\d/.test(s);
function phone(v){
  let d = String(v || '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length > 11) d = d.slice(2);
  return d.length === 10 || d.length === 11 ? '+55' + d : null;
}
function hashSenha(senha){
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(senha, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}
function confereSenha(senha, stored){
  try {
    const [, s, h] = String(stored).split('$');
    const calc = crypto.scryptSync(String(senha), Buffer.from(s, 'base64'), 64, { N: 16384, r: 8, p: 1 });
    const ref = Buffer.from(h, 'base64');
    return ref.length === calc.length && crypto.timingSafeEqual(ref, calc);
  } catch (_) { return false; }
}
const HASH_FALSO = hashSenha('senha-falsa-para-tempo-constante-1');
function senhaTemporaria(){
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const b = crypto.randomBytes(10);
  return Array.from(b, x => c[x % c.length]).join('') + '7';
}
function dispositivo(ua){
  ua = String(ua || '');
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua))) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X/.test(ua)) return 'Mac';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Outro';
}
const quente = u => PERFIS.slice(0, 2).includes(u.perfil) && ['gerente', 'supervisor'].includes(u.funcao) && ['5000_20000', 'acima_20000'].includes(u.area_faixa);
function atualizaQuente(id){
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return;
  const q = quente(u);
  if (q && !u.quente_desde) db.prepare('UPDATE users SET quente_desde = ? WHERE id = ?').run(now(), id);
  if (!q && u.quente_desde) db.prepare('UPDATE users SET quente_desde = NULL WHERE id = ?').run(id);
}
function publico(u){
  if (!u) return null;
  return {
    id: u.id, nome: u.nome, email: u.email, whatsapp: u.whatsapp, perfil: u.perfil, funcao: u.funcao, uf: u.uf,
    municipio: u.municipio, empresa: u.empresa, area_faixa: u.area_faixa, interesses: JSON.parse(u.interesses || '[]'),
    origem: u.origem, role: u.role, status: u.status, criado_em: u.criado_em, portal: !!u.portal_id
  };
}
function logEvento(userId, tipo, req, meta, em){
  db.prepare('INSERT INTO events (user_id, tipo, em, dispositivo, meta) VALUES (?, ?, ?, ?, ?)')
    .run(userId, tipo, em || now(), dispositivo(req && req.headers['user-agent']), meta ? JSON.stringify(meta).slice(0, 600) : null);
}

/* limite de tentativas (memória) */
const hits = new Map();
function limite(chave, max, janelaMs){
  const t = Date.now(); const h = hits.get(chave);
  if (!h || h.ate < t){ hits.set(chave, { n: 1, ate: t + janelaMs }); return true; }
  h.n++; return h.n <= max;
}
setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (v.ate < t) hits.delete(k); }, 60e3).unref();

/* e-mail */
const mailer = process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST, port: +process.env.SMTP_PORT || 587,
  secure: String(process.env.SMTP_SECURE || '') === 'true' || +process.env.SMTP_PORT === 465,
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
}) : null;

/* ---------- sessão ---------- */
function lerCookie(req, nome){
  const c = req.headers.cookie || '';
  const m = c.split(/;\s*/).find(x => x.startsWith(nome + '='));
  return m ? decodeURIComponent(m.slice(nome.length + 1)) : null;
}
function criaSessao(req, res, userId){
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, criado_em, expira_em, dispositivo) VALUES (?, ?, ?, ?, ?)')
    .run(sha256(token), userId, now(), addDays(SESSION_DAYS), dispositivo(req.headers['user-agent']));
  const seguro = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `mgeo_sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${seguro}`);
}
function apagaCookie(res){ res.setHeader('Set-Cookie', 'mgeo_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'); }
function sessao(req){
  const t = lerCookie(req, 'mgeo_sid'); if (!t) return null;
  const h = sha256(t);
  const s = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(h);
  if (!s || s.expira_em < now()){ if (s) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(h); return null; }
  if (new Date(s.expira_em) - Date.now() < (SESSION_DAYS - 7) * 864e5) db.prepare('UPDATE sessions SET expira_em = ? WHERE token_hash = ?').run(addDays(SESSION_DAYS), h);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id);
  return u ? { user: u, hash: h } : null;
}
function auth(req, res, next){
  const s = sessao(req);
  if (!s) return res.status(401).json({ erro: 'Faça login novamente.', code: 'sem_sessao' });
  if (s.user.status === 'bloqueado') return res.status(403).json({ erro: 'Acesso bloqueado.', code: 'bloqueado' });
  if (s.user.status === 'pendente') return res.status(403).json({ erro: 'Cadastro aguardando liberação.', code: 'pendente' });
  req.user = s.user; req.sessionHash = s.hash; next();
}
function admin(req, res, next){
  auth(req, res, () => req.user.role === 'admin' ? next() : res.status(403).json({ erro: 'Apenas administradores.' }));
}

/* ---------- app ---------- */
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// O app também abre num caminho do domínio (ex.: portalmgeo.com.br/mgeopdf): o EasyPanel repassa o
// caminho inteiro, então o prefixo é tirado aqui. BASE_PATH muda o prefixo; BASE_PATH= (vazio) desliga.
const BASE = String(process.env.BASE_PATH ?? '/mgeopdf').trim().replace(/\/+$/, '');
if (BASE) app.use((req, res, next) => {
  if (req.path === BASE) return res.redirect(301, BASE + '/' + req.url.slice(BASE.length)); // /mgeopdf -> /mgeopdf/
  if (req.url.startsWith(BASE + '/')) req.url = req.url.slice(BASE.length) || '/';
  next();
});

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.google.com", "connect-src 'self' https://*.google.com https://servicodados.ibge.gov.br",
    "worker-src 'self' blob:", "font-src 'self' data: blob:", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  res.setHeader('X-Frame-Options', 'DENY');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

const api = express.Router();
api.use(express.json({ limit: '200kb' }));
// proteção contra CSRF: toda alteração exige o cabeçalho do app e a mesma origem
api.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return next();
  if (req.headers['x-mgeo'] !== '1') return res.status(403).json({ erro: 'Requisição recusada.' });
  const o = req.headers.origin;
  if (o){ try { if (new URL(o).host !== req.headers.host) return res.status(403).json({ erro: 'Origem recusada.' }); } catch (_) { return res.status(403).json({ erro: 'Origem recusada.' }); } }
  next();
});
const ip = req => req.ip || 'x';

api.get('/health', (req, res) => res.json({ ok: true }));
api.get('/public-config', (req, res) => res.json({ recuperar_por_email: !!mailer, termos_versao: TERMOS_VERSAO }));

/* cadastro */
api.post('/auth/register', (req, res) => {
  if (!limite('reg:' + ip(req), 10, 3600e3)) return res.status(429).json({ erro: 'Muitos cadastros deste local. Tente mais tarde.' });
  const b = req.body || {};
  const u = {
    nome: str(b.nome, 80), email: str(b.email, 190).toLowerCase(), whatsapp: phone(b.whatsapp),
    perfil: oneOf(b.perfil, PERFIS), funcao: oneOf(b.funcao, FUNCOES), uf: oneOf(String(b.uf || '').toUpperCase(), UFS),
    municipio: str(b.municipio, 80), empresa: str(b.empresa, 100) || null, origem: oneOf(b.origem, ORIGENS), origem_outro: str(b.origem_outro, 100) || null
  };
  if (u.nome.split(/\s+/).length < 2) return res.status(400).json({ erro: 'Digite nome e sobrenome.', campo: 'nome' });
  if (!emailOk(u.email)) return res.status(400).json({ erro: 'E-mail inválido.', campo: 'email' });
  if (!senhaOk(b.senha)) return res.status(400).json({ erro: 'A senha precisa ter 8 caracteres ou mais, com letras e números.', campo: 'senha' });
  if (!u.whatsapp) return res.status(400).json({ erro: 'WhatsApp inválido. Use DDD + número.', campo: 'whatsapp' });
  if (!u.perfil) return res.status(400).json({ erro: 'Escolha o seu perfil.', campo: 'perfil' });
  if (!u.funcao) return res.status(400).json({ erro: 'Escolha a sua função.', campo: 'funcao' });
  if (!u.uf || !u.municipio) return res.status(400).json({ erro: 'Informe UF e município.', campo: 'municipio' });
  if (!u.origem) return res.status(400).json({ erro: 'Conte onde conheceu o aplicativo.', campo: 'origem' });
  if (b.termos !== true) return res.status(400).json({ erro: 'É preciso aceitar os Termos de Uso.', campo: 'termos' });
  if (b.contato !== true) return res.status(400).json({ erro: 'É preciso autorizar o contato comercial.', campo: 'contato' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(u.email)) return res.status(409).json({ erro: 'Este e-mail já tem cadastro. Use Entrar ou Esqueci minha senha.', campo: 'email' });
  const status = getConfig('auto_aprovar') === '1' ? 'ativo' : 'pendente';
  const t = now();
  const r = db.prepare(`INSERT INTO users (nome, email, senha_hash, whatsapp, perfil, funcao, uf, municipio, empresa, origem, origem_outro,
      termos_versao, termos_em, contato_ok, contato_em, status, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`)
    .run(u.nome, u.email, hashSenha(b.senha), u.whatsapp, u.perfil, u.funcao, u.uf, u.municipio, u.empresa, u.origem, u.origem_outro, TERMOS_VERSAO, t, t, status, t);
  const id = r.lastInsertRowid;
  logEvento(id, 'cadastro', req, { origem: u.origem });
  if (status !== 'ativo') return res.status(202).json({ code: 'pendente', erro: 'Cadastro recebido! A equipe MGEO vai liberar seu acesso em breve.' });
  db.prepare('UPDATE users SET ultimo_acesso = ?, total_acessos = total_acessos + 1 WHERE id = ?').run(t, id);
  logEvento(id, 'login', req);
  criaSessao(req, res, id);
  res.json({ user: publico(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
});

/* usuário do Portal MGEO: cria ou atualiza o cadastro local (estatísticas, modo gerencial) */
function vinculaPortal(p, req){
  const ger = portal.gerencial(p.papel), fixo = ADMINS_FIXOS.includes(p.email);
  let u = db.prepare('SELECT * FROM users WHERE portal_id = ?').get(p.id) || db.prepare('SELECT * FROM users WHERE email = ?').get(p.email);
  if (!u){
    const nome = p.nome || p.email.split('@')[0].replace(/[._-]+/g, ' ').replace(/(^|\s)\S/g, c => c.toUpperCase());
    const r = db.prepare(`INSERT INTO users (nome, email, senha_hash, role, status, origem, criado_por, portal_id, portal_papel)
        VALUES (?, ?, ?, ?, 'ativo', 'equipe_mgeo', 'portal', ?, ?)`)
      .run(nome, p.email, hashSenha(senhaTemporaria()), ger || fixo ? 'admin' : 'cliente', p.id, p.papel);
    logEvento(r.lastInsertRowid, 'cadastro', req, { origem: 'portal', papel: p.papel });
    return db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  }
  let role = u.role;
  if (ger) role = 'admin';
  else if (role === 'admin' && !fixo && portal.gerencial(u.portal_papel)) role = 'cliente'; // perdeu admin/comercial no portal
  if (!u.portal_id){
    // primeira vez pelo portal: a senha local antiga deixa de valer (vale a do portal) e as sessões antigas caem
    db.prepare('UPDATE users SET senha_hash = ? WHERE id = ?').run(hashSenha(senhaTemporaria()), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  }
  db.prepare(`UPDATE users SET portal_id = ?, portal_papel = ?, role = ?, status = CASE WHEN status = 'pendente' THEN 'ativo' ELSE status END WHERE id = ?`)
    .run(p.id, p.papel, role, u.id);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
}

/* entrar: primeiro o cadastro do MGEO PDF; se não bater, o login do Portal MGEO */
api.post('/auth/login', async (req, res) => {
  const email = str((req.body || {}).email, 190).toLowerCase(), senha = (req.body || {}).senha;
  if (!limite('li:' + ip(req) + email, 8, 15 * 60e3) || !limite('lip:' + ip(req), 60, 15 * 60e3))
    return res.status(429).json({ erro: 'Muitas tentativas. Aguarde 15 minutos ou recupere a senha.' });
  let u = email ? db.prepare('SELECT * FROM users WHERE email = ?').get(email) : null;
  const ok = confereSenha(senha || '', u ? u.senha_hash : HASH_FALSO) && !!u;
  if (!ok){
    const p = emailOk(email) && typeof senha === 'string' ? await portal.entrar(email, senha.slice(0, 128)) : { ok: false };
    if (!p.ok){
      if (p.falha) console.warn(`[MGEO] login pelo Portal MGEO não conferido (${email}): ${p.motivo}`);
      if (p.inativo) return res.status(403).json({ erro: 'Seu usuário está inativo no Portal MGEO. Fale com a equipe MGEO.', code: 'bloqueado' });
      if (p.falha) return res.status(502).json({ erro: 'Não consegui conferir seu login no Portal MGEO agora. Tente de novo em instantes.' });
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
    }
    u = vinculaPortal(p, req);
    console.log(`[MGEO] login pelo Portal MGEO: ${p.email} (papel ${p.papel || '-'}${u.role === 'admin' ? ', modo gerencial' : ''})`);
  }
  if (u.status === 'bloqueado') return res.status(403).json({ erro: 'Seu acesso está bloqueado. Fale com a equipe MGEO.', code: 'bloqueado' });
  if (u.status === 'pendente') return res.status(403).json({ erro: 'Seu cadastro está em análise. Você será avisado quando for liberado.', code: 'pendente' });
  db.prepare('UPDATE users SET ultimo_acesso = ?, total_acessos = total_acessos + 1 WHERE id = ?').run(now(), u.id);
  logEvento(u.id, 'login', req);
  criaSessao(req, res, u.id);
  res.json({ user: publico(u) });
});

api.post('/auth/logout', (req, res) => {
  const t = lerCookie(req, 'mgeo_sid');
  if (t) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(t));
  apagaCookie(res); res.json({ ok: true });
});

api.get('/auth/me', auth, (req, res) => res.json({ user: publico(req.user) }));

/* esqueci a senha: código de 6 números por e-mail */
api.post('/auth/forgot', async (req, res) => {
  const email = str((req.body || {}).email, 190).toLowerCase();
  if (!mailer) return res.status(503).json({ erro: 'Recuperação por e-mail indisponível. Fale com a equipe MGEO para redefinir sua senha.', code: 'sem_email' });
  if (!limite('fg:' + email, 3, 3600e3) || !limite('fgip:' + ip(req), 15, 3600e3)) return res.status(429).json({ erro: 'Muitos pedidos. Tente de novo em 1 hora.' });
  const u = emailOk(email) ? db.prepare('SELECT * FROM users WHERE email = ?').get(email) : null;
  if (u && u.status !== 'bloqueado' && !u.portal_id){ // usuário do portal recupera a senha no próprio portal
    const codigo = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    db.prepare('UPDATE resets SET usado = 1 WHERE user_id = ?').run(u.id);
    db.prepare('INSERT INTO resets (user_id, code_hash, expira_em) VALUES (?, ?, ?)').run(u.id, sha256(u.id + ':' + codigo), new Date(Date.now() + 15 * 60e3).toISOString());
    try {
      await mailer.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER, to: u.email, subject: `${codigo} é o seu código do MGEO PDF`,
        text: `Olá, ${u.nome.split(' ')[0]}!\n\nSeu código para criar uma nova senha no MGEO PDF é: ${codigo}\n\nEle vale por 15 minutos. Se não foi você, ignore este e-mail.\n\nMGEO Tecnologia`,
        html: `<div style="font-family:Arial,sans-serif;max-width:480px"><p>Olá, ${u.nome.split(' ')[0].replace(/[<>&]/g, '')}!</p><p>Seu código para criar uma nova senha no <b>MGEO PDF</b> é:</p><p style="font-size:30px;font-weight:bold;letter-spacing:6px">${codigo}</p><p>Ele vale por 15 minutos. Se não foi você, ignore este e-mail.</p><p style="color:#777">MGEO Tecnologia</p></div>`
      });
    } catch (e) { console.error('Falha ao enviar e-mail:', e.message); return res.status(502).json({ erro: 'Não foi possível enviar o e-mail agora. Tente de novo.' }); }
  }
  res.json({ ok: true }); // mesma resposta exista ou não o e-mail
});

api.post('/auth/reset', (req, res) => {
  const b = req.body || {}; const email = str(b.email, 190).toLowerCase(); const codigo = String(b.codigo || '').replace(/\D/g, '');
  if (!limite('rs:' + ip(req), 20, 3600e3)) return res.status(429).json({ erro: 'Muitas tentativas. Tente mais tarde.' });
  if (!senhaOk(b.senha)) return res.status(400).json({ erro: 'A nova senha precisa ter 8 caracteres ou mais, com letras e números.' });
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const r = u && db.prepare('SELECT * FROM resets WHERE user_id = ? AND usado = 0 ORDER BY id DESC LIMIT 1').get(u.id);
  if (!r || r.expira_em < now() || r.tentativas >= 5) return res.status(400).json({ erro: 'Código vencido. Peça um novo.' });
  if (sha256(u.id + ':' + codigo) !== r.code_hash){
    db.prepare('UPDATE resets SET tentativas = tentativas + 1 WHERE id = ?').run(r.id);
    return res.status(400).json({ erro: 'Código incorreto.' });
  }
  db.prepare('UPDATE resets SET usado = 1 WHERE id = ?').run(r.id);
  db.prepare('UPDATE users SET senha_hash = ? WHERE id = ?').run(hashSenha(b.senha), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  logEvento(u.id, 'senha_redefinida', req);
  if (u.status !== 'ativo') return res.json({ ok: true, code: u.status });
  db.prepare('UPDATE users SET ultimo_acesso = ?, total_acessos = total_acessos + 1 WHERE id = ?').run(now(), u.id);
  logEvento(u.id, 'login', req);
  criaSessao(req, res, u.id);
  res.json({ user: publico(u) });
});

api.post('/auth/password', auth, (req, res) => {
  const b = req.body || {};
  if (req.user.portal_id) return res.status(400).json({ erro: 'Sua senha é a mesma do Portal MGEO. Para trocar, use o portal.' });
  if (!confereSenha(b.atual || '', req.user.senha_hash)) return res.status(400).json({ erro: 'Senha atual incorreta.' });
  if (!senhaOk(b.nova)) return res.status(400).json({ erro: 'A nova senha precisa ter 8 caracteres ou mais, com letras e números.' });
  db.prepare('UPDATE users SET senha_hash = ? WHERE id = ?').run(hashSenha(b.nova), req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(req.user.id, req.sessionHash);
  res.json({ ok: true });
});

/* dados complementares (depois, no app) */
api.patch('/me', auth, (req, res) => {
  const b = req.body || {}; const set = {};
  if ('empresa' in b) set.empresa = str(b.empresa, 100) || null;
  if ('area_faixa' in b) set.area_faixa = oneOf(b.area_faixa, AREAS);
  if ('interesses' in b) set.interesses = JSON.stringify((Array.isArray(b.interesses) ? b.interesses : []).map(x => str(x, 60)).filter(Boolean).slice(0, 12));
  if ('whatsapp' in b){ const w = phone(b.whatsapp); if (!w) return res.status(400).json({ erro: 'WhatsApp inválido.' }); set.whatsapp = w; }
  const keys = Object.keys(set);
  if (keys.length) db.prepare(`UPDATE users SET ${keys.map(k => k + ' = ?').join(', ')} WHERE id = ?`).run(...keys.map(k => set[k]), req.user.id);
  atualizaQuente(req.user.id);
  res.json({ user: publico(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

/* estatísticas de uso enviadas pelo app (inclusive as que ficaram guardadas offline) */
api.post('/events', auth, (req, res) => {
  const lista = Array.isArray((req.body || {}).eventos) ? req.body.eventos.slice(0, 300) : [];
  const min = Date.now() - 60 * 864e5, max = Date.now() + 5 * 60e3;
  const ins = db.prepare('INSERT INTO events (user_id, tipo, em, dispositivo, meta) VALUES (?, ?, ?, ?, ?)');
  const uso = db.prepare(`INSERT INTO usage_daily (user_id, dia, minutos) VALUES (?, strftime('%Y-%m-%d', ?, '${TZ}'), ?)
      ON CONFLICT(user_id, dia) DO UPDATE SET minutos = minutos + excluded.minutos`);
  const disp = dispositivo(req.headers['user-agent']);
  let ultimo = null;
  db.transaction(() => {
    for (const e of lista){
      const t = Date.parse(e && e.em); const em = (t > min && t < max) ? new Date(t).toISOString() : now();
      if (e.tipo === 'uso'){ const m = Math.max(0, Math.min(60, Math.round(+e.minutos || 0))); if (m) uso.run(req.user.id, em, m); continue; }
      if (!EVENTOS.includes(e.tipo)) continue;
      ins.run(req.user.id, e.tipo, em, disp, e.meta ? JSON.stringify(e.meta).slice(0, 600) : null);
      if (e.tipo === 'app_open' && (!ultimo || em > ultimo)) ultimo = em;
    }
    if (ultimo) db.prepare('UPDATE users SET ultimo_acesso = MAX(COALESCE(ultimo_acesso, ?), ?) WHERE id = ?').run(ultimo, ultimo, req.user.id);
  })();
  res.json({ ok: true });
});

/* ======================= MODO GERENCIAL ======================= */
const adm = express.Router();
adm.use(admin);

adm.get('/stats', (req, res) => {
  const dias = [7, 30, 90, 365].includes(+req.query.dias) ? +req.query.dias : 30;
  const desde = new Date(Date.now() - dias * 864e5).toISOString();
  const d7 = new Date(Date.now() - 7 * 864e5).toISOString(), d30 = new Date(Date.now() - 30 * 864e5).toISOString();
  const hoje = db.prepare(`SELECT strftime('%Y-%m-%d', 'now', '${TZ}') d`).get().d;
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const ACESSO = `tipo IN ('login','app_open')`;

  const usuarios = one(`SELECT COUNT(*) total, SUM(status='ativo') ativos, SUM(status='pendente') pendentes, SUM(status='bloqueado') bloqueados, SUM(role='admin') admins FROM users`);
  const novos = one(`SELECT SUM(strftime('%Y-%m-%d', criado_em, '${TZ}') = ?) hoje, SUM(criado_em >= ?) d7, SUM(criado_em >= ?) d30, SUM(criado_em >= ?) periodo FROM users`, hoje, d7, d30, desde);
  const ativos = one(`SELECT
      (SELECT COUNT(DISTINCT user_id) FROM events WHERE ${ACESSO} AND strftime('%Y-%m-%d', em, '${TZ}') = ?) dia,
      (SELECT COUNT(DISTINCT user_id) FROM events WHERE ${ACESSO} AND em >= ?) semana,
      (SELECT COUNT(DISTINCT user_id) FROM events WHERE ${ACESSO} AND em >= ?) mes`, hoje, d7, d30);
  const uso = one(`SELECT COALESCE(SUM(minutos),0) minutos, COUNT(DISTINCT user_id) usuarios FROM usage_daily WHERE dia >= strftime('%Y-%m-%d', ?, '${TZ}')`, desde);
  const ev = Object.fromEntries(all(`SELECT tipo, COUNT(*) n FROM events WHERE em >= ? GROUP BY tipo`, desde).map(r => [r.tipo, r.n]));
  const offBytes = one(`SELECT COALESCE(SUM(CAST(json_extract(meta,'$.bytes') AS INTEGER)),0) b FROM events WHERE tipo='offline_download' AND em >= ?`, desde).b;

  // séries por dia
  const serie = {};
  for (let i = dias - 1; i >= 0; i--){
    const d = new Date(Date.now() - 3 * 3600e3 - i * 864e5).toISOString().slice(0, 10);
    serie[d] = { dia: d, novos: 0, acessos: 0, ativos: 0, minutos: 0 };
  }
  for (const r of all(`SELECT strftime('%Y-%m-%d', criado_em, '${TZ}') d, COUNT(*) n FROM users WHERE criado_em >= ? GROUP BY d`, desde)) if (serie[r.d]) serie[r.d].novos = r.n;
  for (const r of all(`SELECT strftime('%Y-%m-%d', em, '${TZ}') d, COUNT(*) n, COUNT(DISTINCT user_id) u FROM events WHERE ${ACESSO} AND em >= ? GROUP BY d`, desde)) if (serie[r.d]){ serie[r.d].acessos = r.n; serie[r.d].ativos = r.u; }
  for (const r of all(`SELECT dia d, SUM(minutos) m FROM usage_daily WHERE dia >= strftime('%Y-%m-%d', ?, '${TZ}') GROUP BY dia`, desde)) if (serie[r.d]) serie[r.d].minutos = r.m;

  const dist = (col, extra = '') => all(`SELECT COALESCE(${col}, 'nao_informado') k, COUNT(*) n FROM users WHERE role <> 'admin' ${extra} GROUP BY k ORDER BY n DESC`);
  const leads = one(`SELECT SUM(quente_desde IS NOT NULL) quentes,
      SUM(quente_desde IS NOT NULL AND contatado_em IS NULL AND status <> 'bloqueado') a_ligar,
      SUM(quente_desde IS NOT NULL AND contatado_em IS NULL AND status <> 'bloqueado' AND datetime(quente_desde, '+48 hours') < datetime('now')) atrasados,
      SUM(contatado_em IS NULL AND contato_ok = 1 AND role <> 'admin') sem_contato FROM users`);

  res.json({
    dias, usuarios, novos, ativos, uso, eventos: ev, offline_bytes: offBytes, leads,
    serie: Object.values(serie),
    origem: dist('origem'), perfil: dist('perfil'), funcao: dist('funcao'), area: dist('area_faixa'),
    uf: dist('uf').slice(0, 10),
    municipio: all(`SELECT municipio || '/' || uf k, COUNT(*) n FROM users WHERE municipio IS NOT NULL AND role <> 'admin' GROUP BY k ORDER BY n DESC LIMIT 10`),
    dispositivos: all(`SELECT dispositivo k, COUNT(DISTINCT user_id) n FROM events WHERE ${ACESSO} AND em >= ? GROUP BY k ORDER BY n DESC`, desde),
    instalado: all(`SELECT COALESCE(json_extract(meta,'$.display'),'navegador') k, COUNT(DISTINCT user_id) n FROM events WHERE tipo='app_open' AND em >= ? GROUP BY k`, desde),
    ultimos: all(`SELECT e.id, e.tipo, e.em, e.dispositivo, u.id user_id, u.nome FROM events e JOIN users u ON u.id = e.user_id WHERE e.${ACESSO.replace('tipo', 'tipo')} ORDER BY e.em DESC LIMIT 15`),
    top: all(`SELECT u.id, u.nome, u.empresa, SUM(d.minutos) minutos,
        (SELECT COUNT(*) FROM events e WHERE e.user_id = u.id AND e.${ACESSO} AND e.em >= ?) acessos
        FROM usage_daily d JOIN users u ON u.id = d.user_id WHERE d.dia >= strftime('%Y-%m-%d', ?, '${TZ}')
        GROUP BY u.id ORDER BY minutos DESC LIMIT 10`, desde, desde)
  });
});

const listaUsers = () => db.prepare(`SELECT u.*,
    (SELECT COUNT(*) FROM events e WHERE e.user_id = u.id AND e.tipo IN ('login','app_open')) acessos,
    (SELECT COALESCE(SUM(minutos),0) FROM usage_daily d WHERE d.user_id = u.id) minutos,
    (SELECT COUNT(*) FROM events e WHERE e.user_id = u.id AND e.tipo = 'map_import') mapas,
    (SELECT dispositivo FROM events e WHERE e.user_id = u.id ORDER BY em DESC LIMIT 1) ult_disp
    FROM users u ORDER BY u.criado_em DESC`).all().map(u => { delete u.senha_hash; u.interesses = JSON.parse(u.interesses || '[]'); return u; });

adm.get('/users', (req, res) => res.json({ users: listaUsers() }));

adm.get('/users/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(+req.params.id);
  if (!u) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  delete u.senha_hash; u.interesses = JSON.parse(u.interesses || '[]');
  res.json({
    user: u,
    eventos: db.prepare('SELECT tipo, em, dispositivo, meta FROM events WHERE user_id = ? ORDER BY em DESC LIMIT 150').all(u.id),
    uso: db.prepare('SELECT dia, minutos FROM usage_daily WHERE user_id = ? ORDER BY dia DESC LIMIT 60').all(u.id),
    sessoes: db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id = ? AND expira_em > ?').get(u.id, now()).n
  });
});

adm.patch('/users/:id', (req, res) => {
  const id = +req.params.id, b = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  const eu = id === req.user.id; const set = {};
  if ('status' in b){ if (eu) return res.status(400).json({ erro: 'Você não pode alterar o próprio status.' }); set.status = oneOf(b.status, ['ativo', 'pendente', 'bloqueado']); }
  if ('role' in b){ if (eu) return res.status(400).json({ erro: 'Você não pode alterar o próprio tipo de acesso.' }); set.role = oneOf(b.role, ['cliente', 'admin']); }
  if ('contatado' in b){ set.contatado_em = b.contatado ? now() : null; set.contatado_por = b.contatado ? req.user.nome : null; }
  if ('obs' in b) set.obs = str(b.obs, 2000) || null;
  for (const k of ['nome', 'empresa', 'municipio']) if (k in b) set[k] = str(b[k], 100) || null;
  if ('whatsapp' in b) set.whatsapp = b.whatsapp ? phone(b.whatsapp) : null;
  if ('perfil' in b) set.perfil = oneOf(b.perfil, PERFIS);
  if ('funcao' in b) set.funcao = oneOf(b.funcao, FUNCOES);
  if ('area_faixa' in b) set.area_faixa = oneOf(b.area_faixa, AREAS);
  if ('uf' in b) set.uf = oneOf(String(b.uf || '').toUpperCase(), UFS);
  for (const k in set) if (set[k] === null && ['status', 'role'].includes(k)) return res.status(400).json({ erro: 'Valor inválido.' });
  const keys = Object.keys(set);
  if (keys.length) db.prepare(`UPDATE users SET ${keys.map(k => k + ' = ?').join(', ')} WHERE id = ?`).run(...keys.map(k => set[k]), id);
  if (set.status === 'bloqueado') db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  atualizaQuente(id);
  res.json({ user: listaUsers().find(x => x.id === id) });
});

adm.post('/users/:id/senha', (req, res) => {
  const id = +req.params.id;
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  const nova = senhaTemporaria();
  db.prepare('UPDATE users SET senha_hash = ? WHERE id = ?').run(hashSenha(nova), id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  res.json({ senha: nova });
});

adm.delete('/users/:id', (req, res) => {
  const id = +req.params.id;
  if (id === req.user.id) return res.status(400).json({ erro: 'Você não pode excluir a própria conta.' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

adm.post('/users', (req, res) => {
  const b = req.body || {};
  const email = str(b.email, 190).toLowerCase(), nome = str(b.nome, 80);
  if (!nome) return res.status(400).json({ erro: 'Digite o nome.' });
  if (!emailOk(email)) return res.status(400).json({ erro: 'E-mail inválido.' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ erro: 'Este e-mail já tem cadastro.' });
  const senha = b.senha && senhaOk(b.senha) ? b.senha : senhaTemporaria();
  const r = db.prepare(`INSERT INTO users (nome, email, senha_hash, whatsapp, perfil, funcao, uf, municipio, empresa, role, status, criado_por, origem)
      VALUES (?,?,?,?,?,?,?,?,?,?, 'ativo', ?, 'equipe_mgeo')`)
    .run(nome, email, hashSenha(senha), b.whatsapp ? phone(b.whatsapp) : null, oneOf(b.perfil, PERFIS), oneOf(b.funcao, FUNCOES),
      oneOf(String(b.uf || '').toUpperCase(), UFS), str(b.municipio, 80) || null, str(b.empresa, 100) || null,
      b.role === 'admin' ? 'admin' : 'cliente', req.user.nome);
  res.json({ user: listaUsers().find(x => x.id === r.lastInsertRowid), senha });
});

adm.get('/eventos', (req, res) => {
  const lim = Math.min(500, +req.query.limit || 200), antes = +req.query.antes || 1e15;
  const tipo = req.query.tipo && /^[a-z_]+$/.test(req.query.tipo) ? req.query.tipo : null;
  const rows = db.prepare(`SELECT e.id, e.tipo, e.em, e.dispositivo, e.meta, u.id user_id, u.nome, u.empresa FROM events e
      LEFT JOIN users u ON u.id = e.user_id WHERE e.id < ? ${tipo ? 'AND e.tipo = ?' : ''} ORDER BY e.id DESC LIMIT ?`)
    .all(...[antes, tipo, lim].filter(x => x !== null));
  res.json({ eventos: rows });
});

adm.get('/config', (req, res) => res.json({ auto_aprovar: getConfig('auto_aprovar') === '1', email_configurado: !!mailer }));
adm.patch('/config', (req, res) => { if ('auto_aprovar' in (req.body || {})) setConfig('auto_aprovar', req.body.auto_aprovar ? '1' : '0'); res.json({ auto_aprovar: getConfig('auto_aprovar') === '1', email_configurado: !!mailer }); });

adm.get('/export.csv', (req, res) => {
  const cols = ['id', 'nome', 'email', 'whatsapp', 'perfil', 'funcao', 'municipio', 'uf', 'empresa', 'area_faixa', 'interesses', 'origem', 'origem_outro',
    'quente_desde', 'contatado_em', 'contatado_por', 'obs', 'status', 'role', 'contato_ok', 'termos_em', 'criado_em', 'ultimo_acesso', 'acessos', 'minutos', 'mapas'];
  const esc = v => `"${String(Array.isArray(v) ? v.join('; ') : v == null ? '' : v).replace(/"/g, '""')}"`;
  const csv = '\ufeff' + [cols.join(';'), ...listaUsers().map(u => cols.map(c => esc(u[c])).join(';'))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="usuarios-mgeo-pdf-${now().slice(0, 10)}.csv"`);
  res.send(csv);
});

api.use('/admin', adm);
app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ erro: 'Não encontrado.' }));

/* arquivos do app */
app.use(express.static(PUBLIC_DIR, {
  setHeaders(res, file){
    if (/\.(html|js|css|json|webmanifest)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
    else res.setHeader('Cache-Control', 'public, max-age=86400');
  }
}));
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

/* ADMs iniciais (senha vem da variável de ambiente, nunca do código) */
(function seed(){
  const emails = ADMINS_FIXOS;
  const pass = process.env.ADMIN_SEED_PASSWORD;
  for (const e of emails){
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(e);
    if (u){ if (u.role !== 'admin' || u.status !== 'ativo') db.prepare("UPDATE users SET role='admin', status='ativo' WHERE id = ?").run(u.id); continue; }
    if (!pass){ console.warn(`[MGEO] Defina ADMIN_SEED_PASSWORD para criar o ADM ${e}.`); continue; }
    db.prepare(`INSERT INTO users (nome, email, senha_hash, role, status, origem, criado_por) VALUES (?, ?, ?, 'admin', 'ativo', 'equipe_mgeo', 'sistema')`)
      .run(e.split('@')[0].replace(/^./, c => c.toUpperCase()) + ' (MGEO)', e, hashSenha(pass));
    console.log(`[MGEO] ADM criado: ${e}`);
  }
  // limpeza periódica
  setInterval(() => {
    db.prepare('DELETE FROM sessions WHERE expira_em < ?').run(now());
    db.prepare('DELETE FROM resets WHERE expira_em < ?').run(new Date(Date.now() - 864e5).toISOString());
  }, 6 * 3600e3).unref();
})();

app.listen(PORT, () => console.log(`[MGEO] MGEO PDF rodando na porta ${PORT}${mailer ? ' (e-mail ligado)' : ' (sem SMTP: recuperação de senha pelo ADM)'}`));
