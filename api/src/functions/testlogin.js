/* 임시 이메일 로그인 — 검증용.

   ⚠ 이 파일은 검증이 끝나면 통째로 지운다. 지우는 걸 잊어도 안전하도록,
   환경 변수가 없으면 라우트가 404 를 내고 로그인 폼도 화면에 안 뜬다.
   즉 "끄는 것" 은 Azure 앱 설정에서 TEST_LOGIN_PASSWORD 를 지우는 것 하나뿐이다.

   필요한 환경 변수 (둘 다 있어야 켜진다):
     TEST_LOGIN_EMAIL     이 이메일로 로그인한다. ADMIN_EMAILS 에 있으면 관리자가 된다
     TEST_LOGIN_PASSWORD  무작위 값을 쓸 것. 추측 가능한 값이면 공개 서비스가 그대로 뚫린다

   OAuth 를 못 쓰는 자동화 도구가 관리자 API 를 검증할 때만 쓴다. */
const { app } = require('@azure/functions');
const crypto = require('node:crypto');
const session = require('../lib/session');
const { lockdown } = require('../lib/lockdown');

const config = () => {
  const email = process.env.TEST_LOGIN_EMAIL;
  const password = process.env.TEST_LOGIN_PASSWORD;
  return email && password ? { email, password } : null;
};

/* 길이가 달라도 시간차가 안 나도록 해시를 비교한다.
   === 나 timingSafeEqual 직접 비교는 길이에서 정보가 샌다. */
const sameSecret = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

/* 무차별 대입 방지. 계정이 하나뿐이라 전역 카운터로 충분하다.
   인스턴스가 재시작하면 초기화되는데, 그 사이 시도 횟수도 초기화된다 —
   기능 자체가 임시라 여기까지가 적정선이다. */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_TRIES = 10;
let tries = [];
function allowed(now = Date.now()) {
  tries = tries.filter((t) => now - t < WINDOW_MS);
  if (tries.length >= MAX_TRIES) return false;
  tries.push(now);
  return true;
}

/* 화면이 폼을 띄울지 판단하려면 켜져 있는지 알아야 한다.
   꺼져 있으면 404 — 이 기능의 존재 자체가 드러나지 않는다. */
app.http('testLoginStatus', {
  route: 'auth/test-login',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async () => {
    const locked = lockdown(); if (locked) return locked;
    if (!config()) return { status: 404, jsonBody: { enabled: false } };
    return { jsonBody: { enabled: true }, headers: { 'Cache-Control': 'no-store' } };
  }
});

app.http('testLogin', {
  route: 'auth/test-login',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;

    const cfg = config();
    if (!cfg) return { status: 404, jsonBody: { error: '사용할 수 없습니다.' } };

    if (!allowed()) {
      return { status: 429, jsonBody: { error: '시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.' } };
    }

    let body;
    try { body = await request.json(); } catch { body = {}; }

    const okEmail = sameSecret(String(body.email || '').trim().toLowerCase(), cfg.email.trim().toLowerCase());
    const okPassword = sameSecret(String(body.password || ''), cfg.password);
    // 어느 쪽이 틀렸는지 알려주지 않는다 — 이메일 존재 여부가 새면 대입 대상이 좁혀진다
    if (!okEmail || !okPassword) {
      context.error('test-login 실패');
      return { status: 401, jsonBody: { error: '이메일 또는 비밀번호가 올바르지 않습니다.' } };
    }

    const user = {
      sub: 'test:' + cfg.email,
      name: '테스트 관리자',
      email: cfg.email,
      picture: null,
      provider: 'test',
      // 관리자 여부는 여기서도 ADMIN_EMAILS 로만 정한다. 이 경로로 들어왔다고
      // 무조건 관리자를 주면, 변수를 잘못 켜는 순간 아무나 관리자가 된다.
      role: session.isAdmin(cfg.email) ? 'admin' : 'user'
    };

    return { status: 200, jsonBody: { ok: true, role: user.role }, cookies: [session.issue(user)] };
  }
});

module.exports = { _allowed: allowed, _sameSecret: sameSecret };
