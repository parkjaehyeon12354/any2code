/* 상단 네비의 메가드롭다운 — Index/community 공용.
   #nav-links 가 없는 페이지(login, admin)에서는 아무것도 하지 않는다. */
(function () {
  const navLinks = document.getElementById('nav-links');
  if (!navLinks) return;

  let closeTimer = null;

  function closeAll() {
    clearTimeout(closeTimer);
    navLinks.querySelectorAll('.open,.active').forEach(el => el.classList.remove('open', 'active'));
  }

  function openDropdown(li) {
    clearTimeout(closeTimer);
    const panel = li.querySelector('.mega-dropdown');
    if (!panel || panel.classList.contains('open')) return;
    closeAll();
    panel.classList.add('open');
    li.classList.add('active');
  }

  navLinks.querySelectorAll('li').forEach(li => {
    li.addEventListener('mouseenter', function () {
      clearTimeout(closeTimer);
      openDropdown(li);
    });
    // 250ms 여유 — 링크와 패널 사이를 지날 때 닫히면 못 쓴다
    li.addEventListener('mouseleave', function () {
      closeTimer = setTimeout(closeAll, 250);
    });
  });

  // 드롭다운 여는 링크는 이동시키지 않는다 (href="#" 로 맨 위로 튀는 것 방지)
  navLinks.addEventListener('click', function (e) {
    if (e.target.closest('[data-dropdown]')) e.preventDefault();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeAll();
  });
})();
