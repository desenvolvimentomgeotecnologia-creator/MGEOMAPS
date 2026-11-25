/* MGEO PDF – mapa, GeoPDF e GPS */
'use strict';
const $ = s => document.querySelector(s);
const store = {
  get(k, d){ try{ const v = localStorage.getItem('mgeo:'+k); return v === null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem('mgeo:'+k, JSON.stringify(v)); }catch(e){} }
};
pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';

/* ---------- avisos ---------- */
let toastT;
function toast(msg, err){
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toastT); toastT = setTimeout(() => t.className = 'toast', err ? 4500 : 2600);
}
function busy(on, title, sub){
  $('#busy').classList.toggle('show', !!on);
  if (title) $('#busyT').textContent = title;
  $('#busyS').textContent = sub || '';
}
const tick = () => new Promise(r => setTimeout(r, 30));

/* ---------- banco local (IndexedDB) ---------- */
const DB = {
  db: null,
  open(){ return new Promise((res, rej) => {
    const r = indexedDB.open('mgeo-pdf', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('maps', { keyPath: 'id' });
    r.onsuccess = () => { this.db = r.result; res(); };
    r.onerror = () => rej(r.error);
  }); },
  run(mode, fn){ return new Promise((res, rej) => {
    const tx = this.db.transaction('maps', mode); const st = tx.objectStore('maps');
    const rq = fn(st); let out;
    if (rq) rq.onsuccess = () => out = rq.result;
    tx.oncomplete = () => res(out); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('Sem espaço de armazenamento'));
  }); },
  all(){ return this.run('readonly', s => s.getAll()); },
  get(id){ return this.run('readonly', s => s.get(id)); },
  put(o){ return this.run('readwrite', s => s.put(o)); },
  del(id){ return this.run('readwrite', s => s.delete(id)); }
};

/* ---------- mapa ---------- */
const map = L.map('map', { zoomControl:false, attributionControl:true, maxZoom:22, minZoom:2, worldCopyJump:true, tap:false })
  .setView([-14.2, -51.9], 4);
map.attributionControl.setPrefix(false);
map.attributionControl.setPosition('topright');
L.control.scale({ imperial:false, position:'topright' }).addTo(map);
map.createPane('geopdf').style.zIndex = 350;
map.createPane('gps').style.zIndex = 640;

const gUrl = l => `https://mt{s}.google.com/vt/lyrs=${l}&hl=pt-BR&x={x}&y={y}&z={z}`;
const tileOpt = { subdomains:'0123', maxZoom:22, maxNativeZoom:20, attribution:'Imagens © Google' };
const bases = { m: new OfflineTileLayer('m', gUrl('m'), tileOpt), s: new OfflineTileLayer('s', gUrl('s'), tileOpt), y: new OfflineTileLayer('y', gUrl('y'), tileOpt), n: null };
let baseKey = null;
function setBase(k){
  if (baseKey && bases[baseKey]) map.removeLayer(bases[baseKey]);
  baseKey = k; if (bases[k]) bases[k].addTo(map);
  document.querySelectorAll('#baseSeg button').forEach(b => b.classList.toggle('sel', b.dataset.b === k));
  store.set('base', k);
}
setBase(store.get('base', 's'));

/* camada do GeoPDF: imagem posicionada por transformação afim (aceita mapas rotacionados) */
const GeoImage = L.Layer.extend({
  initialize(url, corners, w, h, opacity){ this._url = url; this._c = corners; this._w = w; this._h = h; this._op = opacity; },
  onAdd(map){
    const img = this._img = L.DomUtil.create('img', 'geo-img leaflet-image-layer ' + (map._zoomAnimated ? 'leaflet-zoom-animated' : 'leaflet-zoom-hide'));
    img.src = this._url; img.alt = ''; img.draggable = false;
    img.style.width = this._w + 'px'; img.style.height = this._h + 'px'; img.style.opacity = this._op;
    map.getPane('geopdf').appendChild(img); this._reset();
  },
  onRemove(){ L.DomUtil.remove(this._img); this._img = null; },
  getEvents(){ const e = { zoom:this._reset, viewreset:this._reset }; if (this._map._zoomAnimated) e.zoomanim = this._anim; return e; },
  _set(fn){
    const c = this._c, W = this._w, H = this._h, a = fn(c.tl), b = fn(c.tr), d = fn(c.bl);
    this._img.style.transform = `matrix(${(b.x-a.x)/W},${(b.y-a.y)/W},${(d.x-a.x)/H},${(d.y-a.y)/H},${a.x},${a.y})`;
  },
  _reset(){ const m = this._map; this._set(ll => m.project(ll)._subtract(m.getPixelOrigin())); },
  _anim(e){ const m = this._map; this._set(ll => m._latLngToNewLayerPoint(ll, e.zoom, e.center)); },
  setOpacity(o){ this._op = o; if (this._img) this._img.style.opacity = o; }
});

/* ---------- leitura da georreferência do GeoPDF ---------- */
async function findGeo(bytes){
  try { const r = await geoFromPdfLib(bytes); if (r) return r; } catch(e){ console.warn('pdf-lib', e); }
  return geoFromRaw(bytes);
}
async function geoFromPdfLib(bytes){
  const { PDFDocument, PDFName, PDFArray, PDFDict, PDFNumber, PDFRef, ParseSpeeds } = PDFLib;
  const doc = await PDFDocument.load(bytes, { ignoreEncryption:true, updateMetadata:false, throwOnInvalidObject:false, parseSpeed:ParseSpeeds.Fastest });
  const ctx = doc.context;
  const R = o => o instanceof PDFRef ? ctx.lookup(o) : o;
  const nums = a => { a = R(a); if (!(a instanceof PDFArray)) return null; return a.asArray().map(x => { x = R(x); return x instanceof PDFNumber ? x.asNumber() : NaN; }); };
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++){
    const mb = pages[i].getMediaBox(), page = [mb.x, mb.y, mb.x + mb.width, mb.y + mb.height];
    const vp = R(pages[i].node.get(PDFName.of('VP')));
    if (!(vp instanceof PDFArray)) continue;
    let best = null;
    for (const e of vp.asArray()){
      const d = R(e); if (!(d instanceof PDFDict)) continue;
      const m = R(d.get(PDFName.of('Measure'))); if (!(m instanceof PDFDict)) continue;
      const st = R(m.get(PDFName.of('Subtype'))); if (st && String(st) !== '/GEO') continue;
      const g = nums(m.get(PDFName.of('GPTS'))); if (!g || g.length < 6) continue;
      const l = nums(m.get(PDFName.of('LPTS')));
      const bb = nums(d.get(PDFName.of('BBox')));
      // ArcGIS/QGIS gravam vários quadros; vale o que está DENTRO da página e for maior
      const area = bb && bb.length >= 4 ? overlap(bb, page) : 0.5 * mb.width * mb.height;
      if (area <= 0) continue;
      if (!best || area > best.area) best = { pageIndex:i, bbox: bb && bb.length >= 4 ? bb : null, g, l, area };
    }
    if (best) return best;
  }
  return null;
}
function overlap(a, b){
  const ax1 = Math.min(a[0], a[2]), ax2 = Math.max(a[0], a[2]), ay1 = Math.min(a[1], a[3]), ay2 = Math.max(a[1], a[3]);
  const w = Math.min(ax2, b[2]) - Math.max(ax1, b[0]), h = Math.min(ay2, b[3]) - Math.max(ay1, b[1]);
  return w > 0 && h > 0 ? w * h : 0;
}
function geoFromRaw(bytes){
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  const arr = (key, from, to) => {
    const sub = s.slice(Math.max(0, from), to); const re = new RegExp('/' + key + '\\s*\\[([^\\]]*)\\]', 'g');
    let m, last = null; while ((m = re.exec(sub))) last = m[1];
    return last ? last.trim().split(/\s+/).map(Number) : null;
  };
  const gi = s.indexOf('/GPTS'); if (gi < 0) return null;
  const g = arr('GPTS', gi, gi + 600); if (!g || g.length < 6) return null;
  const l = arr('LPTS', gi - 600, gi + 600);
  const bb = arr('BBox', gi - 1500, gi);
  return { pageIndex:0, bbox: bb && bb.length >= 4 ? bb : null, g, l };
}
function controlPoints(geo, view){
  const bb = geo.bbox || view;
  const x1 = Math.min(bb[0], bb[2]), x2 = Math.max(bb[0], bb[2]), y1 = Math.min(bb[1], bb[3]), y2 = Math.max(bb[1], bb[3]);
  const n = Math.floor(geo.g.length / 2);
  let l = geo.l;
  if (!l || l.length < 2 * n) l = [0,0, 0,1, 1,1, 1,0, 0.5,0.5].slice(0, 2 * n);
  const pts = [];
  for (let i = 0; i < n; i++){
    let lat = geo.g[2*i], lon = geo.g[2*i+1];
    if (Math.abs(lat) > 90 && Math.abs(lon) <= 90) [lat, lon] = [lon, lat];
    if (![lat, lon, l[2*i], l[2*i+1]].every(Number.isFinite)) continue;
    pts.push({ X: x1 + l[2*i] * (x2 - x1), Y: y1 + l[2*i+1] * (y2 - y1), lat, lon });
  }
  return { bbox:[x1, y1, x2, y2], pts };
}
/* ajuste afim por mínimos quadrados: pixel -> Web Mercator */
function fitAffine(P){
  const n = P.length; let mx = 0, my = 0; P.forEach(p => { mx += p.px; my += p.py; }); mx /= n; my /= n;
  let sxx=0, sxy=0, syy=0, sx=0, sy=0;
  P.forEach(p => { const x = p.px-mx, y = p.py-my; sxx+=x*x; sxy+=x*y; syy+=y*y; sx+=x; sy+=y; });
  const M = [[sxx,sxy,sx],[sxy,syy,sy],[sx,sy,n]];
  const solve = key => {
    let bx=0, by=0, b1=0; P.forEach(p => { const x=p.px-mx, y=p.py-my; bx+=x*p[key]; by+=y*p[key]; b1+=p[key]; });
    const A = M.map((r,i) => [...r, [bx,by,b1][i]]);
    for (let c = 0; c < 3; c++){
      let piv = c; for (let r = c+1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]];
      if (Math.abs(A[c][c]) < 1e-12) throw new Error('Pontos de controle inválidos neste GeoPDF.');
      for (let r = 0; r < 3; r++) if (r !== c){ const f = A[r][c] / A[c][c]; for (let k = c; k < 4; k++) A[r][k] -= f * A[c][k]; }
    }
    return [A[0][3]/A[0][0], A[1][3]/A[1][1], A[2][3]/A[2][2]];
  };
  const ax = solve('mx'), ay = solve('my');
  return (x, y) => [ax[0]*(x-mx) + ax[1]*(y-my) + ax[2], ay[0]*(x-mx) + ay[1]*(y-my) + ay[2]];
}

/* ---------- importação ---------- */
/* desenha uma região da página; devolve o canvas e a posição de recorte */
async function renderRegion(page, region, ocCfg){
  const v1 = page.getViewport({ scale:1 });
  const a1 = v1.convertToViewportPoint(region[0], region[1]), b1 = v1.convertToViewportPoint(region[2], region[3]);
  const bw = Math.max(1, Math.abs(b1[0]-a1[0])), bh = Math.max(1, Math.abs(b1[1]-a1[1]));
  const MAXD = 4096, MAXA = 16e6;
  let scale = Math.min(MAXD / Math.max(bw, bh), 8);
  if (bw * bh * scale * scale > MAXA) scale = Math.sqrt(MAXA / (bw * bh));
  const vp = page.getViewport({ scale });
  const p1 = vp.convertToViewportPoint(region[0], region[1]), p2 = vp.convertToViewportPoint(region[2], region[3]);
  const cx = Math.min(p1[0], p2[0]), cy = Math.min(p1[1], p2[1]);
  const W = Math.max(1, Math.round(Math.abs(p2[0]-p1[0]))), H = Math.max(1, Math.round(Math.abs(p2[1]-p1[1])));
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  const params = { canvasContext:ctx, viewport:vp, transform:[1,0,0,1,-cx,-cy] };
  if (ocCfg) params.optionalContentConfigPromise = Promise.resolve(ocCfg);
  await page.render(params).promise;
  return { canvas, vp, cx, cy, W, H };
}
/* fração de pixels com conteúdo (não brancos) */
function inkRatio(canvas){
  const t = document.createElement('canvas'); t.width = t.height = 96;
  const c = t.getContext('2d', { willReadFrequently:true }); c.drawImage(canvas, 0, 0, 96, 96);
  const d = c.getImageData(0, 0, 96, 96).data; let ink = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 250 || d[i+1] < 250 || d[i+2] < 250) ink++;
  return ink / (96 * 96);
}

async function processPdf(name, size, buf){
  const bytes = new Uint8Array(buf);
  busy(true, 'Lendo georreferência', name); await tick();
  const geo = await findGeo(bytes.slice());
  if (!geo) throw new Error(`“${name}” não tem georreferência. Exporte o mapa como GeoPDF e tente de novo.`);

  busy(true, 'Desenhando o mapa', 'Pode levar alguns segundos'); await tick();
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported:false, disableFontFace:false, useSystemFonts:true }).promise;
  const page = await pdf.getPage(geo.pageIndex + 1);
  const cp = controlPoints(geo, page.view);
  if (cp.pts.length < 3) throw new Error('O GeoPDF tem poucos pontos de controle para posicionar o mapa.');

  // 1ª tentativa: só a área do mapa, camadas como vieram no PDF
  let r = await renderRegion(page, cp.bbox, null);
  let ratio = inkRatio(r.canvas);
  if (ratio < 0.03){
    // 2ª: liga todas as camadas (OCG) do PDF
    let oc = null;
    try { oc = await pdf.getOptionalContentConfig(); const g = oc.getGroups(); if (g) for (const id in g) oc.setVisibility(id, true); else oc = null; } catch(_){ oc = null; }
    const tries = [];
    if (oc) tries.push([cp.bbox, oc]);
    tries.push([page.view, oc, true]); // 3ª: página inteira (caso a área do mapa no PDF esteja deslocada)
    for (const [reg, cfg, onlyIfBlank] of tries){
      if (onlyIfBlank && ratio >= 0.002) break;
      busy(true, 'Desenhando o mapa', 'Ajustando camadas do PDF…'); await tick();
      const r2 = await renderRegion(page, reg, cfg); const q = inkRatio(r2.canvas);
      if (q > ratio + 0.01){ r.canvas.width = 0; r = r2; ratio = q; } else r2.canvas.width = 0;
      if (ratio >= 0.03) break;
    }
  }
  const { canvas, vp, cx, cy, W, H } = r;

  const P = cp.pts.map(p => {
    const v = vp.convertToViewportPoint(p.X, p.Y);
    const m = L.CRS.EPSG3857.project(L.latLng(p.lat, p.lon));
    return { px:v[0]-cx, py:v[1]-cy, mx:m.x, my:m.y };
  });
  const T = fitAffine(P);
  const corner = (x, y) => { const m = T(x, y); const ll = L.CRS.EPSG3857.unproject(L.point(m[0], m[1])); return { lat:ll.lat, lng:ll.lng }; };
  const corners = { tl:corner(0,0), tr:corner(W,0), bl:corner(0,H), br:corner(W,H) };

  busy(true, 'Salvando no celular', name); await tick();
  const imgBlob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.9));
  const tc = document.createElement('canvas'); const ts = 120 / Math.max(W, H);
  tc.width = Math.max(1, Math.round(W*ts)); tc.height = Math.max(1, Math.round(H*ts));
  tc.getContext('2d').drawImage(canvas, 0, 0, tc.width, tc.height);
  const thumb = tc.toDataURL('image/jpeg', 0.75);
  canvas.width = canvas.height = 0;
  pdf.destroy();
  return { w:W, h:H, corners, thumb, img: await imgBlob.arrayBuffer(), blank: ratio < 0.002, v:RENDER_V };
}
const RENDER_V = 3;

async function importFile(file){
  busy(true, 'Abrindo GeoPDF', file.name); await tick();
  const buf = await file.arrayBuffer();
  const out = await processPdf(file.name, file.size, buf);
  const rec = Object.assign({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    name: file.name.replace(/\.pdf$/i, ''), size: file.size, added: Date.now(), pdf: buf
  }, out);
  await DB.put(rec);
  if (window.MGEO_TRACK) MGEO_TRACK('map_import', { kb: Math.round(file.size / 1024) });
  if (rec.blank) toast('O PDF foi posicionado, mas o conteúdo saiu em branco. Envie o arquivo para análise.', true);
  return rec;
}

$('#file').addEventListener('change', async e => {
  const files = [...e.target.files]; e.target.value = '';
  if (!files.length) return;
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch(_){}
  let last = null, ok = 0;
  for (const f of files){
    try { last = await importFile(f); ok++; }
    catch(err){ console.error(err); busy(false); toast(err.message || 'Não foi possível ler este PDF.', true); await new Promise(r => setTimeout(r, 1500)); }
  }
  busy(false);
  await renderList();
  if (last){ toast(ok > 1 ? `${ok} mapas salvos no celular` : 'Mapa salvo no celular'); openMap(last.id); }
});

/* ---------- abrir / lista ---------- */
let current = null;
function overlayOpacity(){ return Number($('#opacity').value) / 100; }
async function openMap(id, fit = true){
  let rec = await DB.get(id);
  if (!rec){ store.set('last', null); return; }
  if ((rec.v || 1) < RENDER_V && rec.pdf){
    try { Object.assign(rec, await processPdf(rec.name, rec.size, rec.pdf)); await DB.put(rec); }
    catch(e){ console.warn(e); }
    busy(false);
  }
  if (current){ map.removeLayer(current.layer); URL.revokeObjectURL(current.url); }
  const url = URL.createObjectURL(new Blob([rec.img], { type:'image/jpeg' }));
  const layer = new GeoImage(url, rec.corners, rec.w, rec.h, overlayOpacity());
  if ($('#swPdf').checked) layer.addTo(map);
  const c = rec.corners;
  if (window.MGEO_TRACK) MGEO_TRACK('map_open');
  current = { id, layer, url, name:rec.name, bounds:L.latLngBounds([c.tl, c.tr, c.bl, c.br]),
    poly:[c.tl, c.tr, c.br, c.bl] };
  if (fit) map.fitBounds(current.bounds, { padding:[24, 24] });
  $('#mapName').textContent = rec.name;
  $('#btnFit').disabled = false;
  store.set('last', id);
  closeSheets(); renderList(); if (lastFix) renderGps();
}
const fmtSize = b => b > 1048576 ? (b/1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b/1024)) + ' KB';
const fmtDate = t => new Date(t).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric' });
function esc(s){ return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]); }

async function renderList(){
  const items = (await DB.all()).sort((a, b) => b.added - a.added);
  const ul = $('#list');
  $('#badge').hidden = !items.length; $('#badge').textContent = items.length;
  if (!items.length){
    ul.innerHTML = `<li class="empty"><b>Nenhum GeoPDF salvo</b>Toque em Importar e escolha um GeoPDF do celular. Ele fica guardado aqui e abre mesmo sem internet.</li>`;
  } else {
    ul.innerHTML = items.map(r => `
      <li class="item${current && current.id === r.id ? ' active' : ''}">
        <button class="item-open" data-open="${r.id}">
          <img class="thumb" src="${r.thumb}" alt="">
          <span class="item-info"><b>${esc(r.name)}</b><span>${fmtSize(r.size)}, salvo em ${fmtDate(r.added)}</span></span>
        </button>
        <button class="icon-btn" data-ren="${r.id}" aria-label="Renomear ${esc(r.name)}">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/></svg>
        </button>
        <button class="icon-btn" data-del="${r.id}" aria-label="Excluir ${esc(r.name)}">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
        </button>
      </li>`).join('');
  }
  try {
    const est = await navigator.storage.estimate();
    $('#storage').textContent = `Espaço usado no celular: ${fmtSize(est.usage || 0)}`;
  } catch(_){ $('#storage').textContent = ''; }
}
$('#list').addEventListener('click', async e => {
  const o = e.target.closest('[data-open]'), d = e.target.closest('[data-del]'), r = e.target.closest('[data-ren]');
  if (o) openMap(o.dataset.open);
  if (r){
    const rec = await DB.get(r.dataset.ren); const name = prompt('Novo nome do mapa', rec.name);
    if (name && name.trim()){ rec.name = name.trim(); await DB.put(rec); if (current && current.id === rec.id){ current.name = rec.name; $('#mapName').textContent = rec.name; } renderList(); }
  }
  if (d){
    const rec = await DB.get(d.dataset.del);
    if (!confirm(`Excluir “${rec.name}” do celular?`)) return;
    await DB.del(rec.id);
    if (current && current.id === rec.id){
      map.removeLayer(current.layer); URL.revokeObjectURL(current.url); current = null;
      $('#mapName').textContent = 'Nenhum mapa aberto'; $('#btnFit').disabled = true; store.set('last', null);
    }
    toast('Mapa excluído'); renderList();
  }
});

/* ---------- folhas ---------- */
function openSheet(id){ closeSheets(); $(id).classList.add('open'); $('#scrim').classList.add('show'); }
function closeSheets(){ document.querySelectorAll('.sheet').forEach(s => s.classList.remove('open')); $('#scrim').classList.remove('show'); }
$('#scrim').onclick = closeSheets;
$('#btnMaps').onclick = $('#btnBrand').onclick = () => { renderList(); renderInstall(); openSheet('#sheetLib'); };
$('#btnLayers').onclick = () => openSheet('#sheetLayers');
$('#btnImport').onclick = () => $('#file').click();
$('#btnFit').onclick = () => { if (current){ follow = false; updateLocateBtn(); map.fitBounds(current.bounds, { padding:[24, 24] }); } };
$('#baseSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setBase(b.dataset.b); });
$('#opacity').addEventListener('input', e => {
  $('#opLbl').textContent = e.target.value + '%'; if (current) current.layer.setOpacity(overlayOpacity()); store.set('op', e.target.value);
});
$('#swPdf').addEventListener('change', e => { if (current){ e.target.checked ? current.layer.addTo(map) : map.removeLayer(current.layer); } });
$('#swGps').addEventListener('change', e => e.target.checked ? startGPS(true) : stopGPS());
$('#swWake').addEventListener('change', e => { store.set('wake', e.target.checked); e.target.checked ? requestWake() : releaseWake(); });
// arrastar a folha para baixo fecha
document.querySelectorAll('.sheet').forEach(sh => {
  let y0 = null;
  sh.addEventListener('touchstart', e => { y0 = (sh.querySelector('.sheet-body').scrollTop <= 0) ? e.touches[0].clientY : null; }, { passive:true });
  sh.addEventListener('touchend', e => { if (y0 !== null && e.changedTouches[0].clientY - y0 > 70) closeSheets(); y0 = null; });
});

/* ---------- GPS em tempo real ---------- */
let watchId = null, follow = false, meMarker = null, accCircle = null, lastFix = null, lastFixAt = 0, firstFix = true;
let compassHeading = null, coordFmt = store.get('fmt', 0), wakeLock = null;
const meIcon = L.divIcon({ className:'me-icon', iconSize:[22, 22], iconAnchor:[11, 11],
  html:`<div class="me"><svg class="cone" viewBox="0 0 70 70"><defs><radialGradient id="cg" cx="35" cy="35" r="35" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2F7BF6" stop-opacity=".55"/><stop offset="1" stop-color="#2F7BF6" stop-opacity="0"/></radialGradient></defs><path d="M35 35 L20 2 A35 35 0 0 1 50 2 Z" fill="url(#cg)"/></svg><div class="pulse"></div><div class="dot"></div></div>` });

function startGPS(user){
  if (!('geolocation' in navigator)){ toast('Este navegador não oferece GPS.', true); return; }
  if (watchId === null){
    watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy:true, maximumAge:0, timeout:30000 });
    $('#gpsState').textContent = 'Procurando sinal…';
  }
  if (user){ startCompass(); if (window.MGEO_TRACK) MGEO_TRACK('gps_on'); }
  $('#swGps').checked = true; store.set('gps', true);
  requestWake(); updateLocateBtn();
}
function stopGPS(){
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null; follow = false; lastFix = null; firstFix = true;
  if (meMarker){ map.removeLayer(meMarker); map.removeLayer(accCircle); meMarker = accCircle = null; }
  $('#swGps').checked = false; store.set('gps', false); releaseWake();
  $('#gpsState').textContent = 'GPS desligado'; $('#coord').textContent = 'Toque em ⌖ para ver sua posição';
  $('#gpsMeta').innerHTML = ''; $('#accVal').innerHTML = '–<small>metros</small>'; $('#live').className = 'live';
  $('#meter').className = 'meter'; $('#meterBar').style.strokeDashoffset = 144.5;
  updateLocateBtn();
}
function onPos(p){
  lastFix = p.coords; lastFixAt = Date.now();
  const ll = [lastFix.latitude, lastFix.longitude];
  if (!meMarker){
    accCircle = L.circle(ll, { radius:lastFix.accuracy, pane:'gps', renderer:L.svg({ pane:'gps' }), color:'#2F7BF6', weight:1.5, fillColor:'#2F7BF6', fillOpacity:.13, interactive:false }).addTo(map);
    meMarker = L.marker(ll, { icon:meIcon, pane:'gps', interactive:false, keyboard:false }).addTo(map);
  } else { meMarker.setLatLng(ll); accCircle.setLatLng(ll); accCircle.setRadius(lastFix.accuracy); }
  if (firstFix && follow){ map.setView(ll, Math.max(map.getZoom(), 17)); }
  else if (follow){ map.panTo(ll, { animate:true, duration:.5 }); }
  firstFix = false;
  renderGps(); updateHeading();
}
function onPosErr(err){
  const msg = { 1:'Permissão de localização negada. Libere nos ajustes do navegador.', 2:'Sinal de GPS indisponível no momento.', 3:'O GPS demorou para responder. Tentando de novo…' }[err.code] || 'Erro no GPS.';
  $('#gpsState').textContent = err.code === 1 ? 'Sem permissão' : 'Sem sinal';
  toast(msg, true);
  if (err.code === 1) stopGPS();
}
const toRad = d => d * Math.PI / 180;
function toUTM(lat, lon){
  const a = 6378137, f = 1/298.257223563, k0 = 0.9996, e2 = f*(2-f), ep2 = e2/(1-e2);
  const zone = Math.min(60, Math.floor((lon + 180) / 6) + 1), lon0 = toRad((zone - 1) * 6 - 180 + 3);
  const φ = toRad(lat), N = a / Math.sqrt(1 - e2*Math.sin(φ)**2), T = Math.tan(φ)**2, C = ep2*Math.cos(φ)**2, A = Math.cos(φ)*(toRad(lon) - lon0);
  const M = a*((1 - e2/4 - 3*e2*e2/64 - 5*e2**3/256)*φ - (3*e2/8 + 3*e2*e2/32 + 45*e2**3/1024)*Math.sin(2*φ) + (15*e2*e2/256 + 45*e2**3/1024)*Math.sin(4*φ) - (35*e2**3/3072)*Math.sin(6*φ));
  const E = k0*N*(A + (1-T+C)*A**3/6 + (5-18*T+T*T+72*C-58*ep2)*A**5/120) + 500000;
  let Nn = k0*(M + N*Math.tan(φ)*(A*A/2 + (5-T+9*C+4*C*C)*A**4/24 + (61-58*T+T*T+600*C-330*ep2)*A**6/720));
  if (lat < 0) Nn += 10000000;
  const band = 'CDEFGHJKLMNPQRSTUVWXX'[Math.floor((lat + 80) / 8)] || '';
  return `${zone}${band}  ${Math.round(E).toLocaleString('pt-BR')} E  ${Math.round(Nn).toLocaleString('pt-BR')} N`;
}
function dms(v, pos, neg){
  const s = v < 0 ? neg : pos; v = Math.abs(v);
  const d = Math.floor(v), mf = (v - d) * 60, m = Math.floor(mf), sec = (mf - m) * 60;
  return `${d}°${String(m).padStart(2, '0')}′${sec.toFixed(1).replace('.', ',').padStart(4, '0')}″${s}`;
}
function coordText(c){
  if (coordFmt === 1) return dms(c.latitude, 'N', 'S') + '  ' + dms(c.longitude, 'L', 'O');
  if (coordFmt === 2) return 'UTM ' + toUTM(c.latitude, c.longitude);
  return c.latitude.toFixed(6) + ', ' + c.longitude.toFixed(6);
}
function inside(ll, poly){
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++){
    const xi = poly[i].lng, yi = poly[i].lat, xj = poly[j].lng, yj = poly[j].lat;
    if (((yi > ll.lat) !== (yj > ll.lat)) && (ll.lng < (xj - xi) * (ll.lat - yi) / (yj - yi) + xi)) ins = !ins;
  }
  return ins;
}
function renderGps(){
  const c = lastFix; if (!c) return;
  const a = c.accuracy;
  const q = a <= 5 ? ['q-good', 'Excelente', 1] : a <= 15 ? ['q-good', 'Boa', .78] : a <= 40 ? ['q-mid', 'Moderada', .5] : ['q-bad', 'Fraca', .22];
  $('#meter').className = 'meter ' + q[0];
  $('#meterBar').style.strokeDashoffset = 144.5 * (1 - q[2]);
  $('#accVal').innerHTML = `±${a < 10 ? a.toFixed(1).replace('.', ',') : Math.round(a)}<small>metros</small>`;
  $('#coord').textContent = coordText(c);
  const meta = [`Precisão ${q[1].toLowerCase()}`];
  if (c.altitude != null) meta.push(`Alt. ${Math.round(c.altitude)} m`);
  if (c.speed != null && c.speed > 0.3) meta.push(`${(c.speed * 3.6).toFixed(1).replace('.', ',')} km/h`);
  let html = meta.map(m => `<span>${m}</span>`).join('');
  if (current && !inside({ lat:c.latitude, lng:c.longitude }, current.poly)) html += `<span class="warn">Fora do GeoPDF</span>`;
  $('#gpsMeta').innerHTML = html;
}
setInterval(() => {
  if (watchId === null || !lastFixAt) return;
  const age = Math.round((Date.now() - lastFixAt) / 1000);
  const live = $('#live');
  if (age < 6){ live.className = 'live on'; $('#gpsState').textContent = 'Ao vivo'; }
  else { live.className = 'live stale'; $('#gpsState').textContent = `Sem atualização há ${age} s`; }
}, 1000);
$('#gpsCard').onclick = () => {
  if (!lastFix){ startGPS(true); follow = true; updateLocateBtn(); return; }
  coordFmt = (coordFmt + 1) % 3; store.set('fmt', coordFmt); renderGps();
  toast(['Graus decimais', 'Graus, minutos e segundos', 'UTM (WGS 84)'][coordFmt]);
};

/* bússola: direção para onde o celular aponta */
let compassOn = false;
function startCompass(){
  if (compassOn) return;
  const handler = e => {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
    else if (e.absolute && e.alpha != null) h = 360 - e.alpha;
    if (h == null) return;
    const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    compassHeading = (h + ang + 360) % 360; updateHeading();
  };
  const listen = () => { compassOn = true;
    if ('ondeviceorientationabsolute' in window) addEventListener('deviceorientationabsolute', handler, true);
    else addEventListener('deviceorientation', handler, true); };
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function'){
    DeviceOrientationEvent.requestPermission().then(s => { if (s === 'granted') listen(); }).catch(() => {});
  } else listen();
}
let headingRaf = 0;
function updateHeading(){
  if (headingRaf) return;
  headingRaf = requestAnimationFrame(() => {
    headingRaf = 0;
    if (!meMarker) return;
    const el = meMarker.getElement(); if (!el) return;
    const me = el.querySelector('.me');
    let h = compassHeading;
    if (lastFix && lastFix.speed > 1 && Number.isFinite(lastFix.heading)) h = lastFix.heading;
    me.classList.toggle('has-heading', h != null);
    if (h != null) me.querySelector('.cone').style.transform = `rotate(${h}deg)`;
  });
}

function updateLocateBtn(){
  const b = $('#btnLocate');
  b.classList.toggle('on', watchId !== null && !follow);
  b.classList.toggle('follow', watchId !== null && follow);
}
$('#btnLocate').onclick = () => {
  if (watchId === null){ follow = true; firstFix = true; startGPS(true); }
  else { follow = true; startCompass(); if (lastFix) map.setView([lastFix.latitude, lastFix.longitude], Math.max(map.getZoom(), 17)); }
  updateLocateBtn();
};
map.on('dragstart', () => { if (follow){ follow = false; updateLocateBtn(); } });

/* manter a tela ligada */
async function requestWake(){
  if (!$('#swWake').checked || watchId === null || !('wakeLock' in navigator) || document.visibilityState !== 'visible' || wakeLock) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => wakeLock = null); } catch(_){}
}
function releaseWake(){ if (wakeLock){ wakeLock.release().catch(() => {}); wakeLock = null; } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') requestWake(); });

/* ---------- instalação e modo offline ---------- */
let installEvt = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; renderInstall(); });
addEventListener('appinstalled', () => { installEvt = null; renderInstall(); toast('MGEO PDF instalado'); });
function renderInstall(){
  const box = $('#installBox');
  if (isStandalone()){ box.hidden = true; return; }
  box.hidden = false;
  if (isIOS){
    box.innerHTML = `<b>Instalar no iPhone</b>No Safari, toque em <svg style="display:inline;vertical-align:-3px" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v12M8 7l4-4 4 4M5 12v8h14v-8"/></svg> Compartilhar e depois em <b style="display:inline">Adicionar à Tela de Início</b>. O app passa a abrir sem internet.`;
  } else if (installEvt){
    box.innerHTML = `<b>Instalar no celular</b>Instale para usar como app, sem internet e em tela cheia.<br><button class="btn btn-primary" id="btnInstall">Instalar MGEO PDF</button>`;
    $('#btnInstall').onclick = async () => { installEvt.prompt(); await installEvt.userChoice; installEvt = null; renderInstall(); };
  } else {
    box.innerHTML = `<b>Instalar no celular</b>No menu do navegador (⋮), toque em <b style="display:inline">Instalar app</b> ou <b style="display:inline">Adicionar à tela inicial</b>.`;
  }
}
function setOnline(){ $('#pillOff').hidden = navigator.onLine; }
addEventListener('online', setOnline); addEventListener('offline', setOnline);

/* ---------- início ---------- */
let appStarted = false;
window.startApp = async function(){
  if (appStarted) return; appStarted = true;
  setOnline();
  const op = store.get('op', '100'); $('#opacity').value = op; $('#opLbl').textContent = op + '%';
  $('#swWake').checked = store.get('wake', true);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')){
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then(() => {
      if (!had) navigator.serviceWorker.ready.then(() => toast('Pronto para uso offline'));
    }).catch(err => console.warn('SW', err));
  }
  try { await DB.open(); } catch(e){ toast('O navegador bloqueou o armazenamento local. Saia da aba anônima.', true); return; }
  await renderList();
  const last = store.get('last', null);
  if (last) await openMap(last, true);
  if (store.get('gps', false)) startGPS(false);
};
