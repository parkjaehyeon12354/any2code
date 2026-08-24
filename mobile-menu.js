/* 모바일 메뉴 — 열기/닫기와 접근성 처리.

   원래는 각 페이지의 인라인 onclick 이 classList 만 토글했다. 그래서
   - 햄버거에 aria-expanded 가 없어 스크린리더가 열림/닫힘을 못 읽었다
   - 메뉴가 화면을 덮는 동안에도 뒤 콘텐츠가 계속 탭으로 잡혔다
   - Escape 로 못 닫았고, 닫아도 포커스가 햄버거로 안 돌아왔다

   파일 하나로 모아 8개 페이지가 같은 동작을 하게 한다. 인라인 onclick 은
   그대로 둬도 이 스크립트가 덮어쓰므로, 자바스크립트가 죽어도 최소한
   열리기는 한다(점진적 향상). */
(function () {
  var menu = document.getElementById('mobile-menu');
  var burger = document.querySelector('.hamburger');
  if (!menu || !burger) return;

  var closeBtn = menu.querySelector('.mobile-menu-close');
  var lastFocus = null;

  function focusables() {
    return [].slice.call(
      menu.querySelectorAll('a[href], button:not([disabled])')
    ).filter(function (el) { return el.offsetParent !== null; });
  }

  function open() {
    lastFocus = document.activeElement;
    menu.classList.add('open');
    burger.setAttribute('aria-expanded', 'true');
    // 메뉴가 화면을 덮는 동안 뒤 콘텐츠가 탭에 잡히면 안 된다
    document.body.style.overflow = 'hidden';
    var f = focusables();
    if (f.length) f[0].focus();
  }

  function close() {
    menu.classList.remove('open');
    burger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    /* 어디서 열었는지로 포커스를 돌려준다. 안 그러면 문서 맨 위로 튄다.

       lastFocus 가 body 인 경우가 있다 — 마우스로 눌렀을 때 브라우저가 버튼에
       포커스를 주지 않는 경우다. 그때 body 로 되돌리면 탭 순서가 처음으로
       가버리므로, 햄버거로 보낸다. */
    var back = (lastFocus && lastFocus !== document.body && lastFocus.focus)
      ? lastFocus : burger;
    back.focus();
  }

  burger.setAttribute('aria-expanded', 'false');
  burger.setAttribute('aria-controls', 'mobile-menu');

  burger.addEventListener('click', function (e) {
    e.preventDefault();
    menu.classList.contains('open') ? close() : open();
  });

  if (closeBtn) {
    closeBtn.addEventListener('click', function (e) {
      e.preventDefault();
      close();
    });
  }

  // 링크를 누르면 이동하므로 따로 닫을 필요는 없지만,
  // 같은 페이지 앵커(#)일 때는 메뉴가 남아 화면을 가린다.
  menu.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (a && a.getAttribute('href') === '#') close();
  });

  document.addEventListener('keydown', function (e) {
    if (!menu.classList.contains('open')) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }

    // 포커스가 메뉴 밖으로 나가지 않게 가둔다
    if (e.key === 'Tab') {
      var f = focusables();
      if (!f.length) return;
      var first = f[0];
      var last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
})();
