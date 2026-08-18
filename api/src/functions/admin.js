const { app } = require('@azure/functions');
const session = require('../lib/session');
const { lockdown, active: lockdownActive } = require('../lib/lockdown');
const { container, query, dbFail } = require('../lib/db');
const settings = require('../lib/settings');

/* 관리자 전용 엔드포인트.

   권한 판정은 여기서만 한다. admin.html 은 누구나 열 수 있고, 화면을 그리는
   자바스크립트도 얼마든지 고칠 수 있다 — 데이터를 안 내주는 것이 유일한 방어선이다.

   ⚠ 경로에 'admin/' 을 쓰지 말 것. Azure Functions 런타임이 자기 관리 API 용으로
   예약한 접두사라, 등록이 조용히 거부된다 — 파일은 정상 로드되는데 라우트만
   사라져서 404 가 나고 로그에도 남지 않는다. 그래서 'moderation/' 을 쓴다. */
const { requireAdmin } = session;

/* 보류 사유를 다시 계산하지 않고 저장된 값을 쓴다. 금칙어 목록이 바뀌어도
   "왜 이 글이 걸렸는지" 는 걸릴 당시 기준으로 남아야 판단할 수 있다. */
const heldView = (p) => ({
  id: p.id,
  kind: p.type,                                   // 'post' | 'comment'
  subject: p.subject || null,
  title: p.type === 'comment' ? '답변' : p.title,
  text: p.body,
  author: p.authorName,
  createdAt: p.createdAt,
  words: p.heldWords || [],
  status: p.status,
  moderatedBy: p.moderatedBy || null,
  moderatedAt: p.moderatedAt || null
});

/* ── 보류 목록 ──
   공개 처리한 것도 함께 돌려준다. 방금 누른 결과가 화면에서 사라지면
   잘못 눌렀을 때 되돌릴 수가 없다. */
app.http('adminHeld', {
  route: 'moderation/held',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;
    const { error } = requireAdmin(request);
    if (error) return error;

    try {
      // 댓글도 함께 본다. 같은 필터에 같은 오탐이 나는데 글만 되살릴 수 있으면
      // 댓글 오탐은 영영 묻힌다.
      const rows = await query({
        query: "SELECT * FROM c WHERE c.type IN ('post', 'comment') AND c.status IN ('held', 'blocked') ORDER BY c.createdAt DESC"
      });
      return { jsonBody: { posts: rows.map(heldView) }, headers: { 'Cache-Control': 'no-store' } };
    } catch (e) {
      context.error('보류 목록 조회 실패:', e.message);
      return dbFail(e);
    }
  }
});

/* ── 보류 처리 ──
   publish  오탐이었다 → 그대로 공개
   block    실제 위반이다 → 차단 상태로 둔다 (문서는 지우지 않는다)
   hold     잘못 눌렀다 → 다시 보류로 */
const ACTIONS = { publish: 'public', block: 'blocked', hold: 'held' };

app.http('adminModerate', {
  route: 'moderation/posts/{id}/moderate',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;
    const { user, error } = requireAdmin(request);
    if (error) return error;

    let body;
    try { body = await request.json(); } catch { body = {}; }

    const status = ACTIONS[body.action];
    if (!status) return { status: 400, jsonBody: { error: '알 수 없는 처리입니다.' } };

    try {
      // 파티션 키를 모르면 patch 를 못 한다 — id 로 먼저 찾는다
      const doc = (await query({
        query: "SELECT * FROM c WHERE c.type IN ('post', 'comment') AND c.id = @id",
        parameters: [{ name: '@id', value: request.params.id }]
      }))[0];
      if (!doc) return { status: 404, jsonBody: { error: '없는 글입니다.' } };

      const c = container();
      const at = new Date().toISOString();
      // 이전 상태를 patch 전에 붙잡아 둔다. 뒤에서 doc.status 를 읽으면 이미
      // 갱신된 값이라 "바뀐 게 없다" 로 판정되어 답변 수 보정이 통째로 빠진다.
      const before = doc.status;
      await c.item(doc.id, doc.pk).patch([
        { op: 'set', path: '/status', value: status },
        // 누가 언제 풀어줬는지 남긴다. 오탐 공개는 되돌릴 일이 생기고,
        // 그때 "누가 판단했나" 를 모르면 같은 논쟁을 반복한다.
        { op: 'set', path: '/moderatedBy', value: user.email || user.sub },
        { op: 'set', path: '/moderatedAt', value: at }
      ]);

      // 댓글이면 원글의 답변 수도 맞춘다. 안 그러면 "답변 1" 인데 아무것도
      // 안 보이거나, 되살렸는데 0 으로 남는다.
      if (doc.type === 'comment' && before !== status) {
        const delta = (status === 'public' ? 1 : 0) - (before === 'public' ? 1 : 0);
        if (delta !== 0) {
          const post = (await query({
            query: "SELECT * FROM c WHERE c.type = 'post' AND c.id = @id",
            parameters: [{ name: '@id', value: doc.postId }]
          }))[0];
          if (post) await c.item(post.id, post.pk).patch([{ op: 'incr', path: '/answers', value: delta }]);
        }
      }

      return { jsonBody: { id: doc.id, kind: doc.type, status, moderatedBy: user.email || user.sub, moderatedAt: at } };
    } catch (e) {
      context.error('보류 처리 실패:', e.message);
      return dbFail(e);
    }
  }
});

/* ── 운영 설정 ──
   고칠 수 있는 값(금칙어·도배 기준)과 못 고치는 값(환경 변수)을 한 화면에서 보여준다.

   환경 변수를 API 로 바꿀 수 있게 만들지 않는다. LOCKDOWN 과 ADMIN_EMAILS 는
   "관리자 세션이 탈취된 상황" 을 가정한 마지막 방어선이라, 사이트 로그인으로
   건드릴 수 있으면 방어선이 아니게 된다 — Azure 포털만 조작할 수 있어야 한다.
   그래서 여기서는 현재 값만 읽어서 보여준다. */
const envView = () => ({
  lockdown: lockdownActive(),
  adminEmails: (process.env.ADMIN_EMAILS || '')
    .split(',').map((s) => s.trim()).filter(Boolean),
  sessionDays: session.MAX_AGE / 86400,
  cosmosConnected: !!process.env.COSMOS_CONNECTION
});

const settingsBody = (editable) => ({
  editable,
  fixed: settings.FIXED,
  env: envView(),
  limits: { wordsMax: settings.WORDS_MAX },
  defaults: settings.DEFAULTS
});

app.http('adminSettings', {
  route: 'moderation/settings',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;
    const { error } = requireAdmin(request);
    if (error) return error;

    try {
      return {
        jsonBody: settingsBody(await settings.get()),
        headers: { 'Cache-Control': 'no-store' }
      };
    } catch (e) {
      context.error('설정 조회 실패:', e.message);
      return dbFail(e);
    }
  }
});

app.http('adminSettingsSave', {
  route: 'moderation/settings',
  methods: ['PUT'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;
    const { user, error } = requireAdmin(request);
    if (error) return error;

    // 금칙어 200개라도 몇 KB다. 그보다 큰 요청은 파싱 전에 자른다.
    if (Number(request.headers.get('content-length') || 0) > 32 * 1024) {
      return { status: 413, jsonBody: { error: '요청이 너무 큽니다.' } };
    }

    let body;
    try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: '요청 형식이 잘못됐습니다.' } }; }

    try {
      const saved = await settings.save(body, user);
      // 저장된 값을 그대로 돌려준다. 화면이 보낸 값을 그리면 서버가 다듬은
      // 결과(중복 제거·공백 정리)와 어긋나서 "저장했는데 다르다" 가 된다.
      return { jsonBody: settingsBody(saved) };
    } catch (e) {
      if (e.code === 'BAD_SETTINGS') return { status: 400, jsonBody: { error: e.message } };
      context.error('설정 저장 실패:', e.message);
      return dbFail(e, '저장하지 못했습니다.');
    }
  }
});


