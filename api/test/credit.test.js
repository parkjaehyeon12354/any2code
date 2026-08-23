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

/* ── 3시간 주기 초기화 ──
   시간대 실수는 조용히 틀린다. 한국 00시에 초기화돼야 하는데 UTC 로 계산하면
   오전 9시에 초기화된다. 경계값을 직접 박아 확인한다. */

const { currentPeriod, msUntilReset, RESET_HOURS } = credit;

// 한국 시각을 UTC 밀리초로. (KST = UTC+9)
const kst = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h - 9, mi);

test('초기화는 3시간마다', () => {
  assert.strictEqual(RESET_HOURS, 3);
});

test('한국 00시·03시·…·21시에 구간이 바뀐다', () => {
  const boundaries = [0, 3, 6, 9, 12, 15, 18, 21];
  for (const h of boundaries) {
    const at = kst(2026, 8, 24, h);
    // 경계 직전과 직후는 서로 다른 구간이어야 한다
    assert.notStrictEqual(
      currentPeriod(at - 1000), currentPeriod(at),
      `한국 ${h}시 경계에서 구간이 바뀌어야 한다`
    );
  }
});

test('같은 구간 안에서는 값이 변하지 않는다', () => {
  // 한국 13:00 과 14:59 는 같은 구간(12~15시)
  const a = currentPeriod(kst(2026, 8, 24, 13, 0));
  const b = currentPeriod(kst(2026, 8, 24, 14, 59));
  assert.strictEqual(a, b, '같은 3시간 구간이면 같은 값이어야 한다');

  // 15:00 은 다음 구간
  const c = currentPeriod(kst(2026, 8, 24, 15, 0));
  assert.notStrictEqual(b, c, '15시부터는 다음 구간이어야 한다');
});

test('한국 자정에 초기화된다 — UTC 자정이 아니다', () => {
  /* ⚠ 이 검사를 "경계에서 값이 바뀌는가" 로만 짜면 시간대 버그를 못 잡는다.
     KST 오프셋 9시간이 초기화 주기 3시간의 배수라, 보정을 빼먹어도 경계 위치는
     그대로다(실제로 보정을 지우고 돌려봤더니 전부 통과했다).

     그래서 구간 경계의 '실제 시각' 을 본다. 한국 시간으로 읽었을 때 반드시
     0·3·6·9·12·15·18·21시 정각이어야 한다. */
  const toKstHour = (iso) => {
    const d = new Date(iso);
    return (d.getUTCHours() + 9) % 24;
  };

  for (const h of [0, 1, 2, 5, 8, 11, 14, 17, 20, 23]) {
    for (const mi of [0, 17, 45]) {
      const iso = currentPeriod(kst(2026, 8, 24, h, mi));
      const kh = toKstHour(iso);
      assert.strictEqual(kh % RESET_HOURS, 0,
        `한국 ${h}:${mi} → 구간 시작이 ${kh}시. 3의 배수여야 한다`);
      assert.strictEqual(kh, h - (h % RESET_HOURS),
        `한국 ${h}:${mi} 는 ${h - (h % RESET_HOURS)}시 구간에 속해야 한다`);
      // 분·초는 항상 0
      const d = new Date(iso);
      assert.strictEqual(d.getUTCMinutes(), 0, '구간 시작은 정각이어야 한다');
      assert.strictEqual(d.getUTCSeconds(), 0, '구간 시작은 정각이어야 한다');
    }
  }

  // 한국 자정을 넘으면 반드시 다른 구간
  assert.notStrictEqual(
    currentPeriod(kst(2026, 8, 24, 23, 59)),
    currentPeriod(kst(2026, 8, 25, 0, 0)),
    '한국 자정에 바뀌어야 한다'
  );
});

test('남은 시간은 0보다 크고 3시간 이하', () => {
  for (const h of [0, 1, 2, 3, 7, 13, 22]) {
    for (const mi of [0, 1, 30, 59]) {
      const ms = msUntilReset(kst(2026, 8, 24, h, mi));
      assert.ok(ms > 0, `${h}:${mi} — 남은 시간이 0 이하면 안 된다`);
      assert.ok(ms <= RESET_HOURS * 3600 * 1000, `${h}:${mi} — 3시간을 넘으면 안 된다`);
    }
  }
});

test('경계 직전에는 남은 시간이 1분 이내', () => {
  const ms = msUntilReset(kst(2026, 8, 24, 14, 59.5));
  assert.ok(ms <= 60000, `15시 직전인데 ${Math.round(ms / 1000)}초 남았다고 나온다`);
});

test('구간이 바뀌면 사용량을 0으로 본다', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../src/lib/credit.js'), 'utf8');
  // balance / consume 양쪽 모두 period 를 비교해야 한다.
  // 한쪽만 하면 잔액은 회복됐는데 차감이 옛 값에 누적되는 식으로 어긋난다.
  assert.ok(/doc\.period === period \? doc\.used : 0/.test(src),
    'balance 가 구간을 비교해야 한다');
  assert.ok(/doc\.period !== period/.test(src),
    'consume 이 구간을 비교해야 한다');
});

test('credit 문서 id 는 sanction 과 겹치지 않는다', () => {
  /* Cosmos 는 (id, partitionKey) 로 문서를 구분한다. 제재 문서가 이미
     `id: sub, pk: sub` 을 쓰므로, credit 이 같은 값을 쓰면 두 문서가 같은
     자리를 다투게 되어 서로를 덮어쓴다.

     실제로 그렇게 만들었다가 제재 이력이 있는 계정만 크레딧 지급이 503 으로
     실패했다. 제재를 받은 적 없는 계정은 멀쩡해서 원인이 한참 늦게 드러났다. */
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../src/lib/credit.js'), 'utf8');

  assert.ok(/const docId = \(sub\) => 'credit:' \+ sub/.test(src),
    'credit 문서는 접두사 붙은 id 를 써야 한다');
  assert.ok(!/id: sub, type: 'credit'/.test(src),
    "id 에 sub 을 그대로 쓰면 sanction 문서와 충돌한다");

  // pk 는 sub 그대로여야 한다 — 조회가 pk 로 걸린다
  const writes = src.match(/id: docId\(sub\), type: 'credit', pk: sub,/g) || [];
  assert.ok(writes.length >= 3,
    `문서를 쓰는 모든 곳이 같은 규칙이어야 한다 (현재 ${writes.length}곳)`);
});

test('문서 쓰기는 patch 가 아니라 upsert 를 쓴다', () => {
  /* 크레딧 기능을 붙이기 전에 만들어진 문서에는 `period` 필드가 없다.
     patch 의 `set /period` 는 그런 문서에서 실패해 503 이 난다.

     실제로 겪었다 — 관리자 지급이 "기존에 쓴 적 있는 사용자" 에게만 실패했다.
     새 사용자는 create 경로라 멀쩡해서 원인이 늦게 드러났다.
     차감(consume)이 같은 식으로 조용히 실패하면 한도가 사실상 없어진다. */
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../src/lib/credit.js'), 'utf8');

  assert.ok(!/\.item\(sub, sub\)\.patch\(/.test(src),
    'credit 문서에 patch 를 쓰면 옛 문서에서 실패한다 — upsert 를 쓸 것');
  // consume 과 grant 양쪽 모두 upsert 여야 한다
  const upserts = src.match(/items\.upsert\(/g) || [];
  assert.ok(upserts.length >= 2,
    `consume 과 grant 둘 다 upsert 여야 한다 (현재 ${upserts.length}곳)`);
});

/* ── 관리자 크레딧 지급 ── */

const ADMIN_SRC = require('fs').readFileSync(
  require('path').join(__dirname, '../src/functions/admin.js'), 'utf8');

test("관리자 크레딧 경로는 'admin/' 을 쓰지 않는다", () => {
  /* Azure Functions 런타임이 'admin/' 접두사를 자기 관리 API 용으로 예약해서,
     쓰면 등록이 조용히 거부된다 — 파일은 로드되는데 라우트만 사라져 404 가 나고
     로그에도 안 남는다. 그래서 'moderation/' 을 쓴다. */
  assert.ok(/route: 'moderation\/credits'/.test(ADMIN_SRC));
  assert.ok(/route: 'moderation\/credits\/grant'/.test(ADMIN_SRC));
  assert.ok(!/route: 'admin\//.test(ADMIN_SRC), "'admin/' 접두사는 라우트가 사라진다");
});

test('크레딧 API 는 관리자만 쓸 수 있다', () => {
  // admin.html 은 누구나 열 수 있다. 데이터를 안 내주는 것이 유일한 방어선이다.
  const credits = ADMIN_SRC.slice(ADMIN_SRC.indexOf("route: 'moderation/credits'"));
  const grant = ADMIN_SRC.slice(ADMIN_SRC.indexOf("route: 'moderation/credits/grant'"));
  assert.ok(/requireAdmin\(request\)/.test(credits.slice(0, 700)),
    '목록 조회가 requireAdmin 을 거쳐야 한다');
  assert.ok(/requireAdmin\(request\)/.test(grant.slice(0, 700)),
    '지급이 requireAdmin 을 거쳐야 한다');
});

test('지급 금액에 상한이 있다', () => {
  // 오타 하나로 백만 크레딧을 주는 사고를 막는다.
  assert.ok(/amount > 2000/.test(ADMIN_SRC), '상한 검사가 있어야 한다');
  assert.ok(/amount <= 0/.test(ADMIN_SRC), '0 이하를 막아야 한다');
  assert.ok(/Number\.isFinite\(amount\)/.test(ADMIN_SRC), 'NaN 을 막아야 한다');
});

test('목록은 사용자 기준이다 — 아직 안 쓴 사람도 나와야 한다', () => {
  /* credit 문서는 한 번이라도 쓴 사람만 갖고 있다. 그것만 보면 정작 크레딧이
     필요한 신규 사용자가 목록에서 빠진다. */
  const seg = ADMIN_SRC.slice(ADMIN_SRC.indexOf("route: 'moderation/credits'"));
  assert.ok(/c\.type = 'user'/.test(seg.slice(0, 1200)),
    'user 문서를 기준으로 조회해야 한다');
});
