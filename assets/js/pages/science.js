  /* 제재 배너 · 소명 — community.html 의 흐름을 그대로 가져왔다.
     AI 도우미는 인젝션 시도 시 영구 정지가 걸리므로 여기서 바로 소명할 수 있어야 한다. */
  (function () {
    const el = (id) => document.getElementById(id);
    const suspended = el('suspended');
    const apModal = el('appeal-modal');
    const apForm = el('appeal-form');
    const apError = el('appeal-error');

    function showSuspension(user) {
      if (!user || !user.suspendedUntil) { suspended.hidden = true; return; }
      /* 영구 제재는 해제일이 없다. until 이 9999-12-31 이라 그대로 찍으면
         "9999-12-31 에 자동 해제됩니다" 가 나온다 — 사용자에게 거짓말이 된다. */
      if (user.suspendedPermanent) {
        el('suspended-title').textContent = '계정이 영구 정지된 상태입니다';
        el('suspended-detail').textContent =
          '사유: ' + (user.suspendedReason || '운영 정책 위반') + ' · 자동으로 해제되지 않습니다. ' +
          '해제를 원하면 소명을 제출해 주세요.';
        suspended.hidden = false;
        return;
      }
      // shortDate 도 session.js 가 const 로 선언한다. 같은 파일에서 오므로 직접 쓴다.
      const when = shortDate(user.suspendedUntil);
      el('suspended-title').textContent = '현재 이용이 제한된 상태입니다';
      el('suspended-detail').textContent =
        '사유: ' + (user.suspendedReason || '운영 정책 위반') + ' · ' + when + '에 자동 해제됩니다.';
      suspended.hidden = false;
    }

    el('ap-text').addEventListener('input', function () {
      el('ap-count').textContent = this.value.length + ' / 2000';
    });

    el('appeal-open').addEventListener('click', function () {
      apError.hidden = true;
      apModal.showModal();
      el('ap-text').focus();
    });

    apModal.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]') || e.target === apModal) apModal.close();
    });

    apForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const submit = el('ap-submit');
      const text = el('ap-text').value.trim();
      if (!text) { el('ap-text').focus(); return; }

      submit.disabled = true;
      submit.textContent = '접수 중…';
      try {
        const res = await fetch('/api/appeals', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // 실패하면 닫지 않는다 — 닫으면 접수된 줄 알고 기다린다
          apError.textContent = data.error || '소명을 접수하지 못했습니다.';
          apError.hidden = false;
          return;
        }
        apModal.close();
        apForm.reset();
        el('ap-count').textContent = '0 / 2000';
        el('suspended-detail').textContent = data.message || '소명이 접수됐습니다. 검토 후 결과를 반영하겠습니다.';
      } catch {
        apError.textContent = '네트워크 오류입니다. 잠시 후 다시 시도해 주세요.';
        apError.hidden = false;
      } finally {
        submit.disabled = false;
        submit.textContent = '접수';
      }
    });

    /* ── AI 크레딧 배지 ──
       llm.js 가 답변을 받은 뒤 window.updateCredit() 을 부른다. 파일이 달라서
       전역 함수 하나로 연결한다 — llm.js 는 배지의 존재를 몰라도 된다. */
    var creditBadge = el('credit-badge');
    var creditNum = el('credit-remaining');

    window.updateCredit = function (c) {
      if (!c || typeof c.remaining !== 'number') return;
      creditBadge.hidden = false;
      if (c.unlimited) {   // 관리자 — 차감하지 않으니 숫자 대신 '무제한'
        creditNum.textContent = '무제한';
        creditBadge.classList.remove('empty', 'low');
        creditBadge.title = '관리자 요금제 · 크레딧을 차감하지 않습니다';
        return;
      }
      creditNum.textContent = c.remaining;
      // 남은 양에 따라 색을 바꾼다. 값은 모델 선택지에 적힌 질문 1번 값(Solar 100,
      // Gemini 300)이다 — 100 미만이면 어느 모델로도 못 묻고, 300 미만이면 Gemini 를 못 쓴다.
      creditBadge.classList.toggle('empty', c.remaining < 100);
      creditBadge.classList.toggle('low', c.remaining >= 100 && c.remaining < 300);

      // 언제 다시 채워지는지 알려준다. 없으면 막연히 기다리게 된다.
      // remaining 은 3시간 몫 + 쿠폰 충전분이라, 충전분이 있으면 나눠 적는다.
      var tip = !c.granted ? ''
        : c.bonus ? '3시간 몫 ' + (c.remaining - c.bonus) + ' / ' + c.granted + ' 남음 · 충전 잔액 ' + c.bonus
        : '전체 ' + c.granted + ' 크레딧 중 ' + c.remaining + ' 남음';
      if (typeof c.resetInMs === 'number' && c.resetInMs > 0) {
        var m = Math.ceil(c.resetInMs / 60000);
        var when = m >= 60 ? Math.floor(m / 60) + '시간 ' + (m % 60) + '분' : m + '분';
        tip += (tip ? ' · ' : '') + when + ' 뒤 충전';
        if (c.remaining <= 0) creditNum.textContent = '0';
      }
      creditBadge.title = tip;
    };

    /* 로그인 상태면 처음부터 잔액을 보여준다. 쓰기 시작한 뒤에야 알면 늦다. */
    function showCredit(user) {
      // 무료(와 비로그인)는 Solar 만 고를 수 있다 — 요금제가 허용한 모델 목록을 넘긴다
      window.setAllowedModels((user && user.credit && user.credit.models) || ['solar']);
      if (!user || !user.authenticated || !user.credit) {
        creditBadge.hidden = true;
        return;
      }
      window.updateCredit(user.credit);
    }
    showCredit(Session.load());
    Session.refresh().then(showCredit);

    /* session.js 는 `const Session = (function(){...})()` 로 선언한다.
       const 는 window 에 붙지 않으므로 window.Session 으로 확인하면 항상 undefined 다.
       (그렇게 썼다가 제재 배너가 통째로 안 떴다. community.html 처럼 직접 참조한다.) */
    showSuspension(Session.load());            // 캐시로 즉시
    Session.refresh().then(showSuspension);    // 서버 확인 후 다시

    /* ── 로그인 안내 ──
       비로그인으로 질문하면 /login 으로 넘기지 않고 이 자리에서 띄운다.
       페이지를 옮기면 쓰던 질문이 날아가고, 로그인 후 다시 찾아와야 한다.

       llm.js 가 401 을 받으면 window.showLoginPrompt() 를 부른다. 서로 다른
       파일이라 전역 함수 하나로 연결한다 — llm.js 는 이 모달의 존재를 몰라도 되고,
       모달이 없는 페이지에서는 그냥 호출이 없다. */
    const loginModal = el('login-modal');
    const loginNote = el('login-note');
    const PENDING_KEY = 'ans2quest:pendingQuestion';

    window.showLoginPrompt = function (question) {
      // 로그인 후 돌아왔을 때 이어서 물어볼 수 있게 질문을 남긴다
      if (question) {
        try { sessionStorage.setItem(PENDING_KEY, question); } catch { /* 저장 실패는 치명적이지 않다 */ }
      }
      loginNote.hidden = true;
      loginModal.showModal();
    };

    loginModal.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]') || e.target === loginModal) loginModal.close();
    });

    loginModal.querySelectorAll('.btn-oauth[data-provider]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const name = btn.dataset.provider;
        btn.disabled = true;
        Session.startLogin(name);

        // 자격증명이 없거나 서버가 응답하지 않으면 이동이 일어나지 않는다.
        // 버튼이 잠긴 채로 남지 않게 되살린다 (login.html 과 같은 처리).
        setTimeout(function () {
          if (!btn.disabled) return;
          btn.disabled = false;
          loginNote.textContent = '로그인 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';
          loginNote.hidden = false;
        }, 4000);
      });
    });

    // 로그인하고 돌아왔다면 쓰던 질문을 입력칸에 되살린다
    try {
      const pending = sessionStorage.getItem(PENDING_KEY);
      if (pending) {
        sessionStorage.removeItem(PENDING_KEY);
        const q = el('q');
        if (q && !q.value) {
          q.value = pending;
          q.focus();
        }
      }
    } catch { /* sessionStorage 를 못 쓰는 환경이면 조용히 넘어간다 */ }
  })();
  
