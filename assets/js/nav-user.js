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
        '<a href="/settings">설정</a>' +
        (isAdmin ? '<a href="/admin">관리자</a>' : '') +
        '<a href="#" data-logout>로그아웃</a>' +
        '</div></div>';
    }

    if (mobileCta) {
      mobileCta.innerHTML =
        '<a href="/settings" class="btn btn-ghost" style="width:100%">설정</a>' +
        (isAdmin ? '<a href="/admin" class="btn btn-ghost" style="width:100%">관리자</a>' : '') +
        '<a href="#" class="btn btn-primary" style="width:100%" data-logout>로그아웃</a>';
    }

    // 페이지 마크업에 박혀 있는 [data-logout] 은 innerHTML 교체로 사라지지 않으므로
    // render 가 두 번 돌면 리스너가 두 번 붙어 로그아웃이 두 번 날아간다.
    // (캐시 → 서버 확인 경로만으로도 render 는 이미 두 번 돌 수 있다.)
    document.querySelectorAll('[data-logout]').forEach(function (el) {
      if (el.dataset.logoutBound) return;
      el.dataset.logoutBound = '1';
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

  /* 설정 화면이 이름을 바꾼 뒤 상단바만 다시 그리려고 쓴다.
     이것 없이 이름을 반영하려면 페이지를 새로고침해야 하고, 그러면 방금 띄운
     "저장했습니다" 안내가 함께 지워져서 사용자는 아무 일도 안 일어난 줄 안다. */
  window.NavUser = { render: render };

  /* 캐시가 있으면 즉시 그리고(깜빡임 방지), 서버 응답이 오면 다시 그린다.

     비교 대상은 "방금 그린 값" 이어야 한다. Session.load() 를 여기서 다시 부르면
     안 되는데, load() 는 서버 확인이 끝나면 캐시가 아니라 verified 를 돌려주므로
     refresh 직후에는 서버 응답과 자기 자신을 비교하게 된다 — 항상 같다고 나와서
     다시 그리지 않는다. 그러면 캐시에 남은 옛 이름·옛 role 이 세션 내내 상단바에
     박혀 있고, "해임되면 다음 새로고침부터 관리자 메뉴가 사라진다" 도 거짓이 된다. */
  const drawn = Session.load();
  render(drawn);
  Session.refresh().then(function (user) {
    /* 가입을 안 끝냈으면(약관 미동의) 가입 화면으로 되돌린다.

       로그인 쿠키가 있다고 가입이 끝난 게 아니다 — 콜백에서 /welcome 으로
       보내지만, 사용자가 주소를 직접 치거나 뒤로가기로 빠져나올 수 있다.
       그때도 결국 여기로 돌아오게 만든다.

       ⚠ 서버(onboarded)만 믿는다. 캐시(drawn)로 판단하면 sessionStorage 를
       손대는 것만으로 가입 절차를 건너뛸 수 있다.
       /welcome 자신과 약관·정책 문서는 제외 — 동의하려면 읽을 수 있어야 한다. */
    if (user && user.onboarded === false) {
      var here = window.location.pathname;
      var free = ['/welcome', '/terms', '/privacy', '/login'];
      if (free.indexOf(here) === -1) {
        window.location.replace('/welcome?to=' + encodeURIComponent(here + window.location.search));
        return;
      }
    }

    if (JSON.stringify(user) !== JSON.stringify(drawn) || !document.getElementById('profile-menu')) {
      render(user);
    }
  });
})();
