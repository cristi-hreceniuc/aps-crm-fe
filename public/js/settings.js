// public/js/settings.js
(function(){
  const root = document.getElementById('settings-root');
  if (!root) return;

  const XML_KEYS = ["xmlns","schemaLocation","xml_luna","xml_an","xml_nume","xml_cui","xml_cif","form230_vizibilitate"];
  let allSettings = [];

  async function fetchSettings(){
    const res = await fetch('/api/settings/xml', { credentials:'same-origin' });
    if (!res.ok) throw new Error('HTTP '+res.status);
    return res.json();
  }

  function buildUI(selectedKey){
    const setting = allSettings.find(s => s.name === selectedKey);
    if (!setting) {
      root.innerHTML = `<div class="alert alert-danger">Setarea ${selectedKey} nu există.</div>`;
      return;
    }

    root.innerHTML = ''; // curățăm

    // container flex pentru toate pe o linie
    const row = document.createElement('div');
    row.className = 'setting-row';
    row.style.display = 'flex';
    row.style.gap = '10px';
    row.style.alignItems = 'center';
    row.style.marginBottom = '12px';

    // dropdown pentru alegere
    const selectKey = document.createElement('select');
    XML_KEYS.forEach(k=>{
      const opt = document.createElement('option');
      opt.value = k; opt.textContent = k;
      selectKey.appendChild(opt);
    });
    selectKey.value = selectedKey;

    // input pentru valoare
    const input = buildInput(setting);
    input.style.flex = '1';

    // butoane
    const btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.className = 'btn btn-mini outline';
    btnSave.textContent = 'Salvează';

    const btnReset = document.createElement('button');
    btnReset.type = 'button';
    btnReset.className = 'btn btn-mini outline';
    btnReset.textContent = 'Reseteaza';

    // adăugăm în linie
    row.appendChild(selectKey);
    row.appendChild(input);
    row.appendChild(btnSave);
    row.appendChild(btnReset);
    root.appendChild(row);

    // event la schimbarea selectului
    selectKey.addEventListener('change', ()=> buildUI(selectKey.value));

    // save
    btnSave.addEventListener('click', async ()=>{
      const newVal = (input.tagName==='SELECT') ? input.value : input.value;
      try{
        const res = await fetch(`/api/settings/${encodeURIComponent(setting.id)}`, {
          method:'PUT',
          headers:{ 'Content-Type':'application/json' },
          credentials:'same-origin',
          body: JSON.stringify({ value: newVal })
        });
        if (!res.ok) throw new Error(await res.text());
        row.style.boxShadow = '0 0 0 3px #bbf7d0 inset';
        setTimeout(()=> row.style.boxShadow = '', 700);
      } catch(err){
        alert('Eroare la salvare: ' + err.message);
      }
    });

    // reset
    btnReset.addEventListener('click', async ()=>{
      try{
        const res = await fetch(`/api/settings/${encodeURIComponent(setting.id)}/reset`, {
          method:'POST',
          credentials:'same-origin'
        });
        if (!res.ok) throw new Error(await res.text());
        const updated = await res.json();
        input.value = updated.value ?? '';
        row.style.boxShadow = '0 0 0 3px #fde68a inset';
        setTimeout(()=> row.style.boxShadow = '', 700);
      } catch(err){
        alert('Eroare la reset: ' + err.message);
      }
    });
  }

  // helper: creează input în funcție de tip
  function buildInput(setting){
    const type = (setting.type || 'string').toLowerCase();
    let input;
    if (type === 'boolean' || type === 'bool'){
      input = document.createElement('select');
      ['true','false'].forEach(v=>{
        const o = document.createElement('option');
        o.value=v; o.textContent=v.toUpperCase();
        input.appendChild(o);
      });
      const cur = (setting.value ?? setting.defaultValue ?? 'false') + '';
      input.value = cur.toLowerCase()==='true' ? 'true' : 'false';
    } else {
      input = document.createElement('input');
      input.type = (type==='integer'||type==='number') ? 'number' : (type==='date' ? 'date' : 'text');
      input.value = setting.value ?? '';
      input.placeholder = setting.defaultValue ?? '';
    }
    return input;
  }

  (async ()=>{
    try{
      allSettings = await fetchSettings();
      buildUI(XML_KEYS[0]); // prima cheie default
    } catch (e){
      root.innerHTML = `<div class="alert alert-danger">Nu pot încărca setările.</div>`;
      console.error(e);
    }
  })();
})();
