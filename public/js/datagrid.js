// public/js/datagrid.js
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const escapeHtml = (s) => String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  const escapeAttr = escapeHtml;
  const cssEsc = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/"/g, '\\"');

  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (!isNaN(d)) {
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      return `${dd}.${mm}.${yyyy}`;
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
    return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso);
  };

  const debounce = (fn, ms = 450) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  class DataGrid {
    constructor(section) {
      this.el = section;
      const cfgEl = $('.dg-config', section);
      this.cfg = cfgEl ? JSON.parse(cfgEl.textContent || '{}') : {};

      this.gridId = (this.cfg.gridId || this.el.getAttribute('data-grid-id') || '').toLowerCase();
      this.tbody = $('.dg-body', section);
      this.thead = $('thead', section);
      this.table = $('.dg-table', section);
      this.colgroup = $('colgroup', section);

      this.prevBtn = $('.dg-prev', section);
      this.nextBtn = $('.dg-next', section);
      this.pagesEl = $('.dg-pages', section);
      this.searchEl = $('.dg-search', section);

      // footer / bulk
      this.footer = $('.dg-footer', section) || section;
      this.bulkBox = $('.dg-bulk', section);
      this.bulkDate = $('.dg-bulk-date', section);
      this.bulkBtn = $('.dg-bulk-btn', section);
      this.footer = this.el.querySelector('.dg-footer');
      this.bulkWrap = this.el.querySelector('.dg-bulk');


      const size = Number(this.cfg.pageSize || 10);
      const firstSorted = (this.cfg.columns || []).find(c => c.defaultSort);

      this.state = {
        page: 0, size,
        sortKey: firstSorted ? firstSorted.key : null,
        sortDir: firstSorted ? (firstSorted.dir || 'asc') : 'asc',
        q: ''
      };

      // selecții
      this.selected = new Set();

      this._toggles = {};
      this._actionsBound = false;

      this._bind();
      this.fetch();

      window.addEventListener('resize', debounce(() => this._autosizeColumns(), 150));
      this._setupObservers();

      // data implicită în bulk (astăzi) – doar pe f230
      // data implicită în bulk (astăzi) – doar pe f230
      if (this.gridId === 'f230' && this.bulkDate && !this.bulkDate.value) {
        const d = new Date();
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        if (this.bulkDate.type === 'date') {
          // pentru <input type="date">
          this.bulkDate.value = `${yyyy}-${mm}-${dd}`;
        } else {
          // pentru input text
          this.bulkDate.value = `${dd}.${mm}.${yyyy}`;
        }
      }
      this.el._dgInstance = this;
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this._closeModal();
      });

    }

    _esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    _fmtTxt(s) { const t = (s ?? '').trim(); return t ? this._esc(t) : '—'; }
    _fmtMultiline(s) { const t = (s ?? '').trim(); return t ? this._esc(t).replace(/\n/g, '<br>') : '—'; }
    _fmtDate(iso) {
      if (!iso) return '—';
      try { const d = new Date(iso); if (!isNaN(d)) return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`; }
      catch (e) { }
      return this._esc(iso);
    }

    // pune asta în datagrid.js, în clasa DataGrid
    _showModal(html) {
      let root = document.getElementById('dg-modal-root');
      if (!root) {
        root = document.createElement('div');
        root.id = 'dg-modal-root';
        root.className = 'dg-modal-root';
        document.body.appendChild(root);
      }
      // injectează ca HTML, nu text!
      root.innerHTML = html;

      const closeBtn = root.querySelector('.dg-modal-close');
      const card = root.querySelector('.dg-modal-card');

      const close = () => { root.innerHTML = ''; root.classList.remove('open'); };

      root.classList.add('open');
      root.addEventListener('click', (e) => { if (e.target === root) close(); });
      if (closeBtn) closeBtn.addEventListener('click', close);
      // previne închiderea când dai click în card
      if (card) card.addEventListener('click', e => e.stopPropagation());
    }



    /* endpoint normal vs. endpointSearch când există q */
    _currentEndpointPath() {
      const ep = this.cfg.endpoint || '';
      const eps = this.cfg.endpointSearch || null;
      const hasQ = !!(this.state.q && this.state.q.length);
      return (hasQ && eps) ? eps : ep;
    }
    _endpointUrl() {
      const ep = this._currentEndpointPath();
      try { return new URL(ep, window.location.origin); }
      catch { return new URL(window.location.origin + ep); }
    }

    _bind() {
      // sortare
      if (this.thead) {
        this.thead.addEventListener('click', (e) => {
          const th = e.target.closest('th[data-sortable]');
          if (!th) return;
          const key = th.getAttribute('data-key');
          if (this.state.sortKey === key) {
            this.state.sortDir = this.state.sortDir === 'asc' ? 'desc' : 'asc';
          } else {
            this.state.sortKey = key;
            this.state.sortDir = 'asc';
          }
          this.state.page = 0;
          this.fetch();
        });

        // select-all (dacă avem col select)
        this.thead.addEventListener('change', (e) => {
          const t = e.target;
          if (!t.classList.contains('dg-check-all')) return;
          const checked = !!t.checked;
          this._setAllSelection(checked);
        });
      }

      // pager
      if (this.prevBtn) this.prevBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (this.prevBtn.disabled) return;
        this.goto(this.state.page - 1);
      });
      if (this.nextBtn) this.nextBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (this.nextBtn.disabled) return;
        this.goto(this.state.page + 1);
      });

      // căutare
      if (this.searchEl) {
        this.searchEl.addEventListener('keydown', (e) => { e.stopPropagation(); }, true);
        this.searchEl.addEventListener('keyup', debounce(() => {
          const v = this.searchEl.value;
          if (v === this.state.q) return;
          this.state.q = v;
          this.state.page = 0;
          this.fetch();
        }, 500));
        this.searchEl.addEventListener('focus', () => { try { this.searchEl.select(); } catch { } });
      }

      // bulk – generează XML (doar pe f230)
      if (this.bulkBtn) {
        this.bulkBtn.addEventListener('click', async () => {
          if (this.bulkBtn.disabled) return;
          if (this.gridId !== 'f230') return;

          const ids = Array.from(this.selected);
          const date = (this.bulkDate && this.bulkDate.value) || '';

          try {
            const res = await fetch('/api/f230/borderou', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/octet-stream,application/xml,application/json'
              },
              credentials: 'same-origin',
              body: JSON.stringify({ ids, date })
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);

            // încercăm să luăm id-ul borderoului din header sau json pt nume fișier
            let borderouId = res.headers.get('X-Borderou-Id') || res.headers.get('X-APS-Borderou');

            const ct = (res.headers.get('content-type') || '').toLowerCase();
            if (ct.includes('application/json')) {
              const data = await res.json();
              if (!borderouId) borderouId = data.borderouId || data.id;
              if (data.url) {
                window.open(data.url, '_blank', 'noopener');
              } else if (data.filename && data.xml) {
                const blob = new Blob([data.xml], { type: 'application/xml' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = data.filename;
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 2000);
              }
            } else {
              const blob = await res.blob();
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              const ymd = (date || new Date().toISOString().slice(0, 10)).replace(/[^0-9]/g, '');
              const fname = borderouId ? `borderou_${borderouId}.xml` : `borderou_${ymd}.xml`;
              a.download = fname;
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 2000);
            }

            // după generare: debifează tot + reîncarcă pagina curentă
            this._clearSelection();
            await this.fetch();
          } catch (err) {
            console.error(err);
            alert('Nu am putut genera XML.');
          }
        });
      }

      // selectare pe rânduri (change pe tbody)
      if (this.tbody) {
        this.tbody.addEventListener('change', (e) => {
          const t = e.target;
          if (!t.classList.contains('dg-row-check')) return;
          const id = t.getAttribute('data-id');
          const checked = !!t.checked;
          this._toggleSelection(id, checked);

          // actualizează select-all din header
          const allCb = this.thead?.querySelector('.dg-check-all');
          if (allCb) {
            const pageCbs = $$('.dg-row-check', this.tbody);
            const allChecked = pageCbs.length && pageCbs.every(x => x.checked);
            allCb.indeterminate = !allChecked && pageCbs.some(x => x.checked);
            allCb.checked = allChecked;
          }
        }, { passive: false });
      }
    }

    goto(page) { if (page < 0) page = 0; this.state.page = page; this.fetch(); }

    async fetch() {
      const url = this._endpointUrl();
      const api = this.cfg.api || {};
      const pageParam = api.pageParam || 'page';
      const sizeParam = api.sizeParam || 'size';
      const sortParam = api.sortParam || 'sort';
      const sortValueTpl = api.sortValue || '{key},{dir}';
      const searchParam = (typeof api.searchParam !== 'undefined') ? api.searchParam : (this.searchEl ? 'q' : null);
      const pageBase = Number(api.pageBase || 0);

      const params = url.searchParams;
      params.set(pageParam, String(this.state.page + pageBase));
      params.set(sizeParam, String(this.state.size));
      if (this.state.sortKey) {
        const beKey = this._columnSortKey(this.state.sortKey);
        const v = sortValueTpl.replace('{key}', beKey).replace('{dir}', this.state.sortDir);
        params.set(sortParam, v);
      } else {
        params.delete(sortParam);
      }
      const rawQ = this.state.q || '';
      const q = rawQ.trim();
      if (searchParam) {
        if (q.length) params.set(searchParam, q);
        else params.delete(searchParam);
      }

      try {
        const res = await fetch(url.toString(), {
          headers: { 'Accept': 'application/json' },
          credentials: 'same-origin'
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        this._consumeResponse(data);
      } catch (err) {
        console.error('DataGrid fetch error:', err);
        if (this.tbody)
          this.tbody.innerHTML = `<tr><td colspan="${(this.cfg.columns || []).length + (this.cfg.selectable ? 1 : 0)}" class="muted" style="text-align:center;padding:22px">Eroare la încărcare.</td></tr>`;
        if (this.pagesEl) this.pagesEl.textContent = '—';
        if (this.prevBtn) this.prevBtn.disabled = true;
        if (this.nextBtn) this.nextBtn.disabled = true;
      }
    }

    _getPath(obj, key) {
      if (!key) return undefined;
      if (key.includes('.')) return key.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), obj);
      return obj[key];
    }

    _columnSortKey(uiKey) {
      const col = (this.cfg.columns || []).find(c => c.key === uiKey);
      return (col && col.sortKey) ? col.sortKey : uiKey;
    }

    _updateFooterVisibility() {
      if (!this.footer) return;
      // afișează bulk (fără a mișca pagerul) doar dacă există selecții
      const hasSel = this.selected && this.selected.size > 0;
      this.footer.classList.toggle('has-bulk', !!hasSel);
    }

    _consumeResponse(data) {
      const resp = this.cfg.response || {};
      const itemsKey = resp.items || 'content';
      const pageKey = resp.page || 'number';
      const sizeKey = resp.size || 'size';
      const totalKey = resp.total || 'totalElements';

      let items = this._getPath(data, itemsKey);
      if (!Array.isArray(items)) items = data.content || data.items || data.result || [];
      const page = Number(this._getPath(data, pageKey) ?? data.number ?? 0);
      const size = Number(this._getPath(data, sizeKey) ?? data.size ?? (this.state.size || 10));
      const total = Number(this._getPath(data, totalKey) ?? data.totalElements ?? data.total ?? items.length);

      this.state.page = isNaN(page) ? 0 : page;
      this.state.size = isNaN(size) ? (this.state.size || 10) : size;
      this.state.total = isNaN(total) ? items.length : total;

      this._renderRows(items);
      this._renderHeaderSort();
      this._renderPager();

      requestAnimationFrame(() => this._autosizeColumns());
    }

    _renderHeaderSort() {
      if (!this.thead) return;
      Array.from(this.thead.querySelectorAll('th')).forEach(th => {
        th.classList.remove('sort-active', 'sort-asc', 'sort-desc');
      });
      if (!this.state.sortKey) return;
      const keyEsc = (window.CSS && CSS.escape) ? CSS.escape(this.state.sortKey) : String(this.state.sortKey);
      const th = this.thead.querySelector(`th[data-key="${keyEsc}"]`);
      if (!th) return;
      th.classList.add('sort-active');
      th.classList.add(this.state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
    }

    _renderRows(items) {
      const cols = this.cfg.columns || [];
      if (!items.length) {
        const colspan = cols.length + (this.cfg.selectable ? 1 : 0);
        this.tbody.innerHTML = `<tr><td colspan="${colspan}" class="muted" style="text-align:center;padding:22px">Nicio înregistrare.</td></tr>`;
        this._updateBulkBtn(); // ascunde butonul dacă e cazul
        return;
      }

      const html = items.map(row => {
        const id = row.id != null ? String(row.id) : '';
        const selectCell = this.cfg.selectable ? `
          <td class="col-select">
            <label class="dg-check">
              <input type="checkbox" class="dg-row-check" data-id="${escapeAttr(id)}" ${this.selected.has(id) ? 'checked' : ''}>
              <span class="box"></span>
              <span class="vh">Selectează</span>
            </label>
          </td>
        ` : '';

        const tds = cols.map(c => {
          let raw = row[c.key];
          let innerHTML = '';
          let titleStr = '';

          if (c.type === 'date' && raw) {
            const val = fmtDate(raw);
            innerHTML = escapeHtml(val);
            titleStr = String(val);
          } else if (c.type === 'link' && raw) {
            const url = String(raw);
            const label = row[c.key + '_label'] ? String(row[c.key + '_label']) : 'Deschide';
            innerHTML = `<a href="${escapeAttr(url)}" target="_blank" rel="noopener" title="${escapeAttr(url)}">${escapeHtml(label)}</a>`;
            titleStr = url;
          } else if (c.type === 'bool') {
            const stateKey = `${this.gridId || 'grid'}::${row.id}::${c.key}`;
            const checked = (stateKey in this._toggles) ? this._toggles[stateKey] : !!raw;
            innerHTML = `
              <label class="dg-toggle-wrap" title="${escapeAttr(c.label)}">
                <input type="checkbox" class="dg-toggle" data-id="${escapeAttr(row.id)}" data-key="${escapeAttr(c.key)}" ${checked ? 'checked' : ''}>
                <span class="dg-toggle-ui"></span>
              </label>
            `;
            titleStr = checked ? 'da' : 'nu';
          } else if (c.type === 'actions') {
            const gid = (this.gridId || '');
            const viewUrl = row.detail || row.link || row.adminEdit || '';
            const docUrl = row.docUrl || row.documentUrl || row.pdfUrl || '';
            const nameForConfirm = row.name || row.companyName || row.title || '';

            switch (gid) {
              case 'voluntari':
                innerHTML = `
                  <div class="dg-actions">
                    <button class="icon-btn btn-open" title="Vezi" data-id="${escapeAttr(row.id)}"
                            ${viewUrl ? `data-link="${escapeAttr(viewUrl)}"` : ''}><span class="ico">👁️</span></button>
                    <button class="icon-btn btn-del" title="Șterge" data-id="${escapeAttr(row.id)}"
                            data-name="${escapeAttr(nameForConfirm)}"><span class="ico">✖</span></button>
                  </div>`;
                break;

              case 'f230':
              case 'd177':
              case 'sponsorizare':
                innerHTML = `
                  <div class="dg-actions">
                    <button class="icon-btn btn-open" title="Vezi" data-id="${escapeAttr(row.id)}"
                            ${viewUrl ? `data-link="${escapeAttr(viewUrl)}"` : ''}><span class="ico">👁️</span></button>
                    <button class="icon-btn btn-pdf" title="Descarcă" data-id="${escapeAttr(row.id)}"
                            ${docUrl ? `data-link="${escapeAttr(docUrl)}"` : ''}><span class="ico">⬇️</span></button>
                    <button class="icon-btn btn-del" title="Șterge" data-id="${escapeAttr(row.id)}"
                            data-name="${escapeAttr(nameForConfirm)}"><span class="ico">✖</span></button>
                  </div>`;
                break;

              case 'offline':
                if ((row.status || '') === 'Plătit online') {
                  innerHTML = `<div class="dg-actions muted">—</div>`;
                } else {
                  innerHTML = `
                    <div class="dg-actions">
                      <button class="icon-btn btn-approve" title="Acceptă" data-id="${escapeAttr(row.id)}"><span class="ico">✔️</span></button>
                      <button class="icon-btn btn-reject"  title="Respinge" data-id="${escapeAttr(row.id)}"><span class="ico">🚫</span></button>
                      <button class="icon-btn btn-del"     title="Șterge" data-id="${escapeAttr(row.id)}"><span class="ico">✖</span></button>
                    </div>`;
                }
                break;

              case 'iban':
                innerHTML = `
                  <div class="dg-actions">
                    <button class="icon-btn btn-edit" title="Editează" data-id="${escapeAttr(row.id)}"
                            data-name="${escapeAttr(row.name || '')}" data-iban="${escapeAttr(row.iban || '')}"><span class="ico">✎</span></button>
                    <button class="icon-btn btn-del" title="Șterge" data-id="${escapeAttr(row.id)}"
                            data-name="${escapeAttr(nameForConfirm)}"><span class="ico">✖</span></button>
                  </div>`;
                break;

              default:
                innerHTML = `
                  <div class="dg-actions">
                    <button class="icon-btn btn-del" title="Șterge" data-id="${escapeAttr(row.id)}"
                            data-name="${escapeAttr(nameForConfirm)}"><span class="ico">✖</span></button>
                  </div>`;
            }
            titleStr = '';
          } else {
            if (raw == null) raw = '';
            if (Array.isArray(raw)) raw = raw.join(', ');
            const s = String(raw);
            innerHTML = escapeHtml(s);
            titleStr = s;
          }

          const clampClass = c.clamp ? ` dg-clamp dg-clamp-${c.clamp}` : '';
          const val = (c.type === 'link') ? innerHTML : `<span class="dg-val${clampClass}">${innerHTML}</span>`;
          return `<td class="col-${escapeAttr(c.key)}" data-label="${escapeAttr(c.label)}" title="${escapeAttr(titleStr)}">${val}</td>`;
        }).join('');

        const selClass = this.selected.has(id) ? ' dg-selected' : '';
        return `<tr class="${selClass}">${selectCell}${tds}</tr>`;
      }).join('');

      this.tbody.innerHTML = html;
      this._bindRowActions();
      this._bindToggles();
      this._updateBulkBtn();
    }

    _renderPager() {
      if (!this.pagesEl) return;
      const page = this.state.page;
      const size = this.state.size;
      const total = this.state.total || 0;
      const pages = Math.max(1, Math.ceil(total / size));
      if (this.prevBtn) this.prevBtn.disabled = page <= 0;
      if (this.nextBtn) this.nextBtn.disabled = page >= pages - 1;
      this.pagesEl.textContent = `Pagina ${page + 1} din ${pages} • ${total} rezultate`;
    }

    async _bindRowActions() {
      if (this._actionsBound) return;
      this._actionsBound = true;
      this.tbody.addEventListener('click', async (e) => {
        const openBtn = e.target.closest('.btn-open');
        const pdfBtn = e.target.closest('.btn-pdf');
        const delBtn = e.target.closest('.btn-del');
        const editBtn = e.target.closest('.btn-edit');

        if (openBtn) {
          const id = openBtn.getAttribute('data-id');
          const link = openBtn.getAttribute('data-link');

          if (this.gridId === 'f230') {
            this._openF230(id);
            return;
          }
          if (this.gridId === 'sponsorizare') {
            this._openSponsorizare(id);
            return;
          }
          if (this.gridId === 'd177') {
            this._openD177(id);
            return;
          }
          if (this.gridId === 'voluntari') {
            try {
              const res = await fetch(`/api/voluntari/${encodeURIComponent(id)}`, {
                headers: { 'Accept': 'application/json' },
                credentials: 'same-origin'
              });
              const raw = await res.text();
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              if (!raw) throw new Error('empty body');
              let data; try { data = JSON.parse(raw); } catch { throw new Error('bad json'); }

              const esc = s => (s == null ? '' : String(s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#039;'));

              const rows = (pairs) => pairs.map(([k, v]) => `
      <div class="dg-row"><div class="k">${esc(k)}</div><div class="v">${v}</div></div>
    `).join('');

              const r = data || {};
              const mail = r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : '';
              const tel = r.phone ? `<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : '';

              const bodyHtml = rows([
                ['Nume', esc(r.lastName || r.nume || r.name || '')],
                ['Prenume', esc(r.firstName || r.prenume || '')],
                ['Dată înrolare', esc(r.date || '')],
                ['Email', mail],
                ['Telefon', tel],
                ['Vârstă', esc(r.age ?? '')],
                ['Ocupație', esc(r.ocupation || r.ocupatie || '')],
                ['Domeniu', esc(r.domain || r.domeniu || '')],
                ['Disponibilitate', esc(r.disponibility || r.disponibilitate || '')],
                ['Motivație', esc(r.motivation || r.motivatie || '')],
                ['Experiență', esc(r.experience || r.experienta || '')],
                ['Acord GDPR', esc(r.gdpr ? 'Da' : (r.gdpr === 0 ? 'Nu' : (r.gdpr || '')))]
              ]);

              // ✅ apel corect: (titlu, html)
              this._showModal(`Voluntar #${esc(id)}`, bodyHtml);
              return;
            } catch (err) {
              console.error('voluntar details error:', err);
              alert('Nu am putut încărca detaliile voluntarului.');
              return;
            }
          }
        }

        if (pdfBtn) {
          const id = pdfBtn.getAttribute('data-id');

          // pentru D177 folosim proxy-ul nostru -> blob download
          if (this.gridId === 'd177') {
            try {
              const r = await fetch(`/api/d177/${encodeURIComponent(id)}/doc`, { credentials: 'same-origin' });
              if (!r.ok) throw new Error('HTTP ' + r.status);
              const blob = await r.blob();
              const fname = r.headers.get('X-Filename') || `contract_${id}.doc`;
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = fname;
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 2000);
            } catch (e) {
              console.error(e);
              alert('Nu am putut descărca documentul.');
            }
            return; // IMPORTANT: nu mai continua la window.open
          }

          // fallback pentru alte grid-uri
          const link = pdfBtn.getAttribute('data-link');
          return link ? window.open(link.replace(/^http:/, 'https:'), '_blank', 'noopener')
            : alert(`Nu există document pentru #${id}`);
        }
        if (editBtn) {
          const id = editBtn.getAttribute('data-id');

          const name = prompt('Nume beneficiar:', editBtn.getAttribute('data-name') || '');
          if (name === null) return;

          let iban = prompt('IBAN:', editBtn.getAttribute('data-iban') || '');
          if (iban === null) return;

          // ✅ validare IBAN
          if (!isValidIban(iban)) {
            alert('IBAN invalid. Verificați formatul (ex: RO...) și controlul mod 97.');
            return;
          }
          iban = normalizeIban(iban);

          try {
            const res = await fetch(`/api/iban/${encodeURIComponent(id)}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify({ name, iban })
            });
            if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
            this.fetch(); // reîncarcă grila
          } catch (err) {
            console.error(err);
            alert('Nu am putut salva.');
          }
          return;
        }

        if (delBtn) {
          const id = delBtn.getAttribute('data-id');
          const name = delBtn.getAttribute('data-name') || `#${id}`;
          if (!confirm(`Ștergi înregistrarea ${name}?`)) return;
          try {
            const epRaw = (this.cfg.endpoint || '/api');
            const base = epRaw.replace(/\/search(?:\?.*)?$/, '').replace(/\/+$/, '');
            const url = `${base}/${encodeURIComponent(id)}`;
            const res = await fetch(url, { method: 'DELETE', credentials: 'same-origin' });
            if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
            this.fetch();
            window.refreshGrid('cause');
          } catch (err) {
            console.error('DELETE error', err);
            alert('Nu am putut șterge.');
          }
        }

        const approveBtn = e.target.closest('.btn-approve');
        const rejectBtn = e.target.closest('.btn-reject');

        if (approveBtn) {
          const id = approveBtn.getAttribute('data-id');
          await fetch('/api/offline-payments/' + id + '/status', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ status: 'approved' })
          });
          this.fetch();
          window.refreshGrid('cause');
          return;
        }
        if (rejectBtn) {
          const id = rejectBtn.getAttribute('data-id');
          await fetch('/api/offline-payments/' + id + '/status', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ status: 'rejected' })
          });
          this.fetch();
          window.refreshGrid('cause');
          return;
        }
      });
    }

    _bindToggles() {
      this.tbody.addEventListener('change', async (e) => {
        const t = e.target;
        if (!t.classList.contains('dg-toggle')) return;
        const id = t.getAttribute('data-id');
        const key = t.getAttribute('data-key');
        const stateKey = `${this.gridId || 'grid'}::${id}::${key}`;
        const val = !!t.checked;
        this._toggles[stateKey] = val;

        if (['d177', 'sponsorizare', 'f230'].includes(this.gridId)) {
          try {
            const body = JSON.stringify({ [key]: val });
            const url = `/api/${this.gridId}/${encodeURIComponent(id)}/flags`;
            const res = await fetch(url, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              credentials: 'same-origin',
              body
            });
            if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
          } catch (err) {
            console.error('Persist toggle failed', err);
            t.checked = !val;
            this._toggles[stateKey] = !val;
            alert('Nu am putut salva setarea.');
          }
        }
      }, { passive: false });
    }

    /* === Helpers pentru modal și escape === */
    _ensureModalCss() {
      if (this._modalCssInjected) return;
      const css = `
  .dg-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:9999;}
  .dg-modal{background:#fff;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.15);max-width:980px;width:calc(100vw - 48px);max-height:85vh;overflow:auto}
  .dg-modal .dg-modal-hd{padding:16px 18px;border-bottom:1px solid #eee;display:flex;align-items:center;justify-content:space-between;gap:10px;position:sticky;top:0;background:#fff;z-index:1}
  .dg-modal .dg-modal-hd h3{margin:0;font-size:18px}
  .dg-modal .dg-modal-bd{padding:16px 18px}
  .dg-modal .close{border:none;background:transparent;font-size:22px;line-height:1;cursor:pointer}
  .dg-kv{display:grid;grid-template-columns:220px 1fr;gap:8px 14px;margin:6px 0}
  .dg-kv .k{color:#6b7280}
  .dg-imgs{display:flex;flex-wrap:wrap;gap:12px;margin-top:10px}
  .dg-imgs img{max-height:90px;border-radius:8px;border:1px solid #eee;display:block}
  .dg-card{border:1px solid #eee;border-radius:12px;padding:12px 14px;margin:10px 0}
  .dg-card h4{margin:0 0 8px 0;font-size:15px}
  `;
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);
      this._modalCssInjected = true;
    }
    _openModal(title, html) {
      this._ensureModalCss();
      const wrap = document.createElement('div');
      wrap.className = 'dg-modal-backdrop';
      wrap.innerHTML = `
    <div class="dg-modal" role="dialog" aria-modal="true">
      <div class="dg-modal-hd">
        <h3>${escapeHtml(title || 'Detalii')}</h3>
        <button class="close" aria-label="Închide">×</button>
      </div>
      <div class="dg-modal-bd">${html || ''}</div>
    </div>`;
      const kill = () => wrap.remove();
      wrap.addEventListener('click', e => { if (e.target === wrap) kill(); });
      wrap.querySelector('.close').addEventListener('click', kill);
      document.body.appendChild(wrap);
    }
    _fmtMoney(x) {
      if (x == null) return '';
      const n = Number(String(x).replace(/[^\d.-]/g, ''));
      if (isNaN(n)) return String(x);
      return n.toLocaleString('ro-RO');
    }
    /* === View details for D177 === */
    async _viewD177(id) {
      try {
        const res = await fetch(`/api/formulare/d177/${encodeURIComponent(id)}`, {
          headers: { 'Accept': 'application/json' },
          credentials: 'same-origin'
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();

        // câmpuri așteptate de la BE (nume sugestive):
        // d.firma { denumire,cui,regcom,adresa,judet,oras }
        // d.coresp { adresa,judet,oras }
        // d.reprez { nume,prenume,email,tel,pozitie }
        // d.contract { data, suma }
        // d.emailTo, d.docHtml, d.docUrl, d.sigUrl, d.docId, d.sigId, d.emailSent

        // extragem imagini din docHtml (inclusiv base64)
        const imgs = [];
        if (d.docHtml) {
          const rx = /<img[^>]+src=["']([^"']+)["']/gi;
          let m; while ((m = rx.exec(d.docHtml))) { imgs.push(m[1]); }
        }
        if (d.sigUrl) imgs.push(d.sigUrl); // dacă BE îți dă separat

        const imgHtml = imgs.length ? (
          `<div class="dg-card">
         <h4>Imagini / semnături</h4>
         <div class="dg-imgs">
           ${imgs.map(src => {
            const esc = escapeAttr(src);
            return `<a href="${esc}" target="_blank" rel="noopener">
                       <img src="${esc}" alt="">
                     </a>`;
          }).join('')}
         </div>
       </div>`
        ) : '';

        const firma = d.firma || {};
        const coresp = d.coresp || {};
        const rep = d.reprez || {};
        const contract = d.contract || {};

        const html = `
      <div class="dg-card">
        <h4>Firma (Sponsor)</h4>
        <div class="dg-kv">
          <div class="k">Denumire</div><div>${escapeHtml(firma.denumire || '')}</div>
          <div class="k">CUI</div><div>${escapeHtml(firma.cui || '')}</div>
          <div class="k">Reg. Com.</div><div>${escapeHtml(firma.regcom || '')}</div>
          <div class="k">Adresă</div><div>${escapeHtml(firma.adresa || '')}</div>
          <div class="k">Județ</div><div>${escapeHtml(firma.judet || '')}</div>
          <div class="k">Oraș</div><div>${escapeHtml(firma.oras || '')}</div>
        </div>
      </div>

      <div class="dg-card">
        <h4>Adresă corespondență</h4>
        <div class="dg-kv">
          <div class="k">Adresă</div><div>${escapeHtml(coresp.adresa || '')}</div>
          <div class="k">Județ</div><div>${escapeHtml(coresp.judet || '')}</div>
          <div class="k">Oraș</div><div>${escapeHtml(coresp.oras || '')}</div>
        </div>
      </div>

      <div class="dg-card">
        <h4>Reprezentant</h4>
        <div class="dg-kv">
          <div class="k">Nume</div><div>${escapeHtml(rep.nume || '')}</div>
          <div class="k">Prenume</div><div>${escapeHtml(rep.prenume || '')}</div>
          <div class="k">Email</div><div>${escapeHtml(rep.email || '')}</div>
          <div class="k">Telefon</div><div>${escapeHtml(rep.tel || '')}</div>
          <div class="k">Poziție</div><div>${escapeHtml(rep.pozitie || '')}</div>
        </div>
      </div>

      <div class="dg-card">
        <h4>Contract</h4>
        <div class="dg-kv">
          <div class="k">Data</div><div>${escapeHtml(contract.data || '')}</div>
          <div class="k">Sumă</div><div>${this._fmtMoney(contract.suma || '')}</div>
        </div>
      </div>

      <div class="dg-card">
        <h4>Alte detalii</h4>
        <div class="dg-kv">
          <div class="k">Email către</div><div>${escapeHtml(d.emailTo || '')}</div>
          <div class="k">Doc ID</div><div>${escapeHtml(String(d.docId || ''))}</div>
          <div class="k">Semnătură ID</div><div>${escapeHtml(String(d.sigId || ''))}</div>
          <div class="k">Email trimis</div><div>${d.emailSent ? 'Da' : 'Nu'}</div>
          ${d.docUrl ? `<div class="k">Document</div><div><a href="${escapeAttr(d.docUrl)}" target="_blank" rel="noopener">Deschide</a></div>` : ''}
        </div>
      </div>

      ${imgHtml}
    `;

        this._openModal(`Declarația 177 – #${id}`, html);
      } catch (err) {
        console.error(err);
        alert('Nu am putut încărca detaliile.');
      }
    }


    // -------- Selecții ----------
    _toggleSelection(id, checked) {
      if (!id) return;
      if (checked) this.selected.add(id); else this.selected.delete(id);
      // marcare vizuală
      const tr = this.tbody?.querySelector(`input.dg-row-check[data-id="${cssEsc(id)}"]`)?.closest('tr');
      if (tr) tr.classList.toggle('dg-selected', checked);
      this._updateBulkBtn();
    }
    _setAllSelection(checked) {
      const inputs = $$('.dg-row-check', this.tbody);
      this.selected.clear();
      inputs.forEach(inp => {
        inp.checked = checked;
        const id = inp.getAttribute('data-id');
        if (checked && id) this.selected.add(id);
        const tr = inp.closest('tr'); if (tr) tr.classList.toggle('dg-selected', checked);
      });
      this._updateBulkBtn();
    }
    _clearSelection() {
      // debifează header
      const headCb = this.thead?.querySelector('.dg-check-all');
      if (headCb) { headCb.checked = false; headCb.indeterminate = false; }
      // debifează rândurile
      this.tbody?.querySelectorAll('.dg-row-check').forEach(cb => {
        cb.checked = false;
        const tr = cb.closest('tr'); if (tr) tr.classList.remove('dg-selected');
      });
      // goleşte setul
      this.selected.clear();
      this._updateBulkBtn();
      this._updateFooterVisibility();
    }
    _updateBulkBtn() {
      if (!this.bulkBtn || !this.footer) return;
      const hasSel = this.selected.size > 0;
      this.bulkBtn.disabled = !hasSel;
      this.footer.classList.toggle('has-bulk', hasSel);
    }

    _setupObservers() {
      const scroll = this.table?.parentElement;
      if (scroll && 'ResizeObserver' in window) {
        this._ro = new ResizeObserver(() => this._autosizeColumns());
        this._ro.observe(scroll);
      }
      window.addEventListener('sidenav-resized', () => this._autosizeColumns());
    }

    _autosizeColumns() {
      if (window.matchMedia('(max-width: 760px)').matches) return;
      if (!this.table || !this.colgroup) return;

      const colsCfg = this.cfg.columns || [];
      const minPx = Number(this.cfg.autosize?.minPx ?? 150);
      const maxPx = Number(this.cfg.autosize?.maxPx ?? 340);

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const refCell = this.tbody.querySelector('td') || this.thead.querySelector('th');
      const style = refCell ? getComputedStyle(refCell) : { font: '14px Inter' };
      const font = `${style.fontStyle || ''} ${style.fontVariant || ''} ${style.fontWeight || ''} ${style.fontSize || '14px'}/${style.lineHeight || '20px'} ${style.fontFamily || 'Inter, Arial'}`.trim();
      ctx.font = font;

      const padX = (() => {
        if (!refCell) return 20;
        const cs = getComputedStyle(refCell);
        return (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      })();

      const widths = colsCfg.map((c) => {
        const th = this.thead?.querySelector(`th.col-${cssEsc(c.key)}`);
        const headerText = th ? th.querySelector('.th-label')?.textContent?.trim() || '' : (c.label || '');
        let w = ctx.measureText(headerText).width;

        const cells = $$(`.col-${cssEsc(c.key)}`, this.tbody).slice(0, 20);
        cells.forEach(td => {
          const link = td.querySelector('a');
          const span = td.querySelector('span.dg-val');
          const txt = link?.textContent || span?.textContent || td.textContent || '';
          const mw = ctx.measureText(txt.trim()).width;
          if (mw > w) w = mw;
        });

        if (c.type === 'number') w *= 0.85;
        if (/email|mail/i.test(c.key)) w *= 1.05;
        if (c.clamp) w = Math.min(w, 220);

        w = Math.ceil(w + padX + (c.sortable ? 18 : 0));
        w = Math.max(minPx, Math.min(maxPx, w));
        return w;
      });

      const container = this.table.parentElement;
      const available = container.clientWidth || this.table.clientWidth || 0;
      const sum = widths.reduce((a, b) => a + b, 0) || 1;

      // + 1 col dacă avem select
      const allCols = $$('.dg-col', this.colgroup);
      const offset = this.cfg.selectable ? 1 : 0;

      allCols.forEach((colEl, i) => {
        // dacă e prima coloană și avem selectable, lăsăm lățimea fixă mică
        if (this.cfg.selectable && i === 0) {
          colEl.style.width = '56px';
          return;
        }
        const dataIndex = i - offset;
        if (dataIndex < 0) return;
        const px = Math.round(widths[dataIndex] * available / sum);
        colEl.style.width = `${px}px`;
      });
    }

    _ensureModalShell() {
      if (!document.getElementById('dg-overlay')) {
        const overlay = document.createElement('div');
        overlay.id = 'dg-overlay';
        overlay.addEventListener('click', () => this._closeModal());
        document.body.appendChild(overlay);
      }
      if (!document.getElementById('dg-modal')) {
        const modal = document.createElement('div');
        modal.id = 'dg-modal';
        modal.innerHTML = `
      <div class="dg-modal-head">
        <div class="dg-modal-title"></div>
        <button class="dg-modal-close" aria-label="Închide">×</button>
      </div>
      <div class="dg-modal-body"></div>
    `;
        modal.querySelector('.dg-modal-close').addEventListener('click', () => this._closeModal());
        document.body.appendChild(modal);
      }
    }

    _showModal(title, html) {
      this._ensureModalShell();
      const o = document.getElementById('dg-overlay');
      const m = document.getElementById('dg-modal');

      m.querySelector('.dg-modal-title').textContent = title || '';
      m.querySelector('.dg-modal-body').innerHTML = html || '';

      // compensează lățimea scrollbar-ului -> fără „zoom/salt”
      const sbw = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.setProperty('--sbw', `${sbw}px`);
      document.body.classList.add('dg-modal-open');

      o.classList.add('is-open');
      m.classList.add('is-open');
    }

    _closeModal() {
      const o = document.getElementById('dg-overlay');
      const m = document.getElementById('dg-modal');
      if (o) o.classList.remove('is-open');
      if (m) m.classList.remove('is-open');
      document.body.classList.remove('dg-modal-open');
      document.body.style.removeProperty('--sbw');
    }

    async _openVolunteer(id) {
      try {
        const r = await fetch(`/api/voluntari/${encodeURIComponent(id)}`, { credentials: 'same-origin' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const v = await r.json();

        const row = (k, val) => `
      <div class="dg-row">
        <div class="k">${k}</div>
        <div class="v">${val ?? '—'}</div>
      </div>`;

        const html = `
  <div class="dg-modal-backdrop"></div>
  <div class="dg-modal">
    <div class="dg-modal-card">
      <div class="dg-modal-head">
        <h3>Voluntar #${escapeHtml(id)}</h3>
        <button class="dg-modal-close" aria-label="Închide">×</button>
      </div>
      <div class="dg-modal-body">
        ${rowsHtml}   <!-- AICI folosește escapeHtml DOAR pe valori, nu pe tot stringul -->
      </div>
      <div class="dg-modal-foot">
        <button class="btn-mini outline dg-modal-close">Închide</button>
      </div>
    </div>
  </div>
`;

        this._showModal(html);
      } catch (err) {
        console.error(err);
        alert('Nu am putut încărca detaliile voluntarului.');
      }
    }

    async _openSponsorizare(id) {
      try {
        const res = await fetch(`/api/sponsorizare/${encodeURIComponent(id)}`, {
          headers: { 'Accept': 'application/json' },
          credentials: 'same-origin'
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const d = await res.json();

        const esc = s => (s == null ? '' : String(s)
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#039;'));
        const nz = v => (v && String(v).trim()) ? esc(v) : '—';

        const firmaHtml = `
      <div class="dg-card">
        <h4>Firmă (Sponsor)</h4>
        <div class="dg-kv">
          <div class="k">Denumire</div><div>${nz(d.companyName)}</div>
          <div class="k">CUI</div><div>${nz(d.fiscalCode)}</div>
          <div class="k">Reg. Comerț</div><div>${nz(d.companyRegCom)}</div>
          <div class="k">Adresă</div><div>${nz(d.companyAddress)}</div>
          <div class="k">Județ</div><div>${nz(d.companyCounty)}</div>
          <div class="k">Oraș</div><div>${nz(d.companyCity)}</div>
        </div>
      </div>`;

        const repHtml = `
      <div class="dg-card">
        <h4>Reprezentant</h4>
        <div class="dg-kv">
          <div class="k">Nume</div><div>${[d.repLastName, d.repFirstName].filter(Boolean).map(esc).join(' ') || '—'}</div>
          <div class="k">Poziție</div><div>${nz(d.repRole)}</div>
          <div class="k">Email</div><div>${d.email ? `<a href="mailto:${esc(d.email)}">${esc(d.email)}</a>` : '—'}</div>
          <div class="k">Telefon</div><div>${d.phone ? `<a href="tel:${esc(d.phone)}">${esc(d.phone)}</a>` : '—'}</div>
        </div>
      </div>`;

        const corespHtml = `
      <div class="dg-card">
        <h4>Corespondență</h4>
        <div class="dg-kv">
          <div class="k">Adresă</div><div>${nz(d.corrAddress)}</div>
          <div class="k">Județ</div><div>${nz(d.corrCounty)}</div>
          <div class="k">Oraș</div><div>${nz(d.corrCity)}</div>
        </div>
      </div>`;

        const bancaContractHtml = `
      <div class="dg-card">
        <h4>Bancă & Contract</h4>
        <div class="dg-kv">
          <div class="k">Banca</div><div>${nz(d.bankName)}</div>
          <div class="k">IBAN</div><div><span class="mono">${nz(d.iban)}</span></div>
          <div class="k">Sumă</div><div>${d.amount ? `${this._fmtMoney(d.amount)} RON` : '—'}</div>
          <div class="k">Data</div><div>${nz(d.contractDate)}</div>
        </div>
      </div>`;

        // DOAR documentul – fără JSON, fără semnătură
        const linksHtml = `
      <div class="dg-card">
        <h4>Fișier</h4>
        <div class="dg-kv">
          <div class="k">Document</div>
          <div>${d.docUrl ? `<a href="${esc(d.docUrl)}" target="_blank" rel="noopener">Descarcă</a>` : '—'}</div>
        </div>
      </div>`;

        const html = firmaHtml + repHtml + corespHtml + bancaContractHtml + linksHtml;
        this._showModal(`Sponsorizare — #${esc(id)}`, html);
      } catch (err) {
        console.error(err);
        alert('Nu am putut încărca detaliile sponsorizării.');
      }
    }


    async _openF230(id) {
      try {
        const res = await fetch(`/api/f230/${encodeURIComponent(id)}`, { credentials: 'same-origin' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const d = await res.json();

        const fullName = [d.firstName, d.lastName].filter(Boolean).join(' ');
        const twoYears = (d.distrib2 || '') === '1';
        const acord = (d.acordEmail || '') === '1';
        const address = [
          [d.street, d.number].filter(Boolean).join(' '),
          ['Bl.', d.block].filter(Boolean).join(' '),
          ['Sc.', d.staircase].filter(Boolean).join(' '),
          ['Et.', d.floor].filter(Boolean).join(' '),
          ['Ap.', d.apartment].filter(Boolean).join(' ')
        ].filter(s => s && /\S/.test(s)).join(', ');
        const locality = [d.city, d.county, d.postalCode].filter(Boolean).join(', ');

        const body = `
      <dl class="dg-kv">
        <dt>An fiscal</dt><dd>${d.year || ''}</dd>
        <dt>Trimis pe</dt><dd>${(d.postDateIso || '').replace('T', ' ')}</dd>
        <dt>Perioadă</dt><dd>${twoYears ? '2 ani' : '1 an'}</dd>
        <dt>Nume</dt><dd>${fullName || ''}</dd>
        <dt>Inițială</dt><dd>${d.initiala || ''}</dd>
        <dt>CNP</dt><dd>${d.cnp || ''}</dd>
        <dt>Adresă</dt><dd>${address || ''}</dd>
        <dt>Localitate</dt><dd>${locality || ''}</dd>
        <dt>Telefon</dt><dd>${d.phone || ''}</dd>
        <dt>Fax</dt><dd>${d.fax || ''}</dd>
        <dt>Email</dt><dd>${d.email || ''}</dd>
        <dt>IBAN</dt><dd>${d.iban || ''}</dd>
        <dt>Acord date identificare</dt><dd>${acord ? 'Da' : 'Nu'}</dd>
        <dt>Nr. borderou</dt><dd>${d.nrBorderou ?? ''}</dd>
      </dl>
      ${d.pdfUrl ? `<div class="dg-modal-actions"><a class="btn btn-mini outline" href="${esc(d.pdfUrl)}" target="_blank" rel="noopener">Descarcă PDF</a></div>` : ''}
    `;

        this._showModal(`${fullName || '(fără nume)'} — #${id}`, body);
      } catch (e) {
        console.error(e);
        alert('Nu pot încărca detaliile.');
      }
    }


    async _openD177(id) {
      try {
        const res = await fetch(`/api/d177/${encodeURIComponent(id)}`, { credentials: 'same-origin' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();

        const f = data.firma || {};
        const co = data.corespondenta || {};
        const r = data.reprezentant || {};
        const ct = data.contract || {};

        const body = `
      <div class="dg-meta">
        <div class="k">Firmă</div><div><strong>${esc(f.denumire || data.title || '—')}</strong></div>
        <div class="k">CUI</div><div>${esc(f.cui || '—')}</div>
        <div class="k">Reg. Com.</div><div>${esc(f.regcom || '—')}</div>
        <div class="k">Adresă</div><div>${esc(f.adresa || '—')}</div>
        <div class="k">Județ / Oraș</div><div>${esc(f.judet || '—')} / ${esc(f.oras || '—')}</div>

        <div class="k">Corespondență</div><div>${esc(co.adresa || '—')} ${esc(co.judet || '')} ${esc(co.oras || '')}</div>

        <div class="k">Reprezentant</div><div>${esc(r.nume || '')} ${esc(r.prenume || '')}</div>
        <div class="k">Email</div><div>${r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : '—'}</div>
        <div class="k">Telefon</div><div>${r.tel ? `<a href="tel:${esc(r.tel)}">${esc(r.tel)}</a>` : '—'}</div>
        <div class="k">Funcție</div><div>${esc(r.pozitie || '—')}</div>

        <div class="k">Contract</div><div>Data: ${esc(ct.data || '—')} • Sumă: ${esc(ct.suma || '—')} RON</div>

        <div class="k">Document</div><div>${data.docUrl ? `<a href="${esc(data.docUrl)}" target="_blank" rel="noopener">Descarcă</a>` : '—'}</div>
        <div class="k">Semnătură</div><div>${data.sigUrl ? `<a href="${esc(data.sigUrl)}" target="_blank" rel="noopener"><img class="dg-sign" src="${esc(data.sigUrl)}" alt="Semnătură"></a>` : '—'}</div>
      </div>
      ${data.docHtml ? `<details style="margin-top:12px;"><summary>Vezi HTML contract</summary><div style="margin-top:10px;border:1px solid #eee;border-radius:10px;padding:12px;max-height:55vh;overflow:auto;">${data.docHtml}</div></details>` : ''}
    `;
        this._showModal(`Detalii 177 — #${id}`, body);
        const b = document.getElementById(`dg-doc-btn-${id}`);
        if (b) {
          b.addEventListener('click', async () => {
            try {
              const r = await fetch(`/api/d177/${encodeURIComponent(id)}/doc`, { credentials: 'same-origin' });
              if (!r.ok) throw new Error('HTTP ' + r.status);
              const blob = await r.blob();
              const fname = r.headers.get('X-Filename') || `contract_${id}.doc`;
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = fname;
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 2000);
            } catch (e) { alert('Nu am putut descărca documentul.'); }
          });
        }
      } catch (err) {
        console.error(err);
        alert('Nu am putut încărca detaliile.');
      }
    }


  }

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m])); }


  window.addEventListener('DOMContentLoaded', () => {
    $$('.card[data-grid]').forEach(section => new DataGrid(section));
  });

  window.refreshGrid = function (gridId) {
    const section = document.querySelector(`.card[data-grid][data-grid-id="${gridId}"]`);
    if (section && section._dgInstance) {
      section._dgInstance.fetch();
    }
  };

})();
