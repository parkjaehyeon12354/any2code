/* 상단 네비 메가드롭다운.

   마우스는 hover 로 열고, 키보드는 focus/Enter 로 연다.

   ⚠ 예전에는 mouseenter/mouseleave 만 있었다. 패널이 display:none 이라
   안쪽 링크가 포커스를 못 받았고, 그 결과 **키보드만 쓰는 사용자는 시뮬레이션
   8개 전부에 도달할 수 없었다**(탭 45번을 눌러도 0개). 모바일 메뉴는 768px
   이하에서만 나오므로 데스크톱에서는 대안도 없었다. */
(function () {
  const navLinks = document.getElementById('nav-links');
  if (!navLinks) return;

  let closeTimer = null;

  function closeAll(exceptLi) {
    clearTimeout(closeTimer);
    navLinks.querySelectorAll('li.active').forEach((li) => {
      if (li === exceptLi) return;
      li.classList.remove('active');
      const p = li.querySelector('.mega-dropdown');
      if (p) {
        p.classList.remove('open');
        const t = li.querySelector('[data-dropdown]');
        if (t) t.setAttribute('aria-expanded', 'false');
      }
    });
  }

  function openDropdown(li) {
    clearTimeout(closeTimer);
    const panel = li.querySelector('.mega-dropdown');
    if (!panel) return;
    closeAll(li);
    if (panel.classList.contains('open')) return;
    panel.classList.add('open');
    li.classList.add('active');
    const t = li.querySelector('[data-dropdown]');
    if (t) t.setAttribute('aria-expanded', 'true');
  }

  function closeOne(li) {
    const panel = li.querySelector('.mega-dropdown');
    if (!panel) return;
    panel.classList.remove('open');
    li.classList.remove('active');
    const t = li.querySelector('[data-dropdown]');
    if (t) t.setAttribute('aria-expanded', 'false');
  }

  navLinks.querySelectorAll('li').forEach((li) => {
    const trigger = li.querySelector('[data-dropdown]');
    const panel = li.querySelector('.mega-dropdown');
    if (!panel || !trigger) return;

    /* 스크린리더가 "메뉴가 열렸다/닫혔다" 를 읽을 수 있게 한다.
       aria-expanded 가 없으면 시각장애 사용자는 눌러도 뭐가 바뀌었는지 모른다. */
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-haspopup', 'true');

    li.addEventListener('mouseenter', function () {
      clearTimeout(closeTimer);
      openDropdown(li);
    });

    li.addEventListener('mouseleave', function () {
      closeTimer = setTimeout(function () { closeAll(); }, 250);
    });

    /* 키보드 — 트리거에서 Enter/Space/아래방향키로 연다.
       href="#" 이라 Enter 는 클릭으로도 들어오는데, 그건 아래 click 에서 받는다. */
    trigger.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        const isOpen = panel.classList.contains('open');
        if (isOpen && e.key !== 'ArrowDown') {
          closeOne(li);
        } else {
          openDropdown(li);
          // 연 다음 첫 항목으로 넘겨준다. 안 그러면 또 탭을 여러 번 눌러야 한다.
          const first = panel.querySelector('a[href]:not([href="#"])');
          if (first) first.focus();
        }
      }
    });

    /* 패널 안에서 포커스가 밖으로 나가면 닫는다.
       focusout 은 패널 내부 이동에도 발생하므로, 다음 포커스 대상이
       이 li 밖일 때만 닫는다. */
    li.addEventListener('focusout', function (e) {
      if (!li.contains(e.relatedTarget)) closeOne(li);
    });

    // 탭으로 패널 안에 들어오면 열어둔다(마우스 없이 도달한 경우)
    li.addEventListener('focusin', function () {
      if (!panel.classList.contains('open')) openDropdown(li);
    });
  });

  /* href="#"인 링크만 이동 방지. 실제 주소가 있는 과목 링크는 정상 이동.
     클릭으로도 열고 닫을 수 있게 한다 — 터치 기기에서는 hover 가 없다. */
  navLinks.addEventListener('click', function (e) {
    const link = e.target.closest('[data-dropdown]');
    if (!link || link.getAttribute('href') !== '#') return;
    e.preventDefault();
    const li = link.closest('li');
    const panel = li && li.querySelector('.mega-dropdown');
    if (!panel) return;
    panel.classList.contains('open') ? closeOne(li) : openDropdown(li);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    // 닫은 뒤 포커스를 트리거로 돌려준다. 안 그러면 문서 맨 위로 튄다.
    const openLi = navLinks.querySelector('li.active');
    closeAll();
    if (openLi) {
      const t = openLi.querySelector('[data-dropdown]');
      if (t) t.focus();
    }
  });
})();
