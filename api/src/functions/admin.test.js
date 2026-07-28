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
require('./admin.js');
require('./posts.js');   // 공개 후 실제로 목록에 뜨는지 함께 확인한다

const session = require('../lib/session');
const db = require('../lib/db');

let docs = [];
const fake = {
  items: {
    create: async (d) => { docs.push(d); return { resource: d }; },
    upsert: async (d) => { docs = docs.filter((x) => x.id !== d.id); docs.push(d); return { resource: d }; },
    query: (spec) => ({
      fetchAll: async () => {
        const p = (n) => (spec.parameters || []).find((x) => x.name === n)?.value;
        let out = docs;
        if (spec.query.includes("c.type = 'post'")) out = out.filter((d) => d.type === 'post');
        if (spec.query.includes("c.type = 'vote'")) out = out.filter((d) => d.type === 'vote');
        if (spec.query.includes("c.status = 'public'")) out = out.filter((d) => d.status === 'public');
        if (spec.query.includes("c.status IN ('held', 'blocked')")) {
          out = out.filter((d) => d.status === 'held' || d.status === 'blocked');
        }
        if (spec.query.includes('c.id = @id')) out = out.filter((d) => d.id === p('@id'));
        if (spec.query.includes('c.userSub = @u')) out = out.filter((d) => d.userSub === p('@u'));
        return { resources: out };
      }
    })
  },
  item: (id, pk) => ({
    read: async () => ({ resource: docs.find((d) => d.id === id && d.pk === pk) || undefined }),
    delete: async () => { docs = docs.filter((d) => d.id !== id); },
    patch: async (ops) => {
      const d = docs.find((x) => x.id === id && x.pk === pk);
      ops.forEach((o) => {
        const key = o.path.slice(1);
        if (o.op === 'incr') d[key] = (d[key] || 0) + o.value;
        if (o.op === 'set') d[key] = o.value;
      });
      return { resource: d };
    }
  })
};
db._setContainer(fake);

const cookieFor = (over) => {
  const c = session.issue({ sub: 'discord:1', name: '박재현', email: 'a@b.c', provider: 'discord', role: 'user', ...over });
  return `${c.name}=${encodeURIComponent(c.value)}`;
};
const asUser = () => cookieFor({});
const asAdmin = () => cookieFor({ sub: 'google:9', email: 'boss@example.com', role: 'admin' });

const req = ({ cookie = null, body = null, params = {} } = {}) => ({
  url: 'https://ans2quest.com/api/admin/held',
  params,
  headers: { get: (k) => (k.toLowerCase() === 'cookie' ? cookie : null) },
  json: async () => { if (body === null) throw new Error('no body'); return body; }
});
const ctx = { error: () => {}, log: () => {} };

/** 욕설이 든 글을 하나 만들어 보류 상태로 넣는다 */
async function seedHeld() {
  docs = [];
  await routes.postsCreate.handler(req({
    cookie: asUser(),
    body: { subject: 'bio', title: '초파리 관찰 질문', body: '초파리 새끼가 며칠 만에 부화하나요?' }
  }), ctx);
  return docs[0];
}

test('두 엔드포인트가 등록된다', () => {
  assert.ok(routes.adminHeld && routes.adminModerate);
  assert.strictEqual(routes.adminModerate.route, 'admin/posts/{id}/moderate');
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
  assert.strictEqual(docs[0].status, 'held', '거부됐는데 상태가 바뀌면 안 된다');
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
  assert.strictEqual(docs[0].moderatedBy, 'boss@example.com');
  assert.ok(Date.parse(docs[0].moderatedAt), '처리 시각이 있어야 나중에 다툼을 가린다');
});

test('차단해도 문서는 지우지 않는다 — 되돌릴 수 있어야 한다', async () => {
  const p = await seedHeld();
  await routes.adminModerate.handler(
    req({ cookie: asAdmin(), body: { action: 'block' }, params: { id: p.id } }), ctx);
  assert.strictEqual(docs.length, 1);
  assert.strictEqual(docs[0].status, 'blocked');

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
