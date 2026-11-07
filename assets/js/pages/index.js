(function () {
  const button = document.getElementById('free-start');
  if (!button) return;

  const setDestination = (user) => {
    button.href = user && user.authenticated ? '/simulation/' : '/signup';
  };

  // 캐시로 즉시 반영하고 서버 확인 결과로 다시 확정한다.
  setDestination(Session.load());
  Session.refresh().then(setDestination);

  // 서버 확인 전에 눌러도 로그인 사용자를 로그인 화면으로 보내지 않는다.
  button.addEventListener('click', async function (event) {
    if (button.getAttribute('href') === '/simulation/') return;
    event.preventDefault();
    const user = await Session.refresh();
    window.location.href = user && user.authenticated ? '/simulation/' : '/login';
  });
})();
