// Lightweight DataGrid: sort, paginate, search (0-based), clamp text
(function(){
  const $  = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  const escapeHtml = (s)=> String(s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
  const escapeAttr = escapeHtml;

  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (!isNaN(d)) {
      const dd = String(d.getDate()).padStart(2,'0');
      const mm = String(d.getMonth()+1).padStart(2,'0');
      const yyyy = d.getFullYear();
      return `${dd}.${mm}.${yyyy}`;
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
    return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso);
  };

  const debounce = (fn, ms=400) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };
  const cssEscape = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/"/g,'\\"');

  class DataGrid {
    constructor(section){
      this.el = section;
      const cfgEl = $('.dg-config', section);
      if (!cfgEl) { console.error('[DataGrid] nu găsește .dg-config'); return; }
      try {
        this.cfg = JSON.parse(cfgEl.textContent || '{}');
      } catch(e) {
        console.error('[DataGrid] JSON invalid în .dg-config', e, cfgEl.textContent);
        this.cfg = {};
      }

      this.tbody   = $('.dg-body', section);
      this.thead   = $('thead', section);
      this.prevBtn = $('.dg-prev', section);
      this.nextBtn = $('.dg-next', section);
      this.pagesEl = $('.dg-pages', section);
      this.searchEl= $('.dg-search', section);

      const size = Number(this.cfg.pageSize || 10);
      this.state = {
        page: 0, size,
        sortKey: (this.cfg.columns || []).find(c => c.defaultSort)?.key || null,
        sortDir: (this.cfg.columns || []).find(c => c.defaultSort)?.dir || 'asc',
        q: ''
      };

      this._bind();
      this.fetch();
    }

    _bind(){
      if (this.thead){
        this.thead.addEventListener('click', (e)=>{
          const th = e.target.closest('th[data-sortable]');
          if(!th) return;
          const key = th.getAttribute('data-key');
          if (this.state.sortKey === key){
            this.state.sortDir = this.state.sortDir === 'asc' ? 'desc' : 'asc';
          } else {
            this.state.sortKey = key;
            this.state.sortDir = 'asc';
          }
          this.state.page = 0;
          this.fetch();
        });
      }

      if (this.prevBtn) this.prevBtn.addEventListener('click', (e)=>{
        e.preventDefault();
        if (this.prevBtn.disabled) return;
        this.goto(this.state.page - 1);
      });
      if (this.nextBtn) this.nextBtn.addEventListener('click', (e)=>{
        e.preventDefault();
        if (this.nextBtn.disabled) return;
        this.goto(this.state.page + 1);
      });

      if (this.searchEl){
        this.searchEl.addEventListener('input', debounce(()=>{
          this.state.q = this.searchEl.value.trim();
          this.state.page = 0;
          this.fetch();
        }, 450));
      }
    }

    goto(page){ if (page < 0) page = 0; this.state.page = page; this.fetch(); }

    _endpointUrl(){
      const ep = this.cfg.endpoint || '';
      try { return new URL(ep, window.location.origin); }
      catch { return new URL(window.location.origin + ep); }
    }

    async fetch(){
      const url = this._endpointUrl();
      const api = this.cfg.api || {};
      const pageParam   = api.pageParam   || 'page';
      const sizeParam   = api.sizeParam   || 'size';
      const sortParam   = api.sortParam   || 'sort';
      const searchParam = api.searchParam || null;
      const sortValueTpl= api.sortValue   || '{key},{dir}';
      const pageBase    = Number(api.pageBase || 0);

      const params = url.searchParams;
      params.set(pageParam, String(this.state.page + pageBase));
      params.set(sizeParam, String(this.state.size));

      if (this.state.sortKey){
        const v = sortValueTpl.replace('{key}', this.state.sortKey)
                              .replace('{dir}', this.state.sortDir);
        params.set(sortParam, v);
      } else {
        params.delete(sortParam);
      }
      if (searchParam){
        if ((this.state.q||'').length) params.set(searchParam, this.state.q);
        else params.delete(searchParam);
      }

      try{
        const res = await fetch(url.toString(), { headers: { 'Accept':'application/json' }});
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        // log util ca să vezi ce vine exact
        console.debug('[DataGrid]', url.toString(), {state:this.state, data});
        this._consumeResponse(data);
      } catch(err){
        console.error('DataGrid fetch error:', err);
        if (this.tbody)
          this.tbody.innerHTML = `<tr><td colspan="${(this.cfg.columns||[]).length}" class="muted" style="text-align:center;padding:22px">Eroare la încărcare.</td></tr>`;
        if (this.pagesEl) this.pagesEl.textContent = '—';
        if (this.prevBtn) this.prevBtn.disabled = true;
        if (this.nextBtn) this.nextBtn.disabled = true;
      }
    }

    _getPath(obj, key){
      if (!key) return undefined;
      if (key.includes('.')) return key.split('.').reduce((acc,k)=> (acc ? acc[k] : undefined), obj);
      return obj[key];
    }

    _consumeResponse(data){
      const resp = this.cfg.response || {};
      // fallback-uri inteligente dacă mapping-ul e greșit
      const itemsKey = resp.items || 'content';
      const pageKey  = resp.page  || 'number';
      const sizeKey  = resp.size  || 'size';
      const totalKey = resp.total || 'totalElements';

      let items = this._getPath(data, itemsKey);
      if (!Array.isArray(items)) {
        // fallback pe câteva chei comune
        items = data.content || data.items || data.result || [];
      }
      const page  = Number(this._getPath(data, pageKey)  ?? data.number ?? 0);
      const size  = Number(this._getPath(data, sizeKey)  ?? data.size   ?? (this.state.size||10));
      const total = Number(this._getPath(data, totalKey) ?? data.totalElements ?? data.total ?? items.length);

      this.state.page  = isNaN(page)  ? 0 : page;
      this.state.size  = isNaN(size)  ? (this.state.size||10) : size;
      this.state.total = isNaN(total) ? items.length : total;

      this._renderRows(items);
      this._renderHeaderSort();
      this._renderPager();
    }

    _renderHeaderSort(){
      if (!this.thead) return;
      $$('th', this.thead).forEach(th=>{
        th.classList.remove('sort-active','sort-asc','sort-desc');
      });
      if (!this.state.sortKey) return;
      const sel = `th[data-key="${cssEscape(this.state.sortKey)}"]`;
      const th = $(sel, this.thead);
      if (!th) return;
      th.classList.add('sort-active');
      th.classList.add(this.state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
    }

    _renderRows(items){
      const cols = this.cfg.columns || [];
      if (!this.tbody) return;

      if(!items.length){
        this.tbody.innerHTML = `<tr><td colspan="${cols.length}" class="muted" style="text-align:center;padding:22px">Nicio înregistrare.</td></tr>`;
        return;
      }

      const html = items.map(row=>{
        const tds = cols.map(c=>{
          let raw = row[c.key];
          let innerHTML, titleStr;

          if(c.type === 'date' && raw){
            const val = fmtDate(raw);
            innerHTML = escapeHtml(val);
            titleStr = String(val);
          } else if(c.type === 'link' && raw){
            const url = String(raw);
            const label = row[c.key + '_label'] ? String(row[c.key + '_label']) : 'Deschide';
            innerHTML = `<a href="${escapeAttr(url)}" target="_blank" rel="noopener" title="${escapeAttr(url)}">${escapeHtml(label)}</a>`;
            titleStr = url;
          } else {
            if(raw == null) raw = '';
            if(Array.isArray(raw)) raw = raw.join(', ');
            const s = String(raw);
            innerHTML = escapeHtml(s);
            titleStr  = s;
          }

          const clampClass = c.clamp ? ` dg-clamp dg-clamp-${c.clamp}` : '';
          const val = (c.type === 'link')
            ? innerHTML
            : `<span class="dg-val${clampClass}">${innerHTML}</span>`;

          return `<td class="col-${escapeAttr(c.key)}" data-label="${escapeAttr(c.label)}" title="${escapeAttr(titleStr)}">${val}</td>`;
        }).join('');

        return `<tr>${tds}</tr>`;
      }).join('');

      this.tbody.innerHTML = html;
    }

    _renderPager(){
      if (!this.pagesEl) return;
      const page  = this.state.page;   // 0-based
      const size  = this.state.size;
      const total = this.state.total || 0;
      const pages = Math.max(1, Math.ceil(total / size));

      if (this.prevBtn) this.prevBtn.disabled = page <= 0;
      if (this.nextBtn) this.nextBtn.disabled = page >= pages - 1;

      this.pagesEl.textContent = `Pagina ${page + 1} din ${pages} • ${total} rezultate`;
    }
  }

  window.addEventListener('DOMContentLoaded', ()=>{
    const grids = $$('.card[data-grid]');
    if (!grids.length) return;
    grids.forEach(section => new DataGrid(section));
  });
})();
