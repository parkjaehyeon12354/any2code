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
require('../src/functions/posts.js');

const session = require('../src/lib/session');
const db = require('../src/lib/db');

const { createFake } = require('./fake-container');
const { fake, state } = createFake();
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

test('COSMOS_CONNECTION 이 없으면 원인을 알려준다', async () => {
  // 관리형 Functions 는 로그 보기가 번거롭다. 응답만 보고 설정 누락을 알아야
  // "DB가 비었나?" 하고 엉뚱한 데를 뒤지지 않는다.
  db._setContainer(null);
  delete process.env.COSMOS_CONNECTION;
  try {
    const res = await routes.postsList.handler(req({}), ctx);
    assert.strictEqual(res.status, 503);
    assert.match(res.jsonBody.error, /COSMOS_CONNECTION/);
  } finally {
    db._setContainer(fake);
  }
});

test('여섯 엔드포인트가 등록된다', () => {
  assert.deepStrictEqual(Object.keys(routes).sort(),
    ['commentsCreate', 'commentsList', 'postsCreate', 'postsGet', 'postsList', 'postsVote']);
  assert.strictEqual(routes.postsVote.route, 'posts/{id}/vote');
  assert.strictEqual(routes.commentsList.route, 'posts/{id}/comments');
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
  state.docs = [];
  const res = await routes.postsCreate.handler(req({ cookie: login(), body: okPost }), ctx);
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.jsonBody.held, false);

  const list = await routes.postsList.handler(req({}), ctx);
  assert.strictEqual(list.jsonBody.posts.length, 1);
  assert.strictEqual(list.jsonBody.posts[0].title, okPost.title);
  assert.strictEqual(list.jsonBody.posts[0].excerpt, okPost.body);
  assert.strictEqual(list.jsonBody.posts[0].body, undefined, '목록에 본문 전체를 실으면 글이 늘수록 응답만 커진다');
});

test('목록의 글이 여러 개여도 전부 excerpt 다 — map 이 인덱스를 넘기는 함정', async () => {
  /* posts.map(publicPost) 로 쓰면 map 이 (요소, 인덱스, 배열) 을 넘겨서
     full 에 인덱스가 들어간다. 인덱스 0 만 falsy 라 첫 글은 멀쩡하고
     두 번째부터 본문 전체가 실려 나갔다 — 실서버에서 화면에 undefined 로 드러났다.
     글을 하나만 만드는 테스트로는 절대 못 잡는다. */
  state.docs = [];
  for (const n of [1, 2, 3]) {
    await routes.postsCreate.handler(req({
      cookie: login(), body: { subject: 'physics', title: '글' + n, body: '본문' + n }
    }), ctx);
  }

  const list = await routes.postsList.handler(req({}), ctx);
  assert.strictEqual(list.jsonBody.posts.length, 3);
  list.jsonBody.posts.forEach((p, i) => {
    assert.strictEqual(p.body, undefined, i + '번째 글에 본문 전체가 실렸다');
    assert.ok(p.excerpt, i + '번째 글의 excerpt 가 없다 — 화면에 undefined 로 나온다');
  });

  // viewerSub 자리에도 배열이 들어가던 탓에 mine 이 늘 false 였다
  const asAuthor = await routes.postsList.handler(req({ cookie: login() }), ctx);
  assert.ok(asAuthor.jsonBody.posts.every((p) => p.mine === true), '내가 쓴 글인데 mine 이 false 다');

  const anon = await routes.postsList.handler(req({}), ctx);
  assert.ok(anon.jsonBody.posts.every((p) => p.mine === false), '비로그인에게 mine 이 true 로 나가면 안 된다');
});

test('작성자 식별자는 목록에 노출되지 않는다', async () => {
  state.docs = [];
  await routes.postsCreate.handler(req({ cookie: login(), body: okPost }), ctx);
  const list = await routes.postsList.handler(req({}), ctx);
  const json = JSON.stringify(list.jsonBody);
  assert.ok(!json.includes('discord:1'), 'authorSub 가 새어나갔다');
  assert.ok(!json.includes('authorSub'));
});

test('욕설이 있으면 보류되고 목록에서 빠진다', async () => {
  state.docs = [];
  const res = await routes.postsCreate.handler(
    req({ cookie: login(), body: { ...okPost, body: '이 병신 같은 실험' } }), ctx);
  assert.strictEqual(res.jsonBody.held, true);
  assert.ok(res.jsonBody.message, '왜 안 보이는지 알려줘야 한다');

  const list = await routes.postsList.handler(req({}), ctx);
  assert.strictEqual(list.jsonBody.posts.length, 0);
  assert.strictEqual(state.docs[0].status, 'held', '삭제가 아니라 보류여야 사람이 되살릴 수 있다');
});

test('과목 필터가 동작한다', async () => {
  state.docs = [];
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
  state.docs = [];
  await routes.postsCreate.handler(req({ cookie: login(), body: okPost }), ctx);
  const id = state.docs[0].id;
  const cookie = login();

  const up = await routes.postsVote.handler(req({ cookie, body: { dir: 1 }, params: { id } }), ctx);
  assert.deepStrictEqual([up.jsonBody.dir, up.jsonBody.score], [1, 1]);

  const again = await routes.postsVote.handler(req({ cookie, body: { dir: 1 }, params: { id } }), ctx);
  assert.deepStrictEqual([again.jsonBody.dir, again.jsonBody.score], [0, 0], '같은 방향 재클릭은 취소');

  const down = await routes.postsVote.handler(req({ cookie, body: { dir: -1 }, params: { id } }), ctx);
  assert.deepStrictEqual([down.jsonBody.dir, down.jsonBody.score], [-1, -1]);
});

test('한 사람이 여러 번 눌러도 표는 하나만 남는다', async () => {
  state.docs = [];
  await routes.postsCreate.handler(req({ cookie: login(), body: okPost }), ctx);
  const id = state.docs[0].id;
  const cookie = login();

  await routes.postsVote.handler(req({ cookie, body: { dir: 1 }, params: { id } }), ctx);
  await routes.postsVote.handler(req({ cookie, body: { dir: -1 }, params: { id } }), ctx);
  await routes.postsVote.handler(req({ cookie, body: { dir: -1 }, params: { id } }), ctx);
  await routes.postsVote.handler(req({ cookie, body: { dir: 1 }, params: { id } }), ctx);

  const votes = state.docs.filter((d) => d.type === 'vote');
  assert.strictEqual(votes.length, 1, '투표가 중복 저장되면 점수를 부풀릴 수 있다');
  assert.strictEqual(state.docs.find((d) => d.type === 'post').score, 1);
});

test('글 도배 — 10분 안에 5개를 넘기면 429', async () => {
  state.docs = [];
  const cookie = login({ sub: 'discord:spam' });
  for (let i = 0; i < 5; i++) {
    const res = await routes.postsCreate.handler(
      req({ cookie, body: { ...okPost, title: '질문 ' + i } }), ctx);
    assert.strictEqual(res.status, 201, i + '번째가 막혔다');
  }
  const sixth = await routes.postsCreate.handler(req({ cookie, body: okPost }), ctx);
  assert.strictEqual(sixth.status, 429);
  assert.strictEqual(state.docs.filter((d) => d.type === 'post').length, 5, '429 인데 저장되면 안 된다');

  // 다른 사용자는 영향받지 않는다
  const other = await routes.postsCreate.handler(
    req({ cookie: login({ sub: 'discord:clean' }), body: okPost }), ctx);
  assert.strictEqual(other.status, 201);
});

test('투표 연타 — 분당 30번을 넘기면 막힌다', () => {
  const { _voteAllowed } = require('../src/functions/posts.js');
  const now = Date.now();
  for (let i = 0; i < 30; i++) assert.ok(_voteAllowed('연타꾼', now + i), i + '번째가 막혔다');
  assert.strictEqual(_voteAllowed('연타꾼', now + 30), false);
  assert.ok(_voteAllowed('무고한사람', now), '남의 연타에 내가 막히면 안 된다');
  // 1분 지나면 다시 허용된다
  assert.ok(_voteAllowed('연타꾼', now + 61_000));
});

test('본문 상한보다 훨씬 큰 요청은 파싱 전에 413', async () => {
  const cookie = login();
  const res = await routes.postsCreate.handler({
    url: 'https://ans2quest.com/api/posts',
    params: {},
    headers: {
      get: (k) => k.toLowerCase() === 'content-length' ? String(1024 * 1024)
        : k.toLowerCase() === 'cookie' ? cookie : null
    },
    json: async () => { throw new Error('파싱까지 갔다 — 크기 검사가 늦다'); }
  }, ctx);
  assert.strictEqual(res.status, 413);
});

test('보류·차단된 글에는 투표할 수 없다 — 목록에서 가리는 것만으로는 차단이 아니다', async () => {
  state.docs = [];
  // 욕설이 섞인 글은 보류로 저장된다
  await routes.postsCreate.handler(
    req({ cookie: login(), body: { ...okPost, body: '이 병신 같은 실험' } }), ctx);
  const post = state.docs.find((d) => d.type === 'post');
  assert.strictEqual(post.status, 'held');

  const held = await routes.postsVote.handler(
    req({ cookie: login(), body: { dir: 1 }, params: { id: post.id } }), ctx);
  assert.strictEqual(held.status, 404, 'id 를 아는 사람이 계속 투표할 수 있으면 안 된다');
  assert.strictEqual(post.score, 0, '거부됐는데 점수가 움직이면 안 된다');
  assert.strictEqual(state.docs.filter((d) => d.type === 'vote').length, 0);

  // 차단 상태도 동일
  post.status = 'blocked';
  const blocked = await routes.postsVote.handler(
    req({ cookie: login(), body: { dir: 1 }, params: { id: post.id } }), ctx);
  assert.strictEqual(blocked.status, 404);

  // 공개되면 다시 투표할 수 있다 — 오탐 복구 후에는 정상 동작해야 한다
  post.status = 'public';
  const ok = await routes.postsVote.handler(
    req({ cookie: login(), body: { dir: 1 }, params: { id: post.id } }), ctx);
  assert.strictEqual(ok.jsonBody.score, 1);
});

test('없는 글에 투표하면 404', async () => {
  state.docs = [];
  const res = await routes.postsVote.handler(
    req({ cookie: login(), body: { dir: 1 }, params: { id: '없음' } }), ctx);
  assert.strictEqual(res.status, 404);
});

test('킬 스위치 — LOCKDOWN=1 이면 읽기·쓰기·투표 전부 503', async () => {
  state.docs = [];
  process.env.LOCKDOWN = '1';
  try {
    const list = await routes.postsList.handler(req({}), ctx);
    const create = await routes.postsCreate.handler(req({ cookie: login(), body: okPost }), ctx);
    const vote = await routes.postsVote.handler(req({ cookie: login(), body: { dir: 1 }, params: { id: 'x' } }), ctx);
    assert.deepStrictEqual([list.status, create.status, vote.status], [503, 503, 503]);
    assert.strictEqual(state.docs.length, 0, '잠금 중에 저장되면 안 된다');
  } finally {
    delete process.env.LOCKDOWN;
  }
  // 변수를 지우면 즉시 복구된다
  const after = await routes.postsList.handler(req({}), ctx);
  assert.strictEqual(after.status ?? 200, 200);
});

test('로그인하면 내 투표 상태가 함께 온다', async () => {
  state.docs = [];
  await routes.postsCreate.handler(req({ cookie: login(), body: okPost }), ctx);
  const id = state.docs[0].id;
  const cookie = login();
  await routes.postsVote.handler(req({ cookie, body: { dir: 1 }, params: { id } }), ctx);

  const mine = await routes.postsList.handler(req({ cookie }), ctx);
  assert.strictEqual(mine.jsonBody.votes[id], 1);

  const other = await routes.postsList.handler(
    req({ cookie: login({ sub: 'discord:2' }) }), ctx);
  assert.deepStrictEqual(other.jsonBody.votes, {}, '남의 투표가 보이면 안 된다');
});

// ── 댓글 ──

/** 공개 상태의 글을 하나 만들어 id 를 돌려준다 */
async function seedPost() {
  state.docs = [];
  await routes.postsCreate.handler(req({ cookie: login(), body: okPost }), ctx);
  return state.docs.find((d) => d.type === 'post');
}

test('댓글 — 비로그인은 못 쓰고, 목록은 누구나 본다', async () => {
  const post = await seedPost();
  const anon = await routes.commentsCreate.handler(
    req({ body: { body: '답변입니다' }, params: { id: post.id } }), ctx);
  assert.strictEqual(anon.status, 401);

  const list = await routes.commentsList.handler(req({ params: { id: post.id } }), ctx);
  assert.deepStrictEqual(list.jsonBody.comments, []);
});

test('댓글 — 작성하면 목록에 뜨고 답변 수가 오른다', async () => {
  const post = await seedPost();
  const res = await routes.commentsCreate.handler(
    req({ cookie: login(), body: { body: '공기저항 때문입니다.' }, params: { id: post.id } }), ctx);
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.jsonBody.held, false);

  const list = await routes.commentsList.handler(req({ params: { id: post.id } }), ctx);
  assert.strictEqual(list.jsonBody.comments.length, 1);
  assert.strictEqual(list.jsonBody.comments[0].body, '공기저항 때문입니다.');
  assert.strictEqual(post.answers, 1, '답변 수가 안 오르면 목록의 "답변 0" 이 거짓말이 된다');
});

test('댓글 — 빈 내용과 길이 초과는 거부한다', async () => {
  const post = await seedPost();
  for (const body of ['', '   ', 'ㄱ'.repeat(2001)]) {
    const res = await routes.commentsCreate.handler(
      req({ cookie: login(), body: { body }, params: { id: post.id } }), ctx);
    assert.strictEqual(res.status, 400);
  }
});

test('댓글 — 작성자 식별자는 노출되지 않는다', async () => {
  const post = await seedPost();
  await routes.commentsCreate.handler(
    req({ cookie: login(), body: { body: '답변입니다' }, params: { id: post.id } }), ctx);
  const list = await routes.commentsList.handler(req({ params: { id: post.id } }), ctx);
  const json = JSON.stringify(list.jsonBody);
  assert.ok(!json.includes('discord:1') && !json.includes('authorSub'));
});

test('댓글 — 욕설은 보류되고 답변 수도 오르지 않는다', async () => {
  const post = await seedPost();
  const res = await routes.commentsCreate.handler(
    req({ cookie: login(), body: { body: '이 병신아' }, params: { id: post.id } }), ctx);
  assert.strictEqual(res.jsonBody.held, true);

  const list = await routes.commentsList.handler(req({ params: { id: post.id } }), ctx);
  assert.strictEqual(list.jsonBody.comments.length, 0);
  assert.strictEqual(post.answers, 0, '보류 중인 답변을 세면 "답변 1" 인데 아무것도 안 보인다');
  assert.strictEqual(state.docs.find((d) => d.type === 'comment').status, 'held');
});

test('댓글 — 보류·차단된 글에는 달 수 없다', async () => {
  const post = await seedPost();
  for (const status of ['held', 'blocked']) {
    post.status = status;
    const res = await routes.commentsCreate.handler(
      req({ cookie: login(), body: { body: '답변입니다' }, params: { id: post.id } }), ctx);
    assert.strictEqual(res.status, 404, `${status} 인 글에 답변이 달렸다`);
  }
  const res = await routes.commentsCreate.handler(
    req({ cookie: login(), body: { body: '답변입니다' }, params: { id: '없음' } }), ctx);
  assert.strictEqual(res.status, 404);
});

test('댓글 — 다른 글의 댓글이 섞이지 않는다', async () => {
  const a = await seedPost();
  await routes.postsCreate.handler(req({ cookie: login(), body: { ...okPost, title: '두번째' } }), ctx);
  const b = state.docs.filter((d) => d.type === 'post')[1];

  await routes.commentsCreate.handler(
    req({ cookie: login(), body: { body: 'A 의 답변' }, params: { id: a.id } }), ctx);

  const listB = await routes.commentsList.handler(req({ params: { id: b.id } }), ctx);
  assert.strictEqual(listB.jsonBody.comments.length, 0);
});

test('댓글 — 킬 스위치에 함께 막힌다', async () => {
  const post = await seedPost();
  process.env.LOCKDOWN = '1';
  try {
    const list = await routes.commentsList.handler(req({ params: { id: post.id } }), ctx);
    const create = await routes.commentsCreate.handler(
      req({ cookie: login(), body: { body: '답변' }, params: { id: post.id } }), ctx);
    assert.deepStrictEqual([list.status, create.status], [503, 503]);
  } finally {
    delete process.env.LOCKDOWN;
  }
});

// ── 글 하나 (post.html 이 쓴다) ──

test('글 하나 — 본문 전체를 주고, 목록은 요약만 준다', async () => {
  const long = 'ㄱ'.repeat(500);
  state.docs = [];
  await routes.postsCreate.handler(req({ cookie: login(), body: { ...okPost, body: long } }), ctx);
  const post = state.docs.find((d) => d.type === 'post');

  const one = await routes.postsGet.handler(req({ params: { id: post.id } }), ctx);
  assert.strictEqual(one.jsonBody.post.body, long, '글 화면은 전문이 필요하다');
  assert.strictEqual(one.jsonBody.post.excerpt, undefined);

  const list = await routes.postsList.handler(req({}), ctx);
  assert.strictEqual(list.jsonBody.posts[0].body, undefined);
  assert.ok(list.jsonBody.posts[0].excerpt.length < long.length, '목록은 잘라서 보낸다');
  assert.ok(list.jsonBody.posts[0].excerpt.endsWith('…'));
});

test('글 하나 — 비로그인도 읽고, 작성자 식별자는 안 나간다', async () => {
  state.docs = [];
  await routes.postsCreate.handler(req({ cookie: login(), body: okPost }), ctx);
  const post = state.docs.find((d) => d.type === 'post');

  const res = await routes.postsGet.handler(req({ params: { id: post.id } }), ctx);
  assert.strictEqual(res.jsonBody.post.title, okPost.title);
  assert.strictEqual(res.jsonBody.myVote, 0);
  assert.ok(!JSON.stringify(res.jsonBody).includes('discord:1'));
  assert.strictEqual(res.headers['Cache-Control'], 'no-store');
});

test('글 하나 — 없는 글·보류·차단은 전부 404', async () => {
  state.docs = [];
  await routes.postsCreate.handler(req({ cookie: login(), body: okPost }), ctx);
  const post = state.docs.find((d) => d.type === 'post');

  const missing = await routes.postsGet.handler(req({ params: { id: '없음' } }), ctx);
  assert.strictEqual(missing.status, 404);

  for (const status of ['held', 'blocked']) {
    post.status = status;
    const res = await routes.postsGet.handler(req({ params: { id: post.id } }), ctx);
    assert.strictEqual(res.status, 404, `${status} 인 글이 링크로 열렸다`);
  }
});

test('글 하나 — 로그인하면 내 투표 상태가 함께 온다', async () => {
  state.docs = [];
  await routes.postsCreate.handler(req({ cookie: login(), body: okPost }), ctx);
  const post = state.docs.find((d) => d.type === 'post');
  const cookie = login();

  await routes.postsVote.handler(req({ cookie, body: { dir: -1 }, params: { id: post.id } }), ctx);

  const mine = await routes.postsGet.handler(req({ cookie, params: { id: post.id } }), ctx);
  assert.strictEqual(mine.jsonBody.myVote, -1);

  const other = await routes.postsGet.handler(
    req({ cookie: login({ sub: 'discord:2' }), params: { id: post.id } }), ctx);
  assert.strictEqual(other.jsonBody.myVote, 0, '남의 투표가 보이면 안 된다');
});

test('글 하나 — 킬 스위치에 막힌다', async () => {
  process.env.LOCKDOWN = '1';
  try {
    const res = await routes.postsGet.handler(req({ params: { id: 'x' } }), ctx);
    assert.strictEqual(res.status, 503);
  } finally {
    delete process.env.LOCKDOWN;
  }
});

test('mine 플래그 — 작성자 식별자를 노출하지 않고 자기 글을 구분한다', async () => {
  state.docs = [];
  await routes.postsCreate.handler(req({ cookie: login(), body: okPost }), ctx);
  const post = state.docs.find((d) => d.type === 'post');
  await routes.commentsCreate.handler(
    req({ cookie: login(), body: { body: '내 답변' }, params: { id: post.id } }), ctx);

  const asAuthor = await routes.postsGet.handler(req({ cookie: login(), params: { id: post.id } }), ctx);
  assert.strictEqual(asAuthor.jsonBody.post.mine, true);

  const asOther = await routes.postsGet.handler(
    req({ cookie: login({ sub: 'discord:9' }), params: { id: post.id } }), ctx);
  assert.strictEqual(asOther.jsonBody.post.mine, false);

  const anon = await routes.postsGet.handler(req({ params: { id: post.id } }), ctx);
  assert.strictEqual(anon.jsonBody.post.mine, false, '비로그인에게 mine=true 가 가면 안 된다');

  const cAuthor = await routes.commentsList.handler(req({ cookie: login(), params: { id: post.id } }), ctx);
  assert.strictEqual(cAuthor.jsonBody.comments[0].mine, true);
  assert.ok(!JSON.stringify(cAuthor.jsonBody).includes('discord:1'), 'sub 는 여전히 안 나간다');
});
