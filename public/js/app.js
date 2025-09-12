(function(){
  const sidenav = document.querySelector('.sidenav');
  const toggle  = document.querySelector('.nav-toggle');
  const scrim   = document.querySelector('.nav-scrim');
  if (!sidenav || !toggle || !scrim) return;

  function openNav(){
    document.body.classList.add('sidenav-open');
    sidenav.classList.add('open');
    scrim.removeAttribute('hidden');          // scrim vizibil doar când e meniu deschis
    window.dispatchEvent(new Event('sidenav-resized'));
  }
  function closeNav(){
    document.body.classList.remove('sidenav-open');
    sidenav.classList.remove('open');
    scrim.setAttribute('hidden','');          // ascuns = nu blochează inputuri
    window.dispatchEvent(new Event('sidenav-resized'));
  }
  function toggleNav(){
    if (sidenav.classList.contains('open')) closeNav(); else openNav();
  }

  toggle.addEventListener('click', (e)=>{ e.preventDefault(); toggleNav(); });
  scrim.addEventListener('click', closeNav);

  // La load: pe desktop deschis, pe mobil închis
  const isMobile = matchMedia('(max-width: 760px)').matches;
  if (isMobile) closeNav(); else openNav();
})();

document.addEventListener('click', (e)=>{
  const parent = e.target.closest('.nav-parent');
  if (!parent) return;
  e.preventDefault();
  parent.closest('.nav-group')?.classList.toggle('open');
});

document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.querySelector(".theme-toggle input");
  const body = document.body;

  // Citește preferința din localStorage
  if (localStorage.getItem("theme") === "dark") {
    body.classList.add("dark");
    if (toggle) toggle.checked = true;
  }

  if (toggle) {
    toggle.addEventListener("change", () => {
      if (toggle.checked) {
        body.classList.add("dark");
        localStorage.setItem("theme", "dark");
      } else {
        body.classList.remove("dark");
        localStorage.setItem("theme", "light");
      }
    });
  }
});
