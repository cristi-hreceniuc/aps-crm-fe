// public/js/app.js
// Helpers mici, fără să atingă request-urile gridului.
// 1. Fix 100vh pe iOS:
(function(){
  const setVh = () => {
    document.documentElement.style.setProperty('--vh', window.innerHeight * 0.01 + 'px');
  };
  window.addEventListener('resize', setVh);
  setVh();
})();

// 2. No-op: loc pentru scripturi generale ale aplicației.
// Grid-ul și meniul sunt în /js/datagrid.js și /js/nav.js.
