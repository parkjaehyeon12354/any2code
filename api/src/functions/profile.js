/* 내 프로필 — 일반 사용자용. 관리자 설정(moderation/settings)과는 별개다.

   소유자만 읽고 쓴다. 남의 sub 를 지정할 통로를 아예 두지 않는다 —
   대상은 항상 세션 쿠키에서 나오므로 다른 사람 프로필은 요청할 방법이 없다. */
const { app } = require('@azure/functions');
const session = require('../lib/session');
const { lockdown } = require('../lib/lockdown');
const { dbFail } = require('../lib/db');
const profile = require('../lib/profile');

const limits = {
  nameMin: profile.NAME_MIN,
  nameMax: profile.NAME_MAX
};

app.http('profileGet', {
  route: 'profile',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;
    const user = session.current(request);
    if (!user) return { status: 401, jsonBody: { error: '로그인이 필요합니다.' } };

    try {
      // 제재·소명은 이름을 저장할 때 바뀌지 않으므로 PUT 응답에는 넣지 않는다.
      // 화면도 이 블록만 따로 그린다 — 저장할 때마다 다시 받을 이유가 없다.
      const [me, record] = await Promise.all([
        profile.read(user.sub),
        profile.discipline(user.sub)
      ]);
      return {
        jsonBody: { profile: profile.view(me, user), limits, discipline: record },
        headers: { 'Cache-Control': 'no-store' }
      };
    } catch (e) {
      context.error('프로필 조회 실패:', e.message);
      return dbFail(e, '프로필을 불러오지 못했습니다.');
    }
  }
});

app.http('profileSave', {
  route: 'profile',
  methods: ['PUT'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;
    const user = session.current(request);
    if (!user) return { status: 401, jsonBody: { error: '로그인이 필요합니다.' } };

    // 이름 20자 + 생일이면 몇십 바이트다. 그보다 큰 요청은 파싱 전에 자른다.
    if (Number(request.headers.get('content-length') || 0) > 8 * 1024) {
      return { status: 413, jsonBody: { error: '요청이 너무 큽니다.' } };
    }

    let body;
    try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: '요청 형식이 잘못됐습니다.' } }; }

    try {
      const { profile: saved, renamed } = await profile.save(user, body);
      return { jsonBody: { profile: saved, limits, renamed } };
    } catch (e) {
      if (e.code === 'BAD_PROFILE') return { status: 400, jsonBody: { error: e.message } };
      context.error('프로필 저장 실패:', e.message);
      return dbFail(e, '저장하지 못했습니다.');
    }
  }
});

/* 가입 마무리 — 약관 동의 + 이름·생일(선택).

   로그인만으로는 가입이 끝나지 않는다. 이 요청이 성공해야 termsAcceptedAt 이
   채워지고, 그 전까지 화면은 /welcome 으로 되돌린다.

   ⚠ 별도 엔드포인트로 둔 이유 — PUT /profile 은 이름 변경에 1분 제한을 건다.
   가입 첫 화면의 이름 입력은 '변경' 이 아니라 최초 입력인데, 그 제한에 걸리면
   가입 자체가 막힌다. */
app.http('profileAcceptTerms', {
  route: 'profile/terms',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;
    const user = session.current(request);
    if (!user) return { status: 401, jsonBody: { error: '로그인이 필요합니다.' } };

    if (Number(request.headers.get('content-length') || 0) > 8 * 1024) {
      return { status: 413, jsonBody: { error: '요청이 너무 큽니다.' } };
    }

    let body;
    try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: '요청 형식이 잘못됐습니다.' } }; }

    // 동의는 반드시 명시적이어야 한다. 기본값으로 통과시키지 않는다.
    if (body && body.agree !== true) {
      return { status: 400, jsonBody: { error: '이용약관과 개인정보 처리방침에 동의해야 가입할 수 있습니다.' } };
    }

    try {
      const saved = await profile.acceptTerms(user, body);
      return { status: 201, jsonBody: { profile: saved, limits } };
    } catch (e) {
      if (e.code === 'BAD_PROFILE') return { status: 400, jsonBody: { error: e.message } };
      context.error('약관 동의 저장 실패:', e.message);
      return dbFail(e, '저장하지 못했습니다.');
    }
  }
});
