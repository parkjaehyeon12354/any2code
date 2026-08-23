/* AI 도우미 크레딧.

   왜 '횟수' 가 아니라 '토큰' 인가 —
   실측해보니 답변 길이가 크게 갈렸다(같은 과학 질문인데 394 ~ 1080 토큰).
   횟수로 세면 짧게 묻는 학생이 손해를 본다. 실제로 쓴 만큼 차감한다.

   단가 근거 (solar-pro4, system 프롬프트 포함 실측 4회):
     렌츠의 법칙            394 토큰
     단진자 주기 유도      1080 토큰
     광합성과 호흡          470 토큰
     산과 염기              699 토큰
     평균 661, 최소 394, 최대 1080

   30 토큰 = 1 크레딧으로 두면
     평균  661 / 30 ≈ 23 크레딧  → 200 크레딧으로 약 8 회
     최소  394 / 30 ≈ 14 크레딧  → 약 14 회
     최대 1080 / 30 ≈ 36 크레딧  → 약 5 회
   목표는 "평균 8회". 짧게 물으면 더 쓰고, 긴 유도를 시키면 덜 쓴다.

   ⚠ 잔액이 모자라도 요청은 막지 않는다. 답변을 받고 나서야 실제 사용량을 알 수
   있기 때문이다. 대신 잔액이 0 이하가 되면 다음 요청이 막힌다. 즉 마지막 한 번은
   초과할 수 있는데, 그게 "답변을 받다가 잘리는" 것보다 낫다.

   ── 주기 초기화 ──
   00시를 기준으로 3시간마다 200 크레딧으로 되돌아간다(00·03·06·09·12·15·18·21시).

   스케줄러를 두지 않고 '읽을 때 판단' 한다. 문서에 마지막 구간을 적어두고, 지금
   구간과 다르면 그 자리에서 사용량을 0 으로 본다. 크론이 없어도 되고, 안 쓰는
   사용자의 문서를 건드리지 않아도 된다.

   시간대는 한국 기준이다. Azure Functions 는 UTC 로 돌기 때문에 그냥 getHours()
   를 쓰면 한국 사용자에게 엉뚱한 시각에 초기화된다. (sanction.js 가 해제일을
   한국 시간으로 찍는 것과 같은 이유다.) */

const { container, query } = require('./db');

const TOKENS_PER_CREDIT = 30;
const FREE_CREDITS = 200;
const RESET_HOURS = 3;

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

/** 토큰 사용량을 크레딧으로 환산. 최소 1 — 0 크레딧으로 쓰는 일은 없어야 한다. */
const toCredits = (tokens) => Math.max(1, Math.ceil((tokens || 0) / TOKENS_PER_CREDIT));

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

/** 쓸 수 있는 상태인가. 잔액이 남아 있으면 true. */
async function allowed(sub) {
  const b = await balance(sub);
  return b.remaining > 0;
}

/* 실제 사용량을 차감한다. 답변을 받은 뒤에 부른다.

   ⚠ 차감에 실패해도 답변은 이미 나갔다. 그 경우 조용히 넘어가되 로그를 남긴다 —
   여기서 예외를 던지면 답변을 받은 사용자에게 오류 화면을 보여주게 된다. */
async function consume(sub, tokens, userName) {
  const cost = toCredits(tokens);
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
    id: sub, type: 'credit', pk: sub,
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
      id: sub, type: 'credit', pk: sub,
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
    id: sub, type: 'credit', pk: sub,
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
  balance, allowed, consume, grant, toCredits,
  currentPeriod, msUntilReset,
  TOKENS_PER_CREDIT, FREE_CREDITS, RESET_HOURS
};
