/* MGEO Campo — mapa, rotas, levantamento, NDVI e indicadores. Funciona offline (PWA). */
(() => {
'use strict';

/* ================= Configuração ================= */
const CFG = {
  sat: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  ref: [
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
  ],
  satMaxZoom: 17,
  osrm: 'https://router.project-osrm.org/route/v1/driving/',
  stac: 'https://earth-search.aws.element84.com/v1/search',
  maxCloud: 20,
  labelZoom: 13
};

/* ================= Utilidades ================= */
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (v, d = 0) => v == null || isNaN(v) ? '–' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const dBR = s => s ? s.split('-').reverse().join('/') : '–';
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const safraOf = s => { if (!s) return null; const y = +s.slice(0, 4), m = +s.slice(5, 7); const a = m >= 4 ? y : y - 1; return `${String(a).slice(2)}/${String(a + 1).slice(2)}`; };
const today = new Date();
const SAFRA_ATUAL = safraOf(today.toISOString().slice(0, 10));
const isMobile = () => matchMedia('(max-width: 899px)').matches;
const canEdit = () => isMobile() || matchMedia('(display-mode: standalone)').matches;

let toastT;
function toast(msg, ms = 3200) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}

/* ================= Banco local (IndexedDB) ================= */
const DB = {
  open() {
    return this._p ||= new Promise((res, rej) => {
      const r = indexedDB.open('mgeo', 1);
      r.onupgradeneeded = () => ['edits', 'ndvi', 'kv'].forEach(s => r.result.createObjectStore(s));
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  },
  async tx(store, mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode); const out = fn(t.objectStore(store));
      t.oncomplete = () => res(out && 'result' in out ? out.result : undefined); t.onerror = () => rej(t.error);
    });
  },
  get: (s, k) => DB.tx(s, 'readonly', o => o.get(k)),
  set: (s, k, v) => DB.tx(s, 'readwrite', o => o.put(v, k)),
  del: (s, k) => DB.tx(s, 'readwrite', o => o.delete(k)),
  clear: s => DB.tx(s, 'readwrite', o => o.clear()),
  async all(s) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const out = []; const c = db.transaction(s).objectStore(s).openCursor();
      c.onsuccess = () => { const cur = c.result; if (cur) { out.push([cur.key, cur.value]); cur.continue(); } else res(out); };
      c.onerror = () => rej(c.error);
    });
  }
};

/* ================= Estado ================= */
const S = {
  feats: [], byFid: new Map(), farms: new Map(), edits: new Map(), ndvi: new Map(), offline: new Set(),
  theme: 'corte', label: 'talhao', opacity: .55, selFarm: null, selFid: null, route: null, me: null
};

function farmKey(p) { return p.fa == null && !p.faz ? `|Sem cadastro (${p.mun || 'sem município'})` : `${p.fa ?? ''}|${p.faz ?? 'Sem nome'}`; }

function centroid(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  let best = null, bestA = -1;
  for (const poly of polys) {
    const r = poly[0]; let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
      a += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f;
    }
    if (Math.abs(a) > bestA && a !== 0) { bestA = Math.abs(a); best = [cx / (3 * a), cy / (3 * a)]; }
  }
  return best || polys[0][0][0];
}
function bboxOf(geom, b = [180, 90, -180, -90]) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) for (const [x, y] of poly[0]) {
    if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
  }
  return b;
}
function inGeom(x, y, geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  let inside = false;
  for (const poly of polys) for (const r of poly) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if ((r[i][1] > y) !== (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) inside = !inside;
  }
  return inside;
}

function indexData(fc) {
  S.feats = fc.features; S.byFid.clear(); S.farms.clear();
  for (const f of S.feats) {
    const p = f.properties;
    const e = S.edits.get(p.fid); if (e) Object.assign(p, e.props);
    f.c = centroid(f.geometry); f.bb = bboxOf(f.geometry);
    S.byFid.set(p.fid, f);
    const k = farmKey(p);
    let fm = S.farms.get(k);
    if (!fm) S.farms.set(k, fm = { key: k, fa: p.fa, faz: p.faz || k.split('|')[1], assoc: p.assoc, mun: p.mun, feats: [], area: 0, bb: [180, 90, -180, -90] });
    fm.feats.push(f); fm.area += p.area || 0; bboxOf(f.geometry, fm.bb);
  }
  for (const fm of S.farms.values()) {
    fm.feats.sort((a, b) => (a.properties.talhao ?? 999) - (b.properties.talhao ?? 999));
    fm.c = [(fm.bb[0] + fm.bb[2]) / 2, (fm.bb[1] + fm.bb[3]) / 2];
    const nd = S.ndvi.get(fm.key);
    if (nd) for (const f of fm.feats) f.properties.ndvi = nd.means[f.properties.fid] ?? null;
  }
}

/* ================= Temas (cores) ================= */
const NDVI_STOPS = [[.1, [140, 81, 10]], [.3, [246, 194, 68]], [.5, [217, 239, 139]], [.7, [102, 189, 99]], [.9, [26, 104, 55]]];
function ndviRGB(v) {
  if (v <= NDVI_STOPS[0][0]) return NDVI_STOPS[0][1];
  for (let i = 1; i < NDVI_STOPS.length; i++) if (v <= NDVI_STOPS[i][0]) {
    const [a, ca] = NDVI_STOPS[i - 1], [b, cb] = NDVI_STOPS[i], t = (v - a) / (b - a);
    return ca.map((c, k) => Math.round(c + (cb[k] - c) * t));
  }
  return NDVI_STOPS[NDVI_STOPS.length - 1][1];
}
const GREY = '#9aa0a6';
const CORTE_RAMP = ['#fff3c4', '#ffd75e', '#f6a81c', '#e57f0c', '#c9510c', '#9c2f12', '#6e1b1b', '#4a1230', '#2e0d3a'];
const TEC_COL = ['#f6a81c', '#2a9df4', '#e0457b', '#3cb878', '#9b6bdf'];
const catColor = i => `hsl(${(i * 137.5 + 38) % 360} ${i % 2 ? 62 : 74}% ${i % 3 ? 54 : 44}%)`;

const THEMES = {
  corte: { title: 'Corte', val: p => p.corte, sort: (a, b) => (isNaN(a) - isNaN(b)) || (isNaN(a) ? a.localeCompare(b) : a - b),
    color: (v) => { const n = +v; return v !== null && !isNaN(n) && n <= 12 ? CORTE_RAMP[Math.min(n, 8)] : '#7b8794'; },
    name: v => isNaN(v) ? v : +v === 0 ? 'Cana planta (0)' : +v > 12 ? `${v} (conferir)` : `${v}º corte` },
  varied: { title: 'Variedade', val: p => p.varied },
  mes: { title: 'Mês da colheita', val: p => p.dt_colh ? p.dt_colh.slice(0, 7) : null, sort: (a, b) => a.localeCompare(b),
    name: v => `${MES[+v.slice(5) - 1]}/${v.slice(2, 4)}` },
  colhido: { title: `Colhido na safra ${SAFRA_ATUAL}`, val: p => colhidoNaSafra(p, SAFRA_ATUAL) ? 'Colhido' : 'A colher',
    color: v => v === 'Colhido' ? '#23875a' : '#f6a81c' },
  tecnico: { title: 'Técnico', val: p => p.tecnico, color: (v, i) => TEC_COL[i % TEC_COL.length] },
  usina: { title: 'Usina', val: p => p.usina },
  ndvi: { title: 'NDVI médio do talhão', ramp: true, val: p => p.ndvi ?? null }
};
const colhidoNaSafra = (p, safra) => safraOf(p.dt_colh) === safra || (safra === SAFRA_ATUAL && p.colhido && !p.dt_colh);

let themeCats = new Map();
function buildCats() {
  const th = THEMES[S.theme]; themeCats = new Map();
  if (th.ramp) return;
  const count = new Map();
  for (const f of S.feats) { const v = th.val(f.properties); if (v != null) count.set(v, (count.get(v) || 0) + 1); }
  const vals = [...count.keys()].sort(th.sort || ((a, b) => count.get(b) - count.get(a)));
  vals.forEach((v, i) => themeCats.set(v, { color: th.color ? th.color(v, i) : catColor(i), n: count.get(v) }));
}
function colorOf(p) {
  const th = THEMES[S.theme], v = th.val(p);
  if (v == null) return GREY;
  if (th.ramp) { const c = ndviRGB(v); return `rgb(${c})`; }
  return themeCats.get(v)?.color || GREY;
}
function renderLegend() {
  const th = THEMES[S.theme]; let h = `<b>${esc(th.title)}</b>`;
  if (th.ramp) {
    const n = S.feats.filter(f => f.properties.ndvi != null).length;
    h += `<div class="ramp"></div><div class="ramp-l"><span>0,1</span><span>0,5</span><span>0,9</span></div>` +
      `<div><i style="background:${GREY}"></i>${n ? 'Sem leitura' : 'Abra uma fazenda e toque em NDVI'}</div>`;
  } else {
    const items = [...themeCats.entries()];
    h += items.slice(0, 22).map(([v, c]) => `<div><i style="background:${c.color}"></i>${esc(th.name ? th.name(v) : v)}</div>`).join('');
    if (items.length > 22) h += `<div class="muted">e mais ${items.length - 22}</div>`;
    h += `<div><i style="background:${GREY}"></i>Sem informação</div>`;
  }
  $('#legend').innerHTML = h;
}

/* ================= Mapa ================= */
let map, lyr, labelLayer, refLayers, ndviOverlay, meMarker, routeLayer;

function initMap() {
  map = L.map('map', { preferCanvas: true, zoomControl: false, maxZoom: 20, attributionControl: true });
  map.attributionControl.setPrefix(false);
  L.tileLayer(CFG.sat, { maxNativeZoom: CFG.satMaxZoom, maxZoom: 20, crossOrigin: true, attribution: 'Imagem © Esri, Maxar, Earthstar Geographics' }).addTo(map);
  refLayers = L.layerGroup(CFG.ref.map(u => L.tileLayer(u, { maxNativeZoom: 15, maxZoom: 20, crossOrigin: true }))).addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  labelLayer = L.layerGroup().addTo(map);
  map.on('moveend zoomend', drawLabels);
  map.on('click', () => { $('#layers').hidden = true; $('#btn-layers').classList.remove('on'); });
}
function styleOf(f) {
  const sel = f.properties.fid === S.selFid, inFarm = S.selFarm && farmKey(f.properties) === S.selFarm;
  return { fillColor: colorOf(f.properties), fillOpacity: S.opacity, color: sel ? '#fff' : inFarm ? '#ffd75e' : 'rgba(255,255,255,.75)', weight: sel ? 3.5 : inFarm ? 2 : .8 };
}
function drawTalhoes() {
  if (lyr) lyr.remove();
  buildCats();
  lyr = L.geoJSON({ type: 'FeatureCollection', features: S.feats }, {
    style: styleOf,
    onEachFeature: (f, l) => l.on('click', e => { L.DomEvent.stopPropagation(e); openTalhao(f.properties.fid); })
  }).addTo(map);
  renderLegend(); drawLabels();
}
function restyle() { buildCats(); lyr.setStyle(styleOf); renderLegend(); drawLabels(); }

function drawLabels() {
  labelLayer.clearLayers();
  if (!S.label || map.getZoom() < CFG.labelZoom) return;
  const b = map.getBounds(); let n = 0;
  for (const f of S.feats) {
    if (!b.contains([f.c[1], f.c[0]])) continue;
    const p = f.properties; let v = p[S.label];
    if (v == null || v === '') continue;
    if (S.label === 'area') v = nf(v, 1); else if (S.label === 'talhao') v = 'T' + v;
    L.marker([f.c[1], f.c[0]], { interactive: false, icon: L.divIcon({ className: 'lbl', html: `<span>${esc(v)}</span>`, iconSize: [0, 0] }) }).addTo(labelLayer);
    if (++n > 350) break;
  }
}
function fitBB(bb) {
  const pad = isMobile() ? { paddingTopLeft: [30, 80], paddingBottomRight: [30, innerHeight * .5] } : { paddingTopLeft: [40, 40], paddingBottomRight: [430, 40] };
  map.fitBounds([[bb[1], bb[0]], [bb[3], bb[2]]], { ...pad, maxZoom: 17 });
}
function showNdviOverlay() {
  if (ndviOverlay) { ndviOverlay.remove(); ndviOverlay = null; }
  const nd = S.selFarm && S.ndvi.get(S.selFarm);
  if (nd && $('#tg-ndvi').checked) ndviOverlay = L.imageOverlay(nd.img, nd.bounds, { opacity: .92, interactive: false }).addTo(map);
}

/* ================= Folha: fazenda e talhão ================= */
const sheet = $('#sheet');
function openSheet(html) { sheet.innerHTML = html; sheet.hidden = false; sheet.scrollTop = 0; document.body.classList.add('sheet-open'); }
function closeSheet() {
  sheet.hidden = true; document.body.classList.remove('sheet-open');
  S.selFarm = null; S.selFid = null; lyr.setStyle(styleOf); showNdviOverlay();
}
const ICON = {
  route: '<svg viewBox="0 0 24 24"><path d="M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm12-10a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8 17h6a4 4 0 0 0 0-8h-4a4 4 0 0 1 0-8"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/></svg>',
  leaf: '<svg viewBox="0 0 24 24"><path d="M5 19c0-9 5-14 15-14 0 10-5 15-14 15M5 19l8-8"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="m4 20 1-5L16 4l4 4L9 19l-5 1Z"/></svg>'
};

function openFarm(key, fit = true) {
  const fm = S.farms.get(key); if (!fm) return;
  S.selFarm = key; S.selFid = null; setTab('map');
  const vars = [...new Set(fm.feats.map(f => f.properties.varied).filter(Boolean))];
  const nd = S.ndvi.get(key), off = S.offline.has(key);
  openSheet(`
    <div class="sheet-head"><h2>${esc(fm.faz)}</h2><button class="x" data-act="close" aria-label="Fechar">✕</button></div>
    <p class="muted">${esc(fm.assoc || 'Sem associado')} — ${esc(fm.mun || '')}${fm.fa ? ` — FA ${fm.fa}` : ''}</p>
    <div class="stats">
      <div><b class="num">${nf(fm.area, 1)}</b><span>hectares</span></div>
      <div><b class="num">${fm.feats.length}</b><span>talhões</span></div>
      <div><b class="num">${vars.length || '–'}</b><span>variedades</span></div>
    </div>
    <div class="actions">
      <button class="btn primary" data-act="route">${ICON.route}Traçar rota</button>
      <button class="btn" data-act="offline">${ICON.down}${off ? 'Satélite baixado' : 'Baixar satélite'}</button>
      <button class="btn" data-act="ndvi">${ICON.leaf}${nd ? 'Atualizar NDVI' : 'NDVI'}</button>
    </div>
    <div id="job"></div>
    ${nd ? `<p class="muted">NDVI Sentinel-2 de ${dBR(nd.date)}, ${nf(nd.cloud)}% de nuvens na cena.</p>` : ''}
    <ul class="rows">${fm.feats.map(f => { const p = f.properties; return `
      <li><button data-fid="${p.fid}"><span class="t">T${p.talhao ?? '?'}</span>
        <span>${esc(p.varied || 'Sem variedade')}<small>${p.corte != null ? esc(THEMES.corte.name(p.corte)) : 'corte não informado'}${p.ndvi != null ? ` — NDVI ${nf(p.ndvi, 2)}` : ''}</small></span>
        <span class="num">${nf(p.area, 1)} ha</span></button></li>`; }).join('')}</ul>`);
  lyr.setStyle(styleOf); showNdviOverlay();
  if (fit) fitBB(fm.bb);
}

const FIELDS = [
  ['varied', 'Variedade'], ['corte', 'Corte'], ['plantio', 'Plantio'], ['dt_colh', 'Colheita'], ['prod_t', 'Produção'],
  ['usina', 'Usina'], ['tecnico', 'Técnico'], ['notas', 'Notas']
];
function openTalhao(fid) {
  const f = S.byFid.get(fid); if (!f) return;
  const p = f.properties; S.selFid = fid; S.selFarm = farmKey(p); setTab('map');
  const tch = p.prod_t && p.area ? p.prod_t / p.area : null;
  const edited = S.edits.has(fid);
  openSheet(`
    <button class="back" data-act="farm">‹ ${esc(p.faz || 'Fazenda')}</button>
    <div class="sheet-head"><h2>Talhão ${p.talhao ?? '?'}</h2><button class="x" data-act="close" aria-label="Fechar">✕</button></div>
    <p class="muted">${esc(p.assoc || '')} — ${esc(p.mun || '')} ${edited ? '<span class="tag">alterado neste aparelho</span>' : ''}</p>
    <dl class="fields">
      <dt>Área</dt><dd>${nf(p.area, 2)} ha</dd>
      <dt>Variedade</dt><dd>${esc(p.varied || '–')}</dd>
      <dt>Corte</dt><dd>${p.corte != null ? esc(THEMES.corte.name(p.corte)) : '–'}</dd>
      <dt>Plantio</dt><dd>${dBR(p.plantio)}</dd>
      <dt>Colheita</dt><dd>${dBR(p.dt_colh)} ${colhidoNaSafra(p, SAFRA_ATUAL) ? '<span class="tag ok">colhido</span>' : ''}</dd>
      <dt>Produção</dt><dd>${p.prod_t ? `${nf(p.prod_t, 1)} t (${nf(tch, 1)} t/ha)` : '–'}</dd>
      <dt>Usina</dt><dd>${esc(p.usina || '–')}</dd>
      <dt>Técnico</dt><dd>${esc(p.tecnico || '–')}</dd>
      <dt>NDVI médio</dt><dd>${p.ndvi != null ? nf(p.ndvi, 2) : '–'}</dd>
      ${p.notas ? `<dt>Notas</dt><dd>${esc(p.notas)}</dd>` : ''}
    </dl>
    ${canEdit() ? `<button class="btn primary wide" data-act="edit">${ICON.edit}Atualizar dados do talhão</button>`
      : '<p class="note">Edição disponível no app (celular ou instalado). Aqui no navegador a visão é gerencial.</p>'}`);
  lyr.setStyle(styleOf); showNdviOverlay();
}

/* ================= Levantamento (survey) ================= */
function listOf(k) { return [...new Set(S.feats.map(f => f.properties[k]).filter(Boolean))].sort(); }
function openSurvey(fid) {
  const p = S.byFid.get(fid).properties;
  const dl = (id, k) => `<datalist id="${id}">${listOf(k).map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
  openSheet(`
    <button class="back" data-act="talhao">‹ Talhão ${p.talhao ?? '?'}</button>
    <div class="sheet-head"><h2>Atualizar talhão ${p.talhao ?? '?'}</h2><button class="x" data-act="close" aria-label="Fechar">✕</button></div>
    <p class="muted">${esc(p.faz || '')} — ${nf(p.area, 2)} ha</p>
    <form id="survey" data-talhao="${fid}">
      <div class="two">
        <label>Variedade<input type="text" name="varied" list="dl-var" value="${esc(p.varied)}" autocapitalize="characters"></label>
        <label>Corte<input type="text" name="corte" inputmode="numeric" value="${esc(p.corte)}"></label>
      </div>
      <div class="two">
        <label>Data do plantio<input type="date" name="plantio" value="${esc(p.plantio)}"></label>
        <label>Data da colheita<input type="date" name="dt_colh" value="${esc(p.dt_colh)}"></label>
      </div>
      <label class="check"><input type="checkbox" name="colhido" ${p.colhido ? 'checked' : ''}> Talhão já colhido nesta safra</label>
      <div class="two">
        <label>Produção (toneladas)<input type="number" name="prod_t" min="0" step="0.1" inputmode="decimal" value="${p.prod_t ?? ''}"></label>
        <label>Usina<input type="text" name="usina" list="dl-us" value="${esc(p.usina)}" autocapitalize="characters"></label>
      </div>
      <label>Técnico<input type="text" name="tecnico" list="dl-tec" value="${esc(p.tecnico)}" autocapitalize="characters"></label>
      <label>Notas<textarea name="notas">${esc(p.notas)}</textarea></label>
      ${dl('dl-var', 'varied')}${dl('dl-us', 'usina')}${dl('dl-tec', 'tecnico')}
      <button class="btn primary wide" type="submit">Salvar alterações</button>
    </form>`);
}
async function saveSurvey(form) {
  const fid = +form.dataset.talhao, p = S.byFid.get(fid).properties, fd = new FormData(form);
  const txt = k => { const v = (fd.get(k) || '').trim(); return v || null; };
  const up = v => v ? v.toUpperCase() : null;
  const nv = {
    varied: up(txt('varied')), corte: txt('corte'), plantio: txt('plantio'), dt_colh: txt('dt_colh'),
    colhido: fd.get('colhido') === 'on', prod_t: txt('prod_t') ? +txt('prod_t') : null,
    usina: up(txt('usina')), tecnico: up(txt('tecnico')), notas: txt('notas')
  };
  const changed = {};
  for (const k in nv) if (nv[k] !== (p[k] ?? null) && !(k === 'colhido' && nv[k] === !!p[k])) changed[k] = nv[k];
  if (!Object.keys(changed).length) { toast('Nada mudou neste talhão.'); return openTalhao(fid); }
  const prev = S.edits.get(fid);
  const rec = { fid, props: { ...(prev?.props || {}), ...changed }, ts: new Date().toISOString() };
  Object.assign(p, changed); S.edits.set(fid, rec);
  await DB.set('edits', fid, rec);
  restyle(); renderBI(); renderData(); openTalhao(fid);
  toast('Alterações salvas neste aparelho.');
}

/* ================= Rotas ================= */
const hav = (a, b) => { const R = 6371e3, r = Math.PI / 180, dLa = (b[1] - a[1]) * r, dLo = (b[0] - a[0]) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const km = m => m >= 1000 ? `${nf(m / 1000, 1)} km` : `${nf(Math.round(m / 10) * 10)} m`;
const dur = s => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
const DIR = { left: 'à esquerda', right: 'à direita', 'slight left': 'levemente à esquerda', 'slight right': 'levemente à direita',
  'sharp left': 'forte à esquerda', 'sharp right': 'forte à direita', straight: 'em frente', uturn: 'e faça o retorno' };
function stepText(st) {
  const m = st.maneuver, via = st.name ? ` em ${st.name}` : st.ref ? ` na ${st.ref}` : '', d = DIR[m.modifier] || '';
  switch (m.type) {
    case 'depart': return `Siga${via || ' pela via'}`;
    case 'arrive': return 'Chegada: ponto de estrada mais próximo da fazenda';
    case 'roundabout': case 'rotary': return `Na rotatória, pegue a ${m.exit || 1}ª saída${via}`;
    case 'merge': return `Entre${via}`;
    case 'on ramp': return `Pegue o acesso ${d}${via}`;
    case 'off ramp': return `Pegue a saída ${d}${via}`;
    case 'fork': return `Na bifurcação, mantenha-se ${d}${via}`;
    case 'end of road': return `No fim da via, vire ${d}${via}`;
    case 'new name': case 'continue': return `Continue ${d}${via}`;
    default: return `Vire ${d}${via}`;
  }
}
function getPos() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('sem GPS'));
    navigator.geolocation.getCurrentPosition(p => res([p.coords.longitude, p.coords.latitude]), rej, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  });
}
function showMe(ll) {
  S.me = ll;
  if (!meMarker) meMarker = L.marker([ll[1], ll[0]], { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false, zIndexOffset: 900 }).addTo(map);
  else meMarker.setLatLng([ll[1], ll[0]]);
}
let watchId = null;
async function routeTo(key) {
  const fm = S.farms.get(key), dest = fm.c;
  const job = $('#job'); if (job) job.innerHTML = '<p class="muted">Procurando sua posição…</p>';
  let from, guessed = false;
  try { from = await getPos(); showMe(from); }
  catch (e) { const c = map.getCenter(); from = [c.lng, c.lat]; guessed = true; }
  routeLayer.clearLayers();
  L.marker([dest[1], dest[0]], { icon: L.divIcon({ className: '', html: '<div class="dest"></div>', iconSize: [22, 22], iconAnchor: [11, 22] }), interactive: false }).addTo(routeLayer);
  let r = null;
  if (navigator.onLine) {
    try {
      const u = `${CFG.osrm}${from[0]},${from[1]};${dest[0]},${dest[1]}?overview=full&geometries=geojson&steps=true`;
      const j = await (await fetch(u)).json();
      if (j.code === 'Ok') r = j.routes[0];
    } catch (e) { /* cai no modo bússola */ }
  }
  const links = `
    <a class="btn" target="_blank" rel="noopener" href="https://waze.com/ul?ll=${dest[1]},${dest[0]}&navigate=yes">Abrir no Waze</a>
    <a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${dest[1]},${dest[0]}">Google Maps</a>`;
  const head = `<button class="back" data-act="farm">‹ ${esc(fm.faz)}</button>
    <div class="sheet-head"><h2>Rota até ${esc(fm.faz)}</h2><button class="x" data-act="endroute" aria-label="Encerrar rota">✕</button></div>`;
  const warn = guessed ? '<p class="note">Não consegui ler o GPS, então a rota sai do centro do mapa. Libere a localização para sair de onde você está.</p>' : '';
  if (r) {
    const line = L.geoJSON(r.geometry, { style: { color: '#26282b', weight: 9, opacity: .85 } }).addTo(routeLayer);
    L.geoJSON(r.geometry, { style: { color: '#f6a81c', weight: 5 } }).addTo(routeLayer);
    const steps = r.legs[0].steps;
    openSheet(`${head}
      <div class="stats"><div><b class="num">${km(r.distance)}</b><span>distância</span></div><div><b class="num">${dur(r.duration)}</b><span>de carro</span></div><div><b class="num">${steps.length}</b><span>manobras</span></div></div>
      ${warn}<div class="actions">${links}</div>
      <ol class="steps">${steps.map(s => `<li><span>${esc(stepText(s))}</span><span>${s.distance ? km(s.distance) : ''}</span></li>`).join('')}</ol>`);
    map.fitBounds(line.getBounds(), isMobile() ? { paddingTopLeft: [30, 80], paddingBottomRight: [30, innerHeight * .45] } : { padding: [60, 60] });
  } else {
    L.polyline([[from[1], from[0]], [dest[1], dest[0]]], { color: '#f6a81c', weight: 4, dashArray: '8 10' }).addTo(routeLayer);
    const brg = (Math.atan2(Math.sin((dest[0] - from[0]) * Math.PI / 180) * Math.cos(dest[1] * Math.PI / 180),
      Math.cos(from[1] * Math.PI / 180) * Math.sin(dest[1] * Math.PI / 180) - Math.sin(from[1] * Math.PI / 180) * Math.cos(dest[1] * Math.PI / 180) * Math.cos((dest[0] - from[0]) * Math.PI / 180)) * 180 / Math.PI + 360) % 360;
    const card = ['norte', 'nordeste', 'leste', 'sudeste', 'sul', 'sudoeste', 'oeste', 'noroeste'][Math.round(brg / 45) % 8];
    openSheet(`${head}
      <div class="stats"><div><b class="num">${km(hav(from, dest))}</b><span>em linha reta</span></div><div><b class="num">${nf(brg)}°</b><span>rumo ${card}</span></div><div><b class="num">–</b><span>sem estradas</span></div></div>
      <p class="note">Sem conexão não dá para calcular o caminho pelas estradas. O mapa mostra a direção e a distância em linha reta, e sua posição continua sendo atualizada pelo GPS.</p>
      ${warn}<div class="actions">${links}</div>`);
    map.fitBounds([[from[1], from[0]], [dest[1], dest[0]]], { padding: [70, 70] });
  }
  S.route = key;
  if (navigator.geolocation && watchId == null) watchId = navigator.geolocation.watchPosition(p => showMe([p.coords.longitude, p.coords.latitude]), () => {}, { enableHighAccuracy: true });
}
function endRoute() {
  routeLayer.clearLayers(); S.route = null;
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  closeSheet();
}

/* ================= Satélite offline ================= */
const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const lat2y = (lat, z) => Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z);
function tileList(bb, z0, z1, tpl) {
  const out = [];
  for (let z = z0; z <= z1; z++) {
    const x0 = lon2x(bb[0], z), x1 = lon2x(bb[2], z), y0 = lat2y(bb[3], z), y1 = lat2y(bb[1], z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y));
  }
  return out;
}
async function downloadOffline(key) {
  const fm = S.farms.get(key), job = $('#job');
  if (!('caches' in window)) return toast('Este navegador não guarda imagens offline.');
  if (!navigator.onLine) return toast('Conecte-se à internet para baixar as imagens.');
  const dx = (fm.bb[2] - fm.bb[0]) * .25 + .003, dy = (fm.bb[3] - fm.bb[1]) * .25 + .003;
  const bb = [fm.bb[0] - dx, fm.bb[1] - dy, fm.bb[2] + dx, fm.bb[3] + dy];
  const wide = [bb[0] - .15, bb[1] - .15, bb[2] + .15, bb[3] + .15];
  let zmax = CFG.satMaxZoom, urls;
  do { urls = [...tileList(wide, 9, 12, CFG.sat), ...tileList(bb, 13, zmax, CFG.sat), ...CFG.ref.flatMap(t => tileList(bb, 11, Math.min(15, zmax), t))]; }
  while (urls.length > 3000 && --zmax >= 13);
  if (zmax < CFG.satMaxZoom) toast(`Área grande: baixando até o zoom ${zmax} para não lotar o aparelho.`, 5000);
  job.innerHTML = `<p class="muted" id="job-t">Baixando ${urls.length} imagens…</p><div class="progress"><i id="job-b"></i></div>`;
  const cache = await caches.open('mgeo-tiles'); let done = 0, fail = 0, i = 0;
  const worker = async () => {
    while (i < urls.length) {
      const u = urls[i++];
      try { if (!(await cache.match(u))) { const r = await fetch(u, { mode: 'cors' }); if (r.ok) await cache.put(u, r); else fail++; } }
      catch (e) { fail++; }
      done++;
      const b = $('#job-b'); if (b) { b.style.width = `${done / urls.length * 100}%`; $('#job-t').textContent = `Baixando imagens: ${done} de ${urls.length}`; }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  if (fail > urls.length * .2) { toast(`${fail} imagens falharam. Tente de novo com sinal melhor.`); if (S.selFarm === key) openFarm(key, false); return; }
  S.offline.add(key); await DB.set('kv', 'offline', [...S.offline]);
  toast(`${fm.faz}: satélite disponível offline.`); renderFarms(); renderData();
  if (S.selFarm === key && !S.selFid) openFarm(key, false);
}

/* ================= NDVI (Sentinel-2, 10 m) ================= */
// Longitude/latitude -> UTM (WGS84), fuso informado, hemisfério sul.
function toUTM(lon, lat, zone) {
  const a = 6378137, f = 1 / 298.257223563, k0 = .9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2), r = Math.PI / 180;
  const phi = lat * r, lam = (lon - (zone * 6 - 183)) * r;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2), T = Math.tan(phi) ** 2, C = ep2 * Math.cos(phi) ** 2, A = Math.cos(phi) * lam;
  const M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi) - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
  const E = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
  const Nn = k0 * (M + N * Math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720)) + 1e7;
  return [E, Nn];
}
function loadScript(src) {
  return new Promise((res, rej) => { if (window.GeoTIFF) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.append(s); });
}
async function readBand(href, zone, bb) {
  const tiff = await GeoTIFF.fromUrl(href), img = await tiff.getImage();
  const [ox, oy] = img.getOrigin(), [rx, ry] = img.getResolution(), res = Math.abs(rx);
  const cs = [[bb[0], bb[1]], [bb[0], bb[3]], [bb[2], bb[1]], [bb[2], bb[3]]].map(c => toUTM(c[0], c[1], zone));
  const x0 = Math.max(0, Math.floor((Math.min(...cs.map(c => c[0])) - ox) / res) - 1), x1 = Math.min(img.getWidth(), Math.ceil((Math.max(...cs.map(c => c[0])) - ox) / res) + 1);
  const y0 = Math.max(0, Math.floor((oy - Math.max(...cs.map(c => c[1]))) / Math.abs(ry)) - 1), y1 = Math.min(img.getHeight(), Math.ceil((oy - Math.min(...cs.map(c => c[1]))) / Math.abs(ry)) + 1);
  if (x1 <= x0 || y1 <= y0) throw new Error('fora da cena');
  const [data] = await img.readRasters({ window: [x0, y0, x1, y1], samples: [0] });
  return { data, w: x1 - x0, h: y1 - y0, ox: ox + x0 * res, oy: oy - y0 * Math.abs(ry), res };
}
async function computeNDVI(key) {
  const fm = S.farms.get(key), job = $('#job');
  if (!navigator.onLine) return toast('O NDVI precisa de internet para buscar a imagem do satélite.');
  const say = t => { if (job) job.innerHTML = `<p class="muted">${t}</p><div class="progress"><i style="width:40%"></i></div>`; };
  try {
    say('Procurando a imagem Sentinel-2 mais recente sem nuvens…');
    await loadScript('vendor/geotiff.js');
    const bb = fm.bb;
    if (hav([bb[0], bb[1]], [bb[2], bb[3]]) > 20000) throw new Error('os talhões deste grupo estão espalhados por mais de 20 km');
    const q = await (await fetch(CFG.stac, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      collections: ['sentinel-2-l2a'], bbox: bb, limit: 8, query: { 'eo:cloud_cover': { lt: CFG.maxCloud } },
      sortby: [{ field: 'properties.datetime', direction: 'desc' }] }) })).json();
    const item = (q.features || []).find(it => it.bbox && it.bbox[0] <= bb[0] && it.bbox[1] <= bb[1] && it.bbox[2] >= bb[2] && it.bbox[3] >= bb[3]) || (q.features || [])[0];
    if (!item) throw new Error(`nenhuma cena com menos de ${CFG.maxCloud}% de nuvens`);
    const epsg = item.properties['proj:epsg'] || +String(item.properties['proj:code'] || '').replace('EPSG:', '');
    if (!(epsg > 32700 && epsg <= 32760)) throw new Error('projeção inesperada na cena');
    const zone = epsg - 32700;
    say(`Lendo a cena de ${dBR(item.properties.datetime.slice(0, 10))}…`);
    const [red, nir] = await Promise.all([readBand(item.assets.red.href, zone, bb), readBand(item.assets.nir.href, zone, bb)]);
    const off = item.properties['earthsearch:boa_offset_applied'] === false ? 1000 : 0;

    // Grade em lat/lon cobrindo a fazenda, ~10 m por pixel.
    const mid = (bb[1] + bb[3]) / 2, wM = hav([bb[0], mid], [bb[2], mid]), hM = hav([bb[0], bb[1]], [bb[0], bb[3]]);
    const sc = Math.min(1, 640 / Math.max(wM / 10, hM / 10));
    const W = Math.max(2, Math.round(wM / 10 * sc)), H = Math.max(2, Math.round(hM / 10 * sc));
    const grid = new Float32Array(W * H).fill(NaN), mask = new Uint8Array(W * H);
    const px2ll = (i, j) => [bb[0] + (i + .5) / W * (bb[2] - bb[0]), bb[3] - (j + .5) / H * (bb[3] - bb[1])];
    const means = {};
    for (const f of fm.feats) {
      const fb = f.bb, i0 = Math.max(0, Math.floor((fb[0] - bb[0]) / (bb[2] - bb[0]) * W)), i1 = Math.min(W - 1, Math.ceil((fb[2] - bb[0]) / (bb[2] - bb[0]) * W));
      const j0 = Math.max(0, Math.floor((bb[3] - fb[3]) / (bb[3] - bb[1]) * H)), j1 = Math.min(H - 1, Math.ceil((bb[3] - fb[1]) / (bb[3] - bb[1]) * H));
      let sum = 0, n = 0;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const [lon, lat] = px2ll(i, j);
        if (!inGeom(lon, lat, f.geometry)) continue;
        const [E, N] = toUTM(lon, lat, zone);
        const c = Math.floor((E - red.ox) / red.res), rw = Math.floor((red.oy - N) / red.res);
        if (c < 0 || rw < 0 || c >= red.w || rw >= red.h) continue;
        const R = red.data[rw * red.w + c], I = nir.data[rw * nir.w + c];
        if (!R && !I) continue;
        const v = ((I - off) - (R - off)) / ((I - off) + (R - off));
        if (!isFinite(v)) continue;
        grid[j * W + i] = v; mask[j * W + i] = 1; sum += v; n++;
      }
      if (n) means[f.properties.fid] = +(sum / n).toFixed(3);
    }
    if (!Object.keys(means).length) throw new Error('a cena não cobre os talhões');
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d'), im = ctx.createImageData(W, H);
    for (let k = 0; k < W * H; k++) if (mask[k]) { const c = ndviRGB(grid[k]); im.data.set([c[0], c[1], c[2], 255], k * 4); }
    ctx.putImageData(im, 0, 0);
    const rec = { date: item.properties.datetime.slice(0, 10), cloud: item.properties['eo:cloud_cover'], bounds: [[bb[1], bb[0]], [bb[3], bb[2]]], img: cv.toDataURL('image/png'), means };
    S.ndvi.set(key, rec); await DB.set('ndvi', key, rec);
    for (const f of fm.feats) f.properties.ndvi = means[f.properties.fid] ?? null;
    S.theme = 'ndvi'; $('#theme').value = 'ndvi'; restyle(); renderFarms();
    if (S.selFarm === key) openFarm(key, false);
    toast(`NDVI de ${dBR(rec.date)} aplicado em ${fm.faz}.`);
  } catch (e) {
    console.error(e);
    if (job) job.innerHTML = `<p class="note">Não foi possível calcular o NDVI agora (${esc(e.message || 'falha de rede')}). Confira a conexão e tente de novo.</p>`;
  }
}

/* ================= Lista de fazendas ================= */
const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function renderFarms() {
  const q = norm($('#q').value.trim());
  let list = [...S.farms.values()];
  if (q) list = list.filter(f => norm(`${f.faz} ${f.assoc} ${f.fa} ${f.mun}`).includes(q));
  list.sort((a, b) => a.faz.localeCompare(b.faz, 'pt-BR'));
  $('#q-count').textContent = q ? `${list.length} de ${S.farms.size} fazendas` : `${S.farms.size} fazendas, ${nf(S.feats.length)} talhões`;
  $('#farm-list').innerHTML = list.slice(0, 80).map(f => `
    <li><button data-farm="${esc(f.key)}"><b>${esc(f.faz)}</b>
      <small>${esc(f.assoc || 'Sem associado')} — ${esc(f.mun || '')} ${S.offline.has(f.key) ? '<span class="tag">offline</span>' : ''} ${S.ndvi.has(f.key) ? '<span class="tag ok">NDVI</span>' : ''}</small>
      <span class="ha"><b class="num">${nf(f.area, 1)}</b><small>ha em ${f.feats.length} talh.</small></span></button></li>`).join('')
    + (list.length > 80 ? `<li class="muted" style="padding:12px 2px">Mostrando 80. Digite para refinar.</li>` : '')
    + (!list.length ? `<li class="note">Nenhuma fazenda com esse nome. Tente o associado, o número FA ou o município.</li>` : '');
}

/* ================= Indicadores ================= */
function fillFilters() {
  const safras = [...new Set(S.feats.map(f => safraOf(f.properties.dt_colh)).filter(Boolean)), SAFRA_ATUAL].filter((v, i, a) => a.indexOf(v) === i).sort().reverse();
  const cur = $('#f-safra').value || (safras.includes('25/26') ? '25/26' : safras[0]);
  $('#f-safra').innerHTML = safras.map(s => `<option ${s === cur ? 'selected' : ''}>${s}</option>`).join('');
  const opt = (id, k, all) => { const c = $(id).value; $(id).innerHTML = `<option value="">${all}</option>` + listOf(k).map(v => `<option ${v === c ? 'selected' : ''}>${esc(v)}</option>`).join(''); };
  opt('#f-tec', 'tecnico', 'Todos'); opt('#f-mun', 'mun', 'Todos');
}
function groupSum(rows, keyFn, valFn) {
  const m = new Map(); for (const p of rows) { const k = keyFn(p); if (k == null) continue; m.set(k, (m.get(k) || 0) + (valFn(p) || 0)); } return m;
}
const hbars = (m, opts = {}) => {
  let e = [...m.entries()].sort(opts.sort || ((a, b) => b[1] - a[1]));
  const rest = e.slice(opts.top || 8).reduce((s, x) => s + x[1], 0); e = e.slice(0, opts.top || 8);
  if (rest > 0) e.push(['Outros', rest]);
  const max = Math.max(...e.map(x => x[1]), 1);
  return e.length ? `<div class="hbar ${opts.cls || ''}">${e.map(([k, v]) => `<span title="${esc(k)}">${esc(opts.name ? opts.name(k) : k)}</span><i style="width:${v / max * 100}%"></i><b>${nf(v)} ha</b>`).join('')}</div>`
    : '<p class="note">Sem dados para este recorte.</p>';
};
function renderBI() {
  const safra = $('#f-safra').value, tec = $('#f-tec').value, mun = $('#f-mun').value;
  const rows = S.feats.map(f => f.properties).filter(p => (!tec || p.tecnico === tec) && (!mun || p.mun === mun));
  const total = rows.reduce((s, p) => s + (p.area || 0), 0);
  const colh = rows.filter(p => colhidoNaSafra(p, safra));
  const aColh = colh.reduce((s, p) => s + (p.area || 0), 0);
  const prod = colh.reduce((s, p) => s + (p.prod_t || 0), 0), aProd = colh.filter(p => p.prod_t).reduce((s, p) => s + (p.area || 0), 0);
  const y0 = 2000 + +safra.slice(0, 2);
  const months = Array.from({ length: 12 }, (_, i) => { const m = (i + 3) % 12, y = i < 9 ? y0 : y0 + 1; return `${y}-${String(m + 1).padStart(2, '0')}`; });
  const byM = groupSum(colh, p => p.dt_colh?.slice(0, 7), p => p.area), maxM = Math.max(...months.map(m => byM.get(m) || 0), 1);
  const farms = new Set(rows.map(farmKey)), assoc = new Set(rows.map(p => p.assoc).filter(Boolean));
  const pct = total ? aColh / total * 100 : 0;
  $('#bi').innerHTML = `
    <div class="hero">
      <p>Área colhida na safra ${esc(safra)}</p>
      <div class="big num">${nf(aColh)} ha</div>
      <p>${nf(pct, 1)}% dos ${nf(total)} ha cadastrados, em ${nf(colh.length)} talhões</p>
      <div class="track"><i style="width:${Math.min(100, pct)}%"></i></div>
    </div>
    <div class="kpis">
      <div><b class="num">${nf(rows.length)}</b><span>talhões</span></div>
      <div><b class="num">${nf(farms.size)}</b><span>fazendas</span></div>
      <div><b class="num">${nf(assoc.size)}</b><span>associados</span></div>
      <div><b class="num">${prod ? nf(prod) + ' t' : '–'}</b><span>${prod ? `produção, ${nf(prod / aProd, 1)} t/ha` : 'produção lançada'}</span></div>
    </div>
    ${prod ? '' : '<p class="note" style="margin-top:10px">A base ainda não tem toneladas. Preencha “Produção” no levantamento do talhão e o TCH aparece aqui sozinho.</p>'}
    <h2>Área colhida por mês</h2>
    <div class="months">${months.map(m => { const v = byM.get(m) || 0; return `<div><em>${v ? nf(v) : ''}</em><i style="height:calc((100% - 40px) * ${(v / maxM).toFixed(4)})"></i><span>${MES[+m.slice(5) - 1]}</span></div>`; }).join('')}</div>
    <h2>Área colhida por usina</h2>${hbars(groupSum(colh, p => p.usina || 'Não informada', p => p.area), { cls: 'amber' })}
    <h2>Área colhida por técnico</h2>${hbars(groupSum(colh, p => p.tecnico || 'Não informado', p => p.area), { cls: 'amber' })}
    <h2>Variedades na área cadastrada</h2>${hbars(groupSum(rows, p => p.varied || 'Não informada', p => p.area))}
    <h2>Estágio de corte</h2>${hbars(groupSum(rows, p => p.corte, p => p.area), { top: 10, sort: (a, b) => THEMES.corte.sort(a[0], b[0]), name: THEMES.corte.name })}
    <h2>Municípios</h2>${hbars(groupSum(rows, p => p.mun, p => p.area))}`;
}

/* ================= Dados / sincronização ================= */
function download(name, text, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
let installEvt = null;
async function renderData() {
  const n = S.edits.size; $('#pend-dot').hidden = !n;
  let use = '';
  try { const e = await navigator.storage.estimate(); use = `${nf(e.usage / 1048576, 1)} MB usados neste aparelho`; } catch (e) { /* sem estimativa */ }
  const last = [...S.edits.values()].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 5);
  $('#data').innerHTML = `<div class="stack">
    <div class="box"><h2>Alterações do campo</h2>
      <p>${n ? `<b class="num">${n}</b> ${n > 1 ? 'talhões alterados' : 'talhão alterado'} neste aparelho, ainda não enviados à base.` : 'Nenhuma alteração pendente.'}</p>
      ${last.map(e => { const p = S.byFid.get(e.fid)?.properties || {}; return `<p class="muted">${esc(p.faz)} T${p.talhao ?? '?'} — ${Object.keys(e.props).map(k => (FIELDS.find(f => f[0] === k) || [0, k])[1]).join(', ')} — ${new Date(e.ts).toLocaleString('pt-BR')}</p>`; }).join('')}
      <div class="actions">
        <button class="btn primary" data-act="exp-edits" ${n ? '' : 'disabled'}>Exportar alterações (CSV)</button>
        <button class="btn" data-act="clear-edits" ${n ? '' : 'disabled'}>Descartar alterações</button>
      </div></div>
    <div class="box"><h2>Base de talhões</h2>
      <p class="muted">${nf(S.feats.length)} talhões em ${S.farms.size} fazendas. Exporte com as alterações aplicadas para abrir no QGIS, ou importe uma base nova em GeoJSON.</p>
      <div class="actions">
        <button class="btn" data-act="exp-base">Exportar base (GeoJSON)</button>
        <button class="btn" data-act="imp-base">Importar base</button>
        <button class="btn" data-act="reset-base">Voltar à base original</button>
      </div></div>
    <div class="box"><h2>Uso offline</h2>
      <p class="muted">O app e os talhões já funcionam sem sinal. Satélite: ${S.offline.size} fazenda(s) baixada(s). NDVI: ${S.ndvi.size} fazenda(s). ${use}</p>
      <div class="actions">
        ${installEvt ? '<button class="btn primary" data-act="install">Instalar o app</button>' : ''}
        <button class="btn" data-act="clear-tiles">Apagar imagens de satélite</button>
      </div></div>
  </div>`;
}
function exportEdits() {
  const cols = ['fid', 'id', 'fa', 'faz', 'talhao', ...FIELDS.map(f => f[0]), 'colhido', 'alterado_em', 'campos_alterados'];
  const q = v => v == null ? '' : /[";\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const lines = [...S.edits.values()].map(e => { const p = S.byFid.get(e.fid).properties; return cols.map(c => q(c === 'alterado_em' ? e.ts : c === 'campos_alterados' ? Object.keys(e.props).join(' ') : p[c])).join(';'); });
  download(`mgeo_alteracoes_${new Date().toISOString().slice(0, 10)}.csv`, '\ufeff' + cols.join(';') + '\n' + lines.join('\n'), 'text/csv');
}
function exportBase() {
  const fc = { type: 'FeatureCollection', features: S.feats.map(f => ({ type: 'Feature', id: f.id, properties: f.properties, geometry: f.geometry })) };
  download(`mgeo_talhoes_${new Date().toISOString().slice(0, 10)}.geojson`, JSON.stringify(fc), 'application/geo+json');
}
async function importBase(file) {
  try {
    const fc = JSON.parse(await file.text());
    if (fc.type !== 'FeatureCollection' || !fc.features?.length) throw 0;
    fc.features.forEach((f, i) => { f.properties ||= {}; f.properties.fid ??= f.id ?? i + 1; });
    if (!fc.features.every(f => f.geometry && /Polygon$/.test(f.geometry.type))) throw 0;
    await DB.set('kv', 'base', fc); toast('Base importada. Recarregando…'); setTimeout(() => location.reload(), 900);
  } catch (e) { toast('Arquivo inválido: preciso de um GeoJSON de polígonos em WGS84, com os mesmos campos da base exportada.', 6000); }
}

/* ================= Navegação e eventos ================= */
function setTab(t) {
  document.body.dataset.tab = t;
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.tab === t));
  if (t === 'bi') renderBI();
  if (t === 'data') renderData();
  setTimeout(() => map && map.invalidateSize(), 60);
}
function bind() {
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); });
  $('#search-pill').onclick = () => { setTab('farms'); $('#q').focus(); };
  $('#q').oninput = renderFarms;
  $('#farm-list').addEventListener('click', e => { const b = e.target.closest('[data-farm]'); if (b) openFarm(b.dataset.farm); });
  ['#f-safra', '#f-tec', '#f-mun'].forEach(s => $(s).onchange = renderBI);
  $('#btn-layers').onclick = e => { const p = $('#layers'); p.hidden = !p.hidden; e.currentTarget.classList.toggle('on', !p.hidden); };
  $('#theme').onchange = e => { S.theme = e.target.value; restyle(); };
  $('#label').onchange = e => { S.label = e.target.value; drawLabels(); };
  $('#opac').oninput = e => { S.opacity = 1 - e.target.value / 100; lyr.setStyle(styleOf); };
  $('#tg-ref').onchange = e => e.target.checked ? refLayers.addTo(map) : refLayers.remove();
  $('#tg-ndvi').onchange = showNdviOverlay;
  $('#btn-gps').onclick = async () => {
    try { const ll = await getPos(); showMe(ll); map.setView([ll[1], ll[0]], Math.max(map.getZoom(), 15)); }
    catch (e) { toast('Não consegui ler sua localização. Libere o GPS para este site.'); }
  };
  sheet.addEventListener('click', e => {
    const fidBtn = e.target.closest('button[data-fid]'); if (fidBtn) return openTalhao(+fidBtn.dataset.fid);
    const a = e.target.closest('[data-act]')?.dataset.act; if (!a) return;
    if (a === 'close') closeSheet();
    else if (a === 'farm') openFarm(S.selFarm || S.route, false);
    else if (a === 'talhao') openTalhao(S.selFid);
    else if (a === 'edit') openSurvey(S.selFid);
    else if (a === 'route') routeTo(S.selFarm);
    else if (a === 'endroute') endRoute();
    else if (a === 'offline') downloadOffline(S.selFarm);
    else if (a === 'ndvi') computeNDVI(S.selFarm);
  });
  sheet.addEventListener('submit', e => { e.preventDefault(); saveSurvey(e.target); });
  $('#data').addEventListener('click', async e => {
    const a = e.target.closest('[data-act]')?.dataset.act; if (!a) return;
    if (a === 'exp-edits') exportEdits();
    else if (a === 'exp-base') exportBase();
    else if (a === 'imp-base') $('#file').click();
    else if (a === 'install' && installEvt) { installEvt.prompt(); installEvt = null; renderData(); }
    else if (a === 'clear-edits' && confirm('Descartar todas as alterações feitas neste aparelho? Não dá para desfazer.')) { await DB.clear('edits'); location.reload(); }
    else if (a === 'reset-base' && confirm('Voltar à base original que veio com o app? As alterações pendentes continuam guardadas.')) { await DB.del('kv', 'base'); location.reload(); }
    else if (a === 'clear-tiles' && confirm('Apagar as imagens de satélite guardadas? Você precisará baixar de novo para usar offline.')) {
      await caches.delete('mgeo-tiles'); S.offline.clear(); await DB.set('kv', 'offline', []); renderData(); renderFarms(); toast('Imagens apagadas.');
    }
  });
  $('#file').onchange = e => { if (e.target.files[0]) importBase(e.target.files[0]); e.target.value = ''; };
  const net = () => { const n = $('#net'); n.textContent = navigator.onLine ? 'online' : 'offline'; n.classList.toggle('off', !navigator.onLine); };
  addEventListener('online', net); addEventListener('offline', net); net();
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (document.body.dataset.tab === 'data') renderData(); });
}

/* ================= Início ================= */
async function start() {
  initMap(); bind();
  try {
    for (const [k, v] of await DB.all('edits')) S.edits.set(k, v);
    for (const [k, v] of await DB.all('ndvi')) S.ndvi.set(k, v);
    S.offline = new Set(await DB.get('kv', 'offline') || []);
  } catch (e) { console.warn('IndexedDB indisponível', e); }
  let fc = null;
  try { fc = await DB.get('kv', 'base'); } catch (e) { /* segue com a base do app */ }
  if (!fc) fc = await (await fetch('data/talhoes.geojson')).json();
  indexData(fc);
  const all = S.feats.reduce((b, f) => [Math.min(b[0], f.bb[0]), Math.min(b[1], f.bb[1]), Math.max(b[2], f.bb[2]), Math.max(b[3], f.bb[3])], [180, 90, -180, -90]);
  map.fitBounds([[all[1], all[0]], [all[3], all[2]]], { padding: [20, 20] });
  drawTalhoes(); renderFarms(); fillFilters(); renderBI(); renderData();
  if (!isMobile()) setTab('bi');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
  window.MGEO = { S, toUTM, openFarm, openTalhao, openSurvey, setTab, tileList, map };
}
start().catch(e => { console.error(e); toast('Não consegui carregar a base de talhões. Recarregue a página.', 8000); });
})();
