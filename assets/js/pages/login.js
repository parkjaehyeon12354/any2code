(function () {
  // 로그인은 이제 서버가 주도한다. 브라우저는 링크만 따라가면 된다:
  //   /api/auth/{provider}/start  →  제공자 동의 화면  →  /api/auth/{provider}/callback
  // client_id 와 state 를 프론트에 두지 않는 이유:
  //   - state 를 sessionStorage 에 두면 서버가 대조할 수 없어 CSRF 방어가 성립하지 않는다
  //   - 이제 서버가 state 를 발급해 httpOnly 쿠키에 심고, 콜백에서 직접 대조한다
  const notice = document.getElementById('notice');
  // 회원가입 화면으로 건너뛸 때도 원래 가려던 곳(?to=)을 그대로 들고 간다.
  const switchLink = document.getElementById('switch-link');
  const toParam = new URLSearchParams(location.search).get('to');
  if (switchLink && toParam) switchLink.href = '/signup?to=' + encodeURIComponent(toParam);
  const LABEL = { kakao: '카카오', google: 'Google', github: 'GitHub', discord: 'Discord' };

  // 콜백이 실패하면 ?error= 를 달고 돌아온다
  const ERRORS = {
    cancelled: '로그인이 취소되었습니다.',
    bad_state: '보안 검증에 실패했습니다. 다시 시도해 주세요.',
    no_code: '제공자로부터 인가 코드를 받지 못했습니다.',
    exchange_failed: '로그인 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.'
  };
  const err = new URLSearchParams(location.search).get('error');
  if (err) {
    notice.textContent = ERRORS[err] || '로그인에 실패했습니다.';
    notice.classList.add('show');
    history.replaceState(null, '', location.pathname);   // 새로고침 시 반복 표시 방지
  }

  // 약관 동의는 이 화면의 일이 아니다. 신규 가입자는 서버가 /welcome 으로
  // 보내 거기서 받는다 — auth.js 콜백의 termsAcceptedAt 판정이 그 강제다.
  document.querySelectorAll('.btn-oauth[data-provider]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const name = btn.dataset.provider;
      btn.disabled = true;
      /* 로그인 페이지 자신으로 돌아오면 곤란하다. ?to= 로 받은 곳이 있으면
         그리로, 없으면 메인으로 보낸다. */
      var back = new URLSearchParams(location.search).get('to') || '/';
      Session.startLogin(name, back);

      // 서버가 아직 배포되지 않았거나 자격증명이 없으면 이동이 안 된다.
      // 버튼이 영영 잠긴 채로 남지 않도록 되살린다.
      setTimeout(function () {
        if (!btn.disabled) return;
        btn.disabled = false;
        notice.textContent = LABEL[name] + ' 로그인 서버에 연결하지 못했습니다. 배포 후 다시 시도해 주세요.';
        notice.classList.add('show');
      }, 4000);
    });
  });

  // 이미 로그인 상태면 로그인 화면에 머물 이유가 없다
  Session.refresh().then(function (user) {
    if (user) window.location.replace('/');
  });
})();
