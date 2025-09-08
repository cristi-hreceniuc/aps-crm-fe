// Sidebar: collapse/expand pe mobil după scroll direction
(function () {
  const wrapper = document.getElementById('menuWrapper');
  const surface = document.querySelector('.sidenav-surface');
  if (!wrapper || !surface) return;

  let lastY = window.scrollY;
  let ticking = false;

  function onScroll() {
    const y = window.scrollY;
    const down = y > lastY + 4;
    const up   = y < lastY - 4;

    if (window.innerWidth <= 900) {
      // shrink "header" un pic după ce plecăm din top (opțional)
      surface.classList.toggle('shrink', y > 12);

      if (down && y > 80) wrapper.classList.add('collapse');
      if (up)            wrapper.classList.remove('collapse');
    } else {
      wrapper.classList.remove('collapse');
      surface.classList.remove('shrink');
    }

    lastY = y;
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) { requestAnimationFrame(onScroll); ticking = true; }
  }, { passive:true });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) {
      wrapper.classList.remove('collapse'); surface.classList.remove('shrink');
    } else {
      onScroll();
    }
  });
})();


// === DataGrid generic (compat Spring Data: sort/page/size + Page JSON) ===
(function () {
  const GRID_SELECTOR = '[data-grid]';
  const DEBOUNCE_MS = 450;

  function debounce(fn, ms) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }
  function escapeHtml(s){return s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');}
  function escapeAttr(s){return escapeHtml(s).replaceAll('\n',' ');}
  function fmtDate(v){ try{ const d=new Date(v); if(isNaN(d)) return v; return new Intl.DateTimeFormat('ro-RO',{year:'numeric',month:'2-digit',day:'2-digit'}).format(d); }catch{ return v; } }
  function get(obj, path, def){ if(!path) return def; return path.split('.').reduce((o,k)=> (o && k in o)? o[k] : undefined, obj) ?? def; }

  class DataGrid {
    constructor(root){
      this.root = root;
      this.cfg = JSON.parse(root.querySelector('.dg-config')?.textContent || '{}');

      this.tbody = root.querySelector('.dg-body');
      this.pagesEl = root.querySelector('.dg-pages');
      this.prevBtn = root.querySelector('.dg-prev');
      this.nextBtn = root.querySelector('.dg-next');
      this.searchEl = root.querySelector('.dg-search');

      this.page = 1;
      this.pageSize = this.cfg.pageSize || 10;
      this.sortBy = this._firstSortableKey() || null;
      this.sortDir = 'asc';
      this.q = '';

      this._bind();
      this.load();
    }

    _firstSortableKey(){
      const s=(this.cfg.columns||[]).find(c=>c.sortable);
      return s?.key || null;
    }

    _bind(){
      // sort
      this.root.querySelectorAll('th[data-sortable]').forEach(th=>{
        th.addEventListener('click',()=>{
          const k=th.dataset.key;
          if(this.sortBy===k) this.sortDir = (this.sortDir==='asc') ? 'desc' : 'asc';
          else { this.sortBy=k; this.sortDir='asc'; }
          this.page=1; this._markSort(th); this.load();
        });
      });
      // pager
      this.prevBtn?.addEventListener('click',()=>{ if(this.page>1){ this.page--; this.load(); }});
      this.nextBtn?.addEventListener('click',()=>{ this.page++; this.load(); });
      // search
      const doSearch = ()=>{
        const v=this.searchEl.value.trim();
        if(v!==this.q){ this.q=v; this.page=1; this.load(); }
      };
      const debounced = debounce(doSearch, DEBOUNCE_MS);
      this.searchEl?.addEventListener('input', debounced);
      this.searchEl?.addEventListener('blur', doSearch);
      this.searchEl?.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); doSearch(); }});
    }

    _markSort(activeTh){
      this.root.querySelectorAll('th[data-sortable]').forEach(th=>th.classList.remove('sort-asc','sort-desc','sort-active'));
      const th = activeTh || this.root.querySelector(`th[data-key="${this.sortBy}"][data-sortable]`);
      if(th) th.classList.add('sort-active', this.sortDir==='asc' ? 'sort-asc' : 'sort-desc');
    }

    async load(){
  const api = this.cfg.api || {};
  const pageParam   = api.pageParam || 'page';
  const sizeParam   = api.sizeParam || 'pageSize';
  const sortParam   = api.sortParam || (this.sortBy ? 'sort' : null);
  const sortTpl     = api.sortValue || null;   // e.g. "{key},{dir}"
  const beZeroBased = (api.pageBase === 0);    // <— important
  const searchParam = api.searchParam;         // only if your BE supports it

  const url = new URL(this.cfg.endpoint, window.location.origin);

  // UI is 1-based; BE can be 0-based → map correctly
  const bePage = beZeroBased ? Math.max(0, this.page - 1) : this.page;
  url.searchParams.set(pageParam, String(bePage));
  url.searchParams.set(sizeParam, String(this.pageSize));

  if (this.sortBy && sortParam) {
    const sv = sortTpl ? sortTpl.replace('{key}', this.sortBy).replace('{dir}', this.sortDir)
                       : this.sortBy;
    url.searchParams.set(sortParam, sv);
  }
  if (searchParam && this.q) {
    url.searchParams.set(searchParam, this.q);
  }

  const headers = { 'Accept':'application/json' };
  const extraHeaders = (this.cfg.auth && this.cfg.auth.headers) || {};
  Object.assign(headers, extraHeaders);

  const fetchOpts = { headers };
  if (this.cfg.auth && this.cfg.auth.credentials) {
    fetchOpts.credentials = this.cfg.auth.credentials; // e.g. 'include'
  }

  try {
    const res = await fetch(url.toString(), fetchOpts);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();

    const map   = this.cfg.response || {};
    const items = get(json, map.items, []);
    const total = get(json, map.total, 0);
    const size  = get(json, map.size,  this.pageSize);
    const beResPage = get(json, map.page, beZeroBased ? 0 : 1);  // page from BE
    const uiPage    = beZeroBased ? (beResPage + 1) : beResPage; // back to 1-based UI

    this._renderRows(items || []);
    this._renderPager(uiPage, size, total);
    this._markSort();
  } catch (e) {
    console.error('DataGrid load error:', e);
    this.tbody.innerHTML = `<tr><td colspan="${(this.cfg.columns||[]).length}" class="muted" style="text-align:center;padding:22px">Eroare la încărcare.</td></tr>`;
    this.pagesEl.textContent = 'Eroare.';
    this.prevBtn.disabled = this.nextBtn.disabled = true;
  }
}


    _renderRows(items){
      const cols=this.cfg.columns||[];
      if(!items.length){
        this.tbody.innerHTML=`<tr><td colspan="${cols.length}" class="muted" style="text-align:center;padding:22px">Nicio înregistrare.</td></tr>`;
        return;
      }
      const html = items.map(row=>{
        const tds = cols.map(c=>{
          let raw = row[c.key];
          let html;
          if(c.type==='date' && raw){ html = escapeHtml(fmtDate(raw)); }
          else if(c.type==='link' && raw){
            const url=String(raw);
            const label = row[c.key+'_label'] ? String(row[c.key+'_label']) : 'Deschide';
            html = `<a href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
          } else {
            if(raw==null) raw='';
            if(Array.isArray(raw)) raw=raw.join(', ');
            html = escapeHtml(String(raw));
          }
          return `<td data-label="${escapeAttr(c.label)}">${html}</td>`;
        }).join('');
        return `<tr>${tds}</tr>`;
      }).join('');
      this.tbody.innerHTML = html;
    }

    _renderPager(page, pageSize, total){
      this.page = page; this.pageSize = pageSize;
      const pages = Math.max(1, Math.ceil(total / pageSize));
      this.prevBtn.disabled = (page <= 1);
      this.nextBtn.disabled = (page >= pages);
      this.pagesEl.textContent = `Pagina ${page} din ${pages} • ${total} rezultate`;
    }
  }

  window.addEventListener('DOMContentLoaded', ()=>{
    document.querySelectorAll(GRID_SELECTOR).forEach(el=> new DataGrid(el));
  });
})();
