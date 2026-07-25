/* 로그인 세션 — login.html 이 쓰고 Index.html 이 읽는다.
   키 이름을 한 곳에만 두려고 파일로 뺐다.

   ⚠ 이건 "화면 표시용" 상태일 뿐 인증이 아니다.
   sessionStorage 는 사용자가 개발자도구로 얼마든지 고칠 수 있으므로
   권한 판단(관리자 여부, 데이터 접근 허용)에 절대 쓰면 안 된다.
   실제 검증은 서버가 토큰을 확인해서 해야 한다. */
/* HTML 이스케이프 — 구글 프로필 이름·신고 내용 등 외부에서 온 문자열을
   innerHTML 에 넣기 전에 반드시 거친다. nav-user.js 와 admin.html 이 공유. */
const escapeHtml = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const Session = (function () {
  const KEY = 'ans2quest_user';

  // ponytail: 서버 없는 지금 단계의 임시 목록. 관리자 화면 레이아웃을
  // 테스트하려고 이메일로만 구분한다. 백엔드가 생기면 이 배열 전체를
  // 지우고 서버가 내려주는 role 을 그대로 신뢰하도록 바꿀 것.
  const MOCK_ADMIN_EMAILS = ['yuyubao123ascii@gmail.com'];

  return {
    save: function (profile) {
      const withRole = Object.assign({}, profile, {
        role: MOCK_ADMIN_EMAILS.includes(profile.email) ? 'admin' : 'user'
      });
      sessionStorage.setItem(KEY, JSON.stringify(withRole));
    },
    load: function () {
      try {
        return JSON.parse(sessionStorage.getItem(KEY));
      } catch (e) {
        return null;   // 저장값이 깨졌으면 비로그인으로 취급
      }
    },
    clear: function () {
      sessionStorage.removeItem(KEY);
    },
    isAdmin: function () {
      const user = this.load();
      return !!user && user.role === 'admin';
    }
  };
})();
