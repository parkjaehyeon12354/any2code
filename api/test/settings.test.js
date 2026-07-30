/* 운영 설정 점검.
   핵심 둘: (1) 관리자 아닌 사람은 못 읽고 못 바꾼다,
            (2) 저장한 값이 실제로 필터·도배 판정에 먹는다 — 화면만 바뀌면 의미가 없다.
   실행: cd api && node --test */
const { test } = require('node:test');
const assert = require('node:assert');

process.env.SESSION_SECRET = 's'.repeat(48);
process.env.ADMIN_EMAILS = 'boss@example.com';

const azPath = require.resolve('@azure/functions');
const routes = {};
require.cache[azPath] = {
  id: azPath, filename: azPath, loaded: true,
  exports: { app: { http: (name, cfg) => { routes[name] = cfg; } } }
};
require('../src/functions/admin.js');
require('../src/functions/posts.js');

const session = require('../src/lib/session');
const db = require('../src/lib/db');
const settings = require('../src/lib/settings');

const { createFake } = require('./fake-container');
const { fake, state } = createFake();
db._setContainer(fake);

const cookieFor = (over) => {
  const c = session.issue({ sub: 'discord:1', name: '박재현', email: 'a@b.c', provider: 'discord', ...over });
  return `${c.name}=${encodeURIComponent(c.value)}`;
};
const asUser = () => cookieFor({});
const asAdmin = () => cookieFor({ sub: 'google:9', email: 'boss@example.com' });

const req = ({ cookie = null, body = null, params = {} } = {}) => ({
  url: 'https://ans2quest.com/api/moderation/settings',
  params,
  headers: { get: (k) => (k.toLowerCase() === 'cookie' ? cookie : null) },
  json: async () => { if (body === null) throw new Error('no body'); return body; }
});
const ctx = { error: () => {}, log: () => {} };

const save = (body, cookie = asAdmin()) => routes.adminSettingsSave.handler(req({ cookie, body }), ctx);
const load = (cookie = asAdmin()) => routes.adminSettings.handler(req({ cookie }), ctx);

/* 유효한 요청 한 벌. 개별 필드만 바꿔가며 검사에 쓴다 */
const OK = { bannedWords: ['욕1', '욕2'], postWindowMin: 10, postMax: 5 };

test('설정 라우트가 등록되고 admin/ 접두사를 쓰지 않는다', () => {
  assert.strictEqual(routes.adminSettings.route, 'moderation/settings');
  assert.strictEqual(routes.adminSettingsSave.route, 'moderation/settings');
  assert.deepStrictEqual(routes.adminSettings.methods, ['GET']);
  assert.deepStrictEqual(routes.adminSettingsSave.methods, ['PUT']);
});

test('비로그인·일반 사용자는 설정을 읽지도 바꾸지도 못한다', async () => {
  state.docs = [];
  assert.strictEqual((await load(null)).status, 401);
  assert.strictEqual((await save(OK, null)).status, 401);

  const read = await load(asUser());
  assert.strictEqual(read.status, 403);
  assert.ok(!read.jsonBody.editable, '거부 응답에 설정이 섞이면 안 된다');

  assert.strictEqual((await save(OK, asUser())).status, 403);
  assert.strictEqual(state.docs.length, 0, '거부됐는데 저장되면 안 된다');
});

test('설정이 없으면 기본값으로 돈다 — 못 읽었다고 필터가 꺼지면 안 된다', async () => {
  state.docs = [];
  const res = await load();
  assert.deepStrictEqual(res.jsonBody.editable.bannedWords, settings.DEFAULTS.bannedWords);
  assert.strictEqual(res.jsonBody.editable.postMax, settings.DEFAULTS.postMax);
});

test('잘못된 값은 400 이고 아무것도 저장되지 않는다', async () => {
  state.docs = [];
  const bad = [
    { ...OK, bannedWords: '욕1,욕2' },              // 배열이 아니면 조용히 빈 목록으로 접지 않는다
    { ...OK, bannedWords: null },
    { ...OK, postMax: 0 },
    { ...OK, postMax: 101 },
    { ...OK, postMax: 2.5 },
    { ...OK, postMax: 'many' },
    { ...OK, postWindowMin: 0 },
    { ...OK, postWindowMin: 1441 },
    { ...OK, bannedWords: Array.from({ length: 201 }, (_, i) => 'w' + i) },
    { ...OK, bannedWords: ['가'.repeat(31)] }
  ];
  for (const body of bad) {
    const res = await save(body);
    assert.strictEqual(res.status, 400, JSON.stringify(body).slice(0, 60) + ' 가 통과했다');
  }
  assert.strictEqual(state.docs.length, 0);
});

test('저장하면 공백·중복이 정리되고 누가 언제 바꿨는지 남는다', async () => {
  state.docs = [];
  const res = await save({ bannedWords: [' 욕1 ', '욕1', '', '욕2'], postWindowMin: 20, postMax: 3 });
  assert.deepStrictEqual(res.jsonBody.editable.bannedWords, ['욕1', '욕2']);
  assert.strictEqual(res.jsonBody.editable.updatedBy, 'boss@example.com');
  assert.ok(Date.parse(res.jsonBody.editable.updatedAt));

  // 응답이 아니라 다시 읽어서 확인한다 — 저장된 척만 하는 화면이 제일 나쁘다
  const again = await load();
  assert.deepStrictEqual(again.jsonBody.editable.bannedWords, ['욕1', '욕2']);
  assert.strictEqual(again.jsonBody.editable.postWindowMin, 20);
});

test('빈 금칙어 목록은 허용한다 — 필터를 끄는 것도 관리자의 판단', async () => {
  state.docs = [];
  const res = await save({ ...OK, bannedWords: [] });
  assert.strictEqual(res.status, undefined);
  assert.deepStrictEqual(res.jsonBody.editable.bannedWords, []);
});

test('저장한 금칙어가 실제 보류 판정에 먹는다', async () => {
  state.docs = [];
  await save({ bannedWords: ['광합성'], postWindowMin: 10, postMax: 5 });

  // 새 목록에 있는 단어 → 보류
  await routes.postsCreate.handler(req({
    cookie: asUser(), body: { subject: 'bio', title: '질문', body: '광합성이 궁금합니다' }
  }), ctx);
  const held = state.docs.find((d) => d.type === 'post');
  assert.strictEqual(held.status, 'held', '추가한 금칙어가 안 먹으면 설정 화면이 거짓말한다');
  assert.deepStrictEqual(held.heldWords, ['광합성']);

  // 기본 목록에 있었지만 지운 단어 → 통과
  await routes.postsCreate.handler(req({
    cookie: asUser(), body: { subject: 'bio', title: '질문2', body: '초파리 새끼가 부화합니다' }
  }), ctx);
  const now = state.docs.filter((d) => d.type === 'post');
  assert.strictEqual(now[1].status, 'public', '목록에서 뺐는데 계속 걸리면 되돌린 게 아니다');
});

test('저장한 도배 기준이 실제로 적용된다', async () => {
  state.docs = [];
  await save({ bannedWords: [], postWindowMin: 10, postMax: 2 });

  const write = (n) => routes.postsCreate.handler(req({
    cookie: asUser(), body: { subject: 'chem', title: '글' + n, body: '내용' + n }
  }), ctx);

  assert.strictEqual((await write(1)).status, 201);
  assert.strictEqual((await write(2)).status, 201);
  const third = await write(3);
  assert.strictEqual(third.status, 429, 'postMax=2 인데 3개째가 들어갔다');
  assert.ok(third.jsonBody.error.includes('2개'), '안내 문구도 설정값을 따라야 한다');
});

test('환경 변수는 읽기만 된다 — 본문으로 보내도 무시된다', async () => {
  // LOCKDOWN·ADMIN_EMAILS 가 API 로 바뀌면 탈취된 관리자 세션이 마지막 방어선을 뚫는다
  state.docs = [];
  await save({ ...OK, lockdown: true, adminEmails: ['attacker@evil.com'], env: { lockdown: true } });
  assert.strictEqual(process.env.LOCKDOWN, undefined);
  assert.strictEqual(process.env.ADMIN_EMAILS, 'boss@example.com');

  const res = await load();
  assert.strictEqual(res.jsonBody.env.lockdown, false);
  assert.deepStrictEqual(res.jsonBody.env.adminEmails, ['boss@example.com']);
  assert.strictEqual(res.jsonBody.env.sessionDays, 14);
  assert.deepStrictEqual(Object.keys(state.docs[0]).filter((k) => k === 'lockdown' || k === 'adminEmails'), [],
    '설정 문서에 환경 값이 섞여 저장되면 안 된다');
});

test('킬 스위치 — 설정 화면도 예외 없이 503', async () => {
  state.docs = [];
  process.env.LOCKDOWN = '1';
  try {
    assert.strictEqual((await load()).status, 503);
    assert.strictEqual((await save(OK)).status, 503);
    assert.strictEqual(state.docs.length, 0);
  } finally {
    delete process.env.LOCKDOWN;
  }
});
