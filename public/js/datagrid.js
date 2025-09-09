// public/js/datagrid.js
// DataGrid simplu: sort, paginate, search (0-based), autosize coloane + clamp
(function(){
  const $  = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const cssEscape = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/"/g,'\\"');

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

  class DataGrid {
    constructor(section){
      this.el = section;
      const cfgEl = $('.dg-config', section);
      this.cfg = cfgEl ? JSON.parse(cfgEl.textContent || '{}') : {};

      this.tbody   = $('.dg-body', section);
      this.thead   = $('thead', section);
      this.table   = $('.dg-table', section);
      this.colgroup= $('colgroup', section);
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
      // re-autosize la resize (debounced)
      window.addEventListener('resize', debounce(()=> this._autosizeColumns(), 150));
      this._setupObservers();

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
      const itemsKey = resp.items || 'content';
      const pageKey  = resp.page  || 'number';
      const sizeKey  = resp.size  || 'size';
      const totalKey = resp.total || 'totalElements';

      let items = this._getPath(data, itemsKey);
      if (!Array.isArray(items)) items = data.content || data.items || data.result || [];
      const page  = Number(this._getPath(data, pageKey)  ?? data.number ?? 0);
      const size  = Number(this._getPath(data, sizeKey)  ?? data.size   ?? (this.state.size||10));
      const total = Number(this._getPath(data, totalKey) ?? data.totalElements ?? data.total ?? items.length);

      this.state.page  = isNaN(page)  ? 0 : page;
      this.state.size  = isNaN(size)  ? (this.state.size||10) : size;
      this.state.total = isNaN(total) ? items.length : total;

      this._renderRows(items);
      this._renderHeaderSort();
      this._renderPager();

      // autosize după ce s-au așezat rândurile
      requestAnimationFrame(()=> this._autosizeColumns());
    }

    _renderHeaderSort(){
  if (!this.thead) return;

  // curăță starea anterioară
  Array.from(this.thead.querySelectorAll('th')).forEach(th => {
    th.classList.remove('sort-active','sort-asc','sort-desc');
  });

  if (!this.state.sortKey) return;

  const keyEsc = (window.CSS && CSS.escape) ? CSS.escape(this.state.sortKey) : String(this.state.sortKey);
  const th = this.thead.querySelector(`th[data-key="${keyEsc}"]`);
  if (!th) return;

  th.classList.add('sort-active');
  th.classList.add(this.state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
}

    _renderRows(items){
      const cols = this.cfg.columns || [];
      if(!items.length){
        this.tbody.innerHTML = `<tr><td colspan="${cols.length}" class="muted" style="text-align:center;padding:22px">Nicio înregistrare.</td></tr>`;
        return;
      }

      const html = items.map(row=>{
        const tds = cols.map(c=>{
          let raw = row[c.key];
          let innerHTML, titleStr;

          if (c.type === 'date' && raw) {
        const val = fmtDate(raw);
        innerHTML = escapeHtml(val);
        titleStr = String(val);
        } else if (c.type === 'link' && raw) {
        const url = String(raw);
        const label = row[c.key + '_label'] ? String(row[c.key + '_label']) : 'Deschide';
        innerHTML = `<a href="${escapeAttr(url)}" target="_blank" rel="noopener" title="${escapeAttr(url)}">${escapeHtml(label)}</a>`;
        titleStr = url;
        } else if (c.type === 'actions') {
        // 👁️ Vezi (folosim row.link dacă există) + ✖ Șterge
        const viewUrl = row.link ? String(row.link) : '';
        innerHTML = `
            <div class="dg-actions">
            <button class="icon-btn btn-view" title="Vezi" data-id="${escapeAttr(row.id)}" ${viewUrl ? `data-link="${escapeAttr(viewUrl)}"` : ''} aria-label="Vezi">
                <span class="ico">👁️</span>
            </button>
            <button class="icon-btn btn-del" title="Șterge" data-id="${escapeAttr(row.id)}" data-name="${escapeAttr(row.name || '')}" aria-label="Șterge">
                <span class="ico">✖</span>
            </button>
            </div>
        `;
        titleStr = '';
        } else {
        if (raw == null) raw = '';
        if (Array.isArray(raw)) raw = raw.join(', ');
        const s = String(raw);
        innerHTML = escapeHtml(s);
        titleStr = s;
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
      this._bindRowActions();   // << adăugat
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

    _bindRowActions(){
  if (this._actionsBound) return;
  this._actionsBound = true;

  this.tbody.addEventListener('click', async (e)=>{
    const viewBtn = e.target.closest('.btn-view');
    const delBtn  = e.target.closest('.btn-del');
    if (viewBtn){
      const link = viewBtn.getAttribute('data-link');
      const id   = viewBtn.getAttribute('data-id');
      if (link) {
        window.open(link, '_blank', 'noopener');
      } else {
        // fallback: dacă n-ai link din BE, poți implementa o pagină de detalii /voluntari/:id
        alert(`Nu există link pentru voluntarul #${id}`);
      }
      return;
    }
    if (delBtn){
  const id   = delBtn.getAttribute('data-id');
  const name = delBtn.getAttribute('data-name') || `#${id}`;
  if (!confirm(`Ștergi voluntarul ${name}? Operațiunea este definitivă.`)) return;
  try{
    // baza din endpoint (ex: /api/voluntari sau /api/voluntari/search)
    const epRaw = (this.cfg.endpoint || '/api/voluntari');
    const base  = epRaw.replace(/\/search(?:\?.*)?$/,'').replace(/\/+$/,''); // scoate /search și / la final
    const url   = `${base}/${encodeURIComponent(id)}`;

    const res = await fetch(url, {
      method: 'DELETE',
      headers: { 'Accept':'application/json' },
      credentials: 'same-origin'   // asigură cookie-ul de sesiune spre FE proxy
    });
    if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
    this.fetch(); // reîncarcă lista
  } catch(err){
    console.error('DELETE error', err);
    alert('Nu am putut șterge voluntarul. Încearcă din nou.');
  }
}
  });
}

_setupObservers(){
  // Re-autosize când se schimbă dimensiunea containerului tabelului
  const scroll = this.table?.parentElement; // .dg-scroll
  if (scroll && 'ResizeObserver' in window){
    this._ro = new ResizeObserver(() => this._autosizeColumns());
    this._ro.observe(scroll);
  }
  // Re-autosize când se extinde/restrânge sidebarul
  window.addEventListener('sidenav-resized', () => this._autosizeColumns());
}

    /* ================== AUTO-SIZE coloane ==================
       Măsoară textul (header + celule vizibile) și setează width pe <col>.
       Respectă clamp (pentru câmpuri foarte lungi) și limite minPx/maxPx. */
    _autosizeColumns(){
      // nu autosize pe mobil (card layout)
      if (window.matchMedia('(max-width: 760px)').matches) return;
      if (!this.table || !this.colgroup) return;

      const colsCfg = this.cfg.columns || [];
      const minPx = Number(this.cfg.autosize?.minPx ?? 80);
      const maxPx = Number(this.cfg.autosize?.maxPx ?? 320);

      // Canvas pt. măsurat textul cu fontul real din tabel
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const refCell = this.tbody.querySelector('td') || this.thead.querySelector('th');
      const style = refCell ? getComputedStyle(refCell) : { font: '14px Inter' };
      const font = `${style.fontStyle || ''} ${style.fontVariant || ''} ${style.fontWeight || ''} ${style.fontSize || '14px'}/${style.lineHeight || '20px'} ${style.fontFamily || 'Inter, Arial'}`.trim();
      ctx.font = font;

      // padding approx pe celulă (st/dr)
      const padX = (()=> {
        if (!refCell) return 20;
        const cs = getComputedStyle(refCell);
        return (parseFloat(cs.paddingLeft)||0) + (parseFloat(cs.paddingRight)||0);
      })();

      // calc width pt. fiecare col
      const widths = colsCfg.map((c, idx)=>{
        // 1) header
        const th = this.thead?.querySelector(`th.col-${cssEscape(c.key)}`);
        const headerText = th ? th.querySelector('.th-label')?.textContent?.trim() || '' : (c.label || '');
        let w = ctx.measureText(headerText).width;

        // 2) celule vizibile (luăm primele 20 pentru performanță)
        const cells = $$( `.col-${cssEscape(c.key)}`, this.tbody ).slice(0, 20);
        cells.forEach(td=>{
          const link = td.querySelector('a');
          const span = td.querySelector('.dg-val');
          const txt  = link?.textContent || span?.textContent || td.textContent || '';
          const mw   = ctx.measureText(txt.trim()).width;
          if (mw > w) w = mw;
        });

        // 3) ajustări după tip
        if (c.type === 'number') w *= 0.8;                      // numere pot fi mai înguste
        if (/email|mail/i.test(c.key)) w *= 1.05;               // email ușor mai lat
        if (c.clamp) w = Math.min(w, 200);                      // câmpuri lungi (motivation etc.) nu extind tabelul

        // padding + mică rezervă pentru icon sort
        w = Math.ceil(w + padX + (c.sortable ? 16 : 0));

        // limite
        w = Math.max(minPx, Math.min(maxPx, w));
        return w;
      });

      // Normalizează la lățimea containerului (fără scrollbar)
      const container = this.table.parentElement; // .dg-scroll
      const available = container.clientWidth || this.table.clientWidth || 0;
      const sum = widths.reduce((a,b)=> a+b, 0) || 1;

      // Setăm pe <col> în px (tabelul e table-layout: fixed)
      const cols = $$('.dg-col', this.colgroup);
      cols.forEach((colEl, i)=>{
        const px = Math.round(widths[i] * available / sum);
        colEl.style.width = `${px}px`;
      });
    }
  }

  window.addEventListener('DOMContentLoaded', ()=>{
    $$('.card[data-grid]').forEach(section => new DataGrid(section));
  });
})();
