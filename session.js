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

    /** 서버에 현재 세션을 묻는다. 페이지당 한 번만 실제 요청이 나간다. */
    async refresh() {
      if (inflight) return inflight;
      inflight = (async () => {
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
      return inflight;
    },

    async logout() {
      try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); }
      catch { /* 서버가 없어도 화면 상태는 정리한다 */ }
      verified = null;
      checked = true;
      sessionStorage.removeItem(KEY);
    },

    /** 로그인 시작 — 서버가 state 를 발급하고 제공자로 보낸다 */
    startLogin(provider) {
      window.location.href = '/api/auth/' + encodeURIComponent(provider) + '/start';
    }
  };
})();
