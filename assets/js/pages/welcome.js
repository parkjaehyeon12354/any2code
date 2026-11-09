(function () {
  var el = function (id) { return document.getElementById(id); };
  var form = el('w-form'), sub = el('w-sub');
  var submit = el('w-submit'), err = el('w-error');

  /* 약관에 동의하면 원래 가려던 화면으로 이어간다.
     ?to= 는 콜백이 붙여준다. 남이 심어놓은 외부 주소로 튀지 않도록
     '/' 로 시작하고 '//' 가 아닌 값만 받는다(오픈 리다이렉트 방어). */
  function nextPath() {
    var raw = new URLSearchParams(location.search).get('to') || '/';
    if (raw.charAt(0) !== '/' || raw.charAt(1) === '/' || raw.charAt(1) === '\\') return '/';
    return raw;
  }

  function fail(msg) {
    err.textContent = msg;
    err.hidden = false;
    submit.disabled = false;
    submit.textContent = '시작하기';
  }

  el('w-skip').addEventListener('click', function (e) {
    // 이름·생일만 선택이다. 동의는 여전히 필수라 submit 핸들러가 그대로 막는다.
    e.preventDefault();
    el('w-name').value = '';
    el('w-birthday').value = '';
    form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
  });

  el('w-cancel').addEventListener('click', function (e) {
    e.preventDefault();
    // 로그아웃하면 가입이 완료되지 않은 채로 남는다. 다시 로그인하면 여기로 돌아온다.
    Session.logout().then(function () { location.replace('/'); });
  });

  var agree = el('w-agree'), agreeBox = el('w-agree-box');
  agree.addEventListener('change', function () {
    if (!agree.checked) return;
    agreeBox.classList.remove('nudge');
    err.hidden = true;
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    // 체크하지 않으면 서버로 보내지 않는다 — 버튼을 막는 대신 이유를 보여준다.
    if (!agree.checked) {
      agreeBox.classList.add('nudge');
      fail('이용약관과 개인정보 처리방침에 동의해야 시작할 수 있습니다.');
      agree.focus();
      return;
    }

    submit.disabled = true;
    submit.textContent = '처리하는 중…';
    err.hidden = true;

    fetch('/api/profile/terms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        agree: true,   // 여기 도달했다는 것 자체가 체크박스를 확인했다는 뜻이다
        name: el('w-name').value.trim(),
        birthday: el('w-birthday').value || null
      })
    }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; });
    }).then(function (res) {
      if (res.ok) { location.replace(nextPath()); return; }
      if (res.status === 401) { location.replace('/login'); return; }
      fail((res.d && res.d.error) || '가입을 마치지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }).catch(function () {
      fail('네트워크에 문제가 있습니다. 연결을 확인하고 다시 시도해 주세요.');
    });
  });

  // 로그인 상태부터 확인한다. 로그인 안 했으면 여기 있을 이유가 없고,
  // 이미 가입을 끝냈으면 되돌려보낸다(뒤로가기로 이 화면에 다시 들어오는 경우).
  Session.refresh().then(function (me) {
    if (!me) { location.replace('/login'); return; }
    if (me.onboarded) { location.replace(nextPath()); return; }

    sub.textContent = me.name
      ? me.name + ' 님, 반가워요. 아래 항목만 확인하면 시작할 수 있습니다.'
      : '반가워요. 아래 항목만 확인하면 시작할 수 있습니다.';
    form.hidden = false;
    el('w-name').placeholder = me.name ? '비워두면 ' + me.name + ' 으로 표시됩니다' : '비워두면 로그인 계정 이름을 씁니다';
  }).catch(function () {
    // 확인에 실패해도 가입을 막지는 않는다. 제출 시 서버가 다시 판정한다.
    sub.textContent = '아래 항목만 확인하면 시작할 수 있습니다.';
    form.hidden = false;
  });
})();
