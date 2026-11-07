// 화면 가드. 서버(/api/me)가 내려준 role 로 판정한다.
// 이건 "관리자가 아닌 사람에게 화면을 안 보여주는" 편의이지 보안 경계가 아니다 —
// 진짜 차단은 각 /api 엔드포인트가 세션 쿠키를 검증해서 한다.
Session.refresh().then(function (user) {
  if (!user || user.role !== 'admin') window.location.replace('/');
});
