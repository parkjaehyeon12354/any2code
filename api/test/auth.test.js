/* auth 엔드포인트 동작 점검.
   Functions 런타임을 통째로 띄우지 않고 @azure/functions 의 app.http 를 가로채
   실제 핸들러를 그대로 호출한다 — 200MB 짜리 Core Tools 없이 로직을 검증한다.
   실행: cd api && node --test */
const { test } = require('node:test');
const assert = require('node:assert');

process.env.SESSION_SECRET = 'y'.repeat(48);
process.env.ADMIN_EMAILS = 'boss@example.com';

// ── @azure/functions 가로채기 (auth.js 를 require 하기 전에 해야 한다) ──
const azPath = require.resolve('@azure/functions');
const routes = {};
require.cache[azPath] = {
  id: azPath, filename: azPath, loaded: true, exports: {
    app: { http: (name, cfg) => { routes[name] = cfg; } }
  }
};
require('../src/functions/auth.js');

const session = require('../src/lib/session');

const mkReq = ({ url = 'https://ans2quest.com/api/x', params = {}, cookie = null, query = '' } = {}) => ({
  url: url + (query ? '?' + query : ''),
  params,
  headers: { get: (k) => (k.toLowerCase() === 'cookie' ? cookie : null) }
});
const ctx = { error: () => {}, log: () => {} };

test('런타임 진입점이 테스트 파일을 끌어들이지 않는다', () => {
  // main 글로브 범위 안에 테스트가 있으면 프로덕션에서 함께 로드된다.
  // 그러면 이 파일 위쪽의 process.env 대입이 실행돼 진짜 SESSION_SECRET 이
  // 'yyyy…' 로 덮이고, 공개된 값이라 관리자 쿠키를 누구나 위조할 수 있다.
  const fs = require('node:fs');
  const path = require('node:path');
  const pkg = require('../package.json');

  const dir = path.dirname(pkg.main);                       // 'src/functions'
  const loaded = fs.readdirSync(path.join(__dirname, '..', dir));
  const tests = loaded.filter((f) => f.includes('.test.'));
  assert.deepStrictEqual(tests, [], `${dir} 안에 테스트 파일이 있다: ${tests.join(', ')}`);

  // src/ 전체에도 두지 않는다 — 로드는 안 되더라도 배포본에 실려 나간다
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
    .flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const strays = walk(path.join(__dirname, '..', 'src')).filter((f) => f.includes('.test.'));
  assert.deepStrictEqual(strays, [], '테스트는 test/ 에 둔다');
});

test('네 엔드포인트가 모두 등록된다', () => {
  assert.deepStrictEqual(Object.keys(routes).sort(), ['authCallback', 'authStart', 'logout', 'me']);
  assert.strictEqual(routes.authStart.route, 'auth/{provider}/start');
  assert.strictEqual(routes.me.methods[0], 'GET');
  assert.strictEqual(routes.logout.methods[0], 'POST');
});

test('알 수 없는 제공자는 404', async () => {
  const res = await routes.authStart.handler(mkReq({ params: { provider: 'naver' } }), ctx);
  assert.strictEqual(res.status, 404);
});

test('자격증명이 없으면 302 로 넘기지 않고 503 을 낸다', async () => {
  delete process.env.KAKAO_CLIENT_ID;
  const res = await routes.authStart.handler(mkReq({ params: { provider: 'kakao' } }), ctx);
  assert.strictEqual(res.status, 503);
  assert.match(res.body, /KAKAO_CLIENT_ID/, '무엇을 등록해야 하는지 알려줘야 한다');
});

test('로그인 시작 — 인가 URL 과 state 쿠키를 함께 낸다', async () => {
  process.env.KAKAO_CLIENT_ID = 'kid';
  process.env.KAKAO_CLIENT_SECRET = 'ksec';
  const res = await routes.authStart.handler(mkReq({ params: { provider: 'kakao' } }), ctx);

  assert.strictEqual(res.status, 302);
  const u = new URL(res.headers.Location);
  assert.strictEqual(u.origin + u.pathname, 'https://kauth.kakao.com/oauth/authorize');
  assert.strictEqual(u.searchParams.get('client_id'), 'kid');
  assert.strictEqual(u.searchParams.get('response_type'), 'code');
  // 콜백 주소는 요청 오리진에서 만들어져야 프리뷰 배포에서도 맞는다
  assert.strictEqual(u.searchParams.get('redirect_uri'), 'https://ans2quest.com/api/auth/kakao/callback');

  const c = res.cookies[0];
  assert.strictEqual(c.httpOnly, true, 'JS 가 읽으면 XSS 로 탈취된다');
  assert.strictEqual(c.secure, true);
  assert.strictEqual(c.sameSite, 'Lax');
  assert.strictEqual(c.value, u.searchParams.get('state'), '쿠키와 URL 의 state 가 같아야 대조가 된다');
});

test('PUBLIC_ORIGIN 이 있으면 콜백 주소는 그걸 쓴다 — 내부 호스트가 새면 안 된다', async () => {
  // SWA 는 Functions 를 <guid>.azurewebsites.net 으로 호출한다. 그 주소가
  // redirect_uri 로 나가면 제공자가 등록된 주소와 다르다며 로그인을 거부한다.
  process.env.PUBLIC_ORIGIN = 'https://ans2quest.kr/';   // 뒤 슬래시도 흘려보내면 안 된다
  try {
    const res = await routes.authStart.handler(
      mkReq({ url: 'https://abc123.azurewebsites.net/api/x', params: { provider: 'kakao' } }), ctx);
    const uri = new URL(res.headers.Location).searchParams.get('redirect_uri');
    assert.strictEqual(uri, 'https://ans2quest.kr/api/auth/kakao/callback');
    assert.ok(!uri.includes('azurewebsites.net'), '내부 호스트가 제공자에게 노출됐다');
  } finally {
    delete process.env.PUBLIC_ORIGIN;
  }
});

test('콜백 — state 가 없거나 어긋나면 교환을 시도조차 하지 않는다', async () => {
  const bad = await routes.authCallback.handler(
    mkReq({ params: { provider: 'kakao' }, query: 'code=abc&state=위조' }), ctx);
  assert.strictEqual(bad.status, 302);
  assert.match(bad.headers.Location, /error=bad_state/);
});

test('콜백 — 제공자가 발급한 state 를 다른 제공자 콜백에 쓰면 거부된다', async () => {
  const { state, cookie } = session.issueState('kakao');
  const res = await routes.authCallback.handler(
    mkReq({ params: { provider: 'github' }, cookie: `${cookie.name}=${cookie.value}`, query: `code=abc&state=${state}` }), ctx);
  assert.match(res.headers.Location, /error=bad_state/);
});

test('콜백 — 사용자가 동의를 거부하면 cancelled 로 돌아간다', async () => {
  const res = await routes.authCallback.handler(
    mkReq({ params: { provider: 'kakao' }, query: 'error=access_denied' }), ctx);
  assert.match(res.headers.Location, /error=cancelled/);
});

test('/api/me — 쿠키 없으면 401, 위조 쿠키도 401', async () => {
  const anon = await routes.me.handler(mkReq({}), ctx);
  assert.strictEqual(anon.status, 401);
  assert.strictEqual(anon.jsonBody.authenticated, false);

  const forged = await routes.me.handler(
    mkReq({ cookie: `${session.COOKIE}=eyJyb2xlIjoiYWRtaW4ifQ.fakesig` }), ctx);
  assert.strictEqual(forged.status, 401, '서명 없는 admin 주장은 통하면 안 된다');
});

test('/api/me — 정상 세션은 role 을 그대로 돌려준다', async () => {
  const c = session.issue({ sub: 'kakao:1', name: '박재현', email: 'boss@example.com', provider: 'kakao', role: 'admin' });
  const res = await routes.me.handler(mkReq({ cookie: `${c.name}=${encodeURIComponent(c.value)}` }), ctx);
  assert.strictEqual(res.jsonBody.authenticated, true);
  assert.strictEqual(res.jsonBody.role, 'admin');
  assert.strictEqual(res.headers['Cache-Control'], 'no-store', '세션 응답이 캐시되면 안 된다');
});

test('킬 스위치 — 로그인 경로는 막히고 로그아웃은 살아있다', async () => {
  process.env.KAKAO_CLIENT_ID = 'kid';
  process.env.KAKAO_CLIENT_SECRET = 'ksec';
  process.env.LOCKDOWN = '1';
  try {
    const start = await routes.authStart.handler(mkReq({ params: { provider: 'kakao' } }), ctx);
    const me = await routes.me.handler(mkReq({}), ctx);
    assert.strictEqual(start.status, 503, '잠금 중 새 로그인은 막아야 한다');
    assert.strictEqual(me.status, 503);
    // 자기 세션을 끊는 것만은 언제나 허용된다
    const out = await routes.logout.handler(mkReq({}), ctx);
    assert.strictEqual(out.status, 204);
  } finally {
    delete process.env.LOCKDOWN;
  }
});

test('로그아웃 — 쿠키를 즉시 만료시킨다', async () => {
  const res = await routes.logout.handler(mkReq({}), ctx);
  assert.strictEqual(res.status, 204);
  assert.strictEqual(res.cookies[0].maxAge, 0);
  assert.strictEqual(res.cookies[0].name, session.COOKIE);
});
