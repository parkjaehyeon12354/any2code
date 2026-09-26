/* AI 도우미 모델 선택 —
   (1) 목록 밖의 모델은 호출 전에 막는다(클라이언트 입력이다),
   (2) Gemini 는 사고 수준 LOW + 넉넉한 출력 예산으로 부른다 — 예산이 작으면 사고가
       먼저 먹어 답변이 빈다,
   (3) 크레딧은 사고 토큰까지 합친 totalTokenCount 로 차감한다.
   구글 서버 대신 fetch 를 가로채 요청 모양을 본다. */
const { test } = require('node:test');
const assert = require('node:assert');

process.env.SESSION_SECRET = 's'.repeat(48);
process.env.VERTEX_API_KEY = 'test-vertex-key';

const azPath = require.resolve('@azure/functions');
const routes = {};
require.cache[azPath] = {
  id: azPath, filename: azPath, loaded: true,
  exports: { app: { http: (name, cfg) => { routes[name] = cfg; } } }
};
require('../src/functions/llmChat.js');

const session = require('../src/lib/session');
const db = require('../src/lib/db');
const { createFake } = require('./fake-container');
db._setContainer(createFake().fake);

const c = session.issue({ sub: 'google:1', name: '학생', email: 's@example.com', provider: 'google' });
const cookie = `${c.name}=${encodeURIComponent(c.value)}`;
const ask = (body) => routes.llmChat.handler({
  headers: { get: (k) => ({ cookie, 'content-length': '100' }[k.toLowerCase()] ?? null) },
  json: async () => body
}, { error: () => {}, warn: () => {}, log: () => {} });

const calls = [];
global.fetch = async (url, init) => {
  calls.push({ url, init, body: JSON.parse(init.body) });
  return {
    ok: true, status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: '주기는 질량과 무관해요.' }] } }],
      usageMetadata: { totalTokenCount: 900 }
    })
  };
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

test('크레딧은 사고 토큰까지 합친 totalTokenCount 로 차감한다', async () => {
  const res = await ask({ question: '단진자 주기?', model: 'gemini' });
  assert.strictEqual(res.jsonBody.credit.spent, 30, '900 토큰 = 30 크레딧');
});

test('Gemini 오류 원문은 학생에게 보이지 않는다', async () => {
  const saved = global.fetch;
  global.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'API key not valid' } }) });
  try {
    const res = await ask({ question: '단진자 주기?', model: 'gemini' });
    assert.strictEqual(res.status, 502);
    assert.doesNotMatch(res.jsonBody.error, /API key/);
  } finally {
    global.fetch = saved;
  }
});
