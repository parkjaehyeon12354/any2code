/* 관리자 엔드포인트 점검.
   핵심은 "관리자가 아닌 사람은 어떤 경로로도 데이터를 못 본다" 이다.
   실행: cd api && node --test */
const { test } = require('node:test');
const assert = require('node:assert');

process.env.SESSION_SECRET = 'q'.repeat(48);
process.env.ADMIN_EMAILS = 'boss@example.com';

const azPath = require.resolve('@azure/functions');
const routes = {};
require.cache[azPath] = {
  id: azPath, filename: azPath, loaded: true,
  exports: { app: { http: (name, cfg) => { routes[name] = cfg; } } }
};
require('../src/functions/admin.js');
require('../src/functions/posts.js');   // 댓글·공개 후 실제로 목록에 뜨는지 함께 확인한다

const session = require('../src/lib/session');
const db = require('../src/lib/db');

const { createFake } = require('./fake-container');
const { fake, state } = createFake();
db._setContainer(fake);

const cookieFor = (over) => {
  const c = session.issue({ sub: 'discord:1', name: '박재현', email: 'a@b.c', provider: 'discord', role: 'user', ...over });
  return `${c.name}=${encodeURIComponent(c.value)}`;
};
const asUser = () => cookieFor({});
const asAdmin = () => cookieFor({ sub: 'google:9', email: 'boss@example.com', role: 'admin' });

const req = ({ cookie = null, body = null, params = {} } = {}) => ({
  url: 'https://ans2quest.com/api/moderation/held',
  params,
  headers: { get: (k) => (k.toLowerCase() === 'cookie' ? cookie : null) },
  json: async () => { if (body === null) throw new Error('no body'); return body; }
});
const ctx = { error: () => {}, log: () => {} };

/** 욕설이 든 글을 하나 만들어 보류 상태로 넣는다 */
async function seedHeld() {
  state.docs = [];
  await routes.postsCreate.handler(req({
    cookie: asUser(),
    body: { subject: 'bio', title: '초파리 관찰 질문', body: '초파리 새끼가 며칠 만에 부화하나요?' }
  }), ctx);
  return state.docs[0];
}

test('두 엔드포인트가 등록된다', () => {
  assert.ok(routes.adminHeld && routes.adminModerate);
  assert.strictEqual(routes.adminHeld.route, 'moderation/held');
  assert.strictEqual(routes.adminModerate.route, 'moderation/posts/{id}/moderate');
});

test("라우트가 'admin/' 으로 시작하지 않는다 — Functions 예약 접두사", () => {
  // Azure Functions 런타임이 자기 관리 API 용으로 admin/ 을 예약했다.
  // 그 접두사를 쓰면 등록이 조용히 거부된다 — 파일은 로드되는데 라우트만
  // 사라지고 로그에도 안 남아서, 배포 후 404 를 보고서야 알게 된다.
  const bad = Object.entries(routes).filter(([, c]) => /^admin(\/|$)/.test(c.route || ''));
  assert.deepStrictEqual(bad.map(([n]) => n), [], "'admin/' 접두사는 프로덕션에서 404 가 된다");
});

test('비로그인은 보류 목록을 못 본다', async () => {
  const res = await routes.adminHeld.handler(req({}), ctx);
  assert.strictEqual(res.status, 401);
});

test('일반 사용자는 403 — 화면 코드를 고쳐도 데이터가 안 나간다', async () => {
  const res = await routes.adminHeld.handler(req({ cookie: asUser() }), ctx);
  assert.strictEqual(res.status, 403);
  assert.ok(!res.jsonBody.posts, '거부 응답에 데이터가 섞이면 안 된다');
});

test('쿠키 role 이 admin 이어도 ADMIN_EMAILS 에 없으면 403 — 해임 즉시 반영', async () => {
  // 로그인 당시엔 관리자였지만 이후 목록에서 빠진 경우. 쿠키는 14일 살아있으므로
  // 쿠키의 role 을 믿으면 해임이 만료일까지 늦어진다.
  const fired = cookieFor({ sub: 'google:2', email: 'former@example.com', role: 'admin' });
  const res = await routes.adminHeld.handler(req({ cookie: fired }), ctx);
  assert.strictEqual(res.status, 403);
});

test('서명 없는 admin 주장은 통하지 않는다', async () => {
  const forged = 'a2q_session=' + encodeURIComponent(JSON.stringify({ role: 'admin' })) + '.fakesig';
  const res = await routes.adminHeld.handler(req({ cookie: forged }), ctx);
  assert.strictEqual(res.status, 401);
});

test('일반 사용자는 보류 처리도 못 한다', async () => {
  const p = await seedHeld();
  const res = await routes.adminModerate.handler(
    req({ cookie: asUser(), body: { action: 'publish' }, params: { id: p.id } }), ctx);
  assert.strictEqual(res.status, 403);
  assert.strictEqual(state.docs[0].status, 'held', '거부됐는데 상태가 바뀌면 안 된다');
});

test('관리자는 보류 목록과 감지어를 함께 본다', async () => {
  const p = await seedHeld();
  const res = await routes.adminHeld.handler(req({ cookie: asAdmin() }), ctx);
  assert.strictEqual(res.jsonBody.posts.length, 1);
  assert.strictEqual(res.jsonBody.posts[0].id, p.id);
  assert.deepStrictEqual(res.jsonBody.posts[0].words, ['새끼'], '왜 걸렸는지 알아야 판단할 수 있다');
  assert.ok(res.jsonBody.posts[0].text.includes('초파리'), '전문을 봐야 오탐인지 안다');
});

test('오탐 공개 — 처리 후 실제 목록에 나타난다', async () => {
  const p = await seedHeld();

  const before = await routes.postsList.handler(req({}), ctx);
  assert.strictEqual(before.jsonBody.posts.length, 0, '보류 중에는 안 보여야 한다');

  const res = await routes.adminModerate.handler(
    req({ cookie: asAdmin(), body: { action: 'publish' }, params: { id: p.id } }), ctx);
  assert.strictEqual(res.jsonBody.status, 'public');

  const after = await routes.postsList.handler(req({}), ctx);
  assert.strictEqual(after.jsonBody.posts.length, 1, '공개했는데 목록에 안 뜨면 처리한 의미가 없다');
});

test('누가 언제 처리했는지 남는다', async () => {
  const p = await seedHeld();
  await routes.adminModerate.handler(
    req({ cookie: asAdmin(), body: { action: 'publish' }, params: { id: p.id } }), ctx);
  assert.strictEqual(state.docs[0].moderatedBy, 'boss@example.com');
  assert.ok(Date.parse(state.docs[0].moderatedAt), '처리 시각이 있어야 나중에 다툼을 가린다');
});

test('차단해도 문서는 지우지 않는다 — 되돌릴 수 있어야 한다', async () => {
  const p = await seedHeld();
  await routes.adminModerate.handler(
    req({ cookie: asAdmin(), body: { action: 'block' }, params: { id: p.id } }), ctx);
  assert.strictEqual(state.docs.length, 1);
  assert.strictEqual(state.docs[0].status, 'blocked');

  const back = await routes.adminModerate.handler(
    req({ cookie: asAdmin(), body: { action: 'hold' }, params: { id: p.id } }), ctx);
  assert.strictEqual(back.jsonBody.status, 'held');
});

test('차단된 글은 공개 목록에 안 나오고 관리자 목록에는 남는다', async () => {
  const p = await seedHeld();
  await routes.adminModerate.handler(
    req({ cookie: asAdmin(), body: { action: 'block' }, params: { id: p.id } }), ctx);

  const pub = await routes.postsList.handler(req({}), ctx);
  assert.strictEqual(pub.jsonBody.posts.length, 0);

  const adm = await routes.adminHeld.handler(req({ cookie: asAdmin() }), ctx);
  assert.strictEqual(adm.jsonBody.posts.length, 1, '차단 후 화면에서 사라지면 되돌릴 수 없다');
});

test('킬 스위치 — 관리자도 예외 없이 503', async () => {
  // 잠그는 상황은 보통 "관리자 계정이 이상하다" 일 때다. 관리자를 예외로 두면
  // 탈취된 관리자 세션이 잠금을 뚫고 계속 활동한다.
  const p = await seedHeld();
  process.env.LOCKDOWN = '1';
  try {
    const list = await routes.adminHeld.handler(req({ cookie: asAdmin() }), ctx);
    const act = await routes.adminModerate.handler(
      req({ cookie: asAdmin(), body: { action: 'publish' }, params: { id: p.id } }), ctx);
    assert.deepStrictEqual([list.status, act.status], [503, 503]);
    assert.strictEqual(state.docs[0].status, 'held', '잠금 중에 상태가 바뀌면 안 된다');
  } finally {
    delete process.env.LOCKDOWN;
  }
});

test('알 수 없는 처리와 없는 글은 거부한다', async () => {
  const p = await seedHeld();
  for (const action of ['delete', '', 'DROP TABLE', undefined]) {
    const res = await routes.adminModerate.handler(
      req({ cookie: asAdmin(), body: { action }, params: { id: p.id } }), ctx);
    assert.strictEqual(res.status, 400, `action=${action} 이 통과했다`);
  }

  const missing = await routes.adminModerate.handler(
    req({ cookie: asAdmin(), body: { action: 'publish' }, params: { id: '없음' } }), ctx);
  assert.strictEqual(missing.status, 404);
});

test('보류된 댓글도 관리자 목록에 뜨고, 공개하면 답변 수가 오른다', async () => {
  // 같은 필터에 같은 오탐이 난다. 글만 되살릴 수 있으면 댓글 오탐은 영영 묻힌다.
  state.docs = [];
  await routes.postsCreate.handler(req({
    cookie: asUser(),
    body: { subject: 'physics', title: '단진자 질문', body: '주기가 짧게 나옵니다.' }
  }), ctx);
  const post = state.docs.find((d) => d.type === 'post');

  await routes.commentsCreate.handler(req({
    cookie: asUser(), body: { body: '초파리 새끼 이야기라 걸립니다' }, params: { id: post.id }
  }), ctx);
  const comment = state.docs.find((d) => d.type === 'comment');
  assert.strictEqual(comment.status, 'held');
  assert.strictEqual(post.answers, 0, '보류 중인 답변은 세지 않는다');

  const list = await routes.adminHeld.handler(req({ cookie: asAdmin() }), ctx);
  const row = list.jsonBody.posts.find((x) => x.id === comment.id);
  assert.ok(row, '보류된 댓글이 목록에 없다 — 되살릴 방법이 없어진다');
  assert.strictEqual(row.kind, 'comment');
  assert.deepStrictEqual(row.words, ['새끼']);

  // 공개하면 답변 수가 따라 올라야 한다
  await routes.adminModerate.handler(req({
    cookie: asAdmin(), body: { action: 'publish' }, params: { id: comment.id }
  }), ctx);
  assert.strictEqual(comment.status, 'public');
  assert.strictEqual(post.answers, 1, '공개했는데 답변 0 이면 목록이 거짓말을 한다');

  // 다시 차단하면 되돌아간다
  await routes.adminModerate.handler(req({
    cookie: asAdmin(), body: { action: 'block' }, params: { id: comment.id }
  }), ctx);
  assert.strictEqual(post.answers, 0);
});
