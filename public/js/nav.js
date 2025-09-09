// Mobile sidenav toggle (overlay)
(function(){
  const btn    = document.querySelector('.nav-toggle');
  const scrim  = document.querySelector('.nav-scrim');
  const sidenav= document.querySelector('.sidenav');
  if (!btn || !scrim || !sidenav) return;

  const mql = window.matchMedia('(max-width: 1024px)');
  function sync(){
    const onMobile = mql.matches;
    btn.hidden   = !onMobile;
    scrim.hidden = !onMobile;
    if (!onMobile) document.body.classList.remove('nav-open');
  }
  sync();
  if (mql.addEventListener) mql.addEventListener('change', sync);
  else if (mql.addListener) mql.addListener(sync);

  const open = ()=>{ document.body.classList.add('nav-open'); btn.setAttribute('aria-expanded','true'); };
  const close= ()=>{ document.body.classList.remove('nav-open'); btn.setAttribute('aria-expanded','false'); };

  btn.addEventListener('click', (e)=>{ e.preventDefault(); document.body.classList.contains('nav-open') ? close() : open(); });
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', (e)=>{ if (e.key==='Escape') close(); }, true);
  document.querySelector('.content-shell')?.addEventListener('click', ()=>{ if (document.body.classList.contains('nav-open')) close(); });
})();
