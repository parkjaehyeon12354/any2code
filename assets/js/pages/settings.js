(function () {
  const el = (id) => document.getElementById(id);
  const esc = escapeHtml;   // session.js 제공

  const form = el('form');
  const fName = el('f-name');
  const fBirthday = el('f-birthday');
  const saveBtn = el('save');
  const result = el('result');

  let LOADED = null;   // 서버가 준 마지막 값. '되돌리기' 와 변경 여부 판단에 쓴다

  function say(msg, isBad) {
    result.textContent = msg;
    result.classList.toggle('bad', !!isBad);
    result.hidden = false;
  }

  const PROVIDER_LABEL = { google: 'Google', kakao: '카카오', discord: 'Discord', github: 'GitHub' };

  // shortDate 는 session.js 가 전역으로 준다 (모든 화면이 같은 시간대로 그린다)

  function syncCount() {
    const n = fName.value.trim().length;
    el('name-count').textContent = n + ' / ' + (LOADED ? LOADED.limits.nameMax : 20);
  }
  fName.addEventListener('input', syncCount);

  /* 서버가 준 값만 그린다. 화면이 보낸 값을 그리면 서버가 다듬은 결과(공백 정리 등)와
     어긋나서 "저장했는데 다르다" 가 된다. */
  function render(data) {
    LOADED = data;
    const p = data.profile;

    fName.value = p.name;
    fName.minLength = data.limits.nameMin;
    fName.maxLength = data.limits.nameMax;
    fBirthday.value = p.birthday || '';
    // 오늘 이후는 고를 수 없게 — 서버도 막지만 달력에서 아예 안 보이는 편이 낫다
    fBirthday.max = new Date().toISOString().slice(0, 10);
    fBirthday.min = '1900-01-01';
    syncCount();

    el('name-hint').textContent = p.nameChanged
      ? '로그인 제공자 이름은 "' + p.oauthName + '" 입니다. 이름을 바꾸면 이미 쓴 글의 작성자명도 함께 바뀝니다.'
      : '지금은 로그인 제공자에서 온 이름을 쓰고 있습니다. 바꾸면 이미 쓴 글의 작성자명도 함께 바뀝니다.';

    el('stamp').textContent = p.nameChangedAt
      ? '이름 마지막 변경: ' + shortDate(p.nameChangedAt)
      : '';

    const chip = '<span class="chip chip-' + esc(p.provider) + '">' +
      esc(PROVIDER_LABEL[p.provider] || p.provider) + '</span>';
    el('account').innerHTML =
      '<div><dt>로그인</dt><dd>' + chip + '</dd></div>' +
      '<div><dt>이메일</dt><dd>' + esc(p.email || '—') + '</dd></div>' +
      '<div><dt>가입일</dt><dd>' + esc(shortDate(p.joinedAt)) + '</dd></div>' +
      '<div><dt>최근 로그인</dt><dd>' + esc(shortDate(p.lastLoginAt)) + '</dd></div>';
  }

  /* 소명 결과 문구는 "받아들여졌는지" 를 그대로 말한다. 관리자 화면은 기각·인용·감경
     이라는 정확한 말을 쓰지만, 처분을 받는 쪽에는 그 단어가 무슨 뜻인지부터 걸린다. */
  const APPEAL_STATUS = {
    wait:    { cls: 'badge-wait', text: '검토 중' },
    granted: { cls: 'badge-ok',   text: '받아들여짐' },
    reduced: { cls: 'badge-wait', text: '일부 받아들여짐' },
    denied:  { cls: 'badge-bad',  text: '받아들여지지 않음' }
  };

  const badge = (cls, text) => '<span class="badge ' + cls + '">' + esc(text) + '</span>';

  /* 제재·소명은 이름을 저장해도 바뀌지 않으므로 불러올 때 한 번만 그린다. */
  /* 이력 한 줄의 문구. days 는 그 이벤트가 만든 기간이라 해석이 이벤트마다 다르다.
     영구 제재는 days 가 null 이다 — 그대로 이으면 "null일 이용 제한" 이 나온다. */
  const LOG_EVENT = {
    issued:  (h) => (h.permanent ? '영구 정지' : h.days ? h.days + '일 이용 제한' : '경고'),
    reduced: (h) => '소명이 일부 받아들여져 ' + h.days + '일로 줄었습니다',
    lifted:  () => '소명이 받아들여져 제재가 해제됐습니다'
  };

  function renderDiscipline(d) {
    const box = el('discipline');
    const parts = [];

    if (d.sanction) {
      const s = d.sanction;
      parts.push('<p class="sub-head">현재 상태</p>');
      const state = s.active
        ? badge('badge-bad', s.permanent ? '영구 정지' : '제한 중')
        : s.lifted
          ? badge('badge-ok', '소명으로 해제됨')
          : badge('badge-off', '기간 만료');

      /* 영구 제재는 해제일을 보여주지 않는다. until 이 9999-12-31 이라
         "해제 예정 9999-12-31" 이 되는데, 자동 해제가 없으므로 거짓말이다. */
      const title = s.permanent ? '영구 정지' : (s.days === 0 ? '경고' : s.days + '일 이용 제한');
      const untilRow = (!s.permanent && s.days > 0)
        ? '<div><dt>' + (s.active ? '해제 예정' : '해제됨') + '</dt><dd>' + esc(shortDate(s.until)) + '</dd></div>'
        : s.permanent && s.active
          ? '<div><dt>해제 방법</dt><dd>소명 제출 후 관리자 검토</dd></div>'
          : '';

      parts.push(
        '<div class="sanction">' +
        '<div class="sanction-top"><strong>' +
        esc(title) + '</strong>' + state + '</div>' +
        '<dl>' +
        '<div><dt>사유</dt><dd>' + esc(s.reason || '—') + '</dd></div>' +
        '<div><dt>처리일</dt><dd>' + esc(shortDate(s.at)) + '</dd></div>' +
        untilRow +
        '</dl></div>'
      );
    }

    if (d.history.length) {
      parts.push('<p class="sub-head">제재 이력 ' + d.history.length + '건</p>');
      parts.push('<div class="log">' + d.history.map(function (h) {
        const label = (LOG_EVENT[h.event] || function () { return h.event; })(h);
        return '<div>' +
          '<span class="when">' + esc(shortDate(h.at)) + '</span>' +
          '<span class="what">' + esc(label) + '</span>' +
          (h.reason && h.event === 'issued' ? '<span class="why">· ' + esc(h.reason) + '</span>' : '') +
          '</div>';
      }).join('') + '</div>');
    }

    if (d.appeals.length) {
      parts.push('<p class="sub-head">낸 소명 ' + d.appeals.length + '건</p>');
      parts.push(d.appeals.map(function (a) {
        const st = APPEAL_STATUS[a.status];
        let outcome = '';
        if (a.status === 'granted') outcome = '제재가 즉시 해제됐습니다.';
        else if (a.status === 'reduced') outcome = '제재가 ' + a.reducedDays + '일로 줄었습니다.';
        else if (a.status === 'denied') outcome = '제재가 유지됩니다.';
        else outcome = '아직 결과가 나오지 않았습니다.';

        return '<div class="appeal">' +
          '<div class="appeal-top">' + badge(st.cls, st.text) +
          '<span class="appeal-when">' + esc(shortDate(a.createdAt)) + ' 접수' +
          (a.decidedAt ? ' · ' + esc(shortDate(a.decidedAt)) + ' 결정' : '') + '</span></div>' +
          '<p class="appeal-text">' + esc(a.text) + '</p>' +
          '<p class="appeal-outcome">' + esc(outcome) + '</p>' +
          '</div>';
      }).join(''));
    }

    if (!parts.length) {
      parts.push('<p class="empty">제재를 받은 적이 없습니다.</p>');
    } else if (!d.appeals.length) {
      /* 소명은 제한이 걸려 있는 동안만 낼 수 있다 (서버가 그렇게 막는다).
         경고만 받았거나 기간이 끝난 사람에게 소명하라고 안내하면, 눌러 봤다가
         거절당한다 — 화면이 되지 않는 일을 권하는 셈이다. */
      parts.push('<p class="empty">' + (d.sanction && d.sanction.active
        ? '아직 낸 소명이 없습니다. 억울한 점이 있으면 커뮤니티 화면에서 소명할 수 있습니다.'
        : '낸 소명이 없습니다.') + '</p>');
    }

    box.innerHTML = parts.join('');
  }

  async function load() {
    try {
      const res = await fetch('/api/profile', { credentials: 'same-origin' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
      const data = await res.json();
      render(data);
      renderDiscipline(data.discipline);
      result.hidden = true;
    } catch (e) {
      say('설정을 불러오지 못했습니다: ' + e.message +
        '\n현재 값을 모르는 상태로 저장하면 멀쩡한 설정을 덮어씁니다. 저장 버튼을 잠갔습니다.', true);
      saveBtn.disabled = true;
    }
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();   // 폼 기본 제출(페이지 이동)을 막는다

    // 브라우저 검사를 먼저 통과시킨다. 서버도 같은 범위를 보지만 왕복 없이 알려주는 편이 낫다
    for (const input of [fName, fBirthday]) {
      if (!input.checkValidity()) { input.focus(); input.reportValidity(); return; }
    }

    const prev = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중…';
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fName.value, birthday: fBirthday.value })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '저장하지 못했습니다.');

      render(data);
      say(data.renamed
        ? '저장했습니다. 이미 쓴 글·답변 ' + data.renamed + '건의 작성자명도 새 이름으로 바꿨습니다.'
        : '저장했습니다.');

      // 상단바가 옛 이름을 들고 있으면 방금 바꾼 게 반영 안 된 것처럼 보인다.
      // 새로고침으로 해결하면 위에서 띄운 안내가 함께 지워지므로 상단바만 다시 그린다.
      const me = await Session.refresh();
      if (window.NavUser) window.NavUser.render(me);
    } catch (e) {
      say('저장하지 못했습니다: ' + e.message + '\n화면의 값은 그대로 두었습니다.', true);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = prev;
    }
  });

  el('reset').addEventListener('click', function () {
    if (!LOADED) return;
    render(LOADED);
    say('불러온 값으로 되돌렸습니다. 저장하지는 않았습니다.');
  });

  /* 계정 삭제. 예약 즉시 서버가 세션 쿠키를 지운다(강제 로그아웃) —
     그 상태는 로그인해야 볼 수 있는데, 로그인하는 순간 서버가 자동으로
     취소해 버리므로 이 화면이 "예약 중" 상태를 그릴 일이 없다. */
  const deleteBtn = el('danger-delete');

  deleteBtn.addEventListener('click', async function () {
    if (!confirm('계정을 삭제하시겠습니까?\n\n즉시 로그아웃되고, 글·답변·프로필이 ' +
      '7일 뒤 완전히 사라집니다. 그 전에 다시 로그인하면 자동으로 취소됩니다.')) return;

    deleteBtn.disabled = true;
    try {
      const res = await fetch('/api/profile/delete', { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '삭제를 예약하지 못했습니다.');
      // 서버가 이미 세션 쿠키를 지웠다. 화면도 로그아웃 상태로 맞춘다.
      location.replace('/');
    } catch (e) {
      say('삭제를 예약하지 못했습니다: ' + e.message, true);
      deleteBtn.disabled = false;
    }
  });

  /* 다음 충전 시각을 한국 시간으로 적는다. 브라우저 시간대가 달라도 서버(credit.js)와
     같은 시각이 나와야 한다 — getHours() 를 쓰면 로컬 시간대로 나온다.
     충전은 항상 정시라, 기기 시계가 조금 틀려도 가장 가까운 정시로 반올림해 맞춘다. */
  function nextResetLabel(resetInMs, now) {
    const at = Math.round((now + resetInMs) / 3600000) * 3600000;
    const h = new Date(at + 9 * 3600000).getUTCHours();
    const m = Math.ceil(resetInMs / 60000);
    const left = m >= 60 ? Math.floor(m / 60) + '시간 ' + (m % 60) + '분' : m + '분';
    return String(h).padStart(2, '0') + '시 (' + left + ' 뒤)';
  }

  const kstDay = (iso) => new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(0, 10);

  /* /api/me(와 쿠폰 사용 응답)가 주는 크레딧 상태. 조회에 실패하면 null 이다.
     free 는 3시간마다 채워지는 몫의 남은 양, bonus 는 쿠폰으로 충전한 잔액이다. */
  function renderCredit(c) {
    el('credit').innerHTML = c && c.unlimited   // 관리자 — 차감하지 않으니 한도·충전 시각이 뜻이 없다
      ? '<div><dt>요금제</dt><dd>' + esc(c.planLabel) + '</dd></div>' +
        '<div><dt>남은 크레딧</dt><dd>무제한 (관리자는 차감하지 않습니다)</dd></div>'
      : c
      ? '<div><dt>요금제</dt><dd>' + esc(c.planLabel) +
          (c.planUntil ? ' · ' + kstDay(c.planUntil) + '까지' : '') + '</dd></div>' +
        '<div><dt>남은 크레딧</dt><dd>' + c.free + ' / ' + c.granted + '</dd></div>' +
        '<div><dt>충전 잔액</dt><dd>' + (c.bonus ? c.bonus + ' (다 쓸 때까지 유지)' : '없음') + '</dd></div>' +
        '<div><dt>다음 충전</dt><dd>' + nextResetLabel(c.resetInMs, Date.now()) + '</dd></div>' +
        '<div><dt>충전 시각</dt><dd>매일 00·03·06·09·12·15·18·21시 (한국 시간)</dd></div>'
      : '<div><dt>남은 크레딧</dt><dd>지금은 불러오지 못했습니다.</dd></div>';
  }

  /* 쿠폰. 결과는 입력칸 아래에 보여 준다. 성공하면 칸을 비우고 크레딧 카드를 바로 고친다 —
     새로고침해야 반영되면 "안 된 건가" 하고 또 누른다(두 번째는 '이미 사용' 이 뜬다). */
  const couponForm = el('coupon-form');
  const couponInput = el('f-coupon');
  const couponBtn = el('coupon-use');
  const couponResult = el('coupon-result');

  /* 모든 기기에서 로그아웃 — 다른 기기·브라우저에 남은 세션까지 서버가 끊는다.
     쿠키가 새어 나갔을 수 있을 때 쓰는 버튼이라 확인을 한 번 받는다. */
  el('logout-all').addEventListener('click', async function () {
    if (!confirm('이 기기를 포함해 로그인된 모든 기기에서 로그아웃합니다. 계속할까요?')) return;
    this.disabled = true;
    try {
      const res = await fetch('/api/auth/logout-all', { method: 'POST', credentials: 'same-origin' });
      if (!res.ok && res.status !== 401) throw new Error((await res.json().catch(() => ({}))).error || res.status);
      await Session.logout();
      location.href = '/login';
    } catch (e) {
      alert('처리하지 못했습니다: ' + e.message);
      this.disabled = false;
    }
  });

  couponForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    couponBtn.disabled = true;
    try {
      const res = await fetch('/api/coupon/redeem', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: couponInput.value })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '쿠폰을 처리하지 못했습니다.');
      couponResult.textContent = data.message;
      couponResult.classList.remove('bad');
      couponInput.value = '';
      renderCredit(data.credit);
      Session.refresh();   // 다른 화면(AI 도우미 배지·모델 선택)이 읽는 캐시도 새 값으로
    } catch (err) {
      couponResult.textContent = err.message;
      couponResult.classList.add('bad');
    } finally {
      couponResult.hidden = false;
      couponBtn.disabled = false;
    }
  });

  // 로그인 확인이 끝난 뒤에 화면을 고른다. 비로그인에게 빈 폼을 보여주면
  // 채우고 저장한 다음에야 로그인하라는 말을 듣게 된다.
  Session.refresh().then(function (user) {
    if (!user) { el('gate').hidden = false; return; }
    el('panel').hidden = false;
    renderCredit(user.credit);
    load();
  });
})();
