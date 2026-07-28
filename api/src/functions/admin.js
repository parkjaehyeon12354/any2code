const { app } = require('@azure/functions');
const session = require('../lib/session');
const { lockdown } = require('../lib/lockdown');
const { container, query } = require('../lib/db');

/* 관리자 전용 엔드포인트.

   권한 판정은 여기서만 한다. admin.html 은 누구나 열 수 있고, 화면을 그리는
   자바스크립트도 얼마든지 고칠 수 있다 — 데이터를 안 내주는 것이 유일한 방어선이다.

   ⚠ 경로에 'admin/' 을 쓰지 말 것. Azure Functions 런타임이 자기 관리 API 용으로
   예약한 접두사라, 등록이 조용히 거부된다 — 파일은 정상 로드되는데 라우트만
   사라져서 404 가 나고 로그에도 남지 않는다. 그래서 'moderation/' 을 쓴다. */
function requireAdmin(request) {
  const user = session.current(request);
  if (!user) return { error: { status: 401, jsonBody: { error: '로그인이 필요합니다.' } } };
  // 쿠키의 role 은 안 본다. 로그인 시점 값이 14일 박제되므로, ADMIN_EMAILS 에서
  // 뺀 사람이 만료까지 관리자로 남는다. 매 요청 현재 목록으로 판정한다.
  if (!session.isAdmin(user.email)) {
    // 403 이 아니라 404 로 숨기는 방법도 있지만, 관리자 화면의 존재는 이미 공개돼
    // 있으므로 숨겨서 얻는 게 없다. 이유를 알려주는 편이 낫다.
    return { error: { status: 403, jsonBody: { error: '관리자만 접근할 수 있습니다.' } } };
  }
  return { user };
}

/* 보류 사유를 다시 계산하지 않고 저장된 값을 쓴다. 금칙어 목록이 바뀌어도
   "왜 이 글이 걸렸는지" 는 걸릴 당시 기준으로 남아야 판단할 수 있다. */
const heldView = (p) => ({
  id: p.id,
  subject: p.subject,
  title: p.title,
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
      const rows = await query({
        query: "SELECT * FROM c WHERE c.type = 'post' AND c.status IN ('held', 'blocked') ORDER BY c.createdAt DESC"
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
      // 파티션 키(과목)를 모르면 patch 를 못 한다 — id 로 먼저 찾는다
      const post = (await query({
        query: "SELECT * FROM c WHERE c.type = 'post' AND c.id = @id",
        parameters: [{ name: '@id', value: request.params.id }]
      }))[0];
      if (!post) return { status: 404, jsonBody: { error: '없는 글입니다.' } };

      const at = new Date().toISOString();
      await container().item(post.id, post.pk).patch([
        { op: 'set', path: '/status', value: status },
        // 누가 언제 풀어줬는지 남긴다. 오탐 공개는 되돌릴 일이 생기고,
        // 그때 "누가 판단했나" 를 모르면 같은 논쟁을 반복한다.
        { op: 'set', path: '/moderatedBy', value: user.email || user.sub },
        { op: 'set', path: '/moderatedAt', value: at }
      ]);

      return { jsonBody: { id: post.id, status, moderatedBy: user.email || user.sub, moderatedAt: at } };
    } catch (e) {
      context.error('보류 처리 실패:', e.message);
      return dbFail(e);
    }
  }
});

function dbFail(e) {
  if (e && e.code === 'NO_COSMOS_CONFIG') {
    return { status: 503, jsonBody: { error: '서버에 데이터베이스가 연결되지 않았습니다. (COSMOS_CONNECTION 미설정)' } };
  }
  return { status: 503, jsonBody: { error: '처리하지 못했습니다.' } };
}

module.exports = { ACTIONS, heldView };
