/* 크레딧 동시 요청 점검 — 실제로 한꺼번에 보내 본다.
   예전 코드는 '읽고 → 계산 → 그냥 덮어쓰기' 라서
   (1) 1번 값만 남은 사람이 질문 10개를 동시에 보내면 10개 모두 답을 받았고,
   (2) 쿠폰 충전과 질문이 겹치면 충전분이 덮여 사라졌다.
   가짜 컨테이너가 _etag/IfMatch 를 흉내 내므로 여기서 그 경쟁을 재현할 수 있다.
   실행: cd api && node --test */
const { test } = require('node:test');
const assert = require('node:assert');

process.env.SESSION_SECRET = 'c'.repeat(48);
process.env.LLM_API_KEY = 'test-solar-key';
process.env.ADMIN_EMAILS = 'boss@example.com';

const azPath = require.resolve('@azure/functions');
const routes = {};
require.cache[azPath] = {
  id: azPath, filename: azPath, loaded: true,
  exports: { app: { http: (name, cfg) => { routes[name] = cfg; } } }
};
require('../src/functions/llmChat.js');

const session = require('../src/lib/session');
const credit = require('../src/lib/credit');
const db = require('../src/lib/db');
const { createFake } = require('./fake-container');
const { fake, state } = createFake();
db._setContainer(fake);

const cookieFor = (sub) => {
  const c = session.issue({ sub, name: '학생', email: sub + '@example.com', provider: 'google' });
  return `${c.name}=${encodeURIComponent(c.value)}`;
};
const ask = (sub) => routes.llmChat.handler({
  headers: { get: (k) => ({ cookie: cookieFor(sub), 'content-length': '100' }[k.toLowerCase()] ?? null) },
  json: async () => ({ question: '진자의 주기는 무엇에 따라 달라지나요?', subject: 'physics', model: 'solar' })
}, { error: () => {}, warn: () => {}, log: () => {} });

// AI 응답을 일부러 늦춘다 — 확인과 차감 사이가 벌어져야 예전 버그가 드러난다
let llmFails = false;
global.fetch = async () => {
  await new Promise((r) => setTimeout(r, 30));
  if (llmFails) return new Response('{"error":"down"}', { status: 500, headers: { 'content-type': 'application/json' } });
  return new Response(JSON.stringify({ id: 'x', object: 'chat.completion', created: 0, model: 'solar-pro4',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '질이 아니라 길이에 따라요.' } }] }),
  { status: 200, headers: { 'content-type': 'application/json' } });
};

/** 실서버처럼 _etag 가 붙은 크레딧 문서를 만든다(create 가 붙여 준다) */
const seed = (sub, fields) => fake.items.create({
  id: credit.docId(sub), type: 'credit', pk: sub, userSub: sub, period: credit.currentPeriod(), granted: 2000, ...fields
});

test('1번 값만 남았을 때 동시에 10개를 보내면 답은 1개만 나간다', async () => {
  const sub = 'google:race1';
  await seed(sub, { used: 1900 });   // 100 남음 = Solar 1번
  const results = await Promise.all(Array.from({ length: 10 }, () => ask(sub)));
  const answered = results.filter((r) => r.jsonBody && r.jsonBody.answer);
  assert.strictEqual(answered.length, 1, '공짜 답변이 나가면 안 된다: ' + results.map((r) => r.status || 200).join(','));
  for (const r of results) if (!(r.jsonBody && r.jsonBody.answer)) assert.ok([402, 429].includes(r.status), String(r.status));
  const b = await credit.balance(sub);
  assert.strictEqual(b.remaining, 0);
});

test('잔액이 넉넉하면 동시에 보낸 만큼 정확히 빠진다', async () => {
  const sub = 'google:race2';
  await seed(sub, { used: 0 });
  const results = await Promise.all(Array.from({ length: 6 }, () => ask(sub)));
  const answered = results.filter((r) => r.jsonBody && r.jsonBody.answer).length;
  const b = await credit.balance(sub);
  assert.strictEqual(b.used, answered * 100, `답 ${answered}개, 차감 ${b.used}`);
  assert.ok(answered >= 1);
});

test('AI 호출이 실패하면 잡아 둔 크레딧을 돌려준다', async () => {
  const sub = 'google:race3';
  await seed(sub, { used: 500, bonus: 50 });
  llmFails = true;
  try {
    const res = await ask(sub);
    assert.strictEqual(res.status, 502);
  } finally { llmFails = false; }
  const b = await credit.balance(sub);
  assert.deepStrictEqual([b.used, b.bonus], [500, 50], '실패한 질문은 빼지 않는다');
});

test('충전분부터 잡은 경우에도 실패하면 충전분이 돌아온다', async () => {
  const sub = 'google:race4';
  await seed(sub, { used: 1950, bonus: 200 });   // 무료 50 + 충전 50 을 잡는다
  llmFails = true;
  try { await ask(sub); } finally { llmFails = false; }
  const b = await credit.balance(sub);
  assert.deepStrictEqual([b.used, b.bonus], [1950, 200]);
});

test('쿠폰 충전과 차감이 겹쳐도 충전분이 사라지지 않는다', async () => {
  const sub = 'google:race5';
  await seed(sub, { used: 0, bonus: 0 });
  const coupon = { kind: 'credit', amount: 500 };
  await Promise.all([
    credit.applyCoupon(sub, coupon), credit.consume(sub, 'solar'),
    credit.applyCoupon(sub, coupon), credit.consume(sub, 'solar'),
    credit.consume(sub, 'solar')
  ]);
  const b = await credit.balance(sub);
  assert.deepStrictEqual([b.bonus, b.used], [1000, 300], '충전 2번·차감 3번이 모두 남아야 한다');
});

test('처음 쓰는 사람의 문서를 둘이 동시에 만들어도 둘 다 반영된다', async () => {
  const sub = 'google:race6';
  await Promise.all([credit.consume(sub, 'solar'), credit.consume(sub, 'solar'), credit.grant(sub, 100)]);
  const b = await credit.balance(sub);
  assert.deepStrictEqual([b.used, b.granted], [200, 2100]);
  assert.strictEqual(state.docs.filter((d) => d.id === credit.docId(sub)).length, 1, '문서는 하나여야 한다');
});
