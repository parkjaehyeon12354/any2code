/* 상단바의 로그인 상태 표시 — Index/community/admin 공용.
   #nav-cta 가 있으면 프로필 드롭다운을, #mobile-cta 가 있으면 모바일 버튼을 채운다.

   ⚠ 관리자 링크 노출은 화면 표시일 뿐 권한이 아니다 — 실제 차단은 /api 가 한다. */
(function () {
  const navCta = document.getElementById('nav-cta');
  const mobileCta = document.getElementById('mobile-cta');
  if (!navCta && !mobileCta) return;

  const esc = escapeHtml;   // session.js 제공

  function render(user) {
    if (!user) return;   // 비로그인이면 HTML 에 적힌 기본값("시작하기")을 그대로 둔다
    const isAdmin = user.role === 'admin';

    if (navCta) {
      navCta.innerHTML =
        '<div class="profile-menu" id="profile-menu">' +
        '<button type="button" class="profile-trigger" aria-expanded="false" aria-haspopup="true">' +
        esc(user.name) +
        '<svg viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1l5 5 5-5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</button>' +
        '<div class="profile-dropdown">' +
        (isAdmin ? '<a href="/admin">관리자</a>' : '') +
        '<a href="#" data-logout>로그아웃</a>' +
        '</div></div>';
    }

    if (mobileCta) {
      mobileCta.innerHTML =
        (isAdmin ? '<a href="/admin" class="btn btn-ghost" style="width:100%">관리자</a>' : '') +
        '<a href="#" class="btn btn-primary" style="width:100%" data-logout>로그아웃</a>';
    }

    document.querySelectorAll('[data-logout]').forEach(function (el) {
      el.addEventListener('click', async function (e) {
        e.preventDefault();
        await Session.logout();          // 서버 쿠키까지 폐기해야 진짜 로그아웃이다
        window.location.href = '/';
      });
    });

    // 드롭다운 — 트리거로 열고, 바깥 클릭·Esc 로 닫는다 (mega-dropdown 과 같은 규칙)
    const menu = document.getElementById('profile-menu');
    if (!menu) return;
    const trigger = menu.querySelector('.profile-trigger');
    const close = function () {
      menu.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    };
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      const open = menu.classList.toggle('open');
      trigger.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }

  // 캐시가 있으면 즉시 그리고(깜빡임 방지), 서버 응답이 오면 다시 그린다
  render(Session.load());
  Session.refresh().then(function (user) {
    if (JSON.stringify(user) !== JSON.stringify(Session.load()) || !document.getElementById('profile-menu')) {
      render(user);
    }
  });
})();
