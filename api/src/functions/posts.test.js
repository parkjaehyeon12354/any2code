/* posts 엔드포인트 점검.
   Cosmos 를 띄우지 않고 컨테이너를 메모리 가짜로 갈아끼운다.
   실행: cd api && node --test */
const { test } = require('node:test');
const assert = require('node:assert');

process.env.SESSION_SECRET = 'z'.repeat(48);
process.env.ADMIN_EMAILS = 'boss@example.com';

const azPath = require.resolve('@azure/functions');
const routes = {};
require.cache[azPath] = {
  id: azPath, filename: azPath, loaded: true,
  exports: { app: { http: (name, cfg) => { routes[name] = cfg; } } }
};
require('./posts.js');

const session = require('../lib/session');
const db = require('../lib/db');

// ── 메모리 가짜 컨테이너 ──
let docs = [];
const fake = {
  items: {
    create: async (d) => { docs.push(d); return { resource: d }; },
    upsert: async (d) => {
      docs = docs.filter((x) => x.id !== d.id);
      docs.push(d);
      return { resource: d };
    },
    query: (spec) => ({
      fetchAll: async () => {
        const p = (n) => (spec.parameters || []).find((x) => x.name === n)?.value;
        let out = docs;
        if (spec.query.includes("c.type = 'post'")) out = out.filter((d) => d.type === 'post');
        if (spec.query.includes("c.type = 'vote'")) out = out.filter((d) => d.type === 'vote');
        if (spec.query.includes("c.status = 'public'")) out = out.filter((d) => d.status === 'public');
        if (spec.query.includes('c.pk = @s')) out = out.filter((d) => d.pk === p('@s'));
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
        if (o.op === 'incr') d[o.path.slice(1)] = (d[o.path.slice(1)] || 0) + o.value;
      });
      return { resource: d };
    }
  })
};
db._setContainer(fake);

const login = (over = {}) => {
  const c = session.issue({ sub: 'discord:1', name: '박재현', email: 'a@b.c', provider: 'discord', role: 'user', ...over });
  return `${c.name}=${encodeURIComponent(c.value)}`;
};

const req = ({ cookie = null, body = null, params = {}, qs = '' } = {}) => ({
  url: 'https://ans2quest.com/api/posts' + (qs ? '?' + qs : ''),
  params,
  headers: { get: (k) => (k.toLowerCase() === 'cookie' ? cookie : null) },
  json: async () => { if (body === null) throw new Error('no body'); return body; }
});
const ctx = { error: () => {}, log: () => {} };

const okPost = { subject: 'physics', title: '단진자 주기 질문', body: '측정값이 계속 짧게 나옵니다.' };

test('세 엔드포인트가 등록된다', () => {
  assert.deepStrictEqual(Object.keys(routes).sort(), ['postsCreate', 'postsList', 'postsVote']);
  assert.strictEqual(routes.postsVote.route, 'posts/{id}/vote');
});

test('비로그인은 글을 쓸 수 없다', async () => {
  const res = await routes.postsCreate.handler(req({ body: okPost }), ctx);
  assert.strictEqual(res.status, 401);
});

test('목록은 비로그인도 읽을 수 있다', async () => {
  const res = await routes.postsList.handler(req({}), ctx);
  assert.ok(Array.isArray(res.jsonBody.posts));
  assert.deepStrictEqual(res.jsonBody.votes, {});
});

test('과목은 정해진 목록만 받는다 — 파티션 키 오염 차단', async () => {
  for (const subject of ['', 'hacked', '../etc', 'PHYSICS']) {
    const res = await routes.postsCreate.handler(
      req({ cookie: login(), body: { ...okPost, subject } }), ctx);
    assert.strictEqual(res.status, 400, `${subject} 가 통과했다`);
  }
});

test('빈 제목·빈 내용·길이 초과는 거부한다', async () => {
  const cases = [
    { ...okPost, title: '   ' },
    { ...okPost, body: '' },
    { ...okPost, title: 'ㄱ'.repeat(121) },
    { ...okPost, body: 'ㄱ'.repeat(4001) }
  ];
  for (const body of cases) {
    const res = await routes.postsCreate.handler(req({ cookie: login(), body }), ctx);
    assert.strictEqual(res.status, 400);
  }
});

test('정상 글은 저장되고 목록에 나온다', async () => {
  docs = [];
  const res = await routes.postsCreate.handler(req({ cookie: login(), body: okPost }), ctx);
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.jsonBody.held, false);

  const list = await routes.postsList.handler(req({}), ctx);
  assert.strictEqual(list.jsonBody.posts.length, 1);
  assert.strictEqual(list.jsonBody.posts[0].title, okPost.title);
});

test('작성자 식별자는 목록에 노출되지 않는다', async () => {
  docs = [];
  await routes.postsCreate.handler(req({ cookie: login(), body: okPost }), ctx);
  const list = await routes.postsList.handler(req({}), ctx);
  const json = JSON.stringify(list.jsonBody);
  assert.ok(!json.includes('discord:1'), 'authorSub 가 새어나갔다');
  assert.ok(!json.includes('authorSub'));
});

test('욕설이 있으면 보류되고 목록에서 빠진다', async () => {
  docs = [];
  const res = await routes.postsCreate.handler(
    req({ cookie: login(), body: { ...okPost, body: '이 병신 같은 실험' } }), ctx);
  assert.strictEqual(res.jsonBody.held, true);
  assert.ok(res.jsonBody.message, '왜 안 보이는지 알려줘야 한다');

  const list = await routes.postsList.handler(req({}), ctx);
  assert.strictEqual(list.jsonBody.posts.length, 0);
  assert.strictEqual(docs[0].status, 'held', '삭제가 아니라 보류여야 사람이 되살릴 수 있다');
});

test('과목 필터가 동작한다', async () => {
  docs = [];
  await routes.postsCreate.handler(req({ cookie: login(), body: okPost }), ctx);
  await routes.postsCreate.handler(req({ cookie: login(), body: { ...okPost, subject: 'chem' } }), ctx);

  const phys = await routes.postsList.handler(req({ qs: 'channel=physics' }), ctx);
  assert.strictEqual(phys.jsonBody.posts.length, 1);
  assert.strictEqual(phys.jsonBody.posts[0].subject, 'physics');
});

test('투표 — 비로그인 401, 잘못된 방향 400', async () => {
  const anon = await routes.postsVote.handler(req({ body: { dir: 1 }, params: { id: 'x' } }), ctx);
  assert.strictEqual(anon.status, 401);

  for (const dir of [0, 2, -5, 'up', null]) {
    const res = await routes.postsVote.handler(
      req({ cookie: login(), body: { dir }, params: { id: 'x' } }), ctx);
    assert.strictEqual(res.status, 400, `dir=${dir} 가 통과했다`);
  }
});

test('투표 — 누르고, 다시 누르면 취소되고, 점수가 맞게 움직인다', async () => {
  docs = [];
  await routes.postsCreate.handler(req({ cookie: login(), body: okPost }), ctx);
  const id = docs[0].id;
  const cookie = login();

  const up = await routes.postsVote.handler(req({ cookie, body: { dir: 1 }, params: { id } }), ctx);
  assert.deepStrictEqual([up.jsonBody.dir, up.jsonBody.score], [1, 1]);

  const again = await routes.postsVote.handler(req({ cookie, body: { dir: 1 }, params: { id } }), ctx);
  assert.deepStrictEqual([again.jsonBody.dir, again.jsonBody.score], [0, 0], '같은 방향 재클릭은 취소');

  const down = await routes.postsVote.handler(req({ cookie, body: { dir: -1 }, params: { id } }), ctx);
  assert.deepStrictEqual([down.jsonBody.dir, down.jsonBody.score], [-1, -1]);
});

test('한 사람이 여러 번 눌러도 표는 하나만 남는다', async () => {
  docs = [];
  await routes.postsCreate.handler(req({ cookie: login(), body: okPost }), ctx);
  const id = docs[0].id;
  const cookie = login();

  await routes.postsVote.handler(req({ cookie, body: { dir: 1 }, params: { id } }), ctx);
  await routes.postsVote.handler(req({ cookie, body: { dir: -1 }, params: { id } }), ctx);
  await routes.postsVote.handler(req({ cookie, body: { dir: -1 }, params: { id } }), ctx);
  await routes.postsVote.handler(req({ cookie, body: { dir: 1 }, params: { id } }), ctx);

  const votes = docs.filter((d) => d.type === 'vote');
  assert.strictEqual(votes.length, 1, '투표가 중복 저장되면 점수를 부풀릴 수 있다');
  assert.strictEqual(docs.find((d) => d.type === 'post').score, 1);
});

test('없는 글에 투표하면 404', async () => {
  docs = [];
  const res = await routes.postsVote.handler(
    req({ cookie: login(), body: { dir: 1 }, params: { id: '없음' } }), ctx);
  assert.strictEqual(res.status, 404);
});

test('로그인하면 내 투표 상태가 함께 온다', async () => {
  docs = [];
  await routes.postsCreate.handler(req({ cookie: login(), body: okPost }), ctx);
  const id = docs[0].id;
  const cookie = login();
  await routes.postsVote.handler(req({ cookie, body: { dir: 1 }, params: { id } }), ctx);

  const mine = await routes.postsList.handler(req({ cookie }), ctx);
  assert.strictEqual(mine.jsonBody.votes[id], 1);

  const other = await routes.postsList.handler(
    req({ cookie: login({ sub: 'discord:2' }) }), ctx);
  assert.deepStrictEqual(other.jsonBody.votes, {}, '남의 투표가 보이면 안 된다');
});
