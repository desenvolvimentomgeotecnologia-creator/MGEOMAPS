/* MGEO PDF – Modo Gerencial (somente ADM) */
'use strict';
(function(){
  const api = (...a) => window.MGEO_API(...a);
  const L = () => window.MGEO_LABELS;
  const h = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  const digits = s => String(s || '').replace(/\D/g, '');
  const n = x => (+x || 0).toLocaleString('pt-BR');
  const fmtDT = t => t ? new Date(t).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '–';
  const fmtD = t => t ? new Date(t).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' }) : '–';
  function ago(t){
    if (!t) return 'nunca';
    const s = (Date.now() - new Date(t)) / 1000;
    if (s < 90) return 'agora há pouco'; if (s < 3600) return `há ${Math.round(s / 60)} min`;
    if (s < 86400) return `há ${Math.round(s / 3600)} h`; if (s < 86400 * 30) return `há ${Math.round(s / 86400)} dia${s < 86400 * 1.5 ? '' : 's'}`;
    return fmtD(t);
  }
  const horas = m => m >= 60 ? `${(m / 60).toLocaleString('pt-BR', { maximumFractionDigits:1 })} h` : `${n(m)} min`;
  const phonePretty = e => { const d = digits(e); if (!d.startsWith('55')) return e || ''; const r = d.slice(2); return `(${r.slice(0,2)}) ${r.length === 11 ? r.slice(2,7) + '-' + r.slice(7) : r.slice(2,6) + '-' + r.slice(6)}`; };
  const TIPOS = { login:'Entrou', app_open:'Abriu o app', cadastro:'Cadastrou-se', map_import:'Importou GeoPDF', map_open:'Abriu mapa', gps_on:'Ligou o GPS',
    offline_download:'Baixou fundo offline', modo:'Escolheu modo', senha_redefinida:'Redefiniu a senha' };
  const lbl = (map, k) => k === 'nao_informado' || k == null ? 'Não informado' : (L()[map][k] || k);

  /* ---------- estrutura ---------- */
  const root = document.createElement('div');
  root.className = 'ger'; root.id = 'ger'; root.hidden = true;
  root.innerHTML = `
    <header class="ger-top"><div class="ger-bar">
      <img class="ger-logo" src="img/logo-white.png" alt="MGEO">
      <span class="ger-title">Painel gerencial</span>
      <div class="ger-act">
        <select class="ger-sel" id="gPer" aria-label="Período"><option value="7">7 dias</option><option value="30" selected>30 dias</option><option value="90">90 dias</option><option value="365">12 meses</option></select>
        <button class="ger-btn" id="gApp">🗺️ <span>Modo MGEO PDF</span></button>
        <button class="ger-btn icon" id="gOut" aria-label="Sair" title="Sair"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/></svg></button>
      </div></div>
      <nav class="ger-tabs" id="gTabs"><button data-t="geral" class="sel">Visão geral</button><button data-t="users">Usuários</button><button data-t="acessos">Acessos</button><button data-t="ajustes">Ajustes</button></nav>
    </header>
    <main class="ger-main"><div class="ger-wrap" id="gBody"></div></main>
    <div class="ger-scrim" id="gScrim"></div>
    <aside class="ger-drawer" id="gDrawer" aria-label="Detalhes do usuário"></aside>`;
  document.body.appendChild(root);
  const $g = s => root.querySelector(s);
  const B = $g('#gBody');
  let tab = 'geral', users = null, stats = null, filtro = 'todos', busca = '', ordem = 'recentes', evTipo = '', evList = [], cfg = null;

  $g('#gTabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; tab = b.dataset.t; root.querySelectorAll('#gTabs button').forEach(x => x.classList.toggle('sel', x === b)); render(); };
  $g('#gPer').onchange = () => { stats = null; render(); };
  $g('#gApp').onclick = () => window.MGEO_AUTH.openMode('app');
  $g('#gOut').onclick = () => { if (confirm('Sair da sua conta?')) window.MGEO_AUTH.logout(); };
  $g('#gScrim').onclick = closeDrawer;

  function open(){ root.hidden = false; document.body.classList.add('ger-on'); render(); }
  function close(){ root.hidden = true; document.body.classList.remove('ger-on'); closeDrawer(); }
  window.MGEO_GERENCIAL = { open, close };

  const loading = t => `<div class="g-load"><div class="spin"></div>${t || 'Carregando…'}</div>`;
  const fail = e => `<div class="g-load">⚠️ ${h(e.message || 'Erro')}<br><button class="btn btn-ghost" id="gRetry" style="margin-top:12px">Tentar de novo</button></div>`;
  async function render(){
    if (!navigator.onLine){ B.innerHTML = `<div class="g-load">📶 O modo gerencial precisa de internet.</div>`; return; }
    try { ({ geral:renderGeral, users:renderUsers, acessos:renderAcessos, ajustes:renderAjustes })[tab](); }
    catch(e){ B.innerHTML = fail(e); }
  }
  B.addEventListener('click', e => { if (e.target.id === 'gRetry'){ stats = null; users = null; render(); } });

  /* ---------- gráficos (SVG) ---------- */
  function lineChart(labels, series, opt = {}){
    const W = opt.W || 640, H = opt.H || 210, P = { l:34, r:10, t:12, b:26 };
    const max = Math.max(1, ...series.flatMap(s => s.values));
    const nice = Math.ceil(max / 4) * 4 || 4;
    const x = i => P.l + (labels.length < 2 ? 0 : i * (W - P.l - P.r) / (labels.length - 1));
    const y = v => H - P.b - v / nice * (H - P.t - P.b);
    const grid = [0, .25, .5, .75, 1].map(f => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(nice * f)}" y2="${y(nice * f)}" class="g-grid"/><text x="${P.l - 6}" y="${y(nice * f) + 4}" class="g-ax" text-anchor="end">${n(Math.round(nice * f))}</text>`).join('');
    const step = Math.ceil(labels.length / 7);
    const xl = labels.map((l, i) => (i % step === 0 || i === labels.length - 1) ? `<text x="${x(i)}" y="${H - 8}" class="g-ax" text-anchor="${i === labels.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'}">${l}</text>` : '').join('');
    const paths = series.map(s => {
      const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
      const area = opt.area && s === series[0] ? `<path d="${d}L${x(s.values.length - 1)},${y(0)}L${x(0)},${y(0)}Z" fill="${s.color}" opacity=".12"/>` : '';
      return `${area}<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>` +
        s.values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="${labels.length > 40 ? 0 : 2.6}" fill="${s.color}"><title>${labels[i]}: ${n(v)} ${s.name}</title></circle>`).join('');
    }).join('');
    const hit = labels.map((l, i) => `<rect x="${x(i) - (W / labels.length) / 2}" y="${P.t}" width="${W / labels.length}" height="${H - P.t - P.b}" fill="transparent"><title>${l}\n${series.map(s => `${s.name}: ${n(s.values[i])}`).join('\n')}</title></rect>`).join('');
    return `<svg class="g-chart" viewBox="0 0 ${W} ${H}" role="img">${grid}${xl}${paths}${hit}</svg>
      <div class="g-legend">${series.map(s => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('')}</div>`;
  }
  function barChart(labels, values, color, name){
    const W = 640, H = 190, P = { l:30, r:6, t:10, b:26 };
    const max = Math.max(1, ...values), nice = Math.ceil(max / 4) * 4 || 4;
    const bw = (W - P.l - P.r) / labels.length;
    const y = v => H - P.b - v / nice * (H - P.t - P.b);
    const step = Math.ceil(labels.length / 7);
    return `<svg class="g-chart" viewBox="0 0 ${W} ${H}" role="img">
      ${[0, .5, 1].map(f => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(nice * f)}" y2="${y(nice * f)}" class="g-grid"/><text x="${P.l - 5}" y="${y(nice * f) + 4}" class="g-ax" text-anchor="end">${n(Math.round(nice * f))}</text>`).join('')}
      ${values.map((v, i) => `<rect x="${P.l + i * bw + bw * .15}" y="${y(v)}" width="${Math.max(1, bw * .7)}" height="${Math.max(0, y(0) - y(v))}" rx="${Math.min(4, bw * .25)}" fill="${color}"><title>${labels[i]}: ${n(v)} ${name}</title></rect>`).join('')}
      ${labels.map((l, i) => (i % step === 0 || i === labels.length - 1) ? `<text x="${P.l + i * bw + bw / 2}" y="${H - 8}" class="g-ax" text-anchor="middle">${l}</text>` : '').join('')}
    </svg>`;
  }
  function hbars(items, map){
    const tot = items.reduce((s, x) => s + x.n, 0) || 1;
    if (!items.length) return `<p class="g-empty">Sem dados ainda.</p>`;
    return `<div class="hb">${items.map(x => { const p = x.n / tot * 100; return `<div class="hb-row"><span class="hb-l">${h(map ? lbl(map, x.k) : (x.k || 'Não informado'))}</span>
      <span class="hb-bar"><i style="width:${Math.max(2, p)}%"></i></span><span class="hb-v num">${n(x.n)} <small>${p.toFixed(0)}%</small></span></div>`; }).join('')}</div>`;
  }
  const kpi = (v, l, sub, cls = '') => `<div class="kpi ${cls}"><b class="num">${v}</b><span>${l}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const card = (title, inner, cls = '') => `<section class="g-card ${cls}"><h3>${title}</h3>${inner}</section>`;

  /* ---------- visão geral ---------- */
  async function renderGeral(){
    const dias = +$g('#gPer').value;
    if (!stats || stats.dias !== dias){
      B.innerHTML = loading('Calculando estatísticas…');
      try { stats = await api('/admin/stats?dias=' + dias); } catch(e){ B.innerHTML = fail(e); return; }
    }
    const s = stats, lab = s.serie.map(d => d.dia.slice(8, 10) + '/' + d.dia.slice(5, 7));
    const per = dias === 365 ? '12 meses' : `${dias} dias`;
    B.innerHTML = `
      <div class="kpis">
        ${kpi(n(s.usuarios.total), 'Usuários cadastrados', `+${n(s.novos.periodo)} em ${per}`)}
        ${kpi(n(s.novos.hoje), 'Novos hoje', `${n(s.novos.d7)} em 7 dias`)}
        ${kpi(n(s.ativos.dia), 'Ativos hoje', `${n(s.ativos.semana)} na semana · ${n(s.ativos.mes)} no mês`)}
        ${kpi(n(s.serie.reduce((a, d) => a + d.acessos, 0)), 'Acessos', `em ${per}`)}
        ${kpi(horas(s.uso.minutos), 'Tempo de uso', s.uso.usuarios ? `média ${horas(Math.round(s.uso.minutos / s.uso.usuarios))} por usuário` : 'em ' + per)}
        ${kpi(n(s.eventos.map_import || 0), 'GeoPDFs importados', `${n(s.eventos.map_open || 0)} aberturas de mapa`)}
        ${kpi(n(s.eventos.offline_download || 0), 'Downloads offline', `${(s.offline_bytes / 1048576).toLocaleString('pt-BR', { maximumFractionDigits:1 })} MB baixados`)}
        ${kpi(n(s.leads.a_ligar || 0), '🔥 Leads quentes a ligar', s.leads.atrasados ? `${n(s.leads.atrasados)} atrasados (+48 h)` : 'nenhum atrasado', s.leads.atrasados ? 'hot' : '')}
      </div>
      <div class="g-grid2">
        ${card('Acessos e usuários ativos por dia', lineChart(lab, [{ name:'acessos', color:'#2F7BF6', values:s.serie.map(d => d.acessos) }, { name:'usuários ativos', color:'#1FA463', values:s.serie.map(d => d.ativos) }], { area:true, W:1180, H:250 }), 'span2')}
        ${card('Novos cadastros por dia', barChart(lab, s.serie.map(d => d.novos), '#E0A800', 'cadastros'))}
        ${card('Tempo de uso por dia (minutos)', barChart(lab, s.serie.map(d => d.minutos), '#8E6CF0', 'min'))}
        ${card('Onde conheceram o app', hbars(s.origem, 'ORIGENS'))}
        ${card('Perfil', hbars(s.perfil, 'PERFIS'))}
        ${card('Função', hbars(s.funcao, 'FUNCOES'))}
        ${card('Área cultivada', hbars(s.area, 'AREAS'))}
        ${card('Estados', hbars(s.uf))}
        ${card('Municípios', hbars(s.municipio))}
        ${card('Aparelhos', hbars(s.dispositivos) + `<div class="g-mini">${s.instalado.map(x => `<span>${x.k === 'instalado' ? '📲 App instalado' : '🌐 Navegador'}: <b>${n(x.n)}</b></span>`).join('')}</div>`)}
        ${card('Leads e contato comercial', `<div class="g-mini col">
          <span>🔥 Quentes: <b>${n(s.leads.quentes)}</b></span><span>📞 A ligar: <b>${n(s.leads.a_ligar)}</b></span>
          <span>⏰ Atrasados: <b>${n(s.leads.atrasados)}</b></span><span>💬 Autorizaram contato e ainda não foram contatados: <b>${n(s.leads.sem_contato)}</b></span></div>
          <button class="btn btn-ghost" data-jump="quentes" style="margin-top:12px">Ver leads quentes</button>`)}
        ${card('Últimos acessos', s.ultimos.length ? `<ul class="g-list">${s.ultimos.map(e => `<li data-user="${e.user_id}"><b>${h(e.nome)}</b><span>${TIPOS[e.tipo] || e.tipo} · ${h(e.dispositivo || '')}</span><time>${ago(e.em)}</time></li>`).join('')}</ul>` : '<p class="g-empty">Sem acessos ainda.</p>')}
        ${card(`Quem mais usou (${per})`, s.top.length ? `<ul class="g-list">${s.top.map((u, i) => `<li data-user="${u.id}"><b>${i + 1}. ${h(u.nome)}</b><span>${h(u.empresa || '')} · ${n(u.acessos)} acessos</span><time>${horas(u.minutos)}</time></li>`).join('')}</ul>` : '<p class="g-empty">Sem uso registrado ainda.</p>')}
      </div>`;
    B.querySelectorAll('[data-user]').forEach(li => li.onclick = () => openUser(+li.dataset.user));
    const j = B.querySelector('[data-jump]'); if (j) j.onclick = () => { filtro = 'quentes'; root.querySelector('#gTabs [data-t="users"]').click(); };
  }

  /* ---------- usuários ---------- */
  const deadline = u => u.quente_desde ? new Date(u.quente_desde).getTime() + 48 * 3600e3 : null;
  const aLigar = u => !!(u.quente_desde && !u.contatado_em && u.status !== 'bloqueado');
  async function loadUsers(force){
    if (users && !force) return;
    const r = await api('/admin/users'); users = r.users;
  }
  async function renderUsers(){
    if (!users){ B.innerHTML = loading('Carregando usuários…'); try { await loadUsers(); } catch(e){ B.innerHTML = fail(e); return; } }
    const semana = Date.now() - 7 * 864e5;
    const F = { todos:() => true, quentes:aLigar, novos:u => new Date(u.criado_em) > semana, semcontato:u => u.contato_ok && !u.contatado_em && u.role !== 'admin',
      pendentes:u => u.status === 'pendente', bloqueados:u => u.status === 'bloqueado', adm:u => u.role === 'admin' };
    const cnt = k => users.filter(F[k]).length;
    const t = busca.toLowerCase();
    let list = users.filter(F[filtro]).filter(u => !t || [u.nome, u.email, u.whatsapp, u.empresa, u.municipio, u.uf].some(x => String(x || '').toLowerCase().includes(t)));
    const S = { recentes:(a, b) => new Date(b.criado_em) - new Date(a.criado_em), acesso:(a, b) => new Date(b.ultimo_acesso || 0) - new Date(a.ultimo_acesso || 0),
      uso:(a, b) => b.minutos - a.minutos, nome:(a, b) => a.nome.localeCompare(b.nome) };
    list.sort((a, b) => filtro === 'quentes' ? (deadline(a) - deadline(b)) : S[ordem](a, b));
    B.innerHTML = `
      <div class="u-tools">
        <input class="input" id="gSearch" placeholder="Buscar por nome, e-mail, WhatsApp, empresa ou cidade" value="${h(busca)}">
        <select class="input g-ord" id="gOrd"><option value="recentes">Mais recentes</option><option value="acesso">Último acesso</option><option value="uso">Mais uso</option><option value="nome">Nome (A–Z)</option></select>
        <a class="btn btn-ghost" href="/api/admin/export.csv" download>⬇ Exportar Excel (CSV)</a>
      </div>
      <div class="chips filters" id="gFil">${[['todos','Todos'],['quentes','🔥 Quentes a ligar'],['novos','Novos (7 dias)'],['semcontato','Sem contato comercial'],['pendentes','Pendentes'],['bloqueados','Bloqueados'],['adm','ADMs']]
        .map(([k, v]) => `<button data-f="${k}" class="${filtro === k ? 'sel' : ''}">${v} <small class="num">${cnt(k)}</small></button>`).join('')}</div>
      <div class="u-table">
        <div class="u-row u-head"><span>Usuário</span><span>Contato</span><span>Perfil</span><span>Local</span><span>Origem</span><span>Cadastro</span><span>Último acesso</span><span>Uso</span></div>
        ${list.length ? list.map(rowUser).join('') : `<p class="g-empty">Nenhum usuário encontrado.</p>`}
      </div>`;
    const s = B.querySelector('#gSearch');
    s.oninput = () => { busca = s.value; const p = s.selectionStart; renderUsers(); const x = B.querySelector('#gSearch'); x.focus(); x.setSelectionRange(p, p); };
    B.querySelector('#gOrd').value = ordem; B.querySelector('#gOrd').onchange = e => { ordem = e.target.value; renderUsers(); };
    B.querySelector('#gFil').onclick = e => { const b = e.target.closest('button'); if (b){ filtro = b.dataset.f; renderUsers(); } };
    B.querySelectorAll('.u-row[data-id]').forEach(r => r.onclick = e => { if (!e.target.closest('a')) openUser(+r.dataset.id); });
  }
  function tags(u){
    const t = [];
    const dl = deadline(u), late = aLigar(u) && dl < Date.now();
    if (u.quente_desde) t.push(`<span class="tag hot">🔥 Quente</span>`);
    if (aLigar(u)) t.push(`<span class="tag ${late ? 'late' : 'hot'}">${late ? 'Atrasado' : 'Ligar até ' + fmtDT(dl)}</span>`);
    if (u.contatado_em) t.push(`<span class="tag ok">Contatado</span>`);
    if (u.role === 'admin') t.push(`<span class="tag adm">ADM</span>`);
    if (u.status === 'pendente') t.push(`<span class="tag pend">Pendente</span>`);
    if (u.status === 'bloqueado') t.push(`<span class="tag blk">Bloqueado</span>`);
    return t.join('');
  }
  function rowUser(u){
    const wa = digits(u.whatsapp);
    return `<div class="u-row ${aLigar(u) ? (deadline(u) < Date.now() ? 'late' : 'hot') : ''}" data-id="${u.id}">
      <span class="u-name"><b>${h(u.nome)}</b><small>${h(u.empresa || 'Empresa não informada')}</small><span class="u-tags">${tags(u)}</span></span>
      <span class="u-ct"><small>${h(u.email)}</small>${wa ? `<a class="u-wa" href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp ${h(phonePretty(u.whatsapp))}</a>` : ''}</span>
      <span>${h([L().PERFIS[u.perfil], L().FUNCOES[u.funcao]].filter(Boolean).join(' · ') || '–')}<small>${h(L().AREAS[u.area_faixa] || '')}</small></span>
      <span>${h(u.municipio ? u.municipio + '/' + (u.uf || '') : '–')}</span>
      <span>${h(lbl('ORIGENS', u.origem))}${u.origem_outro ? `<small>${h(u.origem_outro)}</small>` : ''}</span>
      <span class="num">${fmtD(u.criado_em)}</span>
      <span class="num">${ago(u.ultimo_acesso)}<small>${h(u.ult_disp || '')}</small></span>
      <span class="num">${n(u.acessos)} acessos<small>${horas(u.minutos)} · ${n(u.mapas)} mapas</small></span>
    </div>`;
  }

  /* ---------- detalhe do usuário ---------- */
  const drawer = $g('#gDrawer');
  function closeDrawer(){ drawer.classList.remove('open'); $g('#gScrim').classList.remove('show'); }
  async function openUser(id){
    drawer.innerHTML = loading(); drawer.classList.add('open'); $g('#gScrim').classList.add('show');
    if (!users){ try { await loadUsers(); } catch(_){} }
    let d; try { d = await api('/admin/users/' + id); } catch(e){ drawer.innerHTML = fail(e); return; }
    const u = d.user, me = window.MGEO_AUTH.user && window.MGEO_AUTH.user.id === u.id;
    const full = (users || []).find(x => x.id === id) || {};
    const wa = digits(u.whatsapp), first = String(u.nome).split(' ')[0];
    const waMsg = encodeURIComponent(`Olá ${first}, tudo bem? Aqui é da MGEO Tecnologia. Vi que você usa o MGEO PDF e queria conversar sobre ${u.interesses && u.interesses.length ? u.interesses[0].toLowerCase() : 'como podemos ajudar na sua operação'}.`);
    const uso30 = []; for (let i = 29; i >= 0; i--){ const k = new Date(Date.now() - 3 * 3600e3 - i * 864e5).toISOString().slice(0, 10); uso30.push({ k, m:(d.uso.find(x => x.dia === k) || {}).minutos || 0 }); }
    const row = (k, v) => v ? `<div class="kv"><span>${k}</span><b>${v}</b></div>` : '';
    drawer.innerHTML = `
      <div class="d-head"><button class="icon-btn" id="dClose" aria-label="Fechar">✕</button><div><h3>${h(u.nome)}</h3><div class="u-tags">${tags(u)}</div></div></div>
      <div class="d-body">
        <div class="d-contact">
          ${wa ? `<a class="u-wa big" href="https://wa.me/${wa}?text=${waMsg}" target="_blank" rel="noopener">💬 WhatsApp</a><a class="btn btn-ghost" href="tel:+${wa}">📞 Ligar</a>` : ''}
          <a class="btn btn-ghost" href="mailto:${h(u.email)}">✉️ E-mail</a>
        </div>
        <div class="d-sec"><h4>Contato comercial</h4>
          ${u.contato_ok ? `<p class="hint">✓ Autorizou contato comercial em ${fmtDT(u.contato_em)}</p>` : `<p class="hint">⚠ Não autorizou contato comercial</p>`}
          <button class="btn ${u.contatado_em ? 'btn-ghost' : 'btn-primary'} wide" id="dCont">${u.contatado_em ? `Contatado em ${fmtDT(u.contatado_em)}${u.contatado_por ? ' por ' + h(u.contatado_por) : ''} · desmarcar` : 'Marcar como contatado'}</button>
          <label class="field"><span>Anotações da equipe comercial</span><textarea class="input area" id="dObs" maxlength="2000" placeholder="Ex.: ligou em 20/11, pediu proposta de drone para 3 fazendas…">${h(u.obs || '')}</textarea></label>
          <button class="btn btn-ghost" id="dObsGo">Salvar anotação</button>
        </div>
        <div class="d-sec"><h4>Cadastro</h4>
          ${row('E-mail', h(u.email))}${row('WhatsApp', h(phonePretty(u.whatsapp)))}${row('Perfil', h(L().PERFIS[u.perfil]))}${row('Função', h(L().FUNCOES[u.funcao]))}
          ${row('Município', h(u.municipio ? u.municipio + '/' + (u.uf || '') : ''))}${row('Empresa', h(u.empresa))}${row('Área', h(L().AREAS[u.area_faixa]))}
          ${row('Interesses', h((u.interesses || []).join(', ')))}${row('Conheceu por', h(lbl('ORIGENS', u.origem) + (u.origem_outro ? ' – ' + u.origem_outro : '')))}
          ${row('Cadastro', fmtDT(u.criado_em) + (u.criado_por ? ' · por ' + h(u.criado_por) : ''))}${row('Termos aceitos', u.termos_em ? fmtDT(u.termos_em) + ' (versão ' + h(u.termos_versao) + ')' : '')}
        </div>
        <div class="d-sec"><h4>Uso do aplicativo</h4>
          <div class="kpis mini">${kpi(n(full.acessos), 'acessos')}${kpi(horas(full.minutos || 0), 'de uso')}${kpi(n(full.mapas), 'GeoPDFs')}${kpi(ago(u.ultimo_acesso), 'último acesso')}</div>
          ${barChart(uso30.map(x => x.k.slice(8, 10) + '/' + x.k.slice(5, 7)), uso30.map(x => x.m), '#8E6CF0', 'min')}
          <ul class="g-list tight">${d.eventos.slice(0, 40).map(e => `<li><b>${TIPOS[e.tipo] || e.tipo}</b><span>${h(e.dispositivo || '')}${e.meta && e.tipo === 'offline_download' ? ' · ' + Math.round((JSON.parse(e.meta).bytes || 0) / 1024) + ' KB' : ''}</span><time>${fmtDT(e.em)}</time></li>`).join('') || '<p class="g-empty">Sem atividade.</p>'}</ul>
        </div>
        <div class="d-sec"><h4>Acesso</h4>
          <div class="d-actions">
            ${u.status !== 'ativo' ? `<button class="btn btn-primary" data-act="ativar">Liberar acesso</button>` : ''}
            ${u.status !== 'bloqueado' && !me ? `<button class="btn btn-ghost danger" data-act="bloquear">Bloquear</button>` : ''}
            ${!me ? `<button class="btn btn-ghost" data-act="role">${u.role === 'admin' ? 'Remover ADM' : 'Tornar ADM'}</button>` : ''}
            <button class="btn btn-ghost" data-act="senha">Gerar nova senha</button>
            ${!me ? `<button class="btn btn-ghost danger" data-act="excluir">Excluir dados (LGPD)</button>` : ''}
          </div>
          <div id="dOut"></div>
        </div>
      </div>`;
    const q = s => drawer.querySelector(s);
    q('#dClose').onclick = closeDrawer;
    const patch = async (body, okMsg) => {
      try { const r = await api('/admin/users/' + id, { method:'PATCH', body }); if (users){ const i = users.findIndex(x => x.id === id); if (i >= 0) users[i] = r.user; } stats = null; toast(okMsg || 'Atualizado'); openUser(id); if (tab === 'users') renderUsers(); }
      catch(e){ toast(e.message, true); }
    };
    q('#dCont').onclick = () => patch({ contatado: !u.contatado_em }, u.contatado_em ? 'Contato desmarcado' : 'Marcado como contatado');
    q('#dObsGo').onclick = () => patch({ obs: q('#dObs').value }, 'Anotação salva');
    drawer.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
      const a = b.dataset.act;
      if (a === 'ativar') return patch({ status:'ativo' }, 'Acesso liberado');
      if (a === 'bloquear' && confirm(`Bloquear o acesso de ${u.nome}? Ele sai do app na próxima conexão.`)) return patch({ status:'bloqueado' }, 'Usuário bloqueado');
      if (a === 'role' && confirm(u.role === 'admin' ? `Remover o ADM de ${u.nome}?` : `Dar acesso ADM para ${u.nome}? Ele verá todos os dados de usuários.`)) return patch({ role: u.role === 'admin' ? 'cliente' : 'admin' });
      if (a === 'senha' && confirm(`Gerar uma nova senha para ${u.nome}? A senha atual deixa de funcionar.`)){
        try { const r = await api(`/admin/users/${id}/senha`, { method:'POST' });
          const txt = `Sua nova senha do MGEO PDF: ${r.senha}\nEntre com o e-mail ${u.email} e troque a senha em Minha conta.`;
          q('#dOut').innerHTML = `<div class="cred">Nova senha: <code>${h(r.senha)}</code><br><button class="btn btn-ghost" id="dCopy" style="margin-top:8px">Copiar</button>${wa ? ` <a class="u-wa" href="https://wa.me/${wa}?text=${encodeURIComponent(txt)}" target="_blank" rel="noopener">Enviar por WhatsApp</a>` : ''}</div>`;
          q('#dCopy').onclick = () => navigator.clipboard.writeText(txt).then(() => toast('Copiado'));
        } catch(e){ toast(e.message, true); }
      }
      if (a === 'excluir'){
        const c = prompt(`Isto apaga TODOS os dados de ${u.nome} (pedido LGPD) e não tem volta.\nDigite EXCLUIR para confirmar:`);
        if (c !== 'EXCLUIR') return;
        try { await api('/admin/users/' + id, { method:'DELETE' }); users = users && users.filter(x => x.id !== id); stats = null; closeDrawer(); toast('Dados excluídos'); render(); }
        catch(e){ toast(e.message, true); }
      }
    });
  }

  /* ---------- registro de acessos ---------- */
  async function renderAcessos(more){
    if (!more){ B.innerHTML = loading('Carregando acessos…'); evList = []; }
    let r;
    try { r = await api(`/admin/eventos?limit=150${evTipo ? '&tipo=' + evTipo : ''}${more && evList.length ? '&antes=' + evList[evList.length - 1].id : ''}`); }
    catch(e){ B.innerHTML = fail(e); return; }
    evList = evList.concat(r.eventos);
    B.innerHTML = `
      <div class="chips filters" id="gEv">${[['', 'Todos'], ['login', 'Entradas'], ['app_open', 'Aberturas do app'], ['cadastro', 'Cadastros'], ['map_import', 'GeoPDFs importados'], ['offline_download', 'Downloads offline'], ['gps_on', 'GPS']]
        .map(([k, v]) => `<button data-t="${k}" class="${evTipo === k ? 'sel' : ''}">${v}</button>`).join('')}</div>
      <div class="g-card"><ul class="g-list log">${evList.map(e => `<li data-user="${e.user_id || ''}"><b>${h(e.nome || 'Usuário excluído')}</b><span>${TIPOS[e.tipo] || e.tipo}${e.empresa ? ' · ' + h(e.empresa) : ''} · ${h(e.dispositivo || '')}</span><time>${fmtDT(e.em)}</time></li>`).join('') || '<p class="g-empty">Nada registrado.</p>'}</ul>
      ${r.eventos.length === 150 ? `<button class="btn btn-ghost wide" id="gMore">Carregar mais</button>` : ''}</div>`;
    B.querySelector('#gEv').onclick = e => { const b = e.target.closest('button'); if (b){ evTipo = b.dataset.t; renderAcessos(); } };
    B.querySelectorAll('[data-user]').forEach(li => { if (li.dataset.user) li.onclick = () => openUser(+li.dataset.user); });
    const m = B.querySelector('#gMore'); if (m) m.onclick = () => renderAcessos(true);
  }

  /* ---------- ajustes ---------- */
  async function renderAjustes(){
    if (!cfg){ B.innerHTML = loading(); try { cfg = await api('/admin/config'); } catch(e){ B.innerHTML = fail(e); return; } }
    const P = L().PERFIS, F = L().FUNCOES;
    B.innerHTML = `<div class="g-grid2">
      ${card('Cadastros', `<div class="row"><div>Liberar novos cadastros automaticamente<small>Desligado: cada conta nova fica pendente até um ADM liberar</small></div>
        <label class="switch"><input type="checkbox" id="cfAuto" ${cfg.auto_aprovar ? 'checked' : ''}><span></span></label></div>
        <div class="row"><div>Recuperação de senha por e-mail<small>${cfg.email_configurado ? 'Ligada: o cliente recebe o código no e-mail' : 'Desligada: configure o SMTP no servidor. Até lá, gere a senha pelo painel.'}</small></div><span class="tag ${cfg.email_configurado ? 'ok' : 'pend'}">${cfg.email_configurado ? 'Ativa' : 'Inativa'}</span></div>
        <a class="btn btn-ghost" href="/api/admin/export.csv" download style="margin-top:12px">⬇ Exportar todos os usuários (CSV)</a>`)}
      ${card('Criar usuário', `<p class="hint">O usuário entra com o e-mail e a senha gerada e pode trocá-la em Minha conta.</p>
        <label class="field"><span>Nome completo</span><input class="input" id="nwNome" maxlength="80"></label>
        <label class="field"><span>E-mail</span><input class="input" id="nwMail" type="email" maxlength="190"></label>
        <label class="field"><span>WhatsApp (opcional)</span><input class="input num" id="nwTel" type="tel" placeholder="(18) 99999-9999"></label>
        <div class="two"><label class="field"><span>Perfil</span><select class="input" id="nwPerfil"><option value="">–</option>${Object.entries(P).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label class="field"><span>Função</span><select class="input" id="nwFuncao"><option value="">–</option>${Object.entries(F).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label></div>
        <div class="field"><span>Tipo de acesso</span><div class="chips" id="nwRole"><button data-v="cliente" class="sel">Cliente</button><button data-v="admin">ADM</button></div></div>
        <div class="err" id="nwErr"></div><button class="btn btn-primary wide" id="nwGo">Criar usuário</button><div id="nwOut"></div>`)}
      ${card('Segurança', `<p class="hint">Senhas guardadas com criptografia (scrypt), nunca em texto. Sessões com cookie protegido (HttpOnly), bloqueio por tentativas, proteção contra CSRF e cabeçalhos de segurança. Somente ADMs ativos acessam este painel; a checagem é feita no servidor.</p>`)}
    </div>`;
    const q = s => B.querySelector(s);
    q('#cfAuto').onchange = async e => { try { cfg = await api('/admin/config', { method:'PATCH', body:{ auto_aprovar:e.target.checked } }); toast(cfg.auto_aprovar ? 'Novos cadastros entram liberados' : 'Novos cadastros ficam pendentes'); } catch(err){ e.target.checked = !e.target.checked; toast(err.message, true); } };
    q('#nwRole').onclick = e => { const b = e.target.closest('button'); if (b) B.querySelectorAll('#nwRole button').forEach(x => x.classList.toggle('sel', x === b)); };
    q('#nwGo').onclick = async () => {
      const err = q('#nwErr'); err.textContent = '';
      try {
        const r = await api('/admin/users', { method:'POST', body:{ nome:q('#nwNome').value, email:q('#nwMail').value, whatsapp:q('#nwTel').value, perfil:q('#nwPerfil').value, funcao:q('#nwFuncao').value, role:q('#nwRole .sel').dataset.v } });
        if (users) users.unshift(r.user); stats = null;
        const wa = digits(r.user.whatsapp), txt = `Seu acesso ao MGEO PDF:\nE-mail: ${r.user.email}\nSenha: ${r.senha}\nTroque a senha em Minha conta depois do primeiro acesso.`;
        q('#nwOut').innerHTML = `<div class="cred">✅ Usuário criado<br>E-mail: <code>${h(r.user.email)}</code><br>Senha: <code>${h(r.senha)}</code><br><button class="btn btn-ghost" id="nwCopy" style="margin-top:8px">Copiar dados</button>${wa ? ` <a class="u-wa" href="https://wa.me/${wa}?text=${encodeURIComponent(txt)}" target="_blank" rel="noopener">Enviar por WhatsApp</a>` : ''}</div>`;
        q('#nwCopy').onclick = () => navigator.clipboard.writeText(txt).then(() => toast('Copiado'));
        ['#nwNome', '#nwMail', '#nwTel'].forEach(s => q(s).value = '');
      } catch(e){ err.textContent = e.message; }
    };
  }
})();
