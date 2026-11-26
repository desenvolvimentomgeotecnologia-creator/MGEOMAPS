/* MGEO PDF – entrada, cadastro, recuperação de senha, escolha de modo e estatísticas de uso */
'use strict';
(function(){
  const OFFLINE_DAYS = 30;
  const PERFIS = { usina:'Usina', fornecedor:'Fornecedor', produtor:'Produtor', consultor:'Consultor', outro:'Outro' };
  const FUNCOES = { gerente:'Gerente', supervisor:'Supervisor', tecnico:'Técnico', operador:'Operador' };
  const AREAS = { ate_500:'Até 500 ha', '500_1000':'500 a 1.000 ha', '1000_5000':'1.000 a 5.000 ha', '5000_20000':'5.000 a 20.000 ha', acima_20000:'Acima de 20.000 ha' };
  const ORIGENS = { indicacao:'Indicação de alguém', equipe_mgeo:'Equipe MGEO', instagram:'Instagram', whatsapp:'WhatsApp', google:'Google', linkedin:'LinkedIn', youtube:'YouTube', evento:'Evento ou feira', outro:'Outro' };
  const INTERESSES = ['Mapeamento de falhas', 'Imagens de drone', 'Índices de vegetação (NDVI)', 'Topografia e sistematização', 'Georreferenciamento', 'Contagem de plantas', 'Outro'];
  const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
  window.MGEO_LABELS = { PERFIS, FUNCOES, AREAS, ORIGENS };

  const A = window.MGEO_AUTH = { user:null, offline:false, mode:null };
  const h = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  const digits = s => String(s || '').replace(/\D/g, '');
  function maskPhone(v){
    let d = digits(v); if (d.startsWith('55') && d.length > 11) d = d.slice(2); d = d.slice(0, 11);
    if (d.length <= 2) return d ? `(${d}` : '';
    if (d.length <= 6) return `(${d.slice(0,2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
    return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  }
  const prettyPhone = e => { const d = digits(e); return d.startsWith('55') ? '+55 ' + maskPhone(d.slice(2)) : (e || ''); };
  const initials = n => (String(n || '?').replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('') || '?').toUpperCase();
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { net:true })), ms))]);
  const isNet = e => !navigator.onLine || (e && (e.net || e.name === 'TypeError'));
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  async function api(path, opt = {}){
    let r;
    try {
      r = await fetch('/api' + path, { method:opt.method || 'GET', credentials:'same-origin', keepalive:!!opt.keepalive,
        headers:{ 'Content-Type':'application/json', 'X-MGEO':'1' }, body: opt.body ? JSON.stringify(opt.body) : undefined });
    } catch(e){ e.net = true; throw e; }
    let data = {}; try { data = await r.json(); } catch(_){}
    if (!r.ok){ const e = new Error(data.erro || 'Não foi possível concluir. Tente de novo.'); e.status = r.status; e.code = data.code; e.campo = data.campo; throw e; }
    return data;
  }
  window.MGEO_API = api;
  const msg = e => isNet(e) ? 'Sem conexão com o servidor. Verifique a internet.' : (e.message || 'Algo deu errado.');

  /* ---------- cache para abrir sem internet ---------- */
  const CK = 'mgeo:sessao';
  const readCache = () => { try { return JSON.parse(localStorage.getItem(CK)); } catch(_){ return null; } };
  const writeCache = u => { try { localStorage.setItem(CK, JSON.stringify({ user:u, at:Date.now() })); } catch(_){} };
  const clearCache = () => { try { localStorage.removeItem(CK); } catch(_){} };
  const cacheOk = c => c && c.user && c.user.status === 'ativo' && Date.now() - c.at < OFFLINE_DAYS * 864e5;

  /* ---------- splash ---------- */
  const splash = document.getElementById('splash');
  const t0 = Date.now();
  async function hideSplash(){
    const wait = 1100 - (Date.now() - t0); if (wait > 0) await new Promise(r => setTimeout(r, wait));
    if (splash && !splash.classList.contains('out')){ splash.classList.add('out'); setTimeout(() => splash.remove(), 450); }
  }

  /* ---------- tela de entrada ---------- */
  const auth = document.createElement('div');
  auth.className = 'auth'; auth.id = 'auth'; auth.hidden = true;
  auth.innerHTML = `<div class="auth-hero"><img class="auth-brand" src="img/logo-white.png" alt="MGEO – Soluções em Agricultura de Precisão e Geotecnologia">
      <h1>MGEO PDF</h1><p>Seus GeoPDFs no campo, com GPS em tempo real e sem precisar de internet.</p></div>
    <div class="auth-card"><div class="auth-inner" id="authBody"></div></div>`;
  document.body.appendChild(auth);
  const body = auth.querySelector('#authBody'), card = auth.querySelector('.auth-card');
  function view(html){ body.innerHTML = html; card.scrollTop = 0; auth.hidden = false; hideSplash(); }
  body.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g){ e.preventDefault(); routes[g.dataset.go](); } });
  const back = to => `<button class="back" data-go="${to}">‹ Voltar</button>`;
  const passField = (id, label, ac) => `<label class="field"><span>${label}</span><div class="pass"><input class="input" id="${id}" type="password" autocomplete="${ac}" maxlength="128"><button type="button" class="eye" data-eye="${id}" aria-label="Mostrar senha">Mostrar</button></div></label>`;
  body.addEventListener('click', e => { const b = e.target.closest('[data-eye]'); if (!b) return; const i = body.querySelector('#' + b.dataset.eye); i.type = i.type === 'password' ? 'text' : 'password'; b.textContent = i.type === 'password' ? 'Mostrar' : 'Ocultar'; });
  function busyBtn(btn, on, label){ btn.disabled = on; if (label) btn.textContent = label; }
  let resetEmail = '';

  const routes = {
    login(){
      view(`<h2>Entrar</h2><p class="sub">Use o e-mail e a senha do seu cadastro no MGEO PDF ou do Portal MGEO.</p>
        <label class="field"><span>E-mail</span><input class="input" id="liMail" type="email" inputmode="email" autocomplete="username" maxlength="190"></label>
        ${passField('liPass', 'Senha', 'current-password')}
        <div class="err" id="liErr"></div>
        <button class="btn btn-primary wide" id="liGo">Entrar</button>
        <p class="auth-alt"><button class="link" data-go="forgot">Esqueci minha senha</button></p>
        <div class="divider"><span>Ainda não tem conta?</span></div>
        <button class="btn btn-signal wide" data-go="signup">Criar conta grátis</button>`);
      const go = body.querySelector('#liGo'), err = body.querySelector('#liErr');
      const last = localStorage.getItem('mgeo:last-email'); if (last) body.querySelector('#liMail').value = last;
      const run = async () => {
        const email = body.querySelector('#liMail').value.trim(), senha = body.querySelector('#liPass').value;
        if (!email || !senha) return err.textContent = 'Preencha e-mail e senha.';
        busyBtn(go, true, 'Entrando…'); err.textContent = '';
        try { const { user } = await api('/auth/login', { method:'POST', body:{ email, senha } }); localStorage.setItem('mgeo:last-email', email); enter(user, false, true); }
        catch(e){ if (e.code === 'pendente') return routes.pending(); if (e.code === 'bloqueado') return routes.blocked(); err.textContent = msg(e); busyBtn(go, false, 'Entrar'); }
      };
      go.onclick = run;
      body.querySelector('#liPass').addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
    },
    forgot(){
      view(`${back('login')}<h2>Recuperar senha</h2><p class="sub">Digite o e-mail do cadastro. Vamos enviar um código de 6 números para criar uma nova senha.</p>
        <p class="sub">Entra com o usuário do Portal MGEO? Recupere a senha no <a href="https://portalmgeo.com.br/" target="_blank" rel="noopener">Portal MGEO</a>.</p>
        <label class="field"><span>E-mail</span><input class="input" id="fgMail" type="email" inputmode="email" autocomplete="username" maxlength="190"></label>
        <div class="err" id="fgErr"></div>
        <button class="btn btn-primary wide" id="fgGo">Enviar código</button>`);
      const m = body.querySelector('#fgMail'); m.value = body.dataset.email || localStorage.getItem('mgeo:last-email') || '';
      const go = body.querySelector('#fgGo'), err = body.querySelector('#fgErr');
      go.onclick = async () => {
        const email = m.value.trim(); if (!email) return err.textContent = 'Digite o seu e-mail.';
        busyBtn(go, true, 'Enviando…'); err.textContent = '';
        try { await api('/auth/forgot', { method:'POST', body:{ email } }); resetEmail = email; routes.reset(); }
        catch(e){ err.textContent = msg(e); busyBtn(go, false, 'Enviar código'); }
      };
    },
    reset(){
      view(`${back('forgot')}<h2>Nova senha</h2><p class="sub">Se <b>${h(resetEmail)}</b> tiver cadastro, o código chega em instantes. Confira também a caixa de spam.</p>
        <label class="field"><span>Código do e-mail</span><input class="input otp num" id="rsCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label>
        ${passField('rsPass', 'Nova senha', 'new-password')}
        <p class="hint">Mínimo de 8 caracteres, com letras e números.</p>
        <div class="err" id="rsErr"></div>
        <button class="btn btn-primary wide" id="rsGo">Salvar nova senha e entrar</button>
        <p class="auth-alt"><button class="link" data-go="forgot">Pedir outro código</button></p>`);
      const code = body.querySelector('#rsCode'); code.addEventListener('input', () => code.value = digits(code.value).slice(0, 6));
      const go = body.querySelector('#rsGo'), err = body.querySelector('#rsErr');
      go.onclick = async () => {
        const codigo = code.value, senha = body.querySelector('#rsPass').value;
        if (codigo.length !== 6) return err.textContent = 'O código tem 6 números.';
        busyBtn(go, true, 'Salvando…'); err.textContent = '';
        try {
          const r = await api('/auth/reset', { method:'POST', body:{ email:resetEmail, codigo, senha } });
          if (r.user){ toast('Senha alterada!'); enter(r.user, false, true); }
          else if (r.code === 'pendente') routes.pending(); else routes.blocked();
        } catch(e){ err.textContent = msg(e); busyBtn(go, false, 'Salvar nova senha e entrar'); }
      };
    },
    signup(){
      view(`${back('login')}<h2>Criar conta</h2><p class="sub">Grátis. Leva cerca de 1 minuto.</p>
        <label class="field"><span>Nome completo</span><input class="input" id="suNome" autocomplete="name" maxlength="80"></label>
        <label class="field"><span>E-mail</span><input class="input" id="suMail" type="email" inputmode="email" autocomplete="email" maxlength="190"></label>
        ${passField('suPass', 'Crie uma senha', 'new-password')}
        <p class="hint">Mínimo de 8 caracteres, com letras e números.</p>
        <label class="field"><span>WhatsApp</span><input class="input num" id="suTel" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="(18) 99999-9999"></label>
        <div class="field" id="f-perfil"><span>Perfil</span><div class="chips" id="suPerfil">${Object.entries(PERFIS).map(([k,v])=>`<button type="button" data-v="${k}">${v}</button>`).join('')}</div></div>
        <div class="field" id="f-funcao"><span>Função</span><div class="chips" id="suFuncao">${Object.entries(FUNCOES).map(([k,v])=>`<button type="button" data-v="${k}">${v}</button>`).join('')}</div></div>
        <div class="two">
          <label class="field"><span>UF</span><select class="input" id="suUf"><option value="">UF</option>${UFS.map(u=>`<option>${u}</option>`).join('')}</select></label>
          <label class="field"><span>Município</span><input class="input" id="suMun" list="munList" autocomplete="address-level2" maxlength="80"></label>
        </div><datalist id="munList"></datalist>
        <div class="field" id="f-origem"><span>Onde você conheceu o MGEO PDF?</span><div class="chips" id="suOrig">${Object.entries(ORIGENS).map(([k,v])=>`<button type="button" data-v="${k}">${v}</button>`).join('')}</div></div>
        <label class="field" id="suOrigOutroBox" hidden><span id="suOrigOutroLbl">Qual?</span><input class="input" id="suOrigOutro" maxlength="100"></label>
        <label class="check" id="f-termos"><input type="checkbox" id="suTermos"><span>Li e aceito os <button type="button" class="link inline" data-doc="termos.html">Termos de Uso</button> e a <button type="button" class="link inline" data-doc="privacidade.html">Política de Privacidade</button> do MGEO PDF.</span></label>
        <label class="check" id="f-contato"><input type="checkbox" id="suContato"><span>Autorizo a MGEO Tecnologia a entrar em contato comigo por WhatsApp, telefone ou e-mail para apresentar produtos e serviços (LGPD). Posso cancelar a qualquer momento.</span></label>
        <div class="err" id="suErr"></div>
        <button class="btn btn-primary wide" id="suGo">Criar minha conta</button>`);
      const tel = body.querySelector('#suTel'); tel.addEventListener('input', () => tel.value = maskPhone(tel.value));
      ['#suPerfil', '#suFuncao', '#suOrig'].forEach(id => body.querySelector(id).addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        body.querySelectorAll(id + ' button').forEach(x => x.classList.toggle('sel', x === b));
        if (id === '#suOrig'){
          const box = body.querySelector('#suOrigOutroBox'); box.hidden = !['indicacao', 'outro', 'evento'].includes(b.dataset.v);
          body.querySelector('#suOrigOutroLbl').textContent = b.dataset.v === 'indicacao' ? 'Quem indicou?' : b.dataset.v === 'evento' ? 'Qual evento?' : 'Onde?';
        }
      }));
      body.querySelector('#suUf').addEventListener('change', e => loadMunicipios(e.target.value));
      const go = body.querySelector('#suGo'), err = body.querySelector('#suErr');
      go.onclick = async () => {
        const v = id => body.querySelector(id).value.trim();
        const sel = id => { const b = body.querySelector(id + ' .sel'); return b ? b.dataset.v : ''; };
        const data = { nome:v('#suNome'), email:v('#suMail'), senha:body.querySelector('#suPass').value, whatsapp:v('#suTel'), perfil:sel('#suPerfil'), funcao:sel('#suFuncao'),
          uf:v('#suUf'), municipio:v('#suMun'), origem:sel('#suOrig'), origem_outro:v('#suOrigOutro'),
          termos:body.querySelector('#suTermos').checked, contato:body.querySelector('#suContato').checked };
        busyBtn(go, true, 'Criando conta…'); err.textContent = '';
        try {
          const r = await api('/auth/register', { method:'POST', body:data });
          localStorage.setItem('mgeo:last-email', data.email);
          if (r.code === 'pendente') return routes.pending(r.erro);
          toast('Conta criada. Bem-vindo!'); enter(r.user, false, true);
        } catch(e){
          err.textContent = msg(e); busyBtn(go, false, 'Criar minha conta');
          const f = e.campo && (body.querySelector('#su' + ({ nome:'Nome', email:'Mail', senha:'Pass', whatsapp:'Tel', municipio:'Mun' })[e.campo]) || body.querySelector('#f-' + e.campo));
          if (f){ f.scrollIntoView({ behavior:'smooth', block:'center' }); if (f.focus) f.focus(); }
        }
      };
    },
    pending(text){
      view(`<div class="state-ico">⏳</div><h2>Cadastro em análise</h2>
        <p class="sub">${h(text || 'Seu cadastro foi recebido. A equipe MGEO vai liberar seu acesso em breve.')}</p>
        <button class="btn btn-primary wide" data-go="login">Voltar para o login</button>`);
    },
    blocked(){
      view(`<div class="state-ico">🔒</div><h2>Acesso bloqueado</h2><p class="sub">Seu acesso ao MGEO PDF está suspenso. Fale com a equipe MGEO.</p>
        <button class="btn btn-ghost wide" data-go="login">Voltar</button>`);
    },
    offlineFirst(){
      view(`<div class="state-ico">📶</div><h2>Sem conexão</h2>
        <p class="sub">Para entrar pela primeira vez neste aparelho é preciso internet. Depois o app funciona offline por até ${OFFLINE_DAYS} dias seguidos.</p>
        <button class="btn btn-primary wide" id="ofAgain">Tentar de novo</button>`);
      body.querySelector('#ofAgain').onclick = () => boot();
    },
    mode(){
      const n = String(A.user.nome || '').replace(/\(.*?\)/g, '').trim().split(' ')[0];
      view(`<h2>Olá, ${h(n)}</h2><p class="sub">Como você quer entrar agora?</p>
        <button class="mode-card" data-mode="gerencial"><span class="mode-ico">📊</span><span><b>Modo gerencial</b>Usuários, acessos, estatísticas de uso e contatos para a equipe comercial.</span></button>
        <button class="mode-card" data-mode="app"><span class="mode-ico">🗺️</span><span><b>Modo MGEO PDF</b>Seus GeoPDFs com GPS em tempo real, do jeito que é usado no campo.</span></button>
        <p class="auth-alt"><button class="link" id="mdOut">Sair</button></p>`);
      body.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => openMode(b.dataset.mode));
      body.querySelector('#mdOut').onclick = logout;
    }
  };

  /* documentos (termos e privacidade) dentro do app */
  const docSheet = document.createElement('section');
  docSheet.className = 'sheet doc-sheet'; docSheet.id = 'sheetDoc';
  docSheet.innerHTML = `<div class="grab"></div><div class="sheet-head"><h2 id="docTitle">Termos</h2><button class="btn btn-ghost" id="docClose">Fechar</button></div><div class="sheet-body doc" id="docBody"></div>`;
  document.body.appendChild(docSheet);
  docSheet.querySelector('#docClose').onclick = () => { docSheet.classList.remove('open'); if (auth.hidden) closeSheets(); };
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-doc]'); if (!b) return; e.preventDefault();
    try {
      const html = await (await fetch(b.dataset.doc)).text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      docSheet.querySelector('#docTitle').textContent = (doc.querySelector('h1') || {}).textContent || 'Documento';
      const main = doc.querySelector('main'); if (main.querySelector('h1')) main.querySelector('h1').remove();
      docSheet.querySelector('#docBody').innerHTML = main.innerHTML;
      docSheet.style.zIndex = 4100; docSheet.classList.add('open');
    } catch(_){ window.open(b.dataset.doc, '_blank', 'noopener'); }
  });

  async function loadMunicipios(uf){
    const dl = body.querySelector('#munList'); if (!dl || !uf) return;
    let list = null; try { list = JSON.parse(localStorage.getItem('mgeo:mun:' + uf)); } catch(_){}
    if (!list){
      try { const r = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`); list = (await r.json()).map(m => m.nome); localStorage.setItem('mgeo:mun:' + uf, JSON.stringify(list)); }
      catch(_){ list = []; }
    }
    dl.innerHTML = list.map(n => `<option value="${h(n)}">`).join('');
  }

  /* ---------- sessão ---------- */
  function enter(user, offline, fresh){
    A.user = user; A.offline = offline;
    if (!offline) writeCache(user);
    if (fresh) flushQueue();
    paintMe();
    if (user.role === 'admin') return routes.mode();
    openMode('app');
  }
  let appOpened = false;
  function openMode(m){
    A.mode = m;
    auth.hidden = true; hideSplash();
    track('modo', { modo:m });
    if (m === 'gerencial'){ if (window.MGEO_GERENCIAL) MGEO_GERENCIAL.open(); return; }
    if (window.MGEO_GERENCIAL) MGEO_GERENCIAL.close();
    if (!appOpened){ appOpened = true; track('app_open', { display: standalone() ? 'instalado' : 'navegador', offline: A.offline }); }
    if (typeof window.startApp === 'function') window.startApp();
    if (A.offline) toast('Modo offline: seus mapas continuam disponíveis');
  }
  A.openMode = openMode;

  async function boot(){
    const c = readCache();
    try {
      const { user } = await withTimeout(api('/auth/me'), 7000);
      return enter(user, false);
    } catch(e){
      if (e.status === 401){ clearCache(); return routes.login(); }
      if (e.status === 403){ if (e.code === 'bloqueado'){ clearCache(); return routes.blocked(); } return routes.pending(); }
      if (cacheOk(c)) return enter(c.user, true);
      if (isNet(e)) return routes.offlineFirst();
      routes.login();
    }
  }
  async function logout(){
    try { await flushQueue(); await withTimeout(api('/auth/logout', { method:'POST' }), 4000); } catch(_){}
    clearCache(); try { localStorage.removeItem(QK); } catch(_){}
    location.reload();
  }
  A.logout = logout;
  async function revalidate(){
    if (!A.user || !navigator.onLine) return;
    try { const { user } = await api('/auth/me'); A.user = user; A.offline = false; writeCache(user); paintMe(); flushQueue(); }
    catch(e){
      if (e.status === 401){ clearCache(); toast('Sua sessão expirou. Entre de novo.', true); setTimeout(() => location.reload(), 1800); }
      if (e.status === 403){ clearCache(); location.reload(); }
    }
  }
  addEventListener('online', revalidate);

  /* ---------- estatísticas de uso (guardadas offline e enviadas depois) ---------- */
  const QK = 'mgeo:eventos';
  const readQ = () => { try { return JSON.parse(localStorage.getItem(QK)) || []; } catch(_){ return []; } };
  const saveQ = a => { try { localStorage.setItem(QK, JSON.stringify(a.slice(-800))); } catch(_){} };
  function track(tipo, meta){
    if (!A.user) return;
    const a = readQ(); a.push({ u:A.user.id, tipo, em:new Date().toISOString(), meta }); saveQ(a); flushSoon();
  }
  window.MGEO_TRACK = track;
  function addMinute(){
    if (!A.user || document.visibilityState !== 'visible') return;
    const a = readQ(), nowIso = new Date().toISOString(), last = a[a.length - 1];
    if (last && last.tipo === 'uso' && last.u === A.user.id && last.em.slice(0, 13) === nowIso.slice(0, 13)) last.minutos++;
    else a.push({ u:A.user.id, tipo:'uso', em:nowIso, minutos:1 });
    saveQ(a);
  }
  setInterval(addMinute, 60e3);
  let flushT = null, flushing = false;
  function flushSoon(){ clearTimeout(flushT); flushT = setTimeout(flushQueue, 4000); }
  async function flushQueue(keepalive){
    if (flushing || !A.user || !navigator.onLine) return;
    const all = readQ(); const mine = all.filter(e => e.u === A.user.id); if (!mine.length){ if (all.length) saveQ([]); return; }
    flushing = true;
    try {
      await api('/events', { method:'POST', keepalive:!!keepalive, body:{ eventos:mine.slice(0, 300) } });
      const sent = mine.slice(0, 300);
      saveQ(readQ().filter(e => !sent.some(m => m.em === e.em && m.tipo === e.tipo && m.u === e.u)));
    } catch(e){ if (e.status === 400) saveQ([]); }
    flushing = false;
  }
  setInterval(() => flushQueue(), 120e3);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushQueue(true); });

  /* ---------- minha conta ---------- */
  const meBtn = document.getElementById('btnMe');
  const sheetMe = document.createElement('section');
  sheetMe.className = 'sheet'; sheetMe.id = 'sheetMe';
  document.body.appendChild(sheetMe);
  const incompleto = u => u && u.role !== 'admin' && (!u.empresa || !u.area_faixa || !(u.interesses && u.interesses.length));
  function paintMe(){
    const u = A.user; if (!u) return;
    meBtn.hidden = false; meBtn.querySelector('#meInitials').textContent = initials(u.nome);
    meBtn.classList.toggle('is-adm', u.role === 'admin');
    let n = document.getElementById('nudge');
    if (incompleto(u)){
      if (!n){
        n = document.createElement('button'); n.className = 'nudge'; n.id = 'nudge';
        n.innerHTML = `<span style="font-size:22px">📋</span><span><b>Complete seu perfil</b>Empresa, área e serviços de interesse. Leva 30 segundos.</span>`;
        n.onclick = openMe;
        const lib = document.querySelector('#sheetLib .sheet-body'); lib.insertBefore(n, lib.firstChild);
      }
    } else if (n) n.remove();
  }
  function openMe(){
    const u = A.user; if (!u) return;
    const sel = new Set(u.interesses || []); const off = A.offline || !navigator.onLine;
    sheetMe.innerHTML = `<div class="grab"></div><div class="sheet-head"><h2>Minha conta</h2></div>
      <div class="sheet-body">
        <div class="me-head"><div class="avatar">${h(initials(u.nome))}</div><div><b>${h(u.nome)}</b><span>${h(u.email)}</span>
          <span>${h([PERFIS[u.perfil], FUNCOES[u.funcao], u.municipio && (u.municipio + '/' + (u.uf || ''))].filter(Boolean).join(' · '))}</span></div></div>
        ${u.role === 'admin' ? `<button class="row row-btn" id="meGer"><div><b>Modo gerencial</b><small>Usuários, acessos e estatísticas</small></div><span class="tag adm">ADM</span></button>` : ''}
        <div class="label">Sobre sua empresa</div>
        <label class="field"><span>Empresa</span><input class="input" id="meEmp" maxlength="100" value="${h(u.empresa || '')}"></label>
        <label class="field"><span>WhatsApp</span><input class="input num" id="meTel" type="tel" value="${h(u.whatsapp ? maskPhone(digits(u.whatsapp).slice(2)) : '')}"></label>
        <div class="field"><span>Área cultivada</span><div class="chips" id="meArea">${Object.entries(AREAS).map(([k,v])=>`<button data-v="${k}" class="${u.area_faixa === k ? 'sel' : ''}">${v}</button>`).join('')}</div></div>
        <div class="field"><span>Serviços de interesse</span><div class="chips" id="meInt">${INTERESSES.map(v=>`<button data-v="${h(v)}" class="${sel.has(v) ? 'sel' : ''}">${h(v)}</button>`).join('')}</div></div>
        <div class="err" id="meErr"></div>
        <button class="btn btn-primary wide" id="meSave" ${off ? 'disabled' : ''}>${off ? 'Conecte-se para salvar' : 'Salvar'}</button>
        <div class="label">Segurança</div>
        ${u.portal ? `<p class="hint">Você entra com o usuário do Portal MGEO. Para trocar a senha, use o <a href="https://portalmgeo.com.br/" target="_blank" rel="noopener">Portal MGEO</a>.</p>` : `<details class="pw"><summary>Trocar senha</summary>
          ${['pwOld:Senha atual:current-password', 'pwNew:Nova senha:new-password'].map(x => { const [id, l, ac] = x.split(':'); return `<label class="field"><span>${l}</span><input class="input" id="${id}" type="password" autocomplete="${ac}" maxlength="128"></label>`; }).join('')}
          <div class="err" id="pwErr"></div><button class="btn btn-ghost wide" id="pwGo" ${off ? 'disabled' : ''}>Salvar nova senha</button></details>`}
        <button class="row row-btn" id="meOut"><div>Sair desta conta<small>Seus mapas continuam salvos neste aparelho</small></div></button>
        <p class="hint" style="margin-top:12px"><button class="link inline" data-doc="termos.html">Termos de Uso</button> · <button class="link inline" data-doc="privacidade.html">Privacidade</button></p>
      </div>`;
    const q = s => sheetMe.querySelector(s);
    q('#meTel').addEventListener('input', e => e.target.value = maskPhone(e.target.value));
    q('#meArea').onclick = e => { const b = e.target.closest('button'); if (b) sheetMe.querySelectorAll('#meArea button').forEach(x => x.classList.toggle('sel', x === b)); };
    q('#meInt').onclick = e => { const b = e.target.closest('button'); if (b) b.classList.toggle('sel'); };
    q('#meOut').onclick = () => { if (confirm('Sair da sua conta? Os mapas continuam salvos neste aparelho.')) logout(); };
    const g = q('#meGer'); if (g) g.onclick = () => { closeSheets(); openMode('gerencial'); };
    q('#meSave').onclick = async () => {
      const btn = q('#meSave'), err = q('#meErr'), a = q('#meArea .sel');
      const body = { empresa:q('#meEmp').value, area_faixa:a ? a.dataset.v : null, interesses:[...sheetMe.querySelectorAll('#meInt .sel')].map(b => b.dataset.v) };
      if (q('#meTel').value.trim()) body.whatsapp = q('#meTel').value;
      btn.disabled = true; err.textContent = '';
      try { const r = await api('/me', { method:'PATCH', body }); A.user = r.user; writeCache(r.user); paintMe(); toast('Dados salvos. Obrigado!'); closeSheets(); }
      catch(e){ err.textContent = msg(e); btn.disabled = false; }
    };
    if (q('#pwGo')) q('#pwGo').onclick = async () => {
      const err = q('#pwErr'); err.textContent = '';
      try { await api('/auth/password', { method:'POST', body:{ atual:q('#pwOld').value, nova:q('#pwNew').value } }); toast('Senha alterada'); q('#pwOld').value = q('#pwNew').value = ''; q('.pw').open = false; }
      catch(e){ err.textContent = msg(e); }
    };
    openSheet('#sheetMe');
  }
  meBtn.onclick = openMe;

  boot();
})();
