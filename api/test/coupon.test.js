/* 쿠폰 · 요금제 · 충전 잔액.
   돈과 권한이 걸린 곳이라 "막아야 할 것" 을 촘촘히 본다:
   관리자만 발급, 한 사람 한 번, 횟수·기간 한도, 다른 요금제를 덮어쓰지 않기,
   충전 크레딧은 초기화로 안 사라지고 무료 몫보다 나중에 쓰기. */
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
require('../src/functions/coupon.js');

const session = require('../src/lib/session');
const credit = require('../src/lib/credit');
const db = require('../src/lib/db');
const { createFake } = require('./fake-container');
const { fake, state } = createFake();
db._setContainer(fake);

const cookieFor = (sub, email = 's@example.com') => {
  const c = session.issue({ sub, name: '학생', email, provider: 'google' });
  return `${c.name}=${encodeURIComponent(c.value)}`;
};
const ADMIN = cookieFor('google:boss', 'boss@example.com');
const call = (route, body, cookie) => routes[route].handler({
  headers: { get: (k) => ({ cookie }[k.toLowerCase()] ?? null) },
  json: async () => { if (body === undefined) throw new Error('no body'); return body; }
}, { error: () => {}, log: () => {} });

const issue = async (body) => {
  const res = await call('adminCouponIssue', { count: 1, maxUses: 1, ...body }, ADMIN);
  assert.strictEqual(res.status, undefined, JSON.stringify(res.jsonBody));
  return res.jsonBody.codes;
};
const redeem = (sub, code) => call('couponRedeem', { code }, cookieFor(sub));

test('관리자만 발급한다 — 학생은 403, 비로그인은 401', async () => {
  const body = { kind: 'credit', amount: 1000, count: 1, maxUses: 1 };
  assert.strictEqual((await call('adminCouponIssue', body, cookieFor('google:kid'))).status, 403);
  assert.strictEqual((await call('adminCouponIssue', body, null)).status, 401);
  assert.strictEqual((await call('adminCoupons', undefined, cookieFor('google:kid'))).status, 403);
});

test('발급 값의 상한 — 오타 하나로 큰 값을 뿌리지 않는다', async () => {
  const bad = [
    { kind: 'credit', amount: 1000000 }, { kind: 'credit', amount: 0 }, { kind: 'credit', amount: 1.5 },
    { kind: 'plan', plan: 'free', days: 30 }, { kind: 'plan', plan: 'vip', days: 30 },
    { kind: 'plan', plan: 'pro', days: 3650 }, { kind: 'gift', amount: 10 },
    { kind: 'credit', amount: 10, count: 500 }, { kind: 'credit', amount: 10, maxUses: 0 },
    { kind: 'credit', amount: 10, expiresOn: '2026-13-45' }, { kind: 'credit', amount: 10, expiresOn: '2020-01-01' }
  ];
  for (const b of bad) {
    const res = await call('adminCouponIssue', { count: 1, maxUses: 1, ...b }, ADMIN);
    assert.strictEqual(res.status, 400, JSON.stringify(b));
  }
});

test('크레딧 쿠폰 — 충전되고, 같은 사람은 두 번 못 쓰고, 입력 형식은 너그럽다', async () => {
  const [code] = await issue({ kind: 'credit', amount: 3000, maxUses: 5 });
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  const res = await redeem('google:a', ' ' + code.toLowerCase().replace(/-/g, ' ') + ' ');
  assert.strictEqual(res.jsonBody.ok, true, JSON.stringify(res.jsonBody));
  assert.strictEqual(res.jsonBody.credit.bonus, 3000);
  assert.strictEqual(res.jsonBody.credit.remaining, 2000 + 3000);

  assert.strictEqual((await redeem('google:a', code)).status, 409, '같은 사람 두 번째');
  assert.strictEqual((await credit.balance('google:a')).bonus, 3000, '두 번째가 더 주면 안 된다');
  assert.strictEqual((await redeem('google:b', code)).jsonBody.credit.bonus, 3000, '다른 사람은 된다');
});

test('없는 코드 404, 모양이 틀리면 400, 다 쓴 쿠폰·기간 지난 쿠폰은 410', async () => {
  assert.strictEqual((await redeem('google:c', 'ABCD-EFGH-JKLM')).status, 404);
  assert.strictEqual((await redeem('google:c', 'ABC')).status, 400);
  assert.strictEqual((await redeem('google:c', 'ABCD-EFGH-JKL0')).status, 400, '0 은 쓰지 않는 글자다');

  const [once] = await issue({ kind: 'credit', amount: 10, maxUses: 1 });
  assert.strictEqual((await redeem('google:c', once)).jsonBody.ok, true);
  assert.strictEqual((await redeem('google:d', once)).status, 410, '한 명 한도');

  const [exp] = await issue({ kind: 'credit', amount: 10, maxUses: 9 });
  state.docs.find((d) => d.code === exp.replace(/-/g, '')).expiresAt = '2020-01-01T00:00:00.000Z';
  assert.strictEqual((await redeem('google:c', exp)).status, 410);
});

test('충전 크레딧은 무료 몫보다 나중에 쓰고, 3시간 초기화로 사라지지 않는다', async () => {
  const [code] = await issue({ kind: 'credit', amount: 500 });
  await redeem('google:e', code);
  // 무료 2000 을 다 쓸 때까지 충전분은 그대로다
  for (let i = 0; i < 20; i++) await credit.consume('google:e', 'solar');
  let b = await credit.balance('google:e');
  assert.deepStrictEqual([b.free, b.bonus, b.remaining], [0, 500, 500]);
  await credit.consume('google:e', 'solar');
  b = await credit.balance('google:e');
  assert.deepStrictEqual([b.free, b.bonus], [0, 400], '무료가 없으면 충전분에서 빠진다');

  // 다음 구간 — 무료는 다시 차고 충전분은 남는다
  const doc = state.docs.find((d) => d.id === credit.docId('google:e'));
  const next = credit.view(doc, Date.now() + 3 * 3600e3);
  assert.deepStrictEqual([next.free, next.bonus, next.remaining], [2000, 400, 2400]);
});

test('요금제 쿠폰 — 한도·모델이 바뀌고, 같은 요금제는 기간을 이어 붙이고, 다른 요금제는 덮지 않는다', async () => {
  const [pro] = await issue({ kind: 'plan', plan: 'pro', days: 30, maxUses: 3 });
  const res = await redeem('google:f', pro);
  assert.strictEqual(res.jsonBody.credit.plan, 'pro');
  assert.strictEqual(res.jsonBody.credit.granted, 8000, '이번 구간 한도도 바로 오른다');
  assert.deepStrictEqual(res.jsonBody.credit.models, ['solar', 'gemini']);
  assert.match(res.jsonBody.message, /Pro 요금제가 \d{4}-\d{2}-\d{2}까지/);
  const until1 = Date.parse(res.jsonBody.credit.planUntil);
  assert.ok(Math.abs(until1 - (Date.now() + 30 * 86400e3)) < 60e3);

  const [pro2] = await issue({ kind: 'plan', plan: 'pro', days: 10 });
  const ext = await redeem('google:f', pro2);
  assert.strictEqual(Date.parse(ext.jsonBody.credit.planUntil) - until1, 10 * 86400e3, '남은 기간 뒤에 이어 붙인다');

  const [teacher] = await issue({ kind: 'plan', plan: 'teacher', days: 30 });
  const clash = await redeem('google:f', teacher);
  assert.strictEqual(clash.status, 409);
  assert.strictEqual((await credit.balance('google:f')).plan, 'pro', '티처로 덮이면 안 된다');
  const t = state.docs.find((d) => d.code === teacher.replace(/-/g, ''));
  assert.strictEqual(t.used, 0, '거절된 쿠폰의 사용 횟수가 날아가면 안 된다');
  assert.ok(!state.docs.some((d) => d.type === 'couponUse' && d.code === t.code), '사용 기록도 남기지 않는다');
});

test('요금제는 기간이 지나면 저절로 무료로 돌아간다', () => {
  const now = Date.now();
  const doc = { plan: 'teacher', planUntil: new Date(now + 1000).toISOString() };
  assert.strictEqual(credit.view(doc, now).granted, 50000);
  const later = credit.view(doc, now + 2000);
  assert.deepStrictEqual([later.plan, later.granted, later.models.join()], ['free', 2000, 'solar']);
});

test('차감·지급이 충전 잔액과 요금제를 지우지 않는다', async () => {
  // save() 가 기존 필드를 펼쳐 보존하지 않으면 차감 한 번에 충전분·요금제가 조용히 사라진다
  const [pro] = await issue({ kind: 'plan', plan: 'education', days: 7 });
  const [cr] = await issue({ kind: 'credit', amount: 900 });
  await redeem('google:g', pro);
  await redeem('google:g', cr);
  await credit.consume('google:g', 'gemini');
  await credit.grant('google:g', 100);
  const b = await credit.balance('google:g');
  assert.deepStrictEqual([b.plan, b.bonus, b.granted, b.used], ['education', 900, 8100, 300]);
});

test('크레딧 문서가 같은 사람의 제재 문서를 덮지 않는다', async () => {
  state.docs.push({ id: 'google:h', pk: 'google:h', type: 'sanction', until: '2999-01-01T00:00:00.000Z' });
  await credit.consume('google:h', 'solar');
  assert.ok(state.docs.some((d) => d.id === 'google:h' && d.type === 'sanction'));
});

test('관리자 목록 — 새 쿠폰이 위, 사용 횟수가 보인다', async () => {
  const [code] = await issue({ kind: 'credit', amount: 42, maxUses: 2, memo: '시연용' });
  await redeem('google:i', code);
  const list = (await call('adminCoupons', undefined, ADMIN)).jsonBody;
  const row = list.coupons.find((c) => c.code === code);
  assert.deepStrictEqual([row.used, row.maxUses, row.memo, row.amount], [1, 2, '시연용', 42]);
  assert.deepStrictEqual(list.plans.map((p) => p.id), ['pro', 'education', 'teacher']);
});
