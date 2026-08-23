/* 로그인 세션 — 서버(/api/me)가 유일한 근거.

   설계:
   - 서버가 확인해 준 사용자는 모듈 스코프 변수(verified)에만 둔다.
     sessionStorage 는 "첫 화면을 즉시 그리기 위한 캐시"일 뿐이다.
   - load() 는 서버 확인이 끝나면 verified 만 본다 → 개발자도구로
     sessionStorage 를 고쳐도 그 순간 무효가 된다.
   - 애초에 진짜 차단은 /api 엔드포인트가 httpOnly 세션 쿠키를 검증해서 한다.
     여기 값을 아무리 바꿔도 API 는 데이터를 내주지 않는다. */
const escapeHtml = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ── 날짜 표시 ──
   서버는 전부 UTC ISO 문자열로 준다. 그걸 자르면(slice(0, 10)) UTC 날짜가 나오는데,
   한국은 UTC+9 라 아침 9시 전에 한 일이 전날로 찍힌다. 그래서 항상 Date 로 파싱해
   보는 사람의 기기 시계(로컬 시간대) 기준으로 그린다.

   화면마다 따로 만들던 것을 여기 모았다 — admin 은 UTC, settings 는 로컬, community 는
   'ko-KR'(2026. 7. 30.) 로 셋이 갈려 있었다. */
const pad2 = (n) => String(n).padStart(2, '0');

/** 2026-07-30. ISO 문자열도 Date 객체도 받는다. 값이 없거나 이상하면 '—'. */
const shortDate = (v) => {
  if (!v) return '—';
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? '—' : d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
};

/** 2026-07-30 22:15. 같은 날 여러 건이 쌓이는 곳(설정 변경 이력 등)에만 쓴다. */
const shortWhen = (v) => {
  if (!v) return '—';
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? '—' : shortDate(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
};

const Session = (function () {
  const KEY = 'ans2quest_user';   // 표시용 캐시. 권한 근거가 아니다.
  let verified = null;            // 서버가 확인해 준 사용자
  let checked = false;            // 서버에 한 번이라도 물어봤는지
  let inflight = null;

  const readCache = () => {
    try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; }
  };

  return {
    /** 화면 표시용 사용자. 서버 확인 전에는 캐시로 즉시 그린다. */
    load() { return checked ? verified : readCache(); },

    /** 서버에 현재 세션을 묻는다. 동시에 여러 번 불러도 요청은 하나로 합쳐진다.
        요청이 끝나면 inflight 를 비우므로, 나중에 다시 부르면 다시 물어본다 —
        비우지 않으면 페이지가 살아있는 동안 재확인할 방법이 없어서, 설정에서 이름을
        바꾼 뒤에도 상단바가 로드 시점의 옛 이름을 계속 들고 있었다. */
    async refresh() {
      if (inflight) return inflight;
      const p = (async () => {
        let user = null;
        try {
          const res = await fetch('/api/me', { credentials: 'same-origin' });
          if (res.ok) {
            const me = await res.json();
            if (me.authenticated) user = me;
          }
        } catch {
          // 네트워크 실패 = 확인 불가. 캐시를 믿지 않고 비로그인으로 취급한다.
          user = null;
        }
        verified = user;
        checked = true;
        if (user) sessionStorage.setItem(KEY, JSON.stringify(user));
        else sessionStorage.removeItem(KEY);
        return user;
      })();
      inflight = p;
      // 자기 것만 비운다 — 그 사이 새 요청이 시작됐으면 그건 남겨둬야 한다
      p.finally(() => { if (inflight === p) inflight = null; });
      return p;
    },

    async logout() {
      try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); }
      catch { /* 서버가 없어도 화면 상태는 정리한다 */ }
      verified = null;
      checked = true;
      sessionStorage.removeItem(KEY);
    },

    /** 로그인 시작 — 서버가 state 를 발급하고 제공자로 보낸다.
        지금 보던 화면을 함께 넘겨, 로그인 후 그 자리로 돌아오게 한다.
        (예전에는 무조건 '/' 로 보내서, /science 에서 로그인하면 메인으로 튕겼다) */
    startLogin(provider, to) {
      var back = to || (window.location.pathname + window.location.search);
      window.location.href = '/api/auth/' + encodeURIComponent(provider) + '/start'
        + '?to=' + encodeURIComponent(back);
    }
  };
})();
