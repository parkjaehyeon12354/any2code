const { app } = require('@azure/functions');
const crypto = require('node:crypto');
const session = require('../lib/session');
const credit = require('../lib/credit');
const { lockdown } = require('../lib/lockdown');
const { container, query, dbFail } = require('../lib/db');

/* 쿠폰 — 관리자가 발급하고, 사용자가 설정 화면에서 입력한다.

   종류 둘:
     credit  충전 잔액(bonus)에 amount 를 더한다. 3시간 초기화와 무관하게 다 쓸 때까지 남는다.
     plan    요금제(credit.PLANS)를 days 일 동안 적용한다.
   효과를 주는 일은 credit.js 가 한다 — 크레딧 문서를 쓰는 곳을 한 군데로 둔다.

   문서:
     coupon     id 'coupon:<코드>'          pk 'coupon'   발급한 쿠폰. used / maxUses 로 횟수를 센다
     couponUse  id 'cu:<코드>:<sub>'        pk sub        누가 썼는지. id 가 (쿠폰, 사람)으로 정해져
                                                          있어 같은 사람의 두 번째 create 는 409 로 막힌다
   couponUse 는 계정 삭제 때 지우지 않는다(profile.js purge) — 탈퇴 후 재가입해 같은 쿠폰을
   또 쓰는 길을 막는다. 개인정보는 sub 와 코드뿐이다.

   ⚠ 경로에 'admin/' 을 쓰지 말 것 — Azure 가 조용히 등록을 거부한다. 'moderation/' 을 쓴다. */

// 헷갈리는 글자(I·O·0·1)를 뺀 32자. 12자리 = 60비트라 맞혀서 쓰는 건 불가능하다.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 12 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
const pretty = (code) => code.match(/.{4}/g).join('-');
// 입력은 대소문자·공백·하이픈을 가리지 않는다. 받아 적다 틀리기 쉬운 부분이다.
const normalize = (s) => String(s || '').toUpperCase().replace(/[\s-]/g, '');
const VALID = /^[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{12}$/;

const kstDate = (iso) => new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(0, 10);

/* 입력 시도 제한. 코드는 맞힐 수 없지만, 마구 두드리면 DB 요청(RU)을 태운다.
   llmChat·posts 와 같은 메모리 방식이라 인스턴스가 바뀌면 초기화된다. */
const tryLog = new Map();
function tryAllowed(key, now = Date.now(), max = 10, windowMs = 10 * 60 * 1000) {
  const arr = (tryLog.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { tryLog.set(key, arr); return false; }
  arr.push(now);
  tryLog.set(key, arr);
  return true;
}

const intIn = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/* 발급 요청 검사. 틀린 곳이 있으면 문구를, 맞으면 null. 상한은 오타 하나로
   백만 크레딧·10년 요금제를 뿌리는 사고를 막는 용도다. */
function issueError(b) {
  if (b.kind === 'credit') {
    if (!intIn(b.amount, 1, 100000)) return '충전 크레딧은 1 ~ 100000 사이여야 합니다.';
  } else if (b.kind === 'plan') {
    if (!credit.PLANS[b.plan] || b.plan === 'free') return '요금제를 골라 주세요.';
    if (!intIn(b.days, 1, 366)) return '기간은 1 ~ 366일이어야 합니다.';
  } else {
    return '쿠폰 종류를 골라 주세요.';
  }
  if (!intIn(b.count, 1, 50)) return '코드 개수는 1 ~ 50개여야 합니다.';
  if (!intIn(b.maxUses, 1, 1000)) return '코드마다 사용 가능한 사람 수는 1 ~ 1000명이어야 합니다.';
  if (b.expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(b.expiresOn)) return '만료일 형식이 잘못됐습니다.';
  return null;
}

app.http('adminCoupons', {
  route: 'moderation/coupons',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;
    const { error } = session.requireAdmin(request);
    if (error) return error;
    try {
      const rows = await query({ query: "SELECT * FROM c WHERE c.type = 'coupon' AND c.pk = 'coupon'" });
      rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      return {
        jsonBody: {
          coupons: rows.map((c) => ({
            code: pretty(c.code), kind: c.kind, amount: c.amount || null,
            plan: c.plan || null, planLabel: c.plan ? credit.PLANS[c.plan].label : null, days: c.days || null,
            used: c.used, maxUses: c.maxUses, expiresAt: c.expiresAt, memo: c.memo, createdAt: c.createdAt
          })),
          plans: Object.entries(credit.PLANS)
            .filter(([k]) => k !== 'free')
            .map(([k, p]) => ({ id: k, label: p.label, credits: p.credits }))
        }
      };
    } catch (e) {
      context.error('쿠폰 목록 실패:', e.message);
      return dbFail(e);
    }
  }
});

app.http('adminCouponIssue', {
  route: 'moderation/coupons',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;
    const { error, user: admin } = session.requireAdmin(request);
    if (error) return error;

    let b;
    try { b = await request.json(); } catch { b = null; }
    if (!b || typeof b !== 'object') return { status: 400, jsonBody: { error: '요청 형식이 잘못됐습니다.' } };
    const bad = issueError(b);
    if (bad) return { status: 400, jsonBody: { error: bad } };

    // 만료일은 한국 시간 그날 끝까지 쓸 수 있다. 2026-13-45 처럼 모양만 맞는 날짜도 거른다
    const expMs = b.expiresOn ? Date.parse(`${b.expiresOn}T23:59:59.999+09:00`) : null;
    if (Number.isNaN(expMs)) return { status: 400, jsonBody: { error: '만료일이 올바른 날짜가 아닙니다.' } };
    if (expMs !== null && expMs <= Date.now()) {
      return { status: 400, jsonBody: { error: '만료일이 이미 지났습니다.' } };
    }
    const expiresAt = expMs === null ? null : new Date(expMs).toISOString();

    const now = new Date().toISOString();
    const effect = b.kind === 'credit' ? { amount: b.amount } : { plan: b.plan, days: b.days };
    try {
      const codes = [];
      for (let i = 0; i < b.count; i++) {
        const code = newCode();
        await container().items.create({
          id: 'coupon:' + code, type: 'coupon', pk: 'coupon', code, kind: b.kind, ...effect,
          maxUses: b.maxUses, used: 0, expiresAt,
          memo: String(b.memo || '').trim().slice(0, 100),
          createdBy: admin.sub, createdAt: now
        });
        codes.push(pretty(code));
      }
      context.log(`쿠폰 발급: ${admin.sub} → ${b.kind} ${JSON.stringify(effect)} × ${codes.length}`);
      return { jsonBody: { ok: true, codes } };
    } catch (e) {
      context.error('쿠폰 발급 실패:', e.message);
      return dbFail(e);
    }
  }
});

app.http('couponRedeem', {
  route: 'coupon/redeem',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;
    const user = session.current(request);
    if (!user) return { status: 401, jsonBody: { error: '로그인이 필요합니다.' } };
    if (!tryAllowed(user.sub)) {
      return { status: 429, jsonBody: { error: '입력을 너무 자주 했습니다. 10분 뒤에 다시 시도해 주세요.' } };
    }

    let body;
    try { body = await request.json(); } catch { body = null; }
    const code = normalize(body && body.code);
    if (!VALID.test(code)) return { status: 400, jsonBody: { error: '쿠폰 코드를 다시 확인해 주세요. (12자리)' } };

    const c = container();
    const useId = `cu:${code}:${user.sub}`;
    try {
      const [coupon] = await query({
        query: "SELECT * FROM c WHERE c.type = 'coupon' AND c.pk = @p AND c.id = @id",
        parameters: [{ name: '@p', value: 'coupon' }, { name: '@id', value: 'coupon:' + code }]
      });
      if (!coupon) return { status: 404, jsonBody: { error: '없는 쿠폰 코드입니다.' } };
      if (coupon.expiresAt && coupon.expiresAt <= new Date().toISOString()) {
        return { status: 410, jsonBody: { error: '기간이 지난 쿠폰입니다.' } };
      }
      if (coupon.used >= coupon.maxUses) return { status: 410, jsonBody: { error: '이미 모두 사용된 쿠폰입니다.' } };

      // 사용 기록을 남기기 전에 막는다 — 기록부터 남기면 거절된 쿠폰의 횟수가 날아간다
      const why = credit.couponBlock(await credit.balance(user.sub), coupon);
      if (why) return { status: 409, jsonBody: { error: why } };

      try {
        await c.items.create({ id: useId, type: 'couponUse', pk: user.sub, userSub: user.sub, code, kind: coupon.kind, at: new Date().toISOString() });
      } catch (e) {
        if (e.code === 409) return { status: 409, jsonBody: { error: '이미 사용한 쿠폰입니다.' } };
        throw e;
      }

      let after;
      try {
        after = await credit.applyCoupon(user.sub, coupon, user.name);
      } catch (e) {
        // 효과를 못 줬으면 기록을 되돌린다 — 남겨두면 다시 입력해도 '이미 사용' 이 뜬다
        await c.item(useId, user.sub).delete().catch(() => {});
        throw e;
      }

      /* 사용 횟수. 효과는 이미 줬으므로 실패해도 성공으로 끝낸다.
         ponytail: 검사(used < maxUses)와 증가가 원자적이지 않아, 마지막 한 자리를 두 사람이
         동시에 쓰면 한도를 1 넘을 수 있다. 문제가 되면 patch 에 조건(filterPredicate)을 건다. */
      await c.item('coupon:' + code, 'coupon').patch([{ op: 'incr', path: '/used', value: 1 }])
        .catch((e) => context.error('쿠폰 사용 횟수 기록 실패:', e.message));

      const message = coupon.kind === 'credit'
        ? `${coupon.amount} 크레딧을 충전했습니다.`
        : `${after.planLabel} 요금제가 ${kstDate(after.planUntil)}까지 적용됩니다.`;
      context.log(`쿠폰 사용: ${user.sub} ← ${code} (${coupon.kind})`);
      return { jsonBody: { ok: true, message, credit: after } };
    } catch (e) {
      context.error('쿠폰 사용 실패:', e.message);
      return dbFail(e, '쿠폰을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
  }
});
