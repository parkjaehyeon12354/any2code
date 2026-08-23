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
   초과할 수 있는데, 그게 "답변을 받다가 잘리는" 것보다 낫다. */

const { container, query } = require('./db');

const TOKENS_PER_CREDIT = 30;
const FREE_CREDITS = 200;

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
  if (!doc) return { remaining: FREE_CREDITS, granted: FREE_CREDITS, used: 0 };
  return {
    remaining: Math.max(0, doc.granted - doc.used),
    granted: doc.granted,
    used: doc.used
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
  const now = new Date().toISOString();
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
      granted: FREE_CREDITS, used: cost,
      createdAt: now, updatedAt: now
    });
  } else {
    await c.item(sub, sub).patch([
      { op: 'set', path: '/used', value: doc.used + cost },
      { op: 'set', path: '/updatedAt', value: now }
    ]);
  }

  const used = (doc ? doc.used : 0) + cost;
  const granted = doc ? doc.granted : FREE_CREDITS;
  return { cost, remaining: Math.max(0, granted - used), granted, used };
}

/** 관리자가 크레딧을 더 준다. 소명이 받아들여진 경우 등. */
async function grant(sub, amount, userName) {
  const now = new Date().toISOString();
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
      granted: FREE_CREDITS + amount, used: 0,
      createdAt: now, updatedAt: now
    });
    return { granted: FREE_CREDITS + amount, used: 0, remaining: FREE_CREDITS + amount };
  }

  await c.item(sub, sub).patch([
    { op: 'set', path: '/granted', value: doc.granted + amount },
    { op: 'set', path: '/updatedAt', value: now }
  ]);
  return {
    granted: doc.granted + amount,
    used: doc.used,
    remaining: Math.max(0, doc.granted + amount - doc.used)
  };
}

module.exports = { balance, allowed, consume, grant, toCredits, TOKENS_PER_CREDIT, FREE_CREDITS };
