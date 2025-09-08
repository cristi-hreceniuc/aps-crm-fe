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

// === DataGrid generic (paginare, sort, search debounced) ===
(function () {
  const GRID_SELECTOR = '[data-grid]';
  const DEBOUNCE_MS = 450;

  function debounce(fn, ms) {
    let t; 
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  class DataGrid {
    constructor(root) {
      this.root = root;
      const cfgScript = root.querySelector('.dg-config');
      this.cfg = JSON.parse(cfgScript?.textContent || '{}');

      // Elements
      this.tbody = root.querySelector('.dg-body');
      this.pagesEl = root.querySelector('.dg-pages');
      this.prevBtn = root.querySelector('.dg-prev');
      this.nextBtn = root.querySelector('.dg-next');
      this.searchEl = root.querySelector('.dg-search');

      // State
      this.page = 1;
      this.pageSize = this.cfg.pageSize || 10;
      this.sortBy = this._firstSortableKey() || null;
      this.sortDir = 'asc';
      this.q = '';

      // Bind
      this._bind();
      this.load();
    }

    _firstSortableKey() {
      const s = (this.cfg.columns || []).find(c => c.sortable);
      return s?.key;
    }

    _bind() {
      // Sorting
      this.root.querySelectorAll('th[data-sortable]').forEach(th => {
        th.addEventListener('click', () => {
          const k = th.dataset.key;
          if (this.sortBy === k) {
            this.sortDir = (this.sortDir === 'asc') ? 'desc' : 'asc';
          } else {
            this.sortBy = k; this.sortDir = 'asc';
          }
          this.page = 1;
          this._markSort(th);
          this.load();
        });
      });

      // Pager
      this.prevBtn?.addEventListener('click', () => {
        if (this.page > 1) { this.page--; this.load(); }
      });
      this.nextBtn?.addEventListener('click', () => {
        this.page++; this.load();
      });

      // Search (debounced on input, instant on blur)
      const doSearch = () => { 
        const v = this.searchEl.value.trim();
        if (v !== this.q) { this.q = v; this.page = 1; this.load(); }
      };
      const debounced = debounce(doSearch, DEBOUNCE_MS);
      this.searchEl?.addEventListener('input', debounced);
      this.searchEl?.addEventListener('blur', doSearch);
      this.searchEl?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
      });
    }

    _markSort(activeTh) {
      this.root.querySelectorAll('th[data-sortable]').forEach(th => {
        th.classList.remove('sort-asc','sort-desc','sort-active');
      });
      if (activeTh) {
        activeTh.classList.add('sort-active', this.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      } else {
        const th = this.root.querySelector(`th[data-key="${this.sortBy}"][data-sortable]`);
        if (th) th.classList.add('sort-active', this.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    }

    async load() {
      const url = new URL(this.cfg.endpoint, window.location.origin);
      url.searchParams.set('page', this.page);
      url.searchParams.set('pageSize', this.pageSize);
      if (this.sortBy)  url.searchParams.set('sortBy', this.sortBy);
      if (this.sortDir) url.searchParams.set('sortDir', this.sortDir);
      if (this.q)       url.searchParams.set('q', this.q);

      try {
        const res = await fetch(url.toString(), { headers:{ 'Accept':'application/json' }});
        if (!res.ok) throw new Error('Network error');
        const data = await res.json();
        this._renderRows(data.items || []);
        this._renderPager(data.page || 1, data.pageSize || this.pageSize, data.total || 0);
        this._markSort();
      } catch (e) {
        this._renderError();
        this.pagesEl.textContent = 'Eroare la încărcare.';
        this.prevBtn.disabled = this.nextBtn.disabled = true;
      }
    }

    _renderRows(items) {
      const cols = this.cfg.columns || [];
      if (!items.length) {
        this.tbody.innerHTML = `<tr><td colspan="${cols.length}" class="muted" style="text-align:center;padding:22px">Nicio înregistrare.</td></tr>`;
        return;
      }
      const html = items.map(row => {
        const tds = cols.map(c => {
          let v = row[c.key];
          if (v == null) v = '';
          if (Array.isArray(v)) v = v.join(', ');
          return `<td>${escapeHtml(String(v))}</td>`;
        }).join('');
        return `<tr>${tds}</tr>`;
      }).join('');
      this.tbody.innerHTML = html;
    }

    _renderPager(page, pageSize, total) {
      this.page = page; this.pageSize = pageSize;
      const pages = Math.max(1, Math.ceil(total / pageSize));

      this.prevBtn.disabled = (page <= 1);
      this.nextBtn.disabled = (page >= pages);

      // Afișăm "Pagina X din Y • N rezultate"
      this.pagesEl.textContent = `Pagina ${page} din ${pages} • ${total} rezultate`;
    }
  }

  function escapeHtml(s) {
    return s
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#39;');
  }

  // Init all grids on page
  window.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll(GRID_SELECTOR).forEach(el => new DataGrid(el));
  });
})();

