/* MGEO PDF – login, cadastro (LGPD), perfil e painel ADM master */
'use strict';
(function(){
  const CFG = window.MGEO_CONFIG || {};
  const configured = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && !/SEU-PROJETO|COLE_AQUI/.test(CFG.supabaseUrl + CFG.supabaseAnonKey));
  const OFFLINE_DAYS = CFG.offlineDays || 30;
  const CHANNEL = CFG.otpChannel || 'whatsapp';
  const sb = configured && window.supabase ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
    auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:false, storageKey:'mgeo-auth' }
  }) : null;

  const PERFIS = { usina:'Usina', fornecedor:'Fornecedor', produtor:'Produtor', consultor:'Consultor', outro:'Outro' };
  const FUNCOES = { gerente:'Gerente', supervisor:'Supervisor', tecnico:'Técnico', operador:'Operador' };
  const AREAS = { ate_500:'Até 500 ha', '500_1000':'500 a 1.000 ha', '1000_5000':'1.000 a 5.000 ha', '5000_20000':'5.000 a 20.000 ha', acima_20000:'Acima de 20.000 ha' };
  const INTERESSES = ['Mapeamento de falhas', 'Imagens de drone', 'Índices de vegetação (NDVI)', 'Topografia e sistematização', 'Georreferenciamento', 'Contagem de plantas', 'Outro'];
  const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');

  const A = window.MGEO_AUTH = { profile:null, offline:false };
  const h = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  const digits = s => String(s || '').replace(/\D/g, '');
  function maskPhone(v){
    let d = digits(v); if (d.startsWith('55') && d.length > 11) d = d.slice(2); d = d.slice(0, 11);
    if (d.length <= 2) return d ? `(${d}` : '';
    if (d.length <= 6) return `(${d.slice(0,2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
    return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  }
  function e164(v){ let d = digits(v); if (d.startsWith('55') && d.length > 11) d = d.slice(2); return (d.length === 10 || d.length === 11) ? '+55' + d : null; }
  const prettyPhone = e => { const d = digits(e); return d.startsWith('55') ? '+55 ' + maskPhone(d.slice(2)) : (e || ''); };
  const initials = n => (String(n || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('') || '?').toUpperCase();
  const fmtDT = t => t ? new Date(t).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '–';
  const withTimeout = (p, ms) => Promise.race([Promise.resolve(p), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  const isNet = e => !navigator.onLine || /fetch|network|timeout|Failed|Load failed/i.test((e && (e.message || e.name)) || '');

  function errMsg(e){
    const m = (e && (e.message || e.error_description || e.msg)) || String(e || '');
    if (isNet(e)) return 'Sem conexão com a internet. Tente de novo.';
    if (/only request this after|rate limit|too many/i.test(m)) return 'Muitas tentativas. Aguarde um minuto e peça outro código.';
    if (/expired|invalid.*(otp|token)|token.*invalid/i.test(m)) return 'Código inválido ou vencido. Confira ou peça outro.';
    if (/Invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
    if (/Signups not allowed|User not found/i.test(m)) return 'Este número ainda não tem cadastro. Toque em “Criar conta grátis”.';
    if (/provider|sms|twilio|whatsapp/i.test(m)) return 'O envio do código pelo WhatsApp ainda não foi configurado no servidor da MGEO.';
    if (/Email not confirmed/i.test(m)) return 'Este e-mail ainda não foi confirmado.';
    if (/already registered|already exists/i.test(m)) return 'Este e-mail já tem cadastro.';
    if (/Password should be/i.test(m)) return 'A senha precisa ter pelo menos 8 caracteres.';
    return m || 'Algo deu errado. Tente de novo.';
  }

  /* ---------- cache para uso offline ---------- */
  const CK = 'mgeo:auth-cache';
  function readCache(){ try { return JSON.parse(localStorage.getItem(CK)); } catch(_){ return null; } }
  function writeCache(p){ try { localStorage.setItem(CK, JSON.stringify({ profile:p, at:Date.now() })); } catch(_){} }
  function clearCache(){ try { localStorage.removeItem(CK); } catch(_){} }
  const cacheOk = c => c && c.profile && c.profile.status === 'ativo' && (Date.now() - c.at) < OFFLINE_DAYS * 864e5;

  /* ---------- tela de entrada ---------- */
  const topo = `<svg class="topo" viewBox="0 0 340 340" fill="none" stroke="#F2C230" stroke-opacity=".22" stroke-width="1.4">
    ${[150,128,106,84,62,40].map((r,i)=>`<path d="M${170-r} ${170+i*3}c0-${r*.6} ${r*.5}-${r} ${r}-${r}s${r} ${r*.45} ${r} ${r}-${r*.4} ${r*.95}-${r} ${r*.95}-${r}-${r*.35}-${r}-${r*.95}Z"/>`).join('')}</svg>`;
  const logoSvg = `<svg width="26" height="31" viewBox="0 0 20 24"><path d="M10 0C4.5 0 0 4.4 0 9.8 0 16.6 10 24 10 24s10-7.4 10-14.2C20 4.4 15.5 0 10 0Z" fill="#F2C230"/><circle cx="10" cy="9.6" r="3.9" fill="#0B1F1A"/></svg>`;
  const auth = document.createElement('div');
  auth.className = 'auth'; auth.id = 'auth';
  auth.innerHTML = `<div class="auth-hero">${topo}<div class="auth-logo">${logoSvg}</div>
      <h1>MGEO PDF</h1><p>Seus GeoPDFs no campo, com GPS em tempo real e sem precisar de internet.</p>
      <span class="auth-free">✓ Grátis para usar</span></div>
    <div class="auth-card"><div class="auth-inner" id="authBody"></div></div>`;
  document.body.appendChild(auth);
  const body = auth.querySelector('#authBody');
  const card = auth.querySelector('.auth-card');
  function view(html){ body.innerHTML = html; card.scrollTop = 0; auth.hidden = false; }
  const backBtn = to => `<button class="back" data-go="${to}">‹ Voltar</button>`;
  body.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) routes[g.dataset.go](); });

  let otp = { phone:null, meta:null, timer:null, left:0 };

  const routes = {
    loading(){ view(`<div class="adm-load"><div class="spin"></div>Carregando…</div>`); },
    setup(){
      view(`<div class="state-ico">⚙️</div><h2>Falta ligar o servidor</h2>
        <p class="sub">Para o login funcionar, preencha o arquivo <b>config.js</b> com o endereço e a chave pública do Supabase. O passo a passo está no LEIA-ME.</p>`);
    },
    welcome(){
      view(`<h2>Bem-vindo</h2><p class="sub">Crie sua conta em 1 minuto. O código de acesso chega no seu WhatsApp.</p>
        <div class="auth-big">
          <button class="btn btn-signal wide" data-go="signup">Criar conta grátis</button>
          <button class="btn btn-ghost wide" data-go="login">Já tenho conta</button>
        </div>
        <p class="auth-alt">Equipe MGEO ou login criado pelo ADM? <button class="link" data-go="email">Entrar com e-mail</button></p>`);
    },
    signup(){
      view(`${backBtn('welcome')}<div class="steps"><i class="on"></i><i></i></div>
        <h2>Criar conta</h2><p class="sub">Todos os campos são obrigatórios.</p>
        <label class="field"><span>Nome completo</span><input class="input" id="suNome" autocomplete="name" maxlength="80"></label>
        <label class="field"><span>WhatsApp</span><input class="input num" id="suTel" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="(18) 99999-9999"></label>
        <div class="field"><span>Perfil</span><div class="chips" id="suPerfil">${Object.entries(PERFIS).map(([k,v])=>`<button type="button" data-v="${k}">${v}</button>`).join('')}</div></div>
        <div class="field"><span>Função</span><div class="chips" id="suFuncao">${Object.entries(FUNCOES).map(([k,v])=>`<button type="button" data-v="${k}">${v}</button>`).join('')}</div></div>
        <div class="two">
          <label class="field"><span>UF</span><select class="input" id="suUf"><option value="">UF</option>${UFS.map(u=>`<option>${u}</option>`).join('')}</select></label>
          <label class="field"><span>Município</span><input class="input" id="suMun" list="munList" autocomplete="address-level2" maxlength="80"></label>
        </div>
        <datalist id="munList"></datalist>
        <label class="check"><input type="checkbox" id="suLgpd"><span>Aceito que a MGEO entre em contato comercial comigo pelo WhatsApp e trate meus dados conforme a <a href="privacidade.html" target="_blank" rel="noopener">Política de Privacidade</a> (LGPD). Posso cancelar quando quiser.</span></label>
        <div class="err" id="suErr"></div>
        <button class="btn btn-primary wide" id="suGo">Receber código no WhatsApp</button>`);
      const tel = body.querySelector('#suTel');
      tel.addEventListener('input', () => tel.value = maskPhone(tel.value));
      ['#suPerfil', '#suFuncao'].forEach(id => body.querySelector(id).addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        body.querySelectorAll(id + ' button').forEach(x => x.classList.toggle('sel', x === b));
      }));
      body.querySelector('#suUf').addEventListener('change', e => loadMunicipios(e.target.value));
      body.querySelector('#suGo').onclick = async () => {
        const v = id => body.querySelector(id).value.trim();
        const sel = id => { const b = body.querySelector(id + ' .sel'); return b ? b.dataset.v : ''; };
        const meta = { nome:v('#suNome'), perfil:sel('#suPerfil'), funcao:sel('#suFuncao'), uf:v('#suUf'), municipio:v('#suMun'), lgpd: body.querySelector('#suLgpd').checked ? 'true' : 'false' };
        const phone = e164(v('#suTel'));
        const err = body.querySelector('#suErr');
        if (meta.nome.split(/\s+/).length < 2) return err.textContent = 'Digite nome e sobrenome.';
        if (!phone) return err.textContent = 'Digite o WhatsApp com DDD.';
        if (!meta.perfil) return err.textContent = 'Escolha o seu perfil.';
        if (!meta.funcao) return err.textContent = 'Escolha a sua função.';
        if (!meta.uf || !meta.municipio) return err.textContent = 'Informe a UF e o município.';
        if (meta.lgpd !== 'true') return err.textContent = 'Para continuar, aceite o contato e a política de privacidade.';
        await sendCode(phone, meta, err, body.querySelector('#suGo'));
      };
    },
    login(){
      view(`${backBtn('welcome')}<h2>Entrar</h2><p class="sub">Digite seu WhatsApp. Vamos enviar um código de 6 números.</p>
        <label class="field"><span>WhatsApp</span><input class="input num" id="liTel" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="(18) 99999-9999"></label>
        <div class="err" id="liErr"></div>
        <button class="btn btn-primary wide" id="liGo">Receber código no WhatsApp</button>
        <p class="auth-alt"><button class="link" data-go="email">Entrar com e-mail e senha</button></p>`);
      const tel = body.querySelector('#liTel');
      tel.addEventListener('input', () => tel.value = maskPhone(tel.value));
      body.querySelector('#liGo').onclick = async () => {
        const phone = e164(tel.value), err = body.querySelector('#liErr');
        if (!phone) return err.textContent = 'Digite o WhatsApp com DDD.';
        await sendCode(phone, null, err, body.querySelector('#liGo'));
      };
    },
    code(){
      view(`${backBtn(otp.meta ? 'signup' : 'login')}<div class="steps"><i class="on"></i><i class="on"></i></div>
        <h2>Digite o código</h2><p class="sub">Enviamos um código pelo WhatsApp para <b class="num">${h(prettyPhone(otp.phone))}</b>.</p>
        <label class="field"><span>Código</span><input class="input otp num" id="cdCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label>
        <div class="err" id="cdErr"></div>
        <button class="btn btn-primary wide" id="cdGo">Confirmar</button>
        <p class="auth-alt num" id="cdAgain"></p>`);
      const code = body.querySelector('#cdCode'), err = body.querySelector('#cdErr'), go = body.querySelector('#cdGo');
      code.focus();
      const verify = async () => {
        const t = digits(code.value); if (t.length !== 6) return err.textContent = 'O código tem 6 números.';
        go.disabled = true; err.textContent = '';
        try {
          const { data, error } = await sb.auth.verifyOtp({ phone:otp.phone, token:t, type:'sms' });
          if (error) throw error;
          clearInterval(otp.timer);
          await afterLogin(data.user);
        } catch(e){ err.textContent = errMsg(e); go.disabled = false; }
      };
      code.addEventListener('input', () => { code.value = digits(code.value).slice(0, 6); if (code.value.length === 6) verify(); });
      go.onclick = verify;
      tickResend();
    },
    email(){
      view(`${backBtn('welcome')}<h2>Entrar com e-mail</h2><p class="sub">Para a equipe MGEO e logins criados pelo administrador.</p>
        <label class="field"><span>E-mail</span><input class="input" id="emMail" type="email" autocomplete="username" inputmode="email"></label>
        <label class="field"><span>Senha</span><input class="input" id="emPass" type="password" autocomplete="current-password"></label>
        <div class="err" id="emErr"></div>
        <button class="btn btn-primary wide" id="emGo">Entrar</button>`);
      const go = body.querySelector('#emGo'), err = body.querySelector('#emErr');
      const run = async () => {
        const email = body.querySelector('#emMail').value.trim().toLowerCase(), password = body.querySelector('#emPass').value;
        if (!email || !password) return err.textContent = 'Preencha e-mail e senha.';
        go.disabled = true; err.textContent = '';
        try {
          const { data, error } = await sb.auth.signInWithPassword({ email, password });
          if (error) throw error;
          await afterLogin(data.user);
        } catch(e){ err.textContent = errMsg(e); go.disabled = false; }
      };
      go.onclick = run;
      body.querySelector('#emPass').addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
    },
    pending(){
      view(`<div class="state-ico">⏳</div><h2>Cadastro em análise</h2>
        <p class="sub">Seu acesso será liberado pela equipe MGEO em breve. Você recebe um aviso pelo WhatsApp.</p>
        <div class="err" id="pdErr"></div>
        <button class="btn btn-primary wide" id="pdAgain">Verificar de novo</button>
        <p class="auth-alt"><button class="link" id="pdOut">Sair</button></p>`);
      body.querySelector('#pdAgain').onclick = () => boot();
      body.querySelector('#pdOut').onclick = logout;
    },
    blocked(){
      view(`<div class="state-ico">🔒</div><h2>Acesso bloqueado</h2>
        <p class="sub">Seu acesso ao MGEO PDF foi suspenso. Fale com a equipe MGEO para saber mais.</p>
        <button class="btn btn-ghost wide" id="bkOut">Sair</button>`);
      body.querySelector('#bkOut').onclick = logout;
    },
    offlineFirst(){
      view(`<div class="state-ico">📶</div><h2>Sem internet</h2>
        <p class="sub">No primeiro acesso é preciso estar conectado para entrar. Depois o app funciona offline por até ${OFFLINE_DAYS} dias seguidos.</p>
        <button class="btn btn-primary wide" id="ofAgain">Tentar de novo</button>`);
      body.querySelector('#ofAgain').onclick = () => boot();
    }
  };

  async function loadMunicipios(uf){
    const dl = body.querySelector('#munList'); if (!dl || !uf) return;
    const key = 'mgeo:mun:' + uf;
    let list = null;
    try { list = JSON.parse(localStorage.getItem(key)); } catch(_){}
    if (!list){
      try {
        const r = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`);
        list = (await r.json()).map(m => m.nome); localStorage.setItem(key, JSON.stringify(list));
      } catch(_){ list = []; }
    }
    dl.innerHTML = list.map(n => `<option value="${h(n)}">`).join('');
  }

  async function sendCode(phone, meta, err, btn){
    btn.disabled = true; err.textContent = '';
    try {
      const options = { channel:CHANNEL, shouldCreateUser:!!meta };
      if (meta) options.data = meta;
      const { error } = await sb.auth.signInWithOtp({ phone, options });
      if (error) throw error;
      otp.phone = phone; otp.meta = meta; otp.left = 60;
      routes.code();
    } catch(e){ err.textContent = errMsg(e); btn.disabled = false; }
  }
  function tickResend(){
    clearInterval(otp.timer);
    const el = () => body.querySelector('#cdAgain');
    const paint = () => {
      const p = el(); if (!p){ clearInterval(otp.timer); return; }
      if (otp.left > 0) p.textContent = `Reenviar código em ${otp.left} s`;
      else { p.innerHTML = `Não chegou? <button class="link" id="cdResend">Reenviar código</button>`;
        p.querySelector('#cdResend').onclick = async () => {
          try { const { error } = await sb.auth.signInWithOtp({ phone:otp.phone, options:{ channel:CHANNEL, shouldCreateUser:!!otp.meta, data:otp.meta || undefined } }); if (error) throw error; otp.left = 60; tickResend(); toast('Código reenviado'); }
          catch(e){ body.querySelector('#cdErr').textContent = errMsg(e); }
        };
        clearInterval(otp.timer); }
    };
    paint(); otp.timer = setInterval(() => { otp.left--; paint(); }, 1000);
  }

  /* ---------- sessão ---------- */
  async function fetchProfile(uid){
    const { data, error } = await withTimeout(sb.from('profiles').select('*').eq('id', uid).maybeSingle(), 9000);
    if (error) throw error;
    return data;
  }
  async function afterLogin(user){
    routes.loading();
    try {
      let p = null;
      for (let i = 0; i < 3 && !p; i++){ p = await fetchProfile(user.id); if (!p) await new Promise(r => setTimeout(r, 800)); }
      if (!p) throw new Error('Perfil não encontrado. Rode o script do banco (schema.sql).');
      enter(p, false);
      sb.from('profiles').update({ ultimo_acesso:new Date().toISOString() }).eq('id', user.id).then(() => {}, () => {});
    } catch(e){
      if (isNet(e)){ const c = readCache(); if (cacheOk(c) && c.profile.id === user.id) return enter(c.profile, true); }
      view(`<div class="state-ico">⚠️</div><h2>Não deu para entrar</h2><p class="sub">${h(errMsg(e))}</p><button class="btn btn-primary wide" data-go="welcome">Voltar</button>`);
    }
  }
  function enter(p, offline){
    A.profile = p; A.offline = offline;
    if (!offline) writeCache(p);
    if (p.status === 'bloqueado'){ clearCache(); return routes.blocked(); }
    if (p.status === 'pendente') return routes.pending();
    auth.hidden = true;
    paintMe();
    if (typeof window.startApp === 'function') window.startApp();
    if (offline) toast('Modo offline: seus mapas continuam disponíveis');
  }
  async function boot(){
    routes.loading();
    if (!configured || !sb){ routes.setup(); return; }
    const c = readCache();
    let session = null, failed = false;
    try {
      const r = await withTimeout(sb.auth.getSession(), 6000);
      session = r.data && r.data.session; if (r.error) failed = isNet(r.error) || true;
    } catch(e){ failed = true; }
    if (session) return afterLogin(session.user);
    if ((failed || !navigator.onLine) && cacheOk(c)) return enter(c.profile, true);
    if (!navigator.onLine) return routes.offlineFirst();
    routes.welcome();
  }
  async function logout(){
    try { await withTimeout(sb.auth.signOut({ scope: navigator.onLine ? 'global' : 'local' }), 5000); } catch(_){ try { await sb.auth.signOut({ scope:'local' }); } catch(__){} }
    clearCache(); location.reload();
  }
  // revalida o acesso quando a internet volta (pega bloqueios)
  async function revalidate(){
    if (!sb || !A.profile || !navigator.onLine) return;
    try {
      const p = await fetchProfile(A.profile.id);
      if (!p) return;
      A.profile = p; A.offline = false; writeCache(p); paintMe();
      if (p.status === 'bloqueado'){ clearCache(); routes.blocked(); }
      else if (p.status === 'pendente') routes.pending();
    } catch(_){}
  }
  addEventListener('online', revalidate);
  setInterval(revalidate, 10 * 60 * 1000);

  /* ---------- meu perfil ---------- */
  const meBtn = document.getElementById('btnMe');
  const sheetMe = document.createElement('section');
  sheetMe.className = 'sheet'; sheetMe.id = 'sheetMe'; sheetMe.setAttribute('aria-label', 'Meu perfil');
  document.body.appendChild(sheetMe);
  const incomplete = p => p && (!p.empresa || !p.area_faixa || !(p.interesses && p.interesses.length));

  function paintMe(){
    const p = A.profile; if (!p) return;
    meBtn.hidden = false;
    meBtn.querySelector('#meInitials').textContent = initials(p.nome);
    meBtn.classList.toggle('is-adm', p.role === 'admin');
    // aviso para completar o perfil na lista de mapas
    let n = document.getElementById('nudge');
    if (incomplete(p) && p.role !== 'admin'){
      if (!n){
        n = document.createElement('button'); n.className = 'nudge'; n.id = 'nudge';
        n.innerHTML = `<span style="font-size:22px">📋</span><span><b>Complete seu perfil</b>Empresa, área e serviços de interesse. Leva 30 segundos.</span>`;
        n.onclick = () => openMe();
        const lib = document.querySelector('#sheetLib .sheet-body'); lib.insertBefore(n, lib.firstChild);
      }
    } else if (n) n.remove();
  }
  function openMe(){
    const p = A.profile; if (!p) return;
    const sel = new Set(p.interesses || []);
    sheetMe.innerHTML = `<div class="grab"></div>
      <div class="sheet-head"><h2>Meu perfil</h2></div>
      <div class="sheet-body">
        <div class="me-head"><div class="avatar">${h(initials(p.nome))}</div><div><b>${h(p.nome)}</b>
          <span class="num">${h(p.whatsapp ? prettyPhone(p.whatsapp) : (p.email || ''))}</span>
          <span>${h([PERFIS[p.perfil], FUNCOES[p.funcao], p.municipio && (p.municipio + '/' + (p.uf || ''))].filter(Boolean).join(' · '))}</span></div></div>
        ${p.role === 'admin' ? `<button class="row row-btn" id="meAdm"><div><b>Painel ADM</b><small>Usuários, leads quentes e novos logins</small></div><span class="tag adm">ADM</span></button>` : ''}
        <div class="label">Sobre sua empresa</div>
        <label class="field"><span>Empresa</span><input class="input" id="meEmp" maxlength="100" value="${h(p.empresa || '')}"></label>
        <div class="field"><span>Área cultivada</span><div class="chips" id="meArea">${Object.entries(AREAS).map(([k,v])=>`<button data-v="${k}" class="${p.area_faixa === k ? 'sel' : ''}">${v}</button>`).join('')}</div></div>
        <div class="field"><span>Serviços de interesse</span><div class="chips" id="meInt">${INTERESSES.map(v=>`<button data-v="${h(v)}" class="${sel.has(v) ? 'sel' : ''}">${h(v)}</button>`).join('')}</div></div>
        <div class="err" id="meErr"></div>
        <button class="btn btn-primary wide" id="meSave" ${A.offline || !navigator.onLine ? 'disabled' : ''}>${A.offline || !navigator.onLine ? 'Conecte-se para salvar' : 'Salvar'}</button>
        <div class="label">Conta</div>
        <button class="row row-btn" id="meOut"><div>Sair desta conta<small>Seus mapas continuam salvos neste celular</small></div></button>
        <p class="hint" style="margin-top:12px">Seus dados são protegidos pela LGPD. <a class="link" href="privacidade.html" target="_blank" rel="noopener">Política de privacidade</a></p>
      </div>`;
    sheetMe.querySelector('#meArea').onclick = e => { const b = e.target.closest('button'); if (!b) return; sheetMe.querySelectorAll('#meArea button').forEach(x => x.classList.toggle('sel', x === b)); };
    sheetMe.querySelector('#meInt').onclick = e => { const b = e.target.closest('button'); if (b) b.classList.toggle('sel'); };
    sheetMe.querySelector('#meOut').onclick = () => { if (confirm('Sair da sua conta? Os mapas baixados continuam no celular.')) logout(); };
    const adm = sheetMe.querySelector('#meAdm'); if (adm) adm.onclick = () => { closeSheets(); openAdmin(); };
    sheetMe.querySelector('#meSave').onclick = async () => {
      const btn = sheetMe.querySelector('#meSave'), err = sheetMe.querySelector('#meErr');
      const areaB = sheetMe.querySelector('#meArea .sel');
      const patch = { empresa: sheetMe.querySelector('#meEmp').value.trim() || null, area_faixa: areaB ? areaB.dataset.v : null,
        interesses: [...sheetMe.querySelectorAll('#meInt .sel')].map(b => b.dataset.v) };
      btn.disabled = true; err.textContent = '';
      try {
        const { data, error } = await sb.from('profiles').update(patch).eq('id', p.id).select().maybeSingle();
        if (error) throw error;
        A.profile = data || Object.assign(p, patch); writeCache(A.profile); paintMe();
        toast('Perfil salvo. Obrigado!'); closeSheets();
      } catch(e){ err.textContent = errMsg(e); btn.disabled = false; }
    };
    openSheet('#sheetMe');
  }
  meBtn.onclick = openMe;

  /* ---------- painel ADM ---------- */
  const adm = document.createElement('div');
  adm.className = 'admp'; adm.id = 'adm'; adm.hidden = true;
  adm.innerHTML = `<div class="adm-top"><div class="adm-bar">
      <button class="icon-btn" id="admClose" aria-label="Fechar painel"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg></button>
      <h2>Painel ADM</h2>
      <button class="icon-btn" id="admReload" aria-label="Atualizar"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/></svg></button>
    </div>
    <div class="adm-tabs"><button data-t="users" class="sel">Usuários</button><button data-t="new">Novo login</button><button data-t="cfg">Ajustes</button></div></div>
    <div class="adm-body"><div class="adm-wrap" id="admBody"></div></div>`;
  document.body.appendChild(adm);
  const admBody = adm.querySelector('#admBody');
  let users = [], cfg = null, tab = 'users', filter = 'todos', term = '';

  adm.querySelector('#admClose').onclick = () => { adm.hidden = true; };
  adm.querySelector('#admReload').onclick = () => loadUsers();
  adm.querySelector('.adm-tabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; tab = b.dataset.t;
    adm.querySelectorAll('.adm-tabs button').forEach(x => x.classList.toggle('sel', x === b)); renderAdm(); };

  async function openAdmin(){
    if (!A.profile || A.profile.role !== 'admin') return;
    adm.hidden = false;
    if (!navigator.onLine){ admBody.innerHTML = `<div class="adm-load">O painel precisa de internet.</div>`; return; }
    await loadUsers();
  }
  async function loadUsers(){
    admBody.innerHTML = `<div class="adm-load"><div class="spin"></div>Carregando usuários…</div>`;
    try {
      const [u, c] = await Promise.all([
        sb.from('profiles').select('*').order('criado_em', { ascending:false }).limit(5000),
        sb.from('app_config').select('*').eq('id', 1).maybeSingle()
      ]);
      if (u.error) throw u.error;
      users = u.data || []; cfg = c.data || { auto_aprovar:true };
      renderAdm();
    } catch(e){ admBody.innerHTML = `<div class="adm-load">${h(errMsg(e))}</div>`; }
  }
  const deadline = u => u.quente_desde ? new Date(u.quente_desde).getTime() + 48 * 3600e3 : null;
  const toCall = u => !!(u.quente && !u.contatado_em && u.status !== 'bloqueado');

  function renderAdm(){ ({ users:renderUsers, new:renderNew, cfg:renderCfg })[tab](); }

  function renderUsers(){
    const now = Date.now(), week = now - 7 * 864e5;
    const verified = users.filter(u => u.verificado || u.role === 'admin' || u.email);
    const stats = { total:verified.length, hot:users.filter(toCall).length, pend:users.filter(u => u.status === 'pendente' && (u.verificado || u.email)).length,
      novos:verified.filter(u => new Date(u.criado_em).getTime() > week).length };
    const F = {
      todos: u => u.verificado || u.role === 'admin' || u.email,
      quentes: u => u.quente,
      pendentes: u => u.status === 'pendente',
      bloqueados: u => u.status === 'bloqueado',
      adm: u => u.role === 'admin',
      naover: u => !u.verificado && !u.email
    };
    const t = term.toLowerCase();
    let list = users.filter(F[filter]).filter(u => !t || [u.nome, u.whatsapp, u.email, u.municipio, u.empresa].some(x => (x || '').toLowerCase().includes(t)));
    list.sort((a, b) => (toCall(b) - toCall(a)) || (toCall(a) ? (deadline(a) || 0) - (deadline(b) || 0) : 0) || (new Date(b.criado_em) - new Date(a.criado_em)));
    admBody.innerHTML = `
      <div class="stats num">
        <div class="stat hot"><b>${stats.hot}</b><span>🔥 Quentes a ligar</span></div>
        <div class="stat"><b>${stats.novos}</b><span>Novos (7 dias)</span></div>
        <div class="stat"><b>${stats.pend}</b><span>Pendentes</span></div>
        <div class="stat"><b>${stats.total}</b><span>Total</span></div>
      </div>
      <input class="input search" id="admSearch" placeholder="Buscar nome, WhatsApp, cidade, empresa…" value="${h(term)}">
      <div class="chips filters" id="admFilters">
        ${[['todos','Todos'],['quentes','🔥 Quentes'],['pendentes','Pendentes'],['bloqueados','Bloqueados'],['adm','ADMs'],['naover','Não verificados']].map(([k,v])=>`<button data-f="${k}" class="${filter===k?'sel':''}">${v}</button>`).join('')}
      </div>
      <div id="admList">${list.length ? list.map(userCard).join('') : `<div class="adm-load">Nenhum usuário aqui.</div>`}</div>`;
    const s = admBody.querySelector('#admSearch');
    s.oninput = () => { term = s.value; const pos = s.selectionStart; renderUsers(); const n = admBody.querySelector('#admSearch'); n.focus(); n.setSelectionRange(pos, pos); };
    admBody.querySelector('#admFilters').onclick = e => { const b = e.target.closest('button'); if (b){ filter = b.dataset.f; renderUsers(); } };
    admBody.querySelector('#admList').onclick = onUserAction;
  }
  function userCard(u){
    const me = A.profile && u.id === A.profile.id;
    const dl = deadline(u), late = toCall(u) && dl && Date.now() > dl;
    const tags = [];
    if (u.quente) tags.push(`<span class="tag hot">🔥 Quente</span>`);
    if (toCall(u) && dl) tags.push(`<span class="tag ${late ? 'late' : 'hot'}">${late ? 'Atrasado' : 'Ligar até'} ${fmtDT(dl)}</span>`);
    if (u.contatado_em) tags.push(`<span class="tag ok">Contatado</span>`);
    if (u.role === 'admin') tags.push(`<span class="tag adm">ADM</span>`);
    if (u.status === 'pendente') tags.push(`<span class="tag pend">Pendente</span>`);
    if (u.status === 'bloqueado') tags.push(`<span class="tag blk">Bloqueado</span>`);
    if (!u.verificado && !u.email) tags.push(`<span class="tag unv">Não verificado</span>`);
    const wa = digits(u.whatsapp);
    const msg = encodeURIComponent(`Olá ${String(u.nome || '').split(' ')[0]}, aqui é da MGEO Tecnologia. Vi seu cadastro no MGEO PDF e queria conversar sobre ${u.interesses && u.interesses.length ? u.interesses[0].toLowerCase() : 'nossos serviços'}.`);
    return `<div class="ucard ${late ? 'late' : toCall(u) ? 'hot' : ''}">
      <div class="u-top"><b>${h(u.nome)}${me ? ' (você)' : ''}</b><div class="u-tags">${tags.join('')}</div></div>
      <div class="u-line">${h([PERFIS[u.perfil], FUNCOES[u.funcao]].filter(Boolean).join(' · ') || 'Perfil não informado')}${u.municipio ? ' · ' + h(u.municipio) + '/' + h(u.uf || '') : ''}</div>
      <div class="u-line"><strong>${h(u.empresa || 'Empresa não informada')}</strong> · ${h(AREAS[u.area_faixa] || 'área não informada')}</div>
      ${u.interesses && u.interesses.length ? `<div class="u-line">Interesse: ${h(u.interesses.join(', '))}</div>` : ''}
      <div class="u-line num">${u.email ? h(u.email) + ' · ' : ''}Cadastro ${fmtDT(u.criado_em)} · Último acesso ${fmtDT(u.ultimo_acesso)}${u.lgpd_aceite ? ' · LGPD ✓' : ''}${u.contatado_em ? ' · Contatado ' + fmtDT(u.contatado_em) : ''}</div>
      ${wa ? `<a class="u-wa num" href="https://wa.me/${wa}?text=${msg}" target="_blank" rel="noopener">WhatsApp ${h(prettyPhone(u.whatsapp))}</a>` : ''}
      <div class="u-actions" data-id="${u.id}">
        ${u.status !== 'ativo' ? `<button class="good" data-a="ativar">Liberar acesso</button>` : ''}
        ${u.status !== 'bloqueado' && !me ? `<button class="danger" data-a="bloquear">Bloquear</button>` : ''}
        ${u.quente || u.contatado_em ? `<button data-a="contato">${u.contatado_em ? 'Desmarcar contato' : 'Marcar como contatado'}</button>` : ''}
        ${!me ? `<button data-a="role">${u.role === 'admin' ? 'Remover ADM' : 'Tornar ADM'}</button>` : ''}
      </div></div>`;
  }
  async function onUserAction(e){
    const b = e.target.closest('[data-a]'); if (!b) return;
    const id = b.parentElement.dataset.id, u = users.find(x => x.id === id); if (!u) return;
    let patch = null;
    if (b.dataset.a === 'ativar') patch = { status:'ativo' };
    if (b.dataset.a === 'bloquear'){ if (!confirm(`Bloquear o acesso de ${u.nome}?`)) return; patch = { status:'bloqueado' }; }
    if (b.dataset.a === 'contato') patch = { contatado_em: u.contatado_em ? null : new Date().toISOString() };
    if (b.dataset.a === 'role'){
      const to = u.role === 'admin' ? 'cliente' : 'admin';
      if (!confirm(to === 'admin' ? `Dar acesso de ADM master para ${u.nome}? Ele verá todos os dados.` : `Remover o ADM de ${u.nome}?`)) return;
      patch = { role:to };
    }
    b.disabled = true;
    try {
      const { data, error } = await sb.from('profiles').update(patch).eq('id', id).select().maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Sem permissão para alterar este usuário.');
      Object.assign(u, data); renderUsers(); toast('Atualizado');
    } catch(err){ toast(errMsg(err), true); b.disabled = false; }
  }

  function strongPass(){
    const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#%&*';
    const a = new Uint32Array(12); crypto.getRandomValues(a);
    return Array.from(a, n => c[n % c.length]).join('') + '9a';
  }
  function renderNew(){
    admBody.innerHTML = `<p class="hint">Cria um login com e-mail e senha, já liberado. A pessoa entra em “Entrar com e-mail”.</p>
      <label class="field"><span>Nome completo</span><input class="input" id="nwNome" maxlength="80"></label>
      <label class="field"><span>E-mail</span><input class="input" id="nwMail" type="email" inputmode="email" autocomplete="off"></label>
      <label class="field"><span>Senha</span><input class="input num" id="nwPass" value="${strongPass()}" autocomplete="new-password"></label>
      <label class="field"><span>WhatsApp (opcional)</span><input class="input num" id="nwTel" type="tel" inputmode="tel" placeholder="(18) 99999-9999"></label>
      <div class="two">
        <label class="field"><span>Perfil</span><select class="input" id="nwPerfil"><option value="">–</option>${Object.entries(PERFIS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>
        <label class="field"><span>Função</span><select class="input" id="nwFuncao"><option value="">–</option>${Object.entries(FUNCOES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>
      </div>
      <div class="field"><span>Tipo de acesso</span><div class="chips" id="nwRole"><button data-v="cliente" class="sel">Cliente</button><button data-v="admin">ADM master</button></div></div>
      <div class="err" id="nwErr"></div>
      <button class="btn btn-primary wide" id="nwGo">Criar login</button>
      <div id="nwOut"></div>`;
    const tel = admBody.querySelector('#nwTel'); tel.oninput = () => tel.value = maskPhone(tel.value);
    admBody.querySelector('#nwRole').onclick = e => { const b = e.target.closest('button'); if (b) admBody.querySelectorAll('#nwRole button').forEach(x => x.classList.toggle('sel', x === b)); };
    admBody.querySelector('#nwGo').onclick = createLogin;
  }
  async function createLogin(){
    const v = id => admBody.querySelector(id).value.trim();
    const err = admBody.querySelector('#nwErr'), go = admBody.querySelector('#nwGo');
    const nome = v('#nwNome'), email = v('#nwMail').toLowerCase(), password = admBody.querySelector('#nwPass').value;
    const role = admBody.querySelector('#nwRole .sel').dataset.v, tel = v('#nwTel') ? e164(v('#nwTel')) : '';
    if (!nome) return err.textContent = 'Digite o nome.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err.textContent = 'E-mail inválido.';
    if (password.length < 8) return err.textContent = 'A senha precisa ter pelo menos 8 caracteres.';
    if (tel === null) return err.textContent = 'WhatsApp inválido (use DDD + número).';
    go.disabled = true; err.textContent = '';
    try {
      // cliente temporário: cria o usuário sem deslogar o ADM
      const tmp = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth:{ persistSession:false, autoRefreshToken:false, detectSessionInUrl:false, storageKey:'mgeo-tmp-' + Date.now() } });
      const { data, error } = await tmp.auth.signUp({ email, password, options:{ data:{ nome, whatsapp:tel || '', perfil:v('#nwPerfil'), funcao:v('#nwFuncao'), lgpd:'false' } } });
      if (error) throw error;
      if (!data.user || (data.user.identities && data.user.identities.length === 0)) throw new Error('Este e-mail já tem cadastro.');
      const up = await sb.from('profiles').update({ status:'ativo', role }).eq('id', data.user.id).select().maybeSingle();
      if (up.error) throw up.error;
      if (up.data) users.unshift(up.data);
      const txt = `Seu acesso ao MGEO PDF:\nE-mail: ${email}\nSenha: ${password}\nEntre em “Entrar com e-mail”.`;
      admBody.querySelector('#nwOut').innerHTML = `<div class="cred">✅ Login criado${data.session ? '' : ' (o e-mail precisa ser confirmado antes do primeiro acesso)'}<br>
        E-mail: <code>${h(email)}</code><br>Senha: <code>${h(password)}</code><br>
        <button class="btn btn-ghost" id="nwCopy" style="margin-top:8px">Copiar dados</button>
        ${tel ? `<a class="u-wa" href="https://wa.me/${digits(tel)}?text=${encodeURIComponent(txt)}" target="_blank" rel="noopener">Enviar pelo WhatsApp</a>` : ''}</div>`;
      admBody.querySelector('#nwCopy').onclick = () => navigator.clipboard.writeText(txt).then(() => toast('Copiado'));
      ['#nwNome', '#nwMail', '#nwTel'].forEach(id => admBody.querySelector(id).value = '');
      admBody.querySelector('#nwPass').value = strongPass();
      go.disabled = false;
    } catch(e){ err.textContent = errMsg(e); go.disabled = false; }
  }

  function renderCfg(){
    admBody.innerHTML = `
      <div class="row"><div>Liberar novos cadastros automaticamente<small>Desligado: cada cadastro novo espera você liberar</small></div>
        <label class="switch"><input type="checkbox" id="cfAuto" ${cfg && cfg.auto_aprovar ? 'checked' : ''}><span></span></label></div>
      <button class="row row-btn" id="cfCsv"><div>Exportar leads (CSV)<small>Abre no Excel, com todos os campos e a marcação de quente</small></div></button>
      <p class="hint" style="margin-top:16px">Regra do lead quente: <b>usina ou fornecedor</b> + <b>gerente ou supervisor</b> + <b>acima de 5.000 ha</b>. O prazo de 48 h começa quando o cliente informa a área.</p>
      <p class="hint">Segurança: cada cliente só enxerga os próprios dados. Somente ADMs ativos veem a lista completa, e isso é garantido pelo banco de dados, não só pelo app.</p>`;
    admBody.querySelector('#cfAuto').onchange = async e => {
      const val = e.target.checked;
      const { error } = await sb.from('app_config').update({ auto_aprovar:val, atualizado_em:new Date().toISOString() }).eq('id', 1);
      if (error){ toast(errMsg(error), true); e.target.checked = !val; } else { cfg.auto_aprovar = val; toast(val ? 'Novos cadastros entram liberados' : 'Novos cadastros aguardam liberação'); }
    };
    admBody.querySelector('#cfCsv').onclick = exportCsv;
  }
  function exportCsv(){
    const cols = [['nome','Nome'],['whatsapp','WhatsApp'],['email','E-mail'],['perfil','Perfil'],['funcao','Função'],['municipio','Município'],['uf','UF'],
      ['empresa','Empresa'],['area_faixa','Área'],['interesses','Interesses'],['quente','Quente'],['quente_desde','Quente desde'],['contatado_em','Contatado em'],
      ['status','Status'],['role','Tipo'],['lgpd_aceite','Aceite LGPD'],['lgpd_em','Aceite em'],['criado_em','Cadastro'],['ultimo_acesso','Último acesso']];
    const val = (u, k) => {
      let x = u[k];
      if (k === 'perfil') x = PERFIS[x]; if (k === 'funcao') x = FUNCOES[x]; if (k === 'area_faixa') x = AREAS[x];
      if (Array.isArray(x)) x = x.join('; '); if (typeof x === 'boolean') x = x ? 'Sim' : 'Não';
      if (/_em$|_desde$|ultimo_acesso/.test(k) && x) x = new Date(x).toLocaleString('pt-BR');
      return `"${String(x == null ? '' : x).replace(/"/g, '""')}"`;
    };
    const csv = '\ufeff' + [cols.map(c => `"${c[1]}"`).join(';'), ...users.map(u => cols.map(c => val(u, c[0])).join(';'))].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8' }));
    a.download = `leads-mgeo-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  window.MGEO_AUTH.openAdmin = openAdmin;
  window.MGEO_AUTH.logout = logout;
  boot();
})();
