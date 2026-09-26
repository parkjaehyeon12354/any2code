/* AI 도우미 크레딧 — 모델마다 질문 1번에 고정으로 뺀다(할당제).

   예전에는 실제 토큰 수로 뺐다(30 토큰 = 1 크레딧). 그런데 안전 규칙이 붙어
   system 프롬프트가 600 토큰이 되자, 질문과 상관없이 매번 20 크레딧이 기본으로
   빠져 쓸 수 있는 횟수가 반토막 났다. 학생 입장에서도 "한 번에 얼마" 가 읽기 쉽다.

   값은 질문 1번을 약 3,000 토큰으로 보고 모델 단가대로 매겼다:
     solar  100 크레딧 (3,000 ÷ 30)
     gemini 300 크레딧 (토큰 단가가 Solar 의 약 3배)
   3시간마다 2,000 크레딧 → Solar 만 20회, Gemini 만 6회. 섞어 써도 된다.

   고정이라 묻기 전에 값을 안다. 그래서 잔액이 그 값보다 적으면 미리 막는다 —
   토큰 기준일 때처럼 마지막 한 번이 잔액을 넘는 일이 없다.

   ⚠ 첫 항목이 기본 모델이다. llmChat 이 이 표의 키를 허용 목록으로 쓰므로,
   모델을 늘리려면 여기에 값을 매겨야 한다.

   ── 주기 초기화 ──
   00시를 기준으로 3시간마다 2,000 크레딧으로 되돌아간다(00·03·06·09·12·15·18·21시).

   스케줄러를 두지 않고 '읽을 때 판단' 한다. 문서에 마지막 구간을 적어두고, 지금
   구간과 다르면 그 자리에서 사용량을 0 으로 본다. 크론이 없어도 되고, 안 쓰는
   사용자의 문서를 건드리지 않아도 된다.

   시간대는 한국 기준이다. Azure Functions 는 UTC 로 돌기 때문에 그냥 getHours()
   를 쓰면 한국 사용자에게 엉뚱한 시각에 초기화된다. (sanction.js 가 해제일을
   한국 시간으로 찍는 것과 같은 이유다.) */

const { container, query } = require('./db');

const MODEL_COST = { solar: 100, gemini: 300 };
const FREE_CREDITS = 2000;
const RESET_HOURS = 3;

/* 문서 id.

   ⚠ `sub` 을 그대로 id 로 쓰면 안 된다. Cosmos 는 (id, partitionKey) 로 문서를
   구분하는데, 제재 문서(sanction)가 이미 `id: sub, pk: sub` 을 쓰고 있다.
   같은 자리를 두 문서가 다투게 되어 서로를 덮어쓴다.

   실제로 그렇게 만들었다가, 제재를 받은 적 있는 계정만 크레딧 지급이 503 으로
   실패했다. 제재 이력이 없는 계정은 멀쩡해서 원인이 한참 늦게 드러났다.
   profile.js 가 `'user:' + sub` 를 쓰는 것과 같은 이유다. */
const docId = (sub) => 'credit:' + sub;

/* 지금이 속한 초기화 구간의 시작 시각(ISO).

   한국 시간(UTC+9) 기준 00시부터 3시간 단위로 끊는다. 같은 구간 안에서는 항상
   같은 값이 나오므로, 문서에 적어둔 값과 비교하면 초기화 여부를 알 수 있다. */
function currentPeriod(now = Date.now()) {
  const KST_OFFSET = 9 * 60 * 60 * 1000;
  const kst = now + KST_OFFSET;
  const slot = Math.floor(kst / (RESET_HOURS * 60 * 60 * 1000)) * (RESET_HOURS * 60 * 60 * 1000);
  return new Date(slot - KST_OFFSET).toISOString();
}

/** 다음 초기화까지 남은 밀리초. 화면이 "n시간 뒤 충전" 을 보여줄 때 쓴다. */
function msUntilReset(now = Date.now()) {
  const period = RESET_HOURS * 60 * 60 * 1000;
  return period - ((now + 9 * 60 * 60 * 1000) % period);
}

/* 잔액 문서는 사용자당 하나다(id = pk = sub).
   없으면 아직 한 번도 안 쓴 사람이므로 무료 크레딧을 그대로 돌려준다 —
   가입 시점에 문서를 만들지 않아도 되게 해서, 기존 사용자도 자동으로 포함된다. */
async function balance(sub) {
  const rows = await query({
    query: "SELECT * FROM c WHERE c.type = 'credit' AND c.pk = @s",
    parameters: [{ name: '@s', value: sub }]
  });
  const doc = rows[0];
  const now = Date.now();
  const period = currentPeriod(now);
  const resetInMs = msUntilReset(now);

  if (!doc) {
    return { remaining: FREE_CREDITS, granted: FREE_CREDITS, used: 0, resetInMs };
  }

  /* 구간이 바뀌었으면 사용량은 없던 것으로 본다.
     여기서 문서를 고치지는 않는다 — 읽기만 하는 함수가 쓰기까지 하면 /api/me
     호출마다 DB 쓰기가 생긴다. 실제 기록은 다음 consume 이 정리한다. */
    const used = doc.period === period ? doc.used : 0;
  const granted = doc.period === period ? doc.granted : FREE_CREDITS;

  return {
    remaining: Math.max(0, granted - used),
    granted,
    used,
    resetInMs
  };
}

/* 모델 값만큼 차감한다. 답변을 받은 뒤에 부른다 — 호출이 실패하면 빼지 않는다.

   ⚠ 차감에 실패해도 답변은 이미 나갔다. 그 경우 조용히 넘어가되 로그를 남긴다 —
   여기서 예외를 던지면 답변을 받은 사용자에게 오류 화면을 보여주게 된다. */
async function consume(sub, model, userName) {
  const cost = MODEL_COST[model];
  if (!cost) throw new Error('알 수 없는 모델: ' + model);
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const period = currentPeriod(nowMs);
  const c = container();

  const rows = await query({
    query: "SELECT * FROM c WHERE c.type = 'credit' AND c.pk = @s",
    parameters: [{ name: '@s', value: sub }]
  });
  const doc = rows[0];

  // 구간이 바뀌었으면 이전 사용량은 버리고 새로 센다.
  const rolled = doc && doc.period !== period;
  const prevUsed = doc && !rolled ? doc.used : 0;
  const granted = doc && !rolled ? doc.granted : FREE_CREDITS;
  const used = prevUsed + cost;

  /* upsert 로 통째로 쓴다. patch 는 쓰지 않는다 —
     크레딧 기능 이전에 만들어진 문서에는 `period` 필드가 없어서 `set /period`
     가 실패한다. 차감이 조용히 실패하면 한도가 사실상 없어진다. */
  await c.items.upsert({
    id: docId(sub), type: 'credit', pk: sub,
    userSub: sub,
    userName: userName || (doc && doc.userName) || null,
    granted,
    used,
    period,
    createdAt: (doc && doc.createdAt) || now,
    updatedAt: now
  });

  return {
    cost,
    remaining: Math.max(0, granted - used),
    granted,
    used,
    resetInMs: msUntilReset(nowMs)
  };
}

/* 관리자가 크레딧을 더 준다. 소명이 받아들여진 경우 등.

   ⚠ 이 추가분은 다음 초기화(3시간)에 사라진다. granted 는 구간이 바뀌면
   FREE_CREDITS 로 돌아가기 때문이다. 3시간마다 다시 채워지는 구조라 그게
   자연스럽다 — 영구 지급이 필요해지면 별도 필드를 둬야 한다. */
async function grant(sub, amount, userName) {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const period = currentPeriod(nowMs);
  const c = container();
  const rows = await query({
    query: "SELECT * FROM c WHERE c.type = 'credit' AND c.pk = @s",
    parameters: [{ name: '@s', value: sub }]
  });
  const doc = rows[0];

  if (!doc) {
    await c.items.create({
      id: docId(sub), type: 'credit', pk: sub,
      userSub: sub, userName: userName || null,
      granted: FREE_CREDITS + amount, used: 0, period,
      createdAt: now, updatedAt: now
    });
    return { granted: FREE_CREDITS + amount, used: 0, remaining: FREE_CREDITS + amount };
  }

  // 구간이 지난 문서라면 이번 구간 기준으로 다시 세운다
  const rolled = doc.period !== period;
  const base = rolled ? FREE_CREDITS : doc.granted;
  const used = rolled ? 0 : doc.used;

  /* upsert 로 통째로 쓴다.

     patch 를 쓰면 안 된다 — 크레딧 기능을 붙이기 전에 만들어진 문서에는
     `period` 필드가 없어서 `set /period` 가 실패한다. 실제로 그렇게 짰다가
     기존 문서를 가진 사용자만 503 이 났다(새 사용자는 create 경로라 멀쩡했다).
     같은 이유로 llmChat 의 제재 문서도 upsert 를 쓴다. */
  await c.items.upsert({
    id: docId(sub), type: 'credit', pk: sub,
    userSub: sub,
    userName: userName || doc.userName || null,
    granted: base + amount,
    used,
    period,
    createdAt: doc.createdAt || now,
    updatedAt: now
  });
  return {
    granted: base + amount,
    used,
    remaining: Math.max(0, base + amount - used)
  };
}

module.exports = {
  balance, consume, grant,
  currentPeriod, msUntilReset,
  MODEL_COST, FREE_CREDITS, RESET_HOURS
};
