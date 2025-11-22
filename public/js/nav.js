// public/js/nav.js
// Mobile sidenav toggle (overlay) + Desktop mode toggle (auto/expanded/collapsed)
(function(){
  const btn     = document.querySelector('.nav-toggle');
  const scrim   = document.querySelector('.nav-scrim');
  const sidenav = document.querySelector('.sidenav');
  const modeToggle = document.getElementById('nav-mode-toggle');
  
  if (!sidenav) return;

  // State management with localStorage
  const STORAGE_KEY = 'sidenav-mode';
  const MODE_AUTO = 'auto';
  const MODE_EXPANDED = 'expanded';
  const MODE_COLLAPSED = 'collapsed';

  function getStoredMode() {
    try {
      return localStorage.getItem(STORAGE_KEY) || MODE_AUTO;
    } catch (e) {
      return MODE_AUTO;
    }
  }

  function setStoredMode(mode) {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch (e) {
      // Ignore storage errors
    }
  }

  function updateSidenavMode(mode) {
    // Remove all mode classes
    sidenav.classList.remove('nav-auto', 'nav-expanded', 'nav-collapsed');
    
    // Apply new mode
    sidenav.classList.add('nav-' + mode);
    setStoredMode(mode);

    // Update button title
    const titles = {
      [MODE_AUTO]: 'Mod automat (hover pentru a extinde)',
      [MODE_EXPANDED]: 'Mod extins (click pentru a restânge)',
      [MODE_COLLAPSED]: 'Mod restrâns (click pentru a extinde)'
    };
    if (modeToggle) {
      modeToggle.setAttribute('title', titles[mode] || 'Comută modul meniu');
      modeToggle.setAttribute('aria-label', titles[mode] || 'Comută modul meniu');
    }

    // Fire resize event
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('sidenav-resized'));
    }, 320);
  }

  // Initialize from storage - ensure sidenav has a mode class
  const storedMode = getStoredMode();
  // Make sure sidenav has the mode class immediately
  sidenav.classList.add('nav-' + storedMode);
  updateSidenavMode(storedMode);

  // Desktop mode toggle (only on desktop)
  if (modeToggle) {
    const mql = window.matchMedia('(max-width: 1024px)');
    
    function isMobile() {
      return mql.matches;
    }

    // Cycle through modes: auto -> expanded -> collapsed -> auto
    modeToggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (isMobile()) return; // Only work on desktop
      
      const currentMode = getStoredMode();
      let nextMode;
      
      if (currentMode === MODE_AUTO) {
        nextMode = MODE_EXPANDED;
      } else if (currentMode === MODE_EXPANDED) {
        nextMode = MODE_COLLAPSED;
      } else {
        nextMode = MODE_AUTO;
      }
      
      updateSidenavMode(nextMode);
    });

    // Sync on resize
    if (mql.addEventListener) {
      mql.addEventListener('change', () => {
        if (isMobile()) {
          // On mobile, clear desktop modes
          sidenav.classList.remove('nav-auto', 'nav-expanded', 'nav-collapsed');
        } else {
          // On desktop, restore mode
          const stored = getStoredMode();
          updateSidenavMode(stored);
        }
      });
    }
  }

  // Mobile sidenav toggle (overlay)
  if (btn && scrim) {
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

    const open  = ()=>{ 
      document.body.classList.add('nav-open');  
      btn.setAttribute('aria-expanded','true');
      setTimeout(fireSidenavResized, 220);
    };
    const close = ()=>{ 
      document.body.classList.remove('nav-open'); 
      btn.setAttribute('aria-expanded','false');
      setTimeout(fireSidenavResized, 220);
    };

    btn.addEventListener('click', (e)=>{
      e.preventDefault();
      document.body.classList.contains('nav-open') ? close() : open();
    });
    scrim.addEventListener('click', close);
    document.addEventListener('keydown', (e)=>{ if (e.key === 'Escape') close(); }, true);

    // închide când se apasă în content
    document.querySelector('.content-shell')?.addEventListener('click', ()=>{
      if (document.body.classList.contains('nav-open')) close();
    });
  }

  // Fire resize event for other components
  function fireSidenavResized() {
    window.dispatchEvent(new CustomEvent('sidenav-resized'));
  }

  // Listen for transition end to fire resize event
  sidenav.addEventListener('transitionend', (e) => {
    if (e.propertyName === 'width' || e.propertyName === 'transform') {
      fireSidenavResized();
    }
  });
})();
