/* 신고 → 제재 → 소명 점검.
   핵심은 "제재가 실제로 집행되느냐" — 화면에만 있는 제재는 제재가 아니다.
   실행: cd api && node --test */
const { test } = require('node:test');
const assert = require('node:assert');

process.env.SESSION_SECRET = 'r'.repeat(48);
process.env.ADMIN_EMAILS = 'boss@example.com';

const azPath = require.resolve('@azure/functions');
const routes = {};
require.cache[azPath] = {
  id: azPath, filename: azPath, loaded: true,
  exports: { app: { http: (name, cfg) => { routes[name] = cfg; } } }
};
require('../src/functions/reports.js');
require('../src/functions/posts.js');   // 제재가 글쓰기를 실제로 막는지 함께 본다

const session = require('../src/lib/session');
const db = require('../src/lib/db');
const { createFake } = require('./fake-container');
const { fake, state } = createFake();
db._setContainer(fake);

const cookieFor = (over) => {
  const c = session.issue({ sub: 'discord:1', name: '박재현', email: 'a@b.c', provider: 'discord', role: 'user', ...over });
  return `${c.name}=${encodeURIComponent(c.value)}`;
};
const author = () => cookieFor({});                                        // 글쓴이
const other = () => cookieFor({ sub: 'discord:2', name: '최윤지' });        // 신고자
const admin = () => cookieFor({ sub: 'google:9', email: 'boss@example.com', role: 'admin' });

const req = ({ cookie = null, body = null, params = {} } = {}) => ({
  url: 'https://ans2quest.com/api/reports',
  params,
  headers: { get: (k) => (k.toLowerCase() === 'cookie' ? cookie : null) },
  json: async () => { if (body === null) throw new Error('no body'); return body; }
});
const ctx = { error: () => {}, log: () => {} };

const okPost = { subject: 'physics', title: '단진자 주기 질문', body: '측정값이 짧게 나옵니다.' };

/** 글 하나를 만들고 그 글을 돌려준다 */
async function seedPost() {
  state.docs = [];
  await routes.postsCreate.handler(req({ cookie: author(), body: okPost }), ctx);
  return state.docs.find((d) => d.type === 'post');
}

/** 신고까지 만들어 둔다 */
async function seedReport() {
  const post = await seedPost();
  await routes.reportCreate.handler(
    req({ cookie: other(), body: { targetId: post.id, reason: 'spam' } }), ctx);
  return { post, report: state.docs.find((d) => d.type === 'report') };
}

test('여섯 엔드포인트가 등록된다', () => {
  ['reportCreate', 'reportList', 'reportResolve', 'appealCreate', 'appealList', 'appealDecide']
    .forEach((n) => assert.ok(routes[n], n + ' 없음'));
  assert.strictEqual(routes.reportResolve.route, 'moderation/reports/{id}/resolve');
});

test("관리자 경로가 'admin/' 으로 시작하지 않는다 — Functions 예약 접두사", () => {
  const bad = Object.entries(routes).filter(([, c]) => /^admin(\/|$)/.test(c.route || ''));
  assert.deepStrictEqual(bad.map(([n]) => n), []);
});

// ── 신고 ──

test('신고 — 비로그인 401, 사유·대상 검증', async () => {
  const post = await seedPost();
  const anon = await routes.reportCreate.handler(
    req({ body: { targetId: post.id, reason: 'spam' } }), ctx);
  assert.strictEqual(anon.status, 401);

  for (const reason of ['', 'hack', undefined, '<script>']) {
    const res = await routes.reportCreate.handler(
      req({ cookie: other(), body: { targetId: post.id, reason } }), ctx);
    assert.strictEqual(res.status, 400, `사유 ${reason} 가 통과했다`);
  }

  const noTarget = await routes.reportCreate.handler(
    req({ cookie: other(), body: { reason: 'spam' } }), ctx);
  assert.strictEqual(noTarget.status, 400);

  const missing = await routes.reportCreate.handler(
    req({ cookie: other(), body: { targetId: '없음', reason: 'spam' } }), ctx);
  assert.strictEqual(missing.status, 404);
});

test('신고 — 자기 글은 신고할 수 없다', async () => {
  const post = await seedPost();
  const res = await routes.reportCreate.handler(
    req({ cookie: author(), body: { targetId: post.id, reason: 'spam' } }), ctx);
  assert.strictEqual(res.status, 400);
  assert.strictEqual(state.docs.filter((d) => d.type === 'report').length, 0);
});

test('신고 — 같은 사람이 여러 번 눌러도 한 건으로 센다', async () => {
  const post = await seedPost();
  for (let i = 0; i < 3; i++) {
    await routes.reportCreate.handler(
      req({ cookie: other(), body: { targetId: post.id, reason: 'abuse' } }), ctx);
  }
  assert.strictEqual(state.docs.filter((d) => d.type === 'report').length, 1,
    '중복 신고가 쌓이면 관리자 화면이 같은 건으로 찬다');
});

test('신고 — 목록은 관리자만 본다', async () => {
  await seedReport();
  assert.strictEqual((await routes.reportList.handler(req({}), ctx)).status, 401);
  assert.strictEqual((await routes.reportList.handler(req({ cookie: other() }), ctx)).status, 403);

  const ok = await routes.reportList.handler(req({ cookie: admin() }), ctx);
  assert.strictEqual(ok.jsonBody.reports.length, 1);
  assert.strictEqual(ok.jsonBody.reports[0].reason, '광고성 게시물');
  assert.ok(!JSON.stringify(ok.jsonBody).includes('discord:1'), '작성자 sub 가 새면 안 된다');
});

// ── 제재 ──

test('제재 — 일수 검증', async () => {
  const { report } = await seedReport();
  for (const days of [-1, 1.5, 400, 'x', undefined, null]) {
    const res = await routes.reportResolve.handler(
      req({ cookie: admin(), body: { days }, params: { id: report.id } }), ctx);
    assert.strictEqual(res.status, 400, `days=${days} 가 통과했다`);
  }
  const missing = await routes.reportResolve.handler(
    req({ cookie: admin(), body: { days: 7 }, params: { id: '없음' } }), ctx);
  assert.strictEqual(missing.status, 404);
});

test('제재 — 일반 사용자는 처리할 수 없다', async () => {
  const { report } = await seedReport();
  const res = await routes.reportResolve.handler(
    req({ cookie: other(), body: { days: 7 }, params: { id: report.id } }), ctx);
  assert.strictEqual(res.status, 403);
  assert.strictEqual(state.docs.filter((d) => d.type === 'sanction').length, 0);
});

test('제재 — 7일 제한을 걸면 글쓰기가 실제로 막힌다', async () => {
  const { report } = await seedReport();

  const before = await routes.postsCreate.handler(req({ cookie: author(), body: okPost }), ctx);
  assert.strictEqual(before.status, 201, '제재 전에는 써진다');

  await routes.reportResolve.handler(
    req({ cookie: admin(), body: { days: 7 }, params: { id: report.id } }), ctx);

  const after = await routes.postsCreate.handler(req({ cookie: author(), body: okPost }), ctx);
  assert.strictEqual(after.status, 403, '집행되지 않는 제재는 화면 문구일 뿐이다');
  assert.match(after.jsonBody.error, /제한/);
  assert.ok(after.jsonBody.suspendedUntil, '언제 풀리는지 알려줘야 한다');

  // 신고한 사람은 멀쩡해야 한다
  const innocent = await routes.postsCreate.handler(req({ cookie: other(), body: okPost }), ctx);
  assert.strictEqual(innocent.status, 201);
});

test('제재 — 답변도 막힌다', async () => {
  const { post, report } = await seedReport();
  await routes.reportResolve.handler(
    req({ cookie: admin(), body: { days: 3 }, params: { id: report.id } }), ctx);

  const res = await routes.commentsCreate.handler(
    req({ cookie: author(), body: { body: '답변입니다' }, params: { id: post.id } }), ctx);
  assert.strictEqual(res.status, 403);
});

test('제재 — 경고만(0일)이면 글쓰기는 막지 않는다', async () => {
  const { report } = await seedReport();
  await routes.reportResolve.handler(
    req({ cookie: admin(), body: { days: 0 }, params: { id: report.id } }), ctx);

  assert.strictEqual(state.docs.filter((d) => d.type === 'sanction').length, 0);
  const res = await routes.postsCreate.handler(req({ cookie: author(), body: okPost }), ctx);
  assert.strictEqual(res.status, 201);
});

test('제재 — 기간이 지나면 자동으로 풀린다', async () => {
  const { report } = await seedReport();
  await routes.reportResolve.handler(
    req({ cookie: admin(), body: { days: 7 }, params: { id: report.id } }), ctx);

  const s = state.docs.find((d) => d.type === 'sanction');
  s.until = new Date(Date.now() - 1000).toISOString();   // 어제 끝난 제재

  const res = await routes.postsCreate.handler(req({ cookie: author(), body: okPost }), ctx);
  assert.strictEqual(res.status, 201, '기간이 지났는데 계속 막히면 안 된다');
  assert.ok(state.docs.find((d) => d.type === 'sanction'), '이력은 남아야 반복 위반을 안다');
});

test('제재 — blockContent 면 대상 글도 차단된다', async () => {
  const { post, report } = await seedReport();
  await routes.reportResolve.handler(
    req({ cookie: admin(), body: { days: 3, blockContent: true }, params: { id: report.id } }), ctx);

  assert.strictEqual(post.status, 'blocked');
  const list = await routes.postsList.handler(req({}), ctx);
  assert.strictEqual(list.jsonBody.posts.length, 0);
});

test('제재 — 처리한 신고는 결과와 함께 남는다', async () => {
  const { report } = await seedReport();
  await routes.reportResolve.handler(
    req({ cookie: admin(), body: { days: 5 }, params: { id: report.id } }), ctx);

  const list = await routes.reportList.handler(req({ cookie: admin() }), ctx);
  const row = list.jsonBody.reports[0];
  assert.strictEqual(row.status, 'done');
  assert.strictEqual(row.applied.days, 5);
  assert.strictEqual(row.applied.by, 'boss@example.com');
  assert.ok(row.applied.until, '해제 시각이 있어야 다툼을 가린다');
});

// ── 소명 ──

/** 제재를 받은 상태를 만든다 */
async function seedSanctioned(days = 7) {
  const { report } = await seedReport();
  await routes.reportResolve.handler(
    req({ cookie: admin(), body: { days }, params: { id: report.id } }), ctx);
}

test('소명 — 제재 중인 본인만 낼 수 있다', async () => {
  await seedPost();
  const notSanctioned = await routes.appealCreate.handler(
    req({ cookie: author(), body: { text: '억울합니다' } }), ctx);
  assert.strictEqual(notSanctioned.status, 400);

  await seedSanctioned();
  const anon = await routes.appealCreate.handler(req({ body: { text: '억울합니다' } }), ctx);
  assert.strictEqual(anon.status, 401);

  const ok = await routes.appealCreate.handler(
    req({ cookie: author(), body: { text: '광고가 아니라 실험 정리본이었습니다.' } }), ctx);
  assert.strictEqual(ok.status, 201);
});

test('소명 — 빈 내용·길이 초과 거부, 중복 접수 거부', async () => {
  await seedSanctioned();
  for (const text of ['', '   ', 'ㄱ'.repeat(2001)]) {
    const res = await routes.appealCreate.handler(req({ cookie: author(), body: { text } }), ctx);
    assert.strictEqual(res.status, 400);
  }

  await routes.appealCreate.handler(req({ cookie: author(), body: { text: '첫 소명' } }), ctx);
  const dup = await routes.appealCreate.handler(req({ cookie: author(), body: { text: '또 냅니다' } }), ctx);
  assert.strictEqual(dup.status, 400, '같은 건으로 여러 번 넣으면 관리자 화면이 찬다');
});

test('소명 — 목록은 관리자만 본다', async () => {
  await seedSanctioned();
  await routes.appealCreate.handler(req({ cookie: author(), body: { text: '억울합니다' } }), ctx);

  assert.strictEqual((await routes.appealList.handler(req({}), ctx)).status, 401);
  assert.strictEqual((await routes.appealList.handler(req({ cookie: other() }), ctx)).status, 403);

  const ok = await routes.appealList.handler(req({ cookie: admin() }), ctx);
  assert.strictEqual(ok.jsonBody.appeals.length, 1);
  assert.strictEqual(ok.jsonBody.appeals[0].orig.days, 7);
});

test('소명 인용 — 제재가 실제로 풀린다', async () => {
  await seedSanctioned();
  await routes.appealCreate.handler(req({ cookie: author(), body: { text: '억울합니다' } }), ctx);
  const appeal = state.docs.find((d) => d.type === 'appeal');

  const blocked = await routes.postsCreate.handler(req({ cookie: author(), body: okPost }), ctx);
  assert.strictEqual(blocked.status, 403);

  await routes.appealDecide.handler(
    req({ cookie: admin(), body: { decision: 'granted' }, params: { id: appeal.id } }), ctx);

  const after = await routes.postsCreate.handler(req({ cookie: author(), body: okPost }), ctx);
  assert.strictEqual(after.status, 201, '인용됐는데 여전히 못 쓰면 인용이 아니다');
  assert.ok(state.docs.find((d) => d.type === 'sanction'), '이력은 남긴다');
});

test('제재 이력 — 처리·감경·해제가 각각 한 줄씩 쌓인다', async () => {
  /* 제재 문서는 사용자당 하나라 새 제재가 이전 것을 덮는다. 본인에게 내역을
     보여주려면 덮이지 않는 기록이 따로 필요하다. */
  await seedSanctioned();
  const log = () => state.docs.filter((d) => d.type === 'sanctionLog');

  assert.strictEqual(log().length, 1, '제재를 걸면 이력 한 줄');
  assert.strictEqual(log()[0].event, 'issued');
  assert.ok(log()[0].reason, '무슨 사유였는지 남아야 한다');

  await routes.appealCreate.handler(req({ cookie: author(), body: { text: '억울합니다' } }), ctx);
  const appeal = state.docs.find((d) => d.type === 'appeal');

  await routes.appealDecide.handler(
    req({ cookie: admin(), body: { decision: 'reduced', days: 1 }, params: { id: appeal.id } }), ctx);
  assert.strictEqual(log().length, 2, '감경도 이력에 남아야 한다');
  assert.strictEqual(log().find((h) => h.event === 'reduced').days, 1);

  await routes.appealDecide.handler(
    req({ cookie: admin(), body: { decision: 'granted' }, params: { id: appeal.id } }), ctx);
  assert.strictEqual(log().length, 3, '해제도 이력에 남아야 한다');
  assert.ok(log().find((h) => h.event === 'lifted'));

  // 제재 문서는 여전히 하나 — 이력은 그 문서와 별개로 쌓인다
  assert.strictEqual(state.docs.filter((d) => d.type === 'sanction').length, 1);
});

test('경고(0일)도 이력에 남는다 — 제재 문서는 안 만들지만 본인은 알아야 한다', async () => {
  const { report } = await seedReport();
  await routes.reportResolve.handler(
    req({ cookie: admin(), body: { days: 0 }, params: { id: report.id } }), ctx);

  assert.strictEqual(state.docs.filter((d) => d.type === 'sanction').length, 0, '경고는 제재 문서를 안 만든다');
  const log = state.docs.filter((d) => d.type === 'sanctionLog');
  assert.strictEqual(log.length, 1);
  assert.strictEqual(log[0].days, 0);
});

test('기각은 이력에 쌓지 않는다 — 제재가 그대로이고 소명 문서가 결과를 갖고 있다', async () => {
  await seedSanctioned();
  await routes.appealCreate.handler(req({ cookie: author(), body: { text: '억울합니다' } }), ctx);
  const appeal = state.docs.find((d) => d.type === 'appeal');
  const before = state.docs.filter((d) => d.type === 'sanctionLog').length;

  await routes.appealDecide.handler(
    req({ cookie: admin(), body: { decision: 'denied' }, params: { id: appeal.id } }), ctx);

  assert.strictEqual(state.docs.filter((d) => d.type === 'sanctionLog').length, before,
    '같은 사실을 두 번 쌓으면 내역이 부풀어 보인다');
  assert.strictEqual(state.docs.find((d) => d.type === 'appeal').status, 'denied');
});

test('이력 기록이 실패해도 제재 처리는 성공한다', async () => {
  /* 이미 걸린 제재를 두고 관리자에게 "실패했다" 고 말하면 같은 처리를 또 하게 된다. */
  const { report } = await seedReport();
  const realCreate = fake.items.create;
  fake.items.create = async (d) => {
    if (d.type === 'sanctionLog') throw new Error('이력 저장 실패(의도)');
    return realCreate(d);
  };
  try {
    const res = await routes.reportResolve.handler(
      req({ cookie: admin(), body: { days: 3 }, params: { id: report.id } }), ctx);
    assert.strictEqual(res.status, undefined, '이력 실패가 제재 처리를 실패로 만들었다');
    assert.strictEqual(res.jsonBody.status, 'done');
    assert.ok(state.docs.find((d) => d.type === 'sanction'), '제재는 걸려 있어야 한다');
  } finally {
    fake.items.create = realCreate;
  }
});

test('소명 기각 — 제재가 유지된다', async () => {
  await seedSanctioned();
  await routes.appealCreate.handler(req({ cookie: author(), body: { text: '억울합니다' } }), ctx);
  const appeal = state.docs.find((d) => d.type === 'appeal');

  await routes.appealDecide.handler(
    req({ cookie: admin(), body: { decision: 'denied' }, params: { id: appeal.id } }), ctx);

  assert.strictEqual(appeal.status, 'denied');
  const res = await routes.postsCreate.handler(req({ cookie: author(), body: okPost }), ctx);
  assert.strictEqual(res.status, 403);
});

test('소명 감경 — 일수를 검증하고 기간을 다시 계산한다', async () => {
  await seedSanctioned(30);
  await routes.appealCreate.handler(req({ cookie: author(), body: { text: '줄여주세요' } }), ctx);
  const appeal = state.docs.find((d) => d.type === 'appeal');

  for (const days of [0, -3, 1.5, 400, undefined]) {
    const res = await routes.appealDecide.handler(
      req({ cookie: admin(), body: { decision: 'reduced', days }, params: { id: appeal.id } }), ctx);
    assert.strictEqual(res.status, 400, `days=${days} 가 통과했다`);
  }

  await routes.appealDecide.handler(
    req({ cookie: admin(), body: { decision: 'reduced', days: 3 }, params: { id: appeal.id } }), ctx);

  const s = state.docs.find((d) => d.type === 'sanction');
  assert.strictEqual(s.days, 3);
  const left = (new Date(s.until) - Date.now()) / 86400000;
  assert.ok(left > 2.9 && left < 3.1, '감경한 일수만큼만 남아야 한다');
});

test('소명 — 알 수 없는 결정과 없는 소명은 거부한다', async () => {
  await seedSanctioned();
  await routes.appealCreate.handler(req({ cookie: author(), body: { text: '억울합니다' } }), ctx);
  const appeal = state.docs.find((d) => d.type === 'appeal');

  for (const decision of ['delete', '', 'DROP', undefined]) {
    const res = await routes.appealDecide.handler(
      req({ cookie: admin(), body: { decision }, params: { id: appeal.id } }), ctx);
    assert.strictEqual(res.status, 400);
  }

  const missing = await routes.appealDecide.handler(
    req({ cookie: admin(), body: { decision: 'denied' }, params: { id: '없음' } }), ctx);
  assert.strictEqual(missing.status, 404);
});

test('소명 — 일반 사용자는 판단할 수 없다', async () => {
  await seedSanctioned();
  await routes.appealCreate.handler(req({ cookie: author(), body: { text: '억울합니다' } }), ctx);
  const appeal = state.docs.find((d) => d.type === 'appeal');

  const res = await routes.appealDecide.handler(
    req({ cookie: author(), body: { decision: 'granted' }, params: { id: appeal.id } }), ctx);
  assert.strictEqual(res.status, 403, '본인이 자기 소명을 인용할 수 있으면 제재가 무의미하다');
  assert.strictEqual(appeal.status, 'wait');
});

test('킬 스위치 — 신고·소명 경로도 함께 막힌다', async () => {
  process.env.LOCKDOWN = '1';
  try {
    const r = await routes.reportCreate.handler(req({ cookie: other(), body: {} }), ctx);
    const a = await routes.appealCreate.handler(req({ cookie: author(), body: {} }), ctx);
    const l = await routes.reportList.handler(req({ cookie: admin() }), ctx);
    assert.deepStrictEqual([r.status, a.status, l.status], [503, 503, 503]);
  } finally {
    delete process.env.LOCKDOWN;
  }
});
