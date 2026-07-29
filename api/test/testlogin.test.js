/* 검증용 임시 로그인 점검.
   이 기능은 공개 서비스에 열리는 문이라, 꺼져 있을 때 정말 꺼지는지가 핵심이다.
   실행: cd api && node --test */
const { test } = require('node:test');
const assert = require('node:assert');

process.env.SESSION_SECRET = 'w'.repeat(48);
process.env.ADMIN_EMAILS = 'boss@example.com';

const azPath = require.resolve('@azure/functions');
const routes = {};
require.cache[azPath] = {
  id: azPath, filename: azPath, loaded: true,
  exports: { app: { http: (name, cfg) => { routes[name] = cfg; } } }
};
require('../src/functions/testlogin.js');

const req = (body) => ({
  url: 'https://ans2quest.com/api/auth/test-login',
  params: {},
  headers: { get: () => null },
  json: async () => { if (body === undefined) throw new Error('no body'); return body; }
});
const ctx = { error: () => {}, log: () => {} };

const on = (over = {}) => {
  process.env.TEST_LOGIN_EMAIL = over.email || 'boss@example.com';
  process.env.TEST_LOGIN_PASSWORD = over.password || 'a-long-random-password';
};
const off = () => {
  delete process.env.TEST_LOGIN_EMAIL;
  delete process.env.TEST_LOGIN_PASSWORD;
};

test('환경 변수가 없으면 존재 자체가 드러나지 않는다', async () => {
  off();
  const status = await routes.testLoginStatus.handler(req(), ctx);
  const login = await routes.testLogin.handler(
    req({ email: 'boss@example.com', password: 'a-long-random-password' }), ctx);
  assert.strictEqual(status.status, 404);
  assert.strictEqual(login.status, 404, '꺼진 상태에서 인증을 시도조차 하면 안 된다');
  assert.ok(!login.cookies, '꺼졌는데 세션이 나가면 안 된다');
});

test('비밀번호만 있고 이메일이 없으면 켜지지 않는다', async () => {
  off();
  process.env.TEST_LOGIN_PASSWORD = 'a-long-random-password';
  const res = await routes.testLoginStatus.handler(req(), ctx);
  assert.strictEqual(res.status, 404, '둘 다 있어야 켜진다');
  off();
});

test('켜지면 상태를 알려준다', async () => {
  on();
  const res = await routes.testLoginStatus.handler(req(), ctx);
  assert.strictEqual(res.jsonBody.enabled, true);
  assert.strictEqual(res.headers['Cache-Control'], 'no-store');
  off();
});

test('올바른 자격증명이면 관리자 세션이 나온다', async () => {
  on();
  const res = await routes.testLogin.handler(
    req({ email: 'boss@example.com', password: 'a-long-random-password' }), ctx);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.jsonBody.role, 'admin');
  const c = res.cookies[0];
  assert.strictEqual(c.httpOnly, true);
  assert.strictEqual(c.secure, true);
  off();
});

test('ADMIN_EMAILS 에 없는 이메일이면 관리자가 아니다', async () => {
  // 변수를 잘못 켜도 아무나 관리자가 되면 안 된다
  on({ email: 'nobody@example.com' });
  const res = await routes.testLogin.handler(
    req({ email: 'nobody@example.com', password: 'a-long-random-password' }), ctx);
  assert.strictEqual(res.jsonBody.role, 'user');
  off();
});

test('틀린 비밀번호·이메일은 거부하고, 어느 쪽이 틀렸는지 알려주지 않는다', async () => {
  on();
  const wrongPw = await routes.testLogin.handler(
    req({ email: 'boss@example.com', password: 'wrong' }), ctx);
  const wrongEmail = await routes.testLogin.handler(
    req({ email: 'someone@example.com', password: 'a-long-random-password' }), ctx);

  assert.strictEqual(wrongPw.status, 401);
  assert.strictEqual(wrongEmail.status, 401);
  assert.strictEqual(wrongPw.jsonBody.error, wrongEmail.jsonBody.error,
    '메시지가 다르면 이메일 존재 여부가 새어 대입 대상이 좁혀진다');
  assert.ok(!wrongPw.cookies && !wrongEmail.cookies);
  off();
});

test('무차별 대입 — 10회를 넘기면 막는다', async () => {
  on();
  const { _allowed } = require('../src/functions/testlogin.js');
  // 앞선 테스트들이 이미 시도를 쌓아뒀다. 창(10분) 너머로 옮겨 새로 시작한다.
  const base = Date.now() + 60 * 60 * 1000;
  for (let i = 0; i < 10; i++) assert.ok(_allowed(base + i), i + '번째가 막혔다');
  assert.strictEqual(_allowed(base + 10), false);
  // 창이 지나면 다시 허용된다
  assert.ok(_allowed(base + 10 * 60 * 1000 + 1));
  off();
});

test('킬 스위치가 걸리면 이 경로도 막힌다', async () => {
  on();
  process.env.LOCKDOWN = '1';
  try {
    const status = await routes.testLoginStatus.handler(req(), ctx);
    const login = await routes.testLogin.handler(
      req({ email: 'boss@example.com', password: 'a-long-random-password' }), ctx);
    assert.strictEqual(status.status, 503);
    assert.strictEqual(login.status, 503, '잠금 중에 뒷문이 열려 있으면 잠근 의미가 없다');
  } finally {
    delete process.env.LOCKDOWN;
    off();
  }
});
