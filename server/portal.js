'use strict';
/* MGEO PDF – login com o usuário do Portal MGEO (o mesmo Supabase do portal e do serviço de mapas dos clientes).
 *
 * Quem tem conta ATIVA no Portal MGEO entra no app com o mesmo e-mail e a mesma senha do portal.
 * O cadastro próprio do MGEO PDF continua funcionando para quem não tem conta no portal.
 *
 * Variáveis opcionais (EasyPanel → Ambiente):
 *   PORTAL_LOGIN        0 desliga o login pelo portal (padrão: ligado)
 *   PAPEIS_GERENCIAL    papéis do portal que entram no modo gerencial (padrão: admin,comercial)
 *   SUPABASE_URL        endereço do Supabase do portal (padrão: o mesmo do serviço de mapas)
 *   SUPABASE_ANON_KEY   chave pública (anon) do Supabase do portal
 */
const URL_PADRAO = 'https://supabase-supabase.yzw8ui.easypanel.host';
// chave pública "anon": é a mesma que vai dentro da tela de login do portal (não é segredo)
const CHAVE_PADRAO = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzA0MTUzNjAwLCJleHAiOjI1MjQ2MDgwMDB9.PiaHog57E3F8P-OqS3TfVfG6i9t_9T78-e5LhO_4Coo';

const ligado = String(process.env.PORTAL_LOGIN || '1') !== '0';
const base = () => String(process.env.SUPABASE_URL || URL_PADRAO).replace(/\/+$/, '');
const chave = () => process.env.SUPABASE_ANON_KEY || CHAVE_PADRAO;
const lista = t => String(t || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
const papeisGerencial = () => lista(process.env.PAPEIS_GERENCIAL || 'admin,comercial');
const gerencial = papel => papeisGerencial().includes(String(papel || '').toLowerCase());

async function pedir(caminho, opcoes){
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  try { return await fetch(base() + caminho, { ...opcoes, signal: ctl.signal }); }
  finally { clearTimeout(t); }
}

/* Confere e-mail e senha no Portal MGEO.
 * Devolve { ok:true, id, email, nome, papel } ou { ok:false, motivo, falha? }
 *   falha = true quando o portal não respondeu (fora do ar, sem rede) */
async function entrar(email, senha){
  if (!ligado || !email || !senha) return { ok: false, motivo: 'desligado' };
  let r;
  try {
    r = await pedir('/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: chave(), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, password: senha })
    });
  } catch (e) { return { ok: false, falha: true, motivo: 'portal sem resposta: ' + e.message }; }
  if (r.status === 400 || r.status === 401 || r.status === 422) return { ok: false, motivo: 'senha do portal incorreta' };
  if (!r.ok) return { ok: false, falha: true, motivo: 'portal respondeu ' + r.status };
  const s = await r.json().catch(() => null);
  const u = s && s.user;
  if (!s || !s.access_token || !u || !u.id) return { ok: false, falha: true, motivo: 'resposta inesperada do portal' };

  // mesmas regras do portal: perfil precisa existir e estar ativo
  let pf;
  try {
    const rp = await pedir('/rest/v1/perfis?select=papel,ativo,deleted_at&id=eq.' + encodeURIComponent(u.id), {
      headers: { apikey: chave(), Authorization: 'Bearer ' + s.access_token, Accept: 'application/json' }
    });
    if (!rp.ok) return { ok: false, falha: true, motivo: 'perfil: portal respondeu ' + rp.status };
    pf = (await rp.json())[0];
  } catch (e) { return { ok: false, falha: true, motivo: 'perfil: ' + e.message }; }
  if (!pf) return { ok: false, motivo: 'sem perfil no portal' };
  if (pf.ativo === false || pf.deleted_at) return { ok: false, motivo: 'usuario inativo no portal', inativo: true };

  const md = u.user_metadata || {};
  const nome = String(md.nome || md.full_name || md.name || '').trim().slice(0, 80);
  return { ok: true, id: u.id, email: String(u.email || email).toLowerCase(), nome, papel: String(pf.papel || '') };
}

module.exports = { entrar, gerencial, ligado };
