/* AI 도우미 크레딧 — 모델마다 질문 1번에 고정으로 뺀다(할당제).

   예전에는 실제 토큰 수로 뺐다(30 토큰 = 1 크레딧). 그런데 안전 규칙이 붙어
   system 프롬프트가 600 토큰이 되자, 질문과 상관없이 매번 20 크레딧이 기본으로
   빠져 쓸 수 있는 횟수가 반토막 났다. 학생 입장에서도 "한 번에 얼마" 가 읽기 쉽다.

   값은 질문 1번을 약 3,000 토큰으로 보고 모델 단가대로 매겼다:
     solar  100 크레딧 (3,000 ÷ 30)
     gemini 300 크레딧 (토큰 단가가 Solar 의 약 3배)
   무료는 3시간마다 2,000 크레딧 → Solar 20회. 요금제(PLANS)는 한도가 더 크고 Gemini 를 쓸 수 있다.
   쿠폰으로 충전한 크레딧(bonus)은 초기화와 무관하게 다 쓸 때까지 남는다.

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
const RESET_HOURS = 3;

/* 요금제 — 3시간마다 채워지는 양과 고를 수 있는 모델이 다르다.
   요금제는 쿠폰으로만 생긴다(functions/coupon.js). 기간이 지나면 저절로 무료로
   돌아간다 — 만료를 처리하는 작업 없이 읽을 때 planUntil 과 지금을 비교한다
   (3시간 초기화와 같은 '읽을 때 판단' 방식). 요금제 전용 기능을 붙일 때도
   planOf() 로 판정하면 된다. */
const PLANS = {
  free:      { label: '무료',       credits: 2000,  models: ['solar'] },
  pro:       { label: 'Pro',        credits: 8000,  models: ['solar', 'gemini'] },
  education: { label: '에듀케이션', credits: 8000,  models: ['solar', 'gemini'] },
  teacher:   { label: '티처',       credits: 50000, models: ['solar', 'gemini'] }
};
const FREE_CREDITS = PLANS.free.credits;

/* 관리자 요금제 — 크레딧 무제한, 모든 모델. **PLANS 에 넣지 않는다**: 쿠폰 발급은 PLANS 의
   키만 받으므로(coupon.js issueError), 여기 있으면 쿠폰 하나로 무제한이 새어 나간다.
   누가 관리자인지는 요청마다 session.isAdmin(ADMIN_EMAILS) 으로 정하고, 문서에는 쓰지 않는다 —
   ADMIN_EMAILS 에서 빼면 바로 원래 요금제로 돌아간다. 저장된 잔액은 건드리지 않고 보여 주는 값만 바꾼다. */
const asAdmin = (v) => ({ ...v, plan: 'admin', planLabel: '관리자', planUntil: null, models: Object.keys(MODEL_COST), unlimited: true });

/* 문서 id.

   ⚠ `sub` 을 그대로 id 로 쓰면 안 된다. Cosmos 는 (id, partitionKey) 로 문서를
   구분하는데, 제재 문서(sanction)가 이미 `id: sub, pk: sub` 을 쓰고 있다.
   같은 자리를 두 문서가 다투게 되어 서로를 덮어쓴다.

   실제로 그렇게 만들었다가, 제재를 받은 적 있는 계정만 크레딧 지급이 503 으로
   실패했다. 제재 이력이 없는 계정은 멀쩡해서 원인이 한참 늦게 드러났다.
   profile.js 가 `'user:' + sub` 를 쓰는 것과 같은 이유다. */
const docId = (sub) => 'credit:' + sub;

/* 이 사용자의 크레딧 문서. 반드시 id 로 집는다.

   ⚠ 8/24 에 40분쯤 id 를 sub 그대로 쓴 옛 문서가 운영 DB 에 남아 있다(4개).
   type·pk 로만 찾으면 두 개가 잡히고, 옛 것(period 없음)이 먼저 오면 매번 새 구간으로
   착각해 사용량이 쌓이지 않았다 — 해당 계정은 한도가 사실상 없었다. */
async function readDoc(sub) {
  const rows = await query({
    query: "SELECT * FROM c WHERE c.type = 'credit' AND c.pk = @s AND c.id = @id",
    parameters: [{ name: '@s', value: sub }, { name: '@id', value: docId(sub) }]
  });
  return rows[0];
}

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

/** 지금 적용 중인 요금제. 기간이 지났거나 없으면 'free'. */
const planOf = (doc, nowMs = Date.now()) =>
  doc && PLANS[doc.plan] && doc.planUntil > new Date(nowMs).toISOString() ? doc.plan : 'free';

/* 문서 하나를 '지금' 기준으로 읽는다. 잔액·차감·지급·쿠폰·관리자 목록이 모두 이걸 쓴다.

   - 구간이 바뀌었으면 사용량은 0, 한도(granted)는 지금 요금제 값이다.
     문서를 고치지는 않는다 — /api/me 호출마다 DB 쓰기가 생긴다. 다음 쓰기가 정리한다.
   - 충전 잔액(bonus)은 쿠폰으로 받은 크레딧이다. 구간과 무관하게 다 쓸 때까지 남는다.
   - remaining 은 지금 쓸 수 있는 전부(무료 남은 양 + 충전 잔액)다.
   문서가 없으면 아직 한 번도 안 쓴 사람이다 — 가입 때 만들지 않아도 된다. */
function view(doc, nowMs = Date.now()) {
  const period = currentPeriod(nowMs);
  const plan = planOf(doc, nowMs);
  const fresh = !!doc && doc.period === period;
  const granted = fresh ? doc.granted : PLANS[plan].credits;
  const used = fresh ? doc.used : 0;
  const bonus = (doc && doc.bonus) || 0;
  const free = Math.max(0, granted - used);
  return {
    remaining: free + bonus, free, bonus, granted, used, period,
    plan, planLabel: PLANS[plan].label, planUntil: plan === 'free' ? null : doc.planUntil,
    models: PLANS[plan].models,
    resetInMs: msUntilReset(nowMs)
  };
}

/* 통째로 쓴다. patch 는 쓰지 않는다 — 기능을 붙이기 전에 만들어진 문서에는
   새 필드(period·bonus·plan)가 없어서 patch 가 실패한다. 실제로 그렇게 짰다가
   기존 문서를 가진 사용자만 503 이 났다. 기존 필드는 펼쳐서 보존한다 —
   차감이 bonus·plan 을 빠뜨리고 쓰면 충전한 크레딧과 요금제가 조용히 사라진다.

   ⚠ 동시 요청. 예전에는 '읽고 → 계산하고 → 그냥 upsert' 였다. 같은 사람이 질문을 동시에
   10개 보내면 10개가 같은 잔액을 읽고, 마지막에 쓴 하나만 남아 차감이 1번만 됐다.
   쿠폰 충전과 질문이 겹치면 충전분이 덮여 사라지기도 했다.
   그래서 읽을 때 받은 _etag 를 IfMatch 로 건다. 그 사이 누가 고쳤으면 412 로 거절되고,
   mutate() 가 다시 읽어 다시 계산한다. 문서가 없을 때는 create 로 만든다 — 둘이 동시에
   처음 만들면 한쪽이 409 를 받고 역시 다시 읽는다. */
const SYSTEM_FIELDS = ['_rid', '_self', '_etag', '_attachments', '_ts'];

async function save(sub, doc, fields, userName) {
  const now = new Date().toISOString();
  const next = {
    ...(doc || {}),
    id: docId(sub), type: 'credit', pk: sub, userSub: sub,
    userName: userName || (doc && doc.userName) || null,
    createdAt: (doc && doc.createdAt) || now,
    updatedAt: now,
    ...fields
  };
  for (const k of SYSTEM_FIELDS) delete next[k];
  if (!doc) {
    await container().items.create(next);
  } else if (doc._etag) {
    await container().items.upsert(next, { accessCondition: { type: 'IfMatch', condition: doc._etag } });
  } else {
    await container().items.upsert(next);   // _etag 가 없는 문서는 실서버에 없다(테스트용 수동 문서)
  }
  return next;
}

const MAX_TRIES = 8;
const isRace = (e) => e && (e.code === 412 || e.code === 409);
// 다시 시도할 때 조금씩 늦춘다. 모두 같은 순간에 다시 읽으면 또 같이 부딪힌다.
const backoff = (i) => new Promise((r) => setTimeout(r, Math.floor(Math.random() * 10 * i) + 2));

/* 읽기 → 계산 → 조건부 쓰기를 한 덩어리로 돈다. 충돌하면 처음부터 다시 한다.
   change(v, nowMs) 는 저장할 필드를 돌려준다. 던지면(잔액 부족 등) 아무것도 쓰지 않는다. */
async function mutate(sub, change, userName) {
  for (let i = 1; ; i++) {
    const nowMs = Date.now();
    const doc = await readDoc(sub);
    const v = view(doc, nowMs);
    const fields = change(v, nowMs);
    try {
      return { before: v, saved: await save(sub, doc, fields, userName), nowMs };
    } catch (e) {
      if (isRace(e) && i < MAX_TRIES) { await backoff(i); continue; }
      throw e;
    }
  }
}

async function balance(sub, { admin = false } = {}) {
  const v = view(await readDoc(sub));
  return admin ? asAdmin(v) : v;
}

/** 무료 몫을 먼저 쓰고, 모자란 만큼 충전 잔액에서 뺀다(충전분은 초기화로 안 사라지니 아껴 둔다). */
const split = (v, cost) => {
  const fromFree = Math.min(cost, v.free);
  return { fromFree, fromBonus: Math.min(cost - fromFree, v.bonus) };
};

/* 모델 값만큼 차감한다. 잔액이 모자라면 있는 만큼만 뺀다(0 아래로 내려가지 않는다). */
async function consume(sub, model, userName) {
  const cost = MODEL_COST[model];
  if (!cost) throw new Error('알 수 없는 모델: ' + model);
  const { saved, nowMs } = await mutate(sub, (v) => {
    const { fromFree, fromBonus } = split(v, cost);
    return { granted: v.granted, used: v.used + fromFree, period: v.period, bonus: v.bonus - fromBonus };
  }, userName);
  return { cost, ...view(saved, nowMs) };
}

/* AI 질문 전에 크레딧을 먼저 잡아 둔다(선차감). 모자라면 INSUFFICIENT_CREDIT 을 던지고
   아무것도 빼지 않는다.

   왜 답변 뒤가 아니라 앞인가 — 예전에는 '잔액 확인 → AI 호출 → 차감' 이었다. 확인과 차감
   사이에 AI 를 기다리는 수 초가 끼어 있어서, 1번 값만 남은 사람이 질문을 동시에 10개
   보내면 10개 모두 확인을 통과하고 답을 받았다. 차감은 0 에서 멈추니 9번은 공짜였다.
   잡아 두는 쓰기가 IfMatch 로 하나씩 줄을 서므로, 잔액이 모자란 요청은 AI 를 부르기 전에 막힌다.
   호출이 실패하면 refund() 로 돌려준다 — '실패하면 빼지 않는다' 는 약속은 그대로다. */
async function reserve(sub, model, userName) {
  const cost = MODEL_COST[model];
  if (!cost) throw new Error('알 수 없는 모델: ' + model);
  let hold;
  const { saved, nowMs } = await mutate(sub, (v) => {
    if (v.remaining < cost) {
      const e = new Error('크레딧이 모자랍니다.');
      e.code = 'INSUFFICIENT_CREDIT';
      e.credit = v;
      throw e;
    }
    hold = { ...split(v, cost), period: v.period, cost };
    return { granted: v.granted, used: v.used + hold.fromFree, period: v.period, bonus: v.bonus - hold.fromBonus };
  }, userName);
  return { hold, after: { cost, ...view(saved, nowMs) } };
}

/* 잡아 둔 크레딧을 돌려준다. 그 사이 3시간 구간이 바뀌었으면 무료 몫은 이미 새로 채워졌으므로
   충전분(bonus)만 돌려준다 — 무료 몫까지 돌려주면 새 구간 한도를 넘게 된다. */
async function refund(sub, hold, userName) {
  const { saved, nowMs } = await mutate(sub, (v) => ({
    granted: v.granted,
    used: v.period === hold.period ? Math.max(0, v.used - hold.fromFree) : v.used,
    period: v.period,
    bonus: v.bonus + hold.fromBonus
  }), userName);
  return view(saved, nowMs);
}

/* 관리자가 이번 구간 한도를 더 준다. 소명이 받아들여진 경우 등.

   ⚠ 이 추가분은 다음 초기화(3시간)에 사라진다 — granted 는 구간이 바뀌면 요금제
   값으로 돌아간다. 오래 남아야 하면 크레딧 쿠폰(bonus)을 쓴다. */
async function grant(sub, amount, userName) {
  const { saved, nowMs } = await mutate(sub, (v) => ({ granted: v.granted + amount, used: v.used, period: v.period }), userName);
  return view(saved, nowMs);
}

/* 쿠폰을 적용하기 전에 막을 일이 있는지 본다. 사용 기록을 남기기 전에 불러야 한다 —
   기록부터 남기면 거절된 쿠폰의 사용 횟수가 날아간다.
   다른 요금제가 적용 중이면 막는다. 덮어쓰면 남은 기간(예: 티처)이 조용히 사라진다. */
function couponBlock(v, coupon) {
  if (coupon.kind !== 'plan' || v.plan === 'free' || v.plan === coupon.plan) return null;
  return `이미 ${v.planLabel} 요금제가 적용 중입니다. 기간이 끝난 뒤에 사용해 주세요.`;
}

/* 쿠폰 효과를 적용한다.
   - 크레딧: 충전 잔액(bonus)에 더한다.
   - 요금제: 같은 요금제면 남은 기간 뒤에 이어 붙이고, 아니면 지금부터 센다.
     이번 구간 한도도 바로 새 요금제 값으로 올린다(관리자가 더 준 몫은 유지). */
async function applyCoupon(sub, coupon, userName) {
  const { saved, nowMs } = await mutate(sub, (v, now) => {
    const base = { granted: v.granted, used: v.used, period: v.period };
    if (coupon.kind === 'credit') return { ...base, bonus: v.bonus + coupon.amount };
    const from = v.plan === coupon.plan ? Date.parse(v.planUntil) : now;
    return {
      ...base,
      granted: v.granted - PLANS[v.plan].credits + PLANS[coupon.plan].credits,
      plan: coupon.plan,
      planUntil: new Date(from + coupon.days * 86400000).toISOString()
    };
  }, userName);
  return view(saved, nowMs);
}

module.exports = {
  balance, consume, reserve, refund, grant, isRace, view, planOf, couponBlock, applyCoupon, readDoc, docId, asAdmin,
  currentPeriod, msUntilReset,
  MODEL_COST, PLANS, FREE_CREDITS, RESET_HOURS
};
