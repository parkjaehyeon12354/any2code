/* 킬 스위치.

   Azure 앱 설정에 LOCKDOWN=1 을 넣으면 모든 API 가 503 을 낸다.
   변수를 지우면 원상복구 — 배포 없이 포털에서 수십 초 안에 켜고 끈다.

   API 엔드포인트로 만들지 않은 이유: 관리자 쿠키가 탈취된 상황을 가정하면,
   스위치만은 공격자 손에 넘어가면 안 된다. 사이트 로그인과 무관한
   Azure 포털(소유자 계정 + MS 2FA)만 조작할 수 있어야 한다.

   정적 페이지는 계속 뜬다 — SWA 정적 호스팅은 환경 변수와 무관하다.
   하지만 로그인·글쓰기·조회·관리자 기능 전부가 이 API 를 거치므로
   실질적으로 사이트가 멈춘다. */
const active = () => /^(1|true|on)$/i.test(process.env.LOCKDOWN || '');

const lockdown = () => active()
  ? { status: 503, jsonBody: { error: '점검 중입니다. 잠시 후 다시 이용해 주세요.' } }
  : null;

module.exports = { lockdown, active };
