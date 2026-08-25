/* 상단 네비 메가드롭다운 */
(function () {
  const navLinks = document.getElementById('nav-links');
  if (!navLinks) return;

  let closeTimer = null;

  function closeAll() {
    clearTimeout(closeTimer);
    navLinks.querySelectorAll('.open,.active').forEach(el => {
      el.classList.remove('open', 'active');
    });
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

    li.addEventListener('mouseleave', function () {
      closeTimer = setTimeout(closeAll, 250);
    });
  });

  // href="#"인 링크만 이동 방지
  // 실제 주소가 있는 과목 링크는 정상 이동
  navLinks.addEventListener('click', function (e) {
    const link = e.target.closest('[data-dropdown]');

    if (link && link.getAttribute('href') === '#') {
      e.preventDefault();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeAll();
  });
})();
