/* 세션 강제 종료 점검.
   서명 쿠키는 서버에 남지 않아서, 강제 종료는 "이 시각 이전에 발급된 쿠키는 거부" 로만 할 수 있다.
   핵심: 끊긴 쿠키는 일반 API·관리자 API 어디서도 다시 통과하지 못한다.
   실행: cd api && node --test */
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

process.env.SESSION_SECRET = 'r'.repeat(48);
process.env.ADMIN_EMAILS = 'boss@example.com';

const azPath = require.resolve('@azure/functions');
const routes = {};
require.cache[azPath] = {
  id: azPath, filename: azPath, loaded: true,
  exports: { app: { http: (name, cfg) => { routes[name] = cfg; } } }
};
require('../src/functions/auth.js');
require('../src/functions/admin.js');

const session = require('../src/lib/session');
const db = require('../src/lib/db');
const { createFake } = require('./fake-container');
const { fake, state } = createFake();
db._setContainer(fake);

const USER = { sub: 'discord:1', name: '학생', email: 'a@b.c', provider: 'discord', role: 'user' };
const ADMIN = { sub: 'google:9', name: '관리자', email: 'boss@example.com', provider: 'google', role: 'admin' };
const cookieOf = (u) => { const c = session.issue(u); return `${c.name}=${encodeURIComponent(c.value)}`; };

const req = ({ cookie = null, body = null } = {}) => ({
  url: 'https://ans2quest.com/api/x',
  params: {},
  headers: { get: (k) => (k.toLowerCase() === 'cookie' ? cookie : null) },
  json: async () => { if (body === null) throw new Error('no body'); return body; }
});
const ctx = { error: () => {}, log: () => {} };
const userDoc = (u) => ({ id: 'user:' + u.sub, pk: u.sub, type: 'user', userSub: u.sub });

// 같은 ms 에 발급·종료가 겹치지 않게 시계를 한 칸 밀어 준다
const tick = () => new Promise((r) => setTimeout(r, 3));

beforeEach(() => { state.docs = [userDoc(USER), userDoc(ADMIN)]; });

test('쿠키에 발급 시각(iat)이 들어간다', () => {
  const c = session.issue(USER);
  const payload = JSON.parse(Buffer.from(c.value.split('.')[0], 'base64url').toString());
  assert.ok(Number.isFinite(payload.iat) && payload.iat <= Date.now());
});

test('강제 종료 전 쿠키는 그대로 통과한다', async () => {
  const user = await session.load(req({ cookie: cookieOf(USER) }));
  assert.strictEqual(user.sub, USER.sub);
});

test('모든 기기에서 로그아웃 → 그 전에 받은 쿠키는 전부 거부된다', async () => {
  const phone = cookieOf(USER);
  const laptop = cookieOf(USER);
  await tick();

  const res = await routes.logoutAll.handler(req({ cookie: laptop }), ctx);
  assert.strictEqual(res.status, 204);
  assert.strictEqual(res.cookies[0].maxAge, 0, '이 브라우저의 쿠키도 지운다');

  assert.strictEqual(await session.load(req({ cookie: phone })), null);
  assert.strictEqual(await session.load(req({ cookie: laptop })), null);
  // 서명·만료만 보는 current() 는 여전히 통과한다 — 그래서 핸들러는 load() 를 써야 한다
  assert.ok(session.current(req({ cookie: phone })));
});

test('강제 종료 뒤 새로 로그인하면 다시 쓸 수 있다', async () => {
  await session.revokeAll(USER.sub);
  await tick();
  const fresh = cookieOf(USER);
  assert.strictEqual((await session.load(req({ cookie: fresh }))).sub, USER.sub);
});

test('끊긴 쿠키로는 /api/me 도 로그아웃 상태다', async () => {
  const old = cookieOf(USER);
  await tick();
  await session.revokeAll(USER.sub);
  const res = await routes.me.handler(req({ cookie: old }), ctx);
  assert.strictEqual(res.status, 401);
});

test('iat 가 없는 옛 쿠키도 강제 종료에 함께 끊긴다', async () => {
  // 이 변경 전에 발급된 쿠키를 흉내 낸다: issue() 가 iat 를 넣으므로 서명을 직접 만든다
  const crypto = require('node:crypto');
  const payload = Buffer.from(JSON.stringify({ ...USER, exp: Math.floor(Date.now() / 1000) + 999 })).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('base64url');
  const legacy = `${session.COOKIE}=${payload}.${sig}`;

  assert.ok(await session.load(req({ cookie: legacy })), '강제 종료 전에는 통과');
  await session.revokeAll(USER.sub);
  assert.strictEqual(await session.load(req({ cookie: legacy })), null);
});

test('끊긴 관리자 쿠키로는 관리자 API 를 못 쓴다', async () => {
  const stolen = cookieOf(ADMIN);
  await tick();
  await session.revokeAll(ADMIN.sub);
  const res = await routes.adminSettings.handler(req({ cookie: stolen }), ctx);
  assert.strictEqual(res.status, 401);
});

test('관리자는 다른 사용자의 세션을 끊을 수 있다', async () => {
  const victim = cookieOf(USER);
  await tick();
  const res = await routes.adminRevokeSessions.handler(req({ cookie: cookieOf(ADMIN), body: { sub: USER.sub } }), ctx);
  assert.ok(!res.status || res.status === 200, String(res.status));
  assert.strictEqual(res.jsonBody.ok, true);
  assert.strictEqual(res.jsonBody.self, false);
  assert.strictEqual(await session.load(req({ cookie: victim })), null);
});

test('일반 사용자는 남의 세션을 못 끊는다', async () => {
  const res = await routes.adminRevokeSessions.handler(req({ cookie: cookieOf(USER), body: { sub: ADMIN.sub } }), ctx);
  assert.strictEqual(res.status, 403);
  assert.ok(!state.docs.find((d) => d.sub === ADMIN.sub && d.sessionsValidAfter));
});

test('이상한 sub 는 문서 경로에 넣지 않는다', async () => {
  for (const sub of ['', 'nope', '../user:google:9', 'google:9/x', 'google:' + 'a'.repeat(200)]) {
    const res = await routes.adminRevokeSessions.handler(req({ cookie: cookieOf(ADMIN), body: { sub } }), ctx);
    assert.strictEqual(res.status, 400, sub);
  }
});

test('DB 를 못 읽으면 일반 요청은 통과, 관리자 요청은 막힌다', async () => {
  const broken = {
    ...fake,
    item: () => ({ read: async () => { const e = new Error('timeout'); e.code = 408; throw e; } })
  };
  db._setContainer(broken);
  try {
    assert.ok(await session.load(req({ cookie: cookieOf(USER) })), '일반 사용자는 로그아웃시키지 않는다');
    const res = await session.requireAdmin(req({ cookie: cookieOf(ADMIN) }));
    assert.strictEqual(res.error.status, 503, '관리자는 확인이 안 되면 막는다');
  } finally {
    db._setContainer(fake);
  }
});
