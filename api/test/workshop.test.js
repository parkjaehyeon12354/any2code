/* 커스텀 창작마당 올리기 —
   (1) 올리는 사람은 티처 요금제와 관리자뿐이다(서버가 판정 — 화면의 버튼은 편의일 뿐),
   (2) 시뮬레이션 링크는 우리 사이트의 /simulation/*.html 만, 경로로만 저장한다(목록에 링크로 걸린다),
   (3) 보고서 양식은 모르는 키를 버리고 길이를 자른다. 목록에는 요약만, 작성자 sub 는 절대 안 나간다,
   (4) 지우기는 올린 사람과 관리자만, 계정을 지우면 자료도 지워진다. */
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
require('../src/functions/workshop.js');

const session = require('../src/lib/session');
const credit = require('../src/lib/credit');
const profile = require('../src/lib/profile');
const db = require('../src/lib/db');
const { createFake } = require('./fake-container');
const { fake, state } = createFake();
db._setContainer(fake);

const cookieFor = (sub, email = sub + '@example.com') => {
  const c = session.issue({ sub, name: '이름' + sub.slice(-1), email, provider: 'google' });
  return `${c.name}=${encodeURIComponent(c.value)}`;
};
const call = (name, { cookie = null, body, query = '', id } = {}) => routes[name].handler({
  url: 'https://ans2quest.com/api/workshop' + query,
  params: { id },
  headers: { get: (k) => ({ cookie, 'content-length': '100' }[k.toLowerCase()] ?? null) },
  json: async () => body
}, { error: () => {}, warn: () => {}, log: () => {} });

const teacher = (sub) => state.docs.push({ id: credit.docId(sub), type: 'credit', pk: sub, plan: 'teacher', planUntil: '2999-01-01T00:00:00.000Z' });
teacher('google:t1');
teacher('google:t2');
state.docs.push({ id: credit.docId('google:old'), type: 'credit', pk: 'google:old', plan: 'teacher', planUntil: '2000-01-01T00:00:00.000Z' });
const T1 = cookieFor('google:t1'), T2 = cookieFor('google:t2'), BOSS = cookieFor('google:boss', 'boss@example.com');
const up = (cookie, body) => call('workshopCreate', { cookie, body });

test('티처 요금제와 관리자만 올린다 — 학생·기간 지난 티처 403, 비로그인 401', async () => {
  const body = { kind: 'etc', title: '실험실 안전 수칙 카드', body: '보안경을 씁니다.' };
  assert.strictEqual((await up(null, body)).status, 401);
  assert.strictEqual((await up(cookieFor('google:kid'), body)).status, 403);
  assert.strictEqual((await up(cookieFor('google:old'), body)).status, 403, '요금제 기간이 지나면 선생님이 아니다');
  assert.strictEqual(state.docs.filter((d) => d.type === 'workshop').length, 0);

  const t = await up(T1, body);
  assert.strictEqual(t.status, 201, JSON.stringify(t.jsonBody));
  assert.strictEqual(t.jsonBody.item.role, 'teacher');
  const a = await up(BOSS, { ...body, title: '관리자 자료' });
  assert.strictEqual(a.jsonBody.item.role, 'admin', '요금제가 없어도 관리자는 올린다');
});

test('시뮬레이션 링크는 우리 사이트의 시뮬레이션 주소만, 경로로만 저장한다', async () => {
  for (const link of ['https://evil.example/simulation/pendulum.html', 'javascript:alert(1)', '/community',
    '/simulation/../admin.html', '//evil.example/simulation/pendulum.html', '']) {
    const res = await up(T1, { kind: 'simulation', title: '달', link });
    assert.strictEqual(res.status, 400, `막혀야 한다: ${link}`);
  }
  const ok = await up(T1, { kind: 'simulation', title: '달에서의 단진자', link: ' https://ans2quest.com/simulation/pendulum.html?L=1.00&g=1.62 ' });
  assert.strictEqual(ok.jsonBody.item.link, '/simulation/pendulum.html?L=1.00&g=1.62');
});

test('보고서 양식은 모르는 키를 버리고 자르며, 목록에는 요약만 나간다', async () => {
  assert.strictEqual((await up(T1, { kind: 'report', title: '빈 양식', template: { title: 'x', sections: [] } })).status, 400);
  const res = await up(T1, { kind: 'report', title: '마찰력 보고서', template: {
    title: '마찰력', evil: '<script>', sections: [
      { type: 'text', name: '동기', body: 'x'.repeat(9000), onclick: 'alert(1)' },
      { type: 'table', name: '측정', cells: [['a', 'b'], ['1', 2, { x: 1 }]] },
      { type: 'graph', kind: 'line', cells: [['t', 'v'], ['1', '2']], trend: 'yes' },
      { type: 'weird' }, null
    ] } });
  assert.strictEqual(res.status, 201, JSON.stringify(res.jsonBody));
  const doc = state.docs.find((d) => d.id === res.jsonBody.item.id);
  assert.strictEqual(doc.template.evil, undefined);
  assert.strictEqual(doc.template.sections.length, 4, 'null 은 버리고 모르는 type 은 글로');
  assert.strictEqual(doc.template.sections[0].onclick, undefined);
  assert.strictEqual(doc.template.sections[0].body.length, 4000);
  assert.deepStrictEqual(doc.template.sections[1].cells, [['a', 'b'], ['1', '', '']], '문자열이 아닌 칸은 빈칸');
  assert.strictEqual(doc.template.sections[2].trend, false);

  const list = (await call('workshopList', { query: '?kind=report' })).jsonBody;
  const item = list.items.find((i) => i.id === doc.id);
  assert.deepStrictEqual(item.report, { title: '마찰력', text: 2, table: 1, graph: 1 });
  assert.strictEqual(item.template, undefined, '목록에 양식 전체를 싣지 않는다');
  assert.ok(!JSON.stringify(list).includes('google:'), '작성자 sub 가 새면 안 된다');
});

test('목록 — 종류로 거르고, 최신순이며, 올릴 수 있는지 알려준다', async () => {
  const all = (await call('workshopList', {})).jsonBody;
  assert.ok(all.items.length >= 4);
  assert.ok(all.items.every((x, i) => i === 0 || all.items[i - 1].createdAt >= x.createdAt), '최신순');
  const sims = (await call('workshopList', { query: '?kind=simulation' })).jsonBody.items;
  assert.ok(sims.length && sims.every((x) => x.kind === 'simulation'));
  assert.strictEqual((await call('workshopList', { query: '?kind=bogus' })).jsonBody.items.length, all.items.length, '모르는 종류는 전체');
  assert.deepStrictEqual(
    [await call('workshopList', {}), await call('workshopList', { cookie: cookieFor('google:kid') }),
      await call('workshopList', { cookie: T1 }), await call('workshopList', { cookie: BOSS })].map((r) => r.jsonBody.canUpload),
    [false, false, true, true]);
});

test('지우기는 올린 사람과 관리자만', async () => {
  const mine = (await up(T1, { kind: 'inquiry', title: '지울 자료', body: '내용' })).jsonBody.item;
  assert.strictEqual((await call('workshopDelete', { cookie: T2, id: mine.id })).status, 403, '다른 선생님은 못 지운다');
  assert.strictEqual((await call('workshopDelete', { id: mine.id })).status, 401);
  assert.strictEqual((await call('workshopDelete', { cookie: T1, id: mine.id })).status, 204);
  assert.strictEqual((await call('workshopDelete', { cookie: T1, id: mine.id })).status, 404);

  const other = (await up(T2, { kind: 'etc', title: '관리자가 지울 자료', body: '내용' })).jsonBody.item;
  const seen = (await call('workshopList', { cookie: BOSS })).jsonBody.items.find((i) => i.id === other.id);
  assert.deepStrictEqual([seen.mine, seen.canDelete], [false, true]);
  assert.strictEqual((await call('workshopDelete', { cookie: BOSS, id: other.id })).status, 204);
});

test('계정을 지우면 올린 자료도 지워지고, 이름을 바꾸면 작성자명도 바뀐다', async () => {
  await up(T2, { kind: 'etc', title: '남은 자료', body: '내용' });
  await profile.save({ sub: 'google:t2', name: '이름2', email: 'google:t2@example.com' }, { name: '새이름' });
  assert.ok(state.docs.filter((d) => d.type === 'workshop' && d.authorSub === 'google:t2').every((d) => d.authorName === '새이름'));
  await profile.purge('google:t2');
  assert.strictEqual(state.docs.filter((d) => d.type === 'workshop' && d.authorSub === 'google:t2').length, 0);
  assert.ok(state.docs.some((d) => d.type === 'workshop' && d.authorSub === 'google:t1'), '다른 사람 자료는 그대로');
});
