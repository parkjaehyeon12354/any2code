/* AI 도우미 모델 선택 —
   (1) 목록 밖의 모델은 호출 전에 막는다(클라이언트 입력이다),
   (2) Gemini 는 사고 수준 LOW + 넉넉한 출력 예산으로 부른다 — 예산이 작으면 사고가
       먼저 먹어 답변이 빈다,
   (3) 크레딧은 모델마다 고정으로 뺀다(Solar 100, Gemini 300). 모자라면 묻기 전에 막는다,
   (4) 무료는 Solar 만 — Gemini 는 요금제가 있어야 한다.
   두 제공자 대신 fetch 를 가로채 요청 모양을 본다(openai 패키지도 전역 fetch 를 쓴다). */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

process.env.SESSION_SECRET = 's'.repeat(48);
process.env.VERTEX_API_KEY = 'test-vertex-key';
process.env.LLM_API_KEY = 'test-solar-key';

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
  const c = session.issue({ sub, name: '학생', email: 's@example.com', provider: 'google' });
  return `${c.name}=${encodeURIComponent(c.value)}`;
};
const ask = (body, cookie = cookieFor('google:1')) => routes.llmChat.handler({
  headers: { get: (k) => ({ cookie, 'content-length': '100' }[k.toLowerCase()] ?? null) },
  json: async () => body
}, { error: () => {}, warn: () => {}, log: () => {} });

// Gemini 를 쓰려면 요금제가 있어야 한다. 테스트 사용자에게 Pro 를 준다(extra 로 이번 구간 상태를 덧붙임)
const givePro = (sub, extra = {}) => state.docs.push({
  id: credit.docId(sub), type: 'credit', pk: sub, plan: 'pro', planUntil: '2999-01-01T00:00:00.000Z', ...extra
});
givePro('google:1');

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
const calls = [];
global.fetch = async (url, init) => {
  calls.push({ url: String(url), init, body: JSON.parse(init.body) });
  return String(url).includes('aiplatform.googleapis.com')
    ? json({ candidates: [{ content: { parts: [{ text: '주기는 질량과 무관해요.' }] } }] })
    : json({ id: 'x', object: 'chat.completion', created: 0, model: 'solar-pro4',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '솔라 답변' } }] });
};

test('목록 밖의 모델은 400 이고 외부 호출이 나가지 않는다', async () => {
  calls.length = 0;
  for (const model of ['gpt-5', 'gemini-3.8-pro', { x: 1 }]) {
    const res = await ask({ question: '단진자 주기?', model });
    assert.strictEqual(res.status, 400, `막혀야 한다: ${JSON.stringify(model)}`);
  }
  assert.strictEqual(calls.length, 0);
});

test('Gemini 는 Vertex 에 키 헤더·사고 LOW·넉넉한 예산으로 요청한다', async () => {
  calls.length = 0;
  const res = await ask({ question: '단진자 주기?', model: 'gemini' });
  assert.strictEqual(res.jsonBody.answer, '주기는 질량과 무관해요.');

  const [call] = calls;
  assert.match(call.url, /aiplatform\.googleapis\.com\/.*gemini-3\.8-flash:generateContent$/);
  assert.strictEqual(call.init.headers['x-goog-api-key'], 'test-vertex-key');
  assert.strictEqual(call.body.generationConfig.thinkingConfig.thinkingLevel, 'LOW');
  assert.ok(call.body.generationConfig.maxOutputTokens > 800,
    '800 이하면 사고 토큰이 예산을 먹어 답변이 빈다');
  assert.match(call.body.systemInstruction.parts[0].text, /안전 규칙/, 'system 프롬프트가 같이 가야 한다');
  assert.match(call.body.contents[0].parts[0].text, /^<question>\n단진자 주기\?\n<\/question>$/);
});

test('무료 사용자가 Gemini 를 고르면 403 이고 외부 호출이 나가지 않는다', async () => {
  calls.length = 0;
  const res = await ask({ question: '짧게', model: 'gemini' }, cookieFor('google:free'));
  assert.strictEqual(res.status, 403);
  assert.match(res.jsonBody.error, /요금제/);
  assert.strictEqual(calls.length, 0);
  assert.strictEqual((await ask({ question: '짧게', model: 'solar' }, cookieFor('google:free'))).jsonBody.credit.spent, 100);
});

test('모델마다 고정으로 뺀다 — Solar 100, Gemini 300, 모델을 안 보내면 Solar', async () => {
  givePro('google:fixed');
  const cookie = cookieFor('google:fixed');
  const solar = await ask({ question: '짧게', model: 'solar' }, cookie);
  assert.strictEqual(solar.jsonBody.answer, '솔라 답변');
  assert.strictEqual(solar.jsonBody.credit.spent, 100);
  assert.strictEqual((await ask({ question: '짧게', model: 'gemini' }, cookie)).jsonBody.credit.spent, 300);
  const dflt = await ask({ question: '짧게' }, cookie);
  assert.strictEqual(dflt.jsonBody.credit.spent, 100);
  assert.strictEqual(dflt.jsonBody.credit.remaining, 8000 - 100 - 300 - 100, 'Pro 한도는 8000');
});

test('잔액이 모델 값보다 적으면 묻기 전에 막는다 — 200 남으면 Gemini 402, Solar 는 된다', async () => {
  const sub = 'google:low';
  givePro(sub, { period: credit.currentPeriod(), granted: 8000, used: 7800 });   // 200 남음
  calls.length = 0;
  const g = await ask({ question: '짧게', model: 'gemini' }, cookieFor(sub));
  assert.strictEqual(g.status, 402);
  assert.match(g.jsonBody.error, /300/);
  assert.strictEqual(g.jsonBody.credit.remaining, 200, '실제 잔액을 알려줘야 배지가 맞는다');
  assert.strictEqual(calls.length, 0, '막힌 요청이 외부 호출을 내면 안 된다');

  const s = await ask({ question: '짧게', model: 'solar' }, cookieFor(sub));
  assert.strictEqual(s.jsonBody.credit.remaining, 100);
});

test('id 가 sub 그대로인 옛 크레딧 문서(8/24)가 있어도 사용량이 쌓인다', async () => {
  // 운영 DB 에 실제로 남아 있는 모양 — period 가 없다. 조회에서 먼저 잡히게 앞에 둔다.
  const sub = 'google:legacy';
  state.docs.unshift({ id: sub, type: 'credit', pk: sub, userSub: sub, used: 212, granted: 200 });
  await credit.consume(sub, 'solar');
  const after = await credit.consume(sub, 'gemini');
  assert.strictEqual(after.used, 400, '옛 문서를 집으면 매번 새 구간으로 착각해 300 만 남는다');
  assert.strictEqual((await credit.balance(sub)).remaining, 1600);
});

test('Gemini 오류 원문은 학생에게 보이지 않고, 실패한 질문은 차감하지 않는다', async () => {
  const saved = global.fetch;
  global.fetch = async () => json({ error: { message: 'API key not valid' } }, 403);
  const sub = 'google:err';
  givePro(sub);
  try {
    const res = await ask({ question: '단진자 주기?', model: 'gemini' }, cookieFor(sub));
    assert.strictEqual(res.status, 502);
    assert.doesNotMatch(res.jsonBody.error, /API key/);
    assert.strictEqual((await credit.balance(sub)).remaining, 8000);
  } finally {
    global.fetch = saved;
  }
});

test('화면 선택지에 적힌 값이 가격표와 같다', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../science.html'), 'utf8');
  for (const [model, cost] of Object.entries(credit.MODEL_COST)) {
    assert.match(html, new RegExp(`<option value="${model}">[^<]*· ${cost}</option>`),
      `${model} 선택지에 ${cost} 가 적혀 있어야 한다`);
  }
});
