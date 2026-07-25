/* 상단바의 로그인 상태 표시 — Index/admin 공용.
   #nav-cta 가 있으면 프로필 드롭다운을, #mobile-cta 가 있으면 모바일 버튼을 채운다.
   둘 다 없으면 아무것도 안 한다.

   ⚠ 관리자 링크 노출은 화면 표시일 뿐 권한이 아니다 — session.js 의 경고 참고. */
(function () {
  const user = Session.load();
  if (!user) return;   // 비로그인이면 HTML 에 적힌 기본값("시작하기")을 그대로 둔다

  const esc = escapeHtml;   // session.js 제공
  const isAdmin = Session.isAdmin();
  const navCta = document.getElementById('nav-cta');
  const mobileCta = document.getElementById('mobile-cta');

  if (navCta) {
    navCta.innerHTML =
      '<div class="profile-menu" id="profile-menu">' +
      '<button type="button" class="profile-trigger" aria-expanded="false" aria-haspopup="true">' +
      esc(user.name) +
      '<svg viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1l5 5 5-5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '</button>' +
      '<div class="profile-dropdown">' +
      (isAdmin ? '<a href="admin.html">관리자</a>' : '') +
      '<a href="#" data-logout>로그아웃</a>' +
      '</div></div>';
  }

  if (mobileCta) {
    mobileCta.innerHTML =
      (isAdmin ? '<a href="admin.html" class="btn btn-ghost" style="width:100%">관리자</a>' : '') +
      '<a href="#" class="btn btn-primary" style="width:100%" data-logout>로그아웃</a>';
  }

  document.querySelectorAll('[data-logout]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      Session.clear();
      window.location.href = 'Index.html';   // 관리자 화면에서 로그아웃해도 메인으로
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
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });
})();
