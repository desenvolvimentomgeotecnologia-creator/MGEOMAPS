/* MGEO PDF – blocos do fundo do mapa guardados no celular (IndexedDB) */
'use strict';

const TileStore = {
  db: null,
  _opening: null,
  open(){
    if (this.db) return Promise.resolve(this.db);
    if (this._opening) return this._opening;
    this._opening = new Promise((res, rej) => {
      const r = indexedDB.open('mgeo-tiles', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('tiles')) db.createObjectStore('tiles');
        if (!db.objectStoreNames.contains('packs')) db.createObjectStore('packs', { keyPath:'id' });
      };
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
    return this._opening;
  },
  async _tx(store, mode, fn){
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction(store, mode), st = tx.objectStore(store);
      let out; const rq = fn(st);
      if (rq) rq.onsuccess = () => out = rq.result;
      tx.oncomplete = () => res(out);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('Sem espaço no celular'));
    });
  },
  get(key){ return this._tx('tiles', 'readonly', s => s.get(key)); },
  has(key){ return this._tx('tiles', 'readonly', s => s.getKey(key)).then(k => k !== undefined); },
  putMany(entries){ return this._tx('tiles', 'readwrite', s => { entries.forEach(([k, v]) => s.put(v, k)); }); },
  delMany(keys){ return this._tx('tiles', 'readwrite', s => { keys.forEach(k => s.delete(k)); }); },
  packs(){ return this._tx('packs', 'readonly', s => s.getAll()); },
  putPack(p){ return this._tx('packs', 'readwrite', s => s.put(p)); },
  delPack(id){ return this._tx('packs', 'readwrite', s => s.delete(id)); }
};

/* mesma regra de subdomínio do Leaflet: |x+y| % 4 */
const tileUrl = (lyr, z, x, y) => `https://mt${Math.abs(x + y) % 4}.google.com/vt/lyrs=${lyr}&hl=pt-BR&x=${x}&y=${y}&z=${z}`;

/* camada que usa o bloco salvo no celular e, se não tiver, busca na internet */
const OfflineTileLayer = L.TileLayer.extend({
  initialize(lyr, url, options){
    this._lyr = lyr;
    L.TileLayer.prototype.initialize.call(this, url, options);
    this.on('tileunload', e => { if (e.tile && e.tile._blobUrl){ URL.revokeObjectURL(e.tile._blobUrl); e.tile._blobUrl = null; } });
  },
  createTile(coords, done){
    const img = document.createElement('img');
    img.alt = ''; img.setAttribute('role', 'presentation');
    L.DomEvent.on(img, 'load', L.Util.bind(this._tileOnLoad, this, done, img));
    L.DomEvent.on(img, 'error', L.Util.bind(this._tileOnError, this, done, img));
    const net = this.getTileUrl(coords);
    const key = `${this._lyr}/${coords.z}/${coords.x}/${coords.y}`;
    TileStore.get(key).then(rec => {
      if (rec && rec.d){
        img._blobUrl = URL.createObjectURL(new Blob([rec.d], { type: rec.t || 'image/jpeg' }));
        img.src = img._blobUrl;
      } else img.src = net;
    }).catch(() => { img.src = net; });
    return img;
  }
});
