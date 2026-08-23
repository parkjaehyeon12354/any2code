/* AI 크레딧 —
   200 크레딧으로 평균 8회쯤 쓸 수 있어야 한다. 단가를 잘못 잡으면 대회 시연
   중에 크레딧이 떨어지거나, 반대로 한도가 사실상 없는 것이 된다.

   실측값(solar-pro4, system 프롬프트 포함)을 그대로 넣어 회수를 검증한다. */
process.env.SESSION_SECRET = 'test-secret-for-unit-tests-only';

const test = require('node:test');
const assert = require('node:assert');

const credit = require('../src/lib/credit');
const { toCredits, TOKENS_PER_CREDIT, FREE_CREDITS } = credit;

// 실제로 측정한 대화 4건
const MEASURED = {
  '렌츠의 법칙': 394,
  '단진자 주기 유도': 1080,
  '광합성과 호흡': 470,
  '산과 염기': 699
};
const AVG = Math.round(Object.values(MEASURED).reduce((a, b) => a + b, 0) / 4);   // 661

test('무료 크레딧은 200', () => {
  assert.strictEqual(FREE_CREDITS, 200);
});

test('평균 질문이면 200 크레딧으로 8회쯤 쓸 수 있다', () => {
  const per = toCredits(AVG);
  const rounds = Math.floor(FREE_CREDITS / per);
  assert.ok(rounds >= 7 && rounds <= 9,
    `평균 ${AVG} 토큰 → ${per} 크레딧/회 → ${rounds} 회 (목표 8회 근처여야 한다)`);
});

test('짧은 질문은 더, 긴 질문은 덜 쓸 수 있다', () => {
  const short = Math.floor(FREE_CREDITS / toCredits(MEASURED['렌츠의 법칙']));
  const long = Math.floor(FREE_CREDITS / toCredits(MEASURED['단진자 주기 유도']));
  assert.ok(short > long, '짧은 질문이 더 많이 가능해야 한다');
  assert.ok(long >= 4, `가장 긴 질문도 최소 4회는 되어야 한다 (현재 ${long}회)`);
  assert.ok(short <= 20, `짧은 질문이라도 무제한처럼 보이면 안 된다 (현재 ${short}회)`);
});

test('0 크레딧으로 쓰는 일은 없다', () => {
  // 반올림으로 0 이 되면 무한정 쓸 수 있는 구멍이 된다
  for (const t of [0, 1, 5, TOKENS_PER_CREDIT - 1]) {
    assert.ok(toCredits(t) >= 1, `${t} 토큰이 0 크레딧이 되면 안 된다`);
  }
  // usage 가 없어 0 이 들어와도 최소 1
  assert.strictEqual(toCredits(undefined), 1);
  assert.strictEqual(toCredits(null), 1);
});

test('올림으로 계산한다 — 조금 넘겨도 한 크레딧을 받는다', () => {
  assert.strictEqual(toCredits(TOKENS_PER_CREDIT), 1);
  assert.strictEqual(toCredits(TOKENS_PER_CREDIT + 1), 2);
  assert.strictEqual(toCredits(TOKENS_PER_CREDIT * 3), 3);
});

test('사용량이 많을수록 크레딧도 많이 든다', () => {
  const sorted = Object.values(MEASURED).slice().sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(toCredits(sorted[i]) >= toCredits(sorted[i - 1]),
      '토큰이 늘면 크레딧도 줄지 않아야 한다');
  }
});

test('한도 도달은 402로 알린다 — 401/403 과 구분되어야 한다', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../src/functions/llmChat.js'), 'utf8');
  assert.ok(/remaining <= 0[\s\S]{0,200}status: 402/.test(src),
    '잔액이 없으면 402 를 반환해야 한다');
  // 402 는 "한도 도달"이지 "로그인 필요"(401)나 "정지"(403)가 아니다
  assert.ok(/status: 401/.test(src) && /status: 403/.test(src),
    '401/403 과 함께 쓰여 구분이 유지되어야 한다');
});

test('차감은 답변을 받은 뒤에 한다', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../src/functions/llmChat.js'), 'utf8');
  const callAt = src.indexOf('await callLLM(');
  const consumeAt = src.indexOf('credit.consume(');
  assert.ok(callAt > 0 && consumeAt > callAt,
    '실제 사용량을 알아야 차감할 수 있으므로 callLLM 뒤여야 한다');
});

test('차감 실패가 답변을 막지 않는다', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../src/functions/llmChat.js'), 'utf8');
  // 답변은 이미 만들어졌다. 여기서 예외를 던지면 사용자가 오류 화면을 본다.
  assert.ok(/credit\.consume\([\s\S]{0,120}\}\s*catch/.test(src),
    'consume 은 try/catch 로 감싸야 한다');
});
