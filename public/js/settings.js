// public/js/settings.js
(function(){
  const root = document.getElementById('settings-root');
  if (!root) return;

  // cheile pe care le afișăm (în ordinea dorită în UI)
  const XML_KEYS = ["xmlns","schemaLocation","xml_luna","xml_an","xml_nume","xml_cui","xml_cif","form230_vizibilitate"];

  async function fetchSettings(){
    const res = await fetch('/api/settings/xml', { credentials:'same-origin' });
    if (!res.ok) throw new Error('HTTP '+res.status);
    return res.json();
  }

  function buildRow(s){
    // select cu numele (read-only)
    const nameSelect = document.createElement('select');
    nameSelect.className = 'name-select';
    XML_KEYS.forEach(k=>{
      const opt = document.createElement('option');
      opt.value = k; opt.textContent = k;
      nameSelect.appendChild(opt);
    });
    nameSelect.value = s.name;
    nameSelect.disabled = true;

    // input pentru value (în funcție de tip)
    const type = (s.type || 'string').toLowerCase();
    let input;
    if (type === 'boolean' || type === 'bool'){
      input = document.createElement('select');
      ['true','false'].forEach(v=>{
        const o = document.createElement('option');
        o.value=v; o.textContent=v.toUpperCase();
        input.appendChild(o);
      });
      const cur = (s.value ?? s.defaultValue ?? 'false') + '';
      input.value = cur.toLowerCase()==='true' ? 'true' : 'false';
    } else {
      input = document.createElement('input');
      input.type = (type==='integer'||type==='number') ? 'number' : (type==='date' ? 'date' : 'text');
      input.value = s.value ?? '';
      input.placeholder = s.defaultValue ?? '';
    }
    input.className = 'val-input';

    // butoane
    const btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.className = 'btn btn-mini outline';
    btnSave.textContent = 'Salveaza';

    const btnReset = document.createElement('button');
    btnReset.type = 'button';
    btnReset.className = 'btn btn-mini outline';
    btnReset.textContent = 'Rresetare la valorile implicite';

    // rând
    const row = document.createElement('div');
    row.className = 'setting-row';
    row.appendChild(nameSelect);
    row.appendChild(input);
    row.appendChild(btnSave);
    row.appendChild(btnReset);

    // handlers
    btnSave.addEventListener('click', async ()=>{
      const newVal = (input.tagName==='SELECT') ? input.value : input.value;
      try{
        const res = await fetch(`/api/settings/${encodeURIComponent(s.id)}`, {
          method:'PUT',
          headers:{ 'Content-Type':'application/json' },
          credentials:'same-origin',
          body: JSON.stringify({ value: newVal })
        });
        if (!res.ok){
          const txt = await res.text();
          alert('Eroare la salvare: ' + txt);
          return;
        }
        // feedback vizual
        row.style.boxShadow = '0 0 0 3px #bbf7d0 inset';
        setTimeout(()=> row.style.boxShadow = '', 700);
      } catch(err){
        alert('Eroare la salvare');
      }
    });

    btnReset.addEventListener('click', async ()=>{
      try{
        const res = await fetch(`/api/settings/${encodeURIComponent(s.id)}/reset`, {
          method:'POST',
          credentials:'same-origin'
        });
        if (!res.ok) { alert('Eroare la reset.'); return; }
        const updated = await res.json();
        if (input.tagName==='SELECT') {
          input.value = String(updated.value).toLowerCase();
        } else {
          input.value = updated.value ?? '';
        }
        row.style.boxShadow = '0 0 0 3px #fde68a inset';
        setTimeout(()=> row.style.boxShadow = '', 700);
      } catch(err){
        alert('Eroare la reset.');
      }
    });

    return row;
  }

  function render(list){
    // afișăm doar cheile din XML_KEYS, în ordinea lor
    const map = Object.fromEntries(list.map(x => [x.name, x]));
    root.innerHTML = '';
    XML_KEYS.forEach(k=>{
      if (map[k]) root.appendChild(buildRow(map[k]));
    });
  }

  (async ()=>{
    try{
      const data = await fetchSettings();
      render(data);
    } catch (e){
      root.innerHTML = `<div class="alert alert-danger">Nu pot încărca setările.</div>`;
      console.error(e);
    }
  })();
})();
