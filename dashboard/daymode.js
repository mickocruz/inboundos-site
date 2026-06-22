// Day mode persistence — loaded on every dashboard page
(function(){
  if(localStorage.getItem('ctrl_day_mode')==='1'){
    document.documentElement.classList.add('day-mode');
    document.body && document.body.classList.add('day-mode');
    // Apply before paint to avoid flash
    var s=document.createElement('style');
    s.textContent='html,body{background:#f4f5f7!important;color:#0d1117!important;}';
    document.head.appendChild(s);
  }
  // Re-apply after DOM ready in case body wasn't available above
  document.addEventListener('DOMContentLoaded',function(){
    if(localStorage.getItem('ctrl_day_mode')==='1'){
      document.body.classList.add('day-mode');
      document.documentElement.classList.add('day-mode');
    }
  });
})();
