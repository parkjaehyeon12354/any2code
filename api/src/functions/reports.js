/* 신고 → 제재 → 항소.

   세 가지가 한 흐름이라 한 파일에 둔다.
     신고  사용자가 글·답변을 신고한다
     제재  관리자가 신고를 처리하며 작성자에게 이용 제한을 건다
     항소  제한된 사용자가 이의를 제기하고, 관리자가 판단한다

   ⚠ 경로에 'admin/' 을 쓰지 말 것 — Functions 예약 접두사라 라우트가 조용히
   사라진다. 관리자 경로는 'moderation/' 을 쓴다 (admin.js 참고).

   문서 종류
     report    pk = 신고 대상 id     한 글에 들어온 신고를 한 번에 읽는다
     sanction  pk = 사용자 sub       id 도 sub 라 사용자당 하나만 존재한다
     appeal    pk = 사용자 sub       그 사용자의 항소 이력 */
const { app } = require('@azure/functions');
const session = require('../lib/session');
const { requireAdmin } = session;
const { lockdown } = require('../lib/lockdown');
const { container, query, dbFail } = require('../lib/db');
const sanction = require('../lib/sanction');

/* 신고 사유는 서버가 정한 목록만 받는다. 자유 입력을 허용하면 그 자체가
   욕설 통로가 되고, 관리자 화면에 그대로 표시된다. */
const REASONS = {
  spam: '광고성 게시물',
  abuse: '욕설·비방',
  copyright: '타인 자료 무단 게시',
  wrong: '허위·오답 유도',
  etc: '기타'
};

const MAX_DAYS = 365;
const rid = (p) => p + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const bad = (message) => ({ status: 400, jsonBody: { error: message } });

const until = (days) => new Date(Date.now() + days * 86400_000).toISOString();


/* ── 신고하기 ── */
app.http('reportCreate', {
  route: 'reports',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;
    const user = session.current(request);
    if (!user) return { status: 401, jsonBody: { error: '로그인이 필요합니다.' } };

    let body;
    try { body = await request.json(); } catch { return bad('요청 형식이 잘못됐습니다.'); }

    const reason = REASONS[body.reason];
    if (!reason) return bad('신고 사유를 선택해 주세요.');
    const targetId = String(body.targetId || '');
    if (!targetId) return bad('신고 대상이 없습니다.');

    try {
      const target = (await query({
        query: "SELECT * FROM c WHERE c.type IN ('post', 'comment') AND c.id = @id",
        parameters: [{ name: '@id', value: targetId }]
      }))[0];
      if (!target || target.status !== 'public') {
        return { status: 404, jsonBody: { error: '없는 글입니다.' } };
      }
      if (target.authorSub === user.sub) return bad('자기 글은 신고할 수 없습니다.');

      // 한 사람이 같은 대상을 여러 번 신고해도 한 건으로 센다.
      // id 를 대상+신고자로 고정하면 upsert 가 알아서 덮어쓴다.
      const id = `r_${targetId}_${user.sub}`;
      await container().items.upsert({
        id,
        type: 'report',
        pk: targetId,
        targetId,
        targetKind: target.type,
        targetTitle: target.type === 'comment' ? '답변' : target.title,
        targetText: target.body,
        targetAuthorSub: target.authorSub,
        targetAuthorName: target.authorName,
        reasonCode: body.reason,
        reason,
        bySub: user.sub,
        byName: user.name,
        createdAt: new Date().toISOString(),
        status: 'wait'
      });

      return { status: 201, jsonBody: { ok: true, message: '신고가 접수됐습니다. 확인 후 조치하겠습니다.' } };
    } catch (e) {
      context.error('신고 실패:', e.message);
      return dbFail(e, '신고를 접수하지 못했습니다.');
    }
  }
});

/* ── 신고 목록 (관리자) ── */
const reportView = (r) => ({
  id: r.id,
  target: r.targetTitle,
  targetId: r.targetId,
  targetKind: r.targetKind,
  targetText: r.targetText,
  targetAuthor: r.targetAuthorName,
  reason: r.reason,
  by: r.byName,
  createdAt: r.createdAt,
  status: r.status,
  applied: r.applied || null
});

app.http('reportList', {
  route: 'moderation/reports',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;
    const { error } = requireAdmin(request);
    if (error) return error;

    try {
      // 처리한 것도 함께 준다 — 방금 누른 결과가 사라지면 잘못 눌렀을 때 확인할 수 없다
      const rows = await query({
        query: "SELECT * FROM c WHERE c.type = 'report' ORDER BY c.createdAt DESC"
      });
      return { jsonBody: { reports: rows.map(reportView) }, headers: { 'Cache-Control': 'no-store' } };
    } catch (e) {
      context.error('신고 목록 실패:', e.message);
      return dbFail(e, '신고 목록을 불러오지 못했습니다.');
    }
  }
});

/* ── 신고 처리 (관리자) ──
   days=0 이면 경고만. blockContent 면 대상 글도 차단한다. */
app.http('reportResolve', {
  route: 'moderation/reports/{id}/resolve',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;
    const { user, error } = requireAdmin(request);
    if (error) return error;

    let body;
    try { body = await request.json(); } catch { body = {}; }

    // Number() 로 감싸면 null 이 0 이 되어 "값을 안 보냄" 과 "경고만(0일)" 이
    // 구분되지 않는다. 관리자가 빠뜨린 요청이 조용히 무제재로 처리된다.
    const days = body.days;
    if (!Number.isInteger(days) || days < 0 || days > MAX_DAYS) {
      return bad(`제한 일수는 0~${MAX_DAYS} 사이의 정수여야 합니다.`);
    }

    try {
      const report = (await query({
        query: "SELECT * FROM c WHERE c.type = 'report' AND c.id = @id",
        parameters: [{ name: '@id', value: request.params.id }]
      }))[0];
      if (!report) return { status: 404, jsonBody: { error: '없는 신고입니다.' } };

      const c = container();
      const at = new Date().toISOString();
      const applied = {
        days,
        until: days > 0 ? until(days) : null,
        blockedContent: !!body.blockContent,
        by: user.email || user.sub,
        at
      };

      // 1) 제재 — 사용자당 문서 하나. 이미 있으면 새 기간으로 덮어쓴다
      if (days > 0) {
        await c.items.upsert({
          id: report.targetAuthorSub,
          type: 'sanction',
          pk: report.targetAuthorSub,
          userSub: report.targetAuthorSub,
          userName: report.targetAuthorName,
          days,
          until: applied.until,
          reason: report.reason,
          by: applied.by,
          at
        });
      }

      // 2) 대상 글 차단 (선택)
      if (body.blockContent) {
        const target = (await query({
          query: "SELECT * FROM c WHERE c.type IN ('post', 'comment') AND c.id = @id",
          parameters: [{ name: '@id', value: report.targetId }]
        }))[0];
        if (target && target.status === 'public') {
          await c.item(target.id, target.pk).patch([
            { op: 'set', path: '/status', value: 'blocked' },
            { op: 'set', path: '/moderatedBy', value: applied.by },
            { op: 'set', path: '/moderatedAt', value: at }
          ]);
          // 답변을 차단하면 원글의 답변 수도 줄인다
          if (target.type === 'comment') {
            const post = (await query({
              query: "SELECT * FROM c WHERE c.type = 'post' AND c.id = @id",
              parameters: [{ name: '@id', value: target.postId }]
            }))[0];
            if (post) await c.item(post.id, post.pk).patch([{ op: 'incr', path: '/answers', value: -1 }]);
          }
        }
      }

      // 3) 신고 자체를 처리됨으로
      await c.item(report.id, report.pk).patch([
        { op: 'set', path: '/status', value: 'done' },
        { op: 'set', path: '/applied', value: applied }
      ]);

      return { jsonBody: { id: report.id, status: 'done', applied } };
    } catch (e) {
      context.error('신고 처리 실패:', e.message);
      return dbFail(e, '처리하지 못했습니다.');
    }
  }
});

/* ── 항소하기 ──
   제재를 받은 본인만, 유효 기간 안에만 낼 수 있다. */
app.http('appealCreate', {
  route: 'appeals',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;
    const user = session.current(request);
    if (!user) return { status: 401, jsonBody: { error: '로그인이 필요합니다.' } };

    let body;
    try { body = await request.json(); } catch { return bad('요청 형식이 잘못됐습니다.'); }

    const text = String(body.text || '').trim();
    if (!text) return bad('내용을 입력해 주세요.');
    if (text.length > 2000) return bad('항소 내용은 2000자까지 쓸 수 있습니다.');

    try {
      const current = await sanction.active(user.sub);
      if (!current) return bad('현재 이용 제한 상태가 아닙니다.');

      // 이미 대기 중인 항소가 있으면 새로 받지 않는다 — 같은 건으로 여러 번
      // 넣으면 관리자 화면이 중복으로 찬다
      const waiting = (await query({
        query: "SELECT * FROM c WHERE c.type = 'appeal' AND c.pk = @s AND c.status = 'wait'",
        parameters: [{ name: '@s', value: user.sub }]
      }))[0];
      if (waiting) return bad('이미 접수된 항소가 검토 중입니다.');

      await container().items.create({
        id: rid('a'),
        type: 'appeal',
        pk: user.sub,
        userSub: user.sub,
        userName: user.name,
        text,
        orig: { days: current.days, until: current.until, reason: current.reason },
        createdAt: new Date().toISOString(),
        status: 'wait'
      });

      return { status: 201, jsonBody: { ok: true, message: '항소가 접수됐습니다. 검토 후 결과를 반영하겠습니다.' } };
    } catch (e) {
      context.error('항소 실패:', e.message);
      return dbFail(e, '항소를 접수하지 못했습니다.');
    }
  }
});

/* ── 항소 목록 (관리자) ── */
const appealView = (a) => ({
  id: a.id,
  who: a.userName,
  orig: a.orig,
  reason: a.orig?.reason || '',
  text: a.text,
  createdAt: a.createdAt,
  status: a.status,
  decision: a.decision || null
});

app.http('appealList', {
  route: 'moderation/appeals',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;
    const { error } = requireAdmin(request);
    if (error) return error;

    try {
      const rows = await query({
        query: "SELECT * FROM c WHERE c.type = 'appeal' ORDER BY c.createdAt DESC"
      });
      return { jsonBody: { appeals: rows.map(appealView) }, headers: { 'Cache-Control': 'no-store' } };
    } catch (e) {
      context.error('항소 목록 실패:', e.message);
      return dbFail(e, '항소 목록을 불러오지 못했습니다.');
    }
  }
});

/* ── 항소 판단 (관리자) ──
   denied  기각 — 제재 유지
   granted 인용 — 제재 즉시 해제
   reduced 감경 — days 로 다시 계산 */
const DECISIONS = ['denied', 'granted', 'reduced'];

app.http('appealDecide', {
  route: 'moderation/appeals/{id}/decide',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;
    const { user, error } = requireAdmin(request);
    if (error) return error;

    let body;
    try { body = await request.json(); } catch { body = {}; }

    const decision = body.decision;
    if (!DECISIONS.includes(decision)) return bad('알 수 없는 결정입니다.');

    let days = 0;
    if (decision === 'reduced') {
      days = body.days;
      if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
        return bad(`감경 일수는 1~${MAX_DAYS} 사이의 정수여야 합니다.`);
      }
    }

    try {
      const appeal = (await query({
        query: "SELECT * FROM c WHERE c.type = 'appeal' AND c.id = @id",
        parameters: [{ name: '@id', value: request.params.id }]
      }))[0];
      if (!appeal) return { status: 404, jsonBody: { error: '없는 항소입니다.' } };

      const c = container();
      const at = new Date().toISOString();

      // 인용·감경이면 제재를 실제로 바꾼다. 화면 상태만 바꾸면 사용자는
      // 여전히 글을 못 쓰면서 "인용됨" 이라는 안내만 본다.
      if (decision === 'granted') {
        // 문서를 지우지 않고 기간을 과거로 — 이력이 남아야 반복 위반을 알 수 있다
        await c.item(appeal.userSub, appeal.userSub).patch([
          { op: 'set', path: '/until', value: at },
          { op: 'set', path: '/liftedBy', value: user.email || user.sub },
          { op: 'set', path: '/liftedAt', value: at }
        ]).catch(() => {});
      } else if (decision === 'reduced') {
        await c.item(appeal.userSub, appeal.userSub).patch([
          { op: 'set', path: '/days', value: days },
          { op: 'set', path: '/until', value: until(days) },
          { op: 'set', path: '/reducedBy', value: user.email || user.sub },
          { op: 'set', path: '/reducedAt', value: at }
        ]).catch(() => {});
      }

      await c.item(appeal.id, appeal.pk).patch([
        { op: 'set', path: '/status', value: decision },
        { op: 'set', path: '/decision', value: { decision, days, by: user.email || user.sub, at } }
      ]);

      return { jsonBody: { id: appeal.id, status: decision, days, at } };
    } catch (e) {
      context.error('항소 판단 실패:', e.message);
      return dbFail(e, '처리하지 못했습니다.');
    }
  }
});

module.exports = { REASONS };
