/* MGEO PDF – baixar o fundo (Google Satélite/Mapa) para usar sem internet */
'use strict';
(function(){
  const MAX_TILES = 40000;
  const AVG = { s: 19000, y: 24000, m: 9000 };          // tamanho médio por bloco (bytes) até medir de verdade
  const LYR_NAME = { s:'Satélite', y:'Híbrido', m:'Mapa' };
  const Z_NAME = { 17:'Médio', 18:'Alto', 19:'Muito alto', 20:'Máximo' };
  const measured = {};
  let state = { area:'pdf', lyr:'s', zmax:18 };
  let running = null;

  /* ---------- tela ---------- */
  const sheet = document.createElement('section');
  sheet.className = 'sheet'; sheet.id = 'sheetOffline'; sheet.setAttribute('aria-label', 'Fundo offline');
  sheet.innerHTML = `
    <div class="grab"></div>
    <div class="sheet-head"><h2>Fundo offline</h2></div>
    <div class="sheet-body">
      <p class="hint">Baixe a imagem do fundo uma vez com internet. Depois ela aparece no campo, mesmo sem sinal.</p>
      <div class="label">Área</div>
      <div class="chips" id="offArea">
        <button data-a="pdf">GeoPDF aberto</button><button data-a="view">Área da tela</button>
      </div>
      <div class="label">Fundo</div>
      <div class="chips" id="offLyr">
        <button data-l="s">Satélite</button><button data-l="y">Híbrido</button><button data-l="m">Mapa</button>
      </div>
      <div class="label">Nível de detalhe</div>
      <div class="chips" id="offZ">
        <button data-z="17">Médio</button><button data-z="18">Alto</button><button data-z="19">Muito alto</button><button data-z="20">Máximo</button>
      </div>
      <div class="est" id="offEst">
        <span class="est-k">Tamanho do download</span>
        <b class="num" id="offSize">–</b>
        <span class="num" id="offInfo"></span>
      </div>
      <div class="prog" id="offProg" hidden>
        <div class="prog-bar"><i id="offBar"></i></div>
        <div class="prog-row num"><span id="offProgTxt"></span><button class="link" id="offCancel">Cancelar</button></div>
      </div>
      <button class="btn btn-primary wide" id="offGo">Baixar</button>
      <div class="label">Áreas baixadas</div>
      <ul class="list" id="offPacks"></ul>
      <div class="storage num" id="offTotal"></div>
    </div>`;
  document.body.appendChild(sheet);

  // botão dentro da folha de Camadas
  const lay = document.querySelector('#sheetLayers .sheet-body');
  const lbl = document.createElement('div'); lbl.className = 'label'; lbl.textContent = 'Sem internet';
  const row = document.createElement('button'); row.className = 'row row-btn'; row.id = 'btnOffline';
  row.innerHTML = `<div>Baixar fundo para offline<small id="offRowInfo">Satélite ou mapa, com o tamanho em KB</small></div>
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>`;
  lay.insertBefore(row, lay.querySelector('.label'));
  lay.insertBefore(lbl, row);
  row.onclick = () => { openSheet('#sheetOffline'); syncUI(); renderPacks(); };

  const q = s => sheet.querySelector(s);

  /* ---------- contas ---------- */
  const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
  const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };
  const clamp = (v, z) => Math.max(0, Math.min(2 ** z - 1, v));
  function bounds(){
    if (state.area === 'pdf' && current) return current.bounds.pad(0.15);
    return map.getBounds();
  }
  function ranges(b, zmin, zmax){
    const out = {};
    for (let z = zmin; z <= zmax; z++){
      out[z] = [clamp(lon2x(b.getWest(), z), z), clamp(lon2x(b.getEast(), z), z), clamp(lat2y(Math.min(85, b.getNorth()), z), z), clamp(lat2y(Math.max(-85, b.getSouth()), z), z)];
    }
    return out;
  }
  const countOf = r => Object.values(r).reduce((s, [x0, x1, y0, y1]) => s + (x1 - x0 + 1) * (y1 - y0 + 1), 0);
  function* tilesOf(r){ for (const z in r){ const [x0, x1, y0, y1] = r[z]; for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) yield [+z, x, y]; } }
  function params(){
    const zmax = state.zmax, zmin = Math.min(zmax, 10), b = bounds(), r = ranges(b, zmin, zmax);
    return { b, zmin, zmax, r, n: countOf(r), lyr: state.lyr };
  }
  function fmtBytes(b){
    const kb = b / 1024;
    if (kb < 1024) return `${Math.max(1, Math.round(kb)).toLocaleString('pt-BR')} KB`;
    return `${(kb / 1024).toLocaleString('pt-BR', { maximumFractionDigits:1, minimumFractionDigits:1 })} MB`;
  }
  const kbFull = b => `${Math.max(1, Math.round(b / 1024)).toLocaleString('pt-BR')} KB`;
  function avgFor(lyr, z){ return measured[lyr + z] || AVG[lyr]; }

  /* mede o tamanho real baixando alguns blocos de amostra */
  let measureT = null;
  async function measure(){
    const p = params(); const key = p.lyr + p.zmax;
    if (measured[key] || !navigator.onLine) return;
    const [x0, x1, y0, y1] = p.r[p.zmax]; const pts = [];
    for (let i = 0; i < 5; i++){ pts.push([Math.round(x0 + (x1 - x0) * (i + .5) / 5), Math.round(y0 + (y1 - y0) * ((i * 3) % 5 + .5) / 5)]); }
    let sum = 0, n = 0;
    await Promise.all(pts.map(async ([x, y]) => {
      try { const r = await fetch(tileUrl(p.lyr, p.zmax, x, y), { mode:'cors', credentials:'omit' }); if (r.ok){ const len = (await r.arrayBuffer()).byteLength; sum += len; n++; } } catch(_){}
    }));
    if (n){ measured[key] = Math.round(sum / n); if (key === state.lyr + state.zmax) syncUI(true); }
  }

  /* ---------- interface ---------- */
  function syncUI(skipMeasure){
    if (!current && state.area === 'pdf') state.area = 'view';
    q('#offArea [data-a="pdf"]').disabled = !current;
    sheet.querySelectorAll('#offArea button').forEach(b => b.classList.toggle('sel', b.dataset.a === state.area));
    sheet.querySelectorAll('#offLyr button').forEach(b => b.classList.toggle('sel', b.dataset.l === state.lyr));
    sheet.querySelectorAll('#offZ button').forEach(b => b.classList.toggle('sel', +b.dataset.z === state.zmax));
    const p = params(), est = p.n * avgFor(p.lyr, p.zmax);
    const exact = !!measured[p.lyr + p.zmax];
    q('#offSize').textContent = p.n > MAX_TILES ? 'Área grande demais' : `≈ ${fmtBytes(est)}`;
    q('#offInfo').textContent = p.n > MAX_TILES
      ? `${p.n.toLocaleString('pt-BR')} blocos. Diminua a área ou o detalhe (máx. ${MAX_TILES.toLocaleString('pt-BR')}).`
      : `${kbFull(est)} · ${p.n.toLocaleString('pt-BR')} blocos · zoom ${p.zmin} a ${p.zmax}${exact ? ' · medido agora' : ' · estimativa'}`;
    q('#offEst').classList.toggle('bad', p.n > MAX_TILES);
    const go = q('#offGo');
    go.disabled = !!running || p.n > MAX_TILES || p.n === 0;
    go.textContent = running ? 'Baixando…' : `Baixar ${p.n > MAX_TILES ? '' : '(' + fmtBytes(est) + ')'}`;
    if (!skipMeasure){ clearTimeout(measureT); measureT = setTimeout(measure, 350); }
  }
  q('#offArea').onclick = e => { const b = e.target.closest('button'); if (b && !b.disabled){ state.area = b.dataset.a; syncUI(); } };
  q('#offLyr').onclick = e => { const b = e.target.closest('button'); if (b){ state.lyr = b.dataset.l; syncUI(); } };
  q('#offZ').onclick = e => { const b = e.target.closest('button'); if (b){ state.zmax = +b.dataset.z; syncUI(); } };
  map.on('moveend', () => { if (sheet.classList.contains('open') && state.area === 'view') syncUI(); });

  async function renderPacks(){
    let packs = [];
    try { packs = (await TileStore.packs()).sort((a, b) => b.date - a.date); } catch(_){}
    const ul = q('#offPacks');
    if (!packs.length){ ul.innerHTML = `<li class="empty small">Nenhuma área baixada ainda.</li>`; q('#offTotal').textContent = ''; document.getElementById('offRowInfo').textContent = 'Satélite ou mapa, com o tamanho em KB'; return; }
    ul.innerHTML = packs.map(p => `
      <li class="item">
        <button class="item-open" data-go="${p.id}">
          <span class="pack-ico">${p.lyr === 'm' ? '🗺️' : '🛰️'}</span>
          <span class="item-info"><b>${esc(p.name)}</b><span class="num">${LYR_NAME[p.lyr]} · ${Z_NAME[p.zmax] || 'zoom ' + p.zmax} · ${fmtBytes(p.bytes)} (${kbFull(p.bytes)})${p.done ? '' : ' · incompleto'}</span></span>
        </button>
        <button class="icon-btn" data-del="${p.id}" aria-label="Excluir ${esc(p.name)}">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
        </button>
      </li>`).join('');
    const tot = packs.reduce((s, p) => s + (p.bytes || 0), 0);
    q('#offTotal').textContent = `${packs.length} ${packs.length > 1 ? 'áreas' : 'área'} · ${fmtBytes(tot)} (${kbFull(tot)}) guardados no celular`;
    document.getElementById('offRowInfo').textContent = `${packs.length} ${packs.length > 1 ? 'áreas baixadas' : 'área baixada'} · ${fmtBytes(tot)}`;
  }

  q('#offPacks').onclick = async e => {
    const go = e.target.closest('[data-go]'), del = e.target.closest('[data-del]');
    const packs = await TileStore.packs();
    if (go){
      const p = packs.find(x => x.id === go.dataset.go); if (!p) return;
      closeSheets(); setBase(p.lyr); map.fitBounds([[p.bounds[0], p.bounds[1]], [p.bounds[2], p.bounds[3]]]);
    }
    if (del){
      const p = packs.find(x => x.id === del.dataset.del); if (!p) return;
      if (!confirm(`Excluir a área “${p.name}” (${fmtBytes(p.bytes)}) do celular?`)) return;
      busy(true, 'Excluindo área', p.name);
      try {
        const others = packs.filter(x => x.id !== p.id && x.lyr === p.lyr);
        const covered = (z, x, y) => others.some(o => { const r = o.ranges[z]; return r && x >= r[0] && x <= r[1] && y >= r[2] && y <= r[3]; });
        let keys = [];
        for (const [z, x, y] of tilesOf(p.ranges)){
          if (covered(z, x, y)) continue;
          keys.push(`${p.lyr}/${z}/${x}/${y}`);
          if (keys.length >= 500){ await TileStore.delMany(keys); keys = []; }
        }
        if (keys.length) await TileStore.delMany(keys);
        if (p.cacheMode && 'caches' in window){
          const c = await caches.open('mgeo-tiles-v1');
          for (const [z, x, y] of tilesOf(p.ranges)) if (!covered(z, x, y)) await c.delete(tileUrl(p.lyr, z, x, y));
        }
        await TileStore.delPack(p.id);
        toast('Área excluída');
      } catch(err){ toast('Não foi possível excluir: ' + err.message, true); }
      busy(false); renderPacks();
    }
  };

  /* ---------- download ---------- */
  q('#offCancel').onclick = () => { if (running) running.abort = true; };
  q('#offGo').onclick = async () => {
    if (running) return;
    if (!navigator.onLine){ toast('Conecte-se à internet para baixar o fundo.', true); return; }
    const p = params();
    if (p.n > MAX_TILES || !p.n) return;
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch(_){}
    const name = state.area === 'pdf' && current ? current.name : `Área da tela (${new Date().toLocaleDateString('pt-BR')})`;
    const pack = { id: Date.now().toString(36), name, lyr:p.lyr, zmin:p.zmin, zmax:p.zmax, ranges:p.r,
      bounds:[p.b.getSouth(), p.b.getWest(), p.b.getNorth(), p.b.getEast()], bytes:0, count:0, done:false, cacheMode:false, date:Date.now() };
    await TileStore.putPack(pack);
    running = { abort:false };
    const est = p.n * avgFor(p.lyr, p.zmax);
    q('#offProg').hidden = false; syncUI(true);
    let done = 0, fail = 0, bytes = 0, buf = [], last = 0, noCors = 0;
    const show = force => {
      const t = performance.now(); if (!force && t - last < 250) return; last = t;
      q('#offBar').style.width = (100 * done / p.n).toFixed(1) + '%';
      q('#offProgTxt').textContent = `${done.toLocaleString('pt-BR')} de ${p.n.toLocaleString('pt-BR')} · ${kbFull(bytes)} de ≈ ${kbFull(Math.max(est, bytes))}`;
    };
    const flush = async () => { if (buf.length){ const b = buf; buf = []; await TileStore.putMany(b); } };
    const it = tilesOf(p.r);
    const cache = 'caches' in window ? await caches.open('mgeo-tiles-v1').catch(() => null) : null;
    async function worker(){
      for (let nx = it.next(); !nx.done; nx = it.next()){
        if (running.abort) return;
        const [z, x, y] = nx.value, key = `${p.lyr}/${z}/${x}/${y}`, url = tileUrl(p.lyr, z, x, y);
        try {
          const ex = await TileStore.get(key);
          if (ex && ex.d){ bytes += ex.d.byteLength; }
          else {
            let ok = false;
            if (noCors < 8){
              try {
                const r = await fetch(url, { mode:'cors', credentials:'omit' });
                if (r.ok){ const d = await r.arrayBuffer(); buf.push([key, { d, t: r.headers.get('content-type') || 'image/jpeg' }]); bytes += d.byteLength; ok = true; noCors = 0; }
              } catch(e){ noCors++; }
            }
            if (!ok && cache){ // servidor sem CORS: guarda no cache do app (precisa do link https)
              const r = await fetch(url, { mode:'no-cors' }); await cache.put(url, r); bytes += avgFor(p.lyr, p.zmax); pack.cacheMode = true; ok = true;
            }
            if (!ok) fail++;
            if (buf.length >= 25) await flush();
          }
        } catch(err){ fail++; if (err && err.name === 'QuotaExceededError'){ running.abort = true; toast('Acabou o espaço do celular.', true); } }
        done++; show();
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker));
    try { await flush(); } catch(err){ toast('Acabou o espaço do celular.', true); }
    show(true);
    pack.bytes = bytes; pack.count = done - fail; pack.done = !running.abort && fail === 0;
    await TileStore.putPack(pack);
    const aborted = running.abort; running = null;
    q('#offProg').hidden = true; syncUI(true); renderPacks();
    if (aborted) toast(`Download interrompido. ${fmtBytes(bytes)} já ficaram salvos.`);
    else if (fail) toast(`${fail} blocos falharam. Toque em Baixar de novo para completar.`, true);
    else toast(`Fundo salvo: ${fmtBytes(bytes)} (${kbFull(bytes)})`);
  };

  window.MGEO_OFFLINE = { refresh: renderPacks };
  TileStore.open().then(renderPacks).catch(() => {});
})();
