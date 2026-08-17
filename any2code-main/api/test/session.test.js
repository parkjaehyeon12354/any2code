/* 세션 서명 자체 점검. 인증의 뿌리라 여기가 뚫리면 전부 무너진다.
   실행: cd api && node --test */
const { test } = require('node:test');
const assert = require('node:assert');

process.env.SESSION_SECRET = 'x'.repeat(48);
process.env.ADMIN_EMAILS = 'boss@example.com, Other@Example.com';

const session = require('../src/lib/session');

/** request.headers.get(...) 만 흉내내는 최소 목 */
const req = (cookieHeader) => ({
  headers: { get: (k) => (k.toLowerCase() === 'cookie' ? cookieHeader : null) }
});
const asHeader = (c) => `${c.name}=${encodeURIComponent(c.value)}`;

test('정상 세션은 왕복된다', () => {
  const c = session.issue({ sub: 'google:1', name: '박재현', email: 'boss@example.com', role: 'admin' });
  const user = session.current(req(asHeader(c)));
  assert.strictEqual(user.name, '박재현');
  assert.strictEqual(user.role, 'admin');
});

test('서명이 조작되면 거부된다', () => {
  const c = session.issue({ sub: 'google:1', name: 'a' });
  const [payload, sig] = c.value.split('.');
  const forged = payload + '.' + 'A'.repeat(sig.length);
  assert.strictEqual(session.current(req(`${session.COOKIE}=${forged}`)), null);
});

test('페이로드만 바꾸면 서명이 안 맞아 거부된다 — 권한 상승 차단', () => {
  const c = session.issue({ sub: 'google:1', name: 'a', role: 'user' });
  const [, sig] = c.value.split('.');
  const evil = Buffer.from(JSON.stringify({
    sub: 'google:1', name: 'a', role: 'admin', exp: Math.floor(Date.now() / 1000) + 999
  })).toString('base64url');
  assert.strictEqual(session.current(req(`${session.COOKIE}=${evil}.${sig}`)), null);
});

test('만료된 토큰은 거부된다', () => {
  const crypto = require('node:crypto');
  const payload = Buffer.from(JSON.stringify({ name: 'a', exp: Math.floor(Date.now() / 1000) - 10 }))
    .toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('base64url');
  assert.strictEqual(session.current(req(`${session.COOKIE}=${payload}.${sig}`)), null);
});

test('쿠키가 없거나 형식이 깨져도 던지지 않는다', () => {
  assert.strictEqual(session.current(req(null)), null);
  assert.strictEqual(session.current(req('other=1')), null);
  assert.strictEqual(session.current(req(`${session.COOKIE}=쓰레기`)), null);
});

test('OAuth state 는 발급한 제공자에만 유효하다', () => {
  const { state, cookie } = session.issueState('kakao');
  const r = req(asHeader(cookie));
  assert.strictEqual(session.checkState(r, state, 'kakao'), true);
  assert.strictEqual(session.checkState(r, state, 'github'), false, '제공자 바꿔치기 차단');
  assert.strictEqual(session.checkState(r, 'aaa.bbb', 'kakao'), false, '쿠키와 불일치 차단');
  assert.strictEqual(session.checkState(req(null), state, 'kakao'), false, '쿠키 없으면 차단');
});

test('관리자 판정은 대소문자·공백을 무시한다', () => {
  assert.strictEqual(session.isAdmin('BOSS@example.com'), true);
  assert.strictEqual(session.isAdmin('other@example.com'), true);
  assert.strictEqual(session.isAdmin('nobody@example.com'), false);
  assert.strictEqual(session.isAdmin(null), false, '이메일 없는 계정이 관리자가 되면 안 된다');
});

test('SESSION_SECRET 이 약하면 조용히 넘어가지 않고 실패한다', () => {
  const saved = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'short';
  assert.throws(() => session.issue({ name: 'a' }), /SESSION_SECRET/);
  process.env.SESSION_SECRET = saved;
});
