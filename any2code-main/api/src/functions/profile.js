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
