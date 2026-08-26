const { app } = require('@azure/functions');
const session = require('../lib/session');
const { lockdown } = require('../lib/lockdown');
const { container, query, dbFail } = require('../lib/db');
const sanction = require('../lib/sanction');
const settings = require('../lib/settings');
const profile = require('../lib/profile');

/* 과목은 서버가 정한 목록만 받는다. 클라이언트가 보낸 값을 그대로 파티션 키로
   쓰면 아무 문자열이나 새 파티션이 되어 데이터가 흩어진다. */
const SUBJECTS = ['physics', 'chem', 'bio', 'earth'];

const LIMIT = { title: 120, body: 4000, comment: 2000 };

/* 자동 보류 필터. 목록과 도배 기준은 lib/settings 가 갖고 있다 (관리자 설정 화면에서
   고칠 수 있고, 못 읽으면 기본값으로 돈다). 여기서 다시 정의하면 두 목록이 갈라진다. */
const findBanned = (text, words) => words.filter((w) => text.includes(w));

const rid = (prefix) => prefix + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/* ── 도배 방지 ──
   글: 기준 시간 내 N개까지 (설정값). DB 를 세므로 인스턴스가 재시작해도 유지된다.
   투표: 분당 30번까지 — 코드 고정. 표는 사람당 하나라 남는 건 RU 소모뿐이니
   인스턴스 메모리로 충분하다 (재시작하면 초기화 — 감수한다).
   이 값만 설정으로 빼지 않은 이유는 lib/settings.js 의 FIXED 주석에 있다. */
const voteLog = new Map();   // sub → [timestamp]
function voteAllowed(sub, now = Date.now(), max = settings.FIXED.voteMaxPerMin) {
  const arr = (voteLog.get(sub) || []).filter((t) => now - t < 60_000);
  if (arr.length >= max) { voteLog.set(sub, arr); return false; }
  arr.push(now);
  voteLog.set(sub, arr);
  return true;
}

/* 본문 상한(4000자)보다 훨씬 큰 요청은 파싱 전에 자른다 —
   수십 MB JSON 을 받아서 파싱한 뒤에야 거절하면 그 자체가 부하다. */
const tooBig = (request) => Number(request.headers.get('content-length') || 0) > 32 * 1024;

/** 밖으로 내보낼 형태. 작성자 식별자(sub)는 절대 넣지 않는다.

    목록은 요약만, 글 화면은 본문 전체를 받는다. 목록에 본문을 다 실으면
    글이 100개일 때 응답이 그만큼 커지는데, 화면은 두 줄만 보여준다. */
const EXCERPT_LEN = 200;

const publicPost = (p, full = false, viewerSub = null) => ({
  id: p.id,
  mine: !!viewerSub && p.authorSub === viewerSub,
  subject: p.subject,
  title: p.title,
  author: p.authorName,
  createdAt: p.createdAt,
  score: p.score || 0,
  answers: p.answers || 0,
  ...(full
    ? { body: p.body }
    : { excerpt: p.body.length > EXCERPT_LEN ? p.body.slice(0, EXCERPT_LEN) + '…' : p.body })
});

/* ── 목록 ──
   비로그인도 읽을 수 있다. 로그인했으면 자기 투표 상태를 함께 준다
   (화살표를 눌린 상태로 그리기 위해). */
app.http('postsList', {
  route: 'posts',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;
    const channel = new URL(request.url).searchParams.get('channel') || 'all';
    const user = session.current(request);

    try {
      const spec = channel === 'all'
        ? { query: "SELECT * FROM c WHERE c.type = 'post' AND c.status = 'public'" }
        : {
            query: "SELECT * FROM c WHERE c.type = 'post' AND c.status = 'public' AND c.pk = @s",
            parameters: [{ name: '@s', value: channel }]
          };

      // 목록과 내 투표를 동시에 던진다 — DB 가 40ms 거리라 순차로 하면 두 배 걸린다
      const [posts, myVotes] = await Promise.all([
        query(spec),
        user
          ? query({
              query: "SELECT c.postId, c.dir FROM c WHERE c.type = 'vote' AND c.userSub = @u",
              parameters: [{ name: '@u', value: user.sub }]
            })
          : Promise.resolve([])
      ]);

      const votes = {};
      myVotes.forEach((v) => { votes[v.postId] = v.dir; });

      return {
        // map(publicPost) 로 쓰면 안 된다 — map 이 콜백에 (요소, 인덱스, 배열) 을
        // 넘기므로 full 에 인덱스가, viewerSub 에 배열이 들어간다. 그래서 첫 글만
        // excerpt 가 나오고 (인덱스 0 = falsy) 나머지는 본문 전체가 실려 나갔다.
        jsonBody: { posts: posts.map((p) => publicPost(p, false, user && user.sub)), votes },
        headers: { 'Cache-Control': 'no-store' }
      };
    } catch (e) {
      context.error('목록 조회 실패:', e.message);
      return dbFail(e, '목록을 불러오지 못했습니다.');
    }
  }
});

/* ── 글 하나 ──
   목록에서 걸러 쓰면 전체를 받아야 하고, 링크로 바로 들어온 사람은
   목록을 거치지도 않는다. 보류·차단된 글은 없는 글과 같은 404. */
app.http('postsGet', {
  route: 'posts/{id}',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;
    const user = session.current(request);

    try {
      const post = (await query({
        query: "SELECT * FROM c WHERE c.type = 'post' AND c.id = @id",
        parameters: [{ name: '@id', value: request.params.id }]
      }))[0];
      if (!post || post.status !== 'public') {
        return { status: 404, jsonBody: { error: '없는 글입니다.' } };
      }

      // 내 투표 상태도 함께 — 화살표를 눌린 상태로 그리려면 필요하다
      let myVote = 0;
      if (user) {
        try {
          const read = await container().item(`${post.id}:${user.sub}`, post.id).read();
          if (read.resource) myVote = read.resource.dir;
        } catch { /* 투표한 적 없음 */ }
      }

      return {
        jsonBody: { post: publicPost(post, true, user && user.sub), myVote },
        headers: { 'Cache-Control': 'no-store' }
      };
    } catch (e) {
      context.error('글 조회 실패:', e.message);
      return dbFail(e, '글을 불러오지 못했습니다.');
    }
  }
});

/* ── 작성 ── */
app.http('postsCreate', {
  route: 'posts',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;
    const user = session.current(request);
    if (!user) return { status: 401, jsonBody: { error: '로그인이 필요합니다.' } };
    if (tooBig(request)) return { status: 413, jsonBody: { error: '요청이 너무 큽니다.' } };

    // 제재가 집행되지 않으면 화면에만 있는 문구가 된다
    const blocked = await sanction.block(user.sub);
    if (blocked) return blocked;

    let body;
    try { body = await request.json(); } catch { return bad('요청 형식이 잘못됐습니다.'); }

    const subject = String(body.subject || '');
    const title = String(body.title || '').trim();
    const text = String(body.body || '').trim();

    if (!SUBJECTS.includes(subject)) return bad('과목을 선택해 주세요.');
    if (!title) return bad('제목을 입력해 주세요.');
    if (title.length > LIMIT.title) return bad(`제목은 ${LIMIT.title}자까지 쓸 수 있습니다.`);
    if (!text) return bad('내용을 입력해 주세요.');
    if (text.length > LIMIT.body) return bad(`내용은 ${LIMIT.body}자까지 쓸 수 있습니다.`);

    // 도배 확인 — 이 사용자가 기준 시간 내에 쓴 글 수
    let cfg;
    try {
      cfg = await settings.get();
      const since = new Date(Date.now() - cfg.postWindowMin * 60_000).toISOString();
      const [n] = await query({
        query: "SELECT VALUE COUNT(1) FROM c WHERE c.type = 'post' AND c.authorSub = @u AND c.createdAt > @since",
        parameters: [{ name: '@u', value: user.sub }, { name: '@since', value: since }]
      });
      if (n >= cfg.postMax) {
        return {
          status: 429,
          jsonBody: { error: `잠시 후에 다시 작성해 주세요. ${cfg.postWindowMin}분에 ${cfg.postMax}개까지 올릴 수 있습니다.` }
        };
      }
    } catch (e) {
      context.error('도배 확인 실패:', e.message);
      return dbFail(e, '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }

    const hits = findBanned(title + '\n' + text, cfg.bannedWords);
    const doc = {
      id: rid('p'),
      type: 'post',
      pk: subject,
      subject,
      title,
      body: text,
      authorSub: user.sub,
      // 쿠키의 이름이 아니라 사용자가 고른 표시 이름. 못 읽으면 쿠키 값으로 돈다.
      authorName: await profile.displayName(user).catch(() => user.name),
      createdAt: new Date().toISOString(),
      score: 0,
      answers: 0,
      status: hits.length ? 'held' : 'public',
      ...(hits.length ? { heldWords: hits } : {})
    };

    try {
      await container().items.create(doc);
    } catch (e) {
      context.error('작성 실패:', e.message);
      return dbFail(e, '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }

    // 보류된 글은 목록에 안 나온다 — 사라진 것처럼 보이지 않게 이유를 알려준다
    return {
      status: 201,
      jsonBody: doc.status === 'held'
        ? { held: true, message: '부적절한 표현이 감지되어 검토 대기 중입니다. 오탐이면 곧 공개됩니다.' }
        : { held: false, post: publicPost(doc) }
    };
  }
});

/* ── 투표 ──
   같은 방향을 다시 누르면 취소. 투표 문서와 글의 점수를 따로 갱신한다.
   글 점수는 patch 의 incr 로 올려야 동시 투표가 서로를 덮어쓰지 않는다. */
app.http('postsVote', {
  route: 'posts/{id}/vote',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;
    const user = session.current(request);
    if (!user) return { status: 401, jsonBody: { error: '로그인이 필요합니다.' } };
    if (!voteAllowed(user.sub)) {
      return { status: 429, jsonBody: { error: '너무 빠르게 누르고 있습니다. 잠시 후 다시 시도해 주세요.' } };
    }

    const postId = request.params.id;
    let body;
    try { body = await request.json(); } catch { return bad('요청 형식이 잘못됐습니다.'); }

    const dir = Number(body.dir);
    if (dir !== 1 && dir !== -1) return bad('추천 또는 비추천만 가능합니다.');

    const voteId = `${postId}:${user.sub}`;
    const c = container();

    try {
      const post = (await query({
        query: "SELECT * FROM c WHERE c.type = 'post' AND c.id = @id",
        parameters: [{ name: '@id', value: postId }]
      }))[0];
      if (!post) return { status: 404, jsonBody: { error: '없는 글입니다.' } };
      // 목록에서 가리는 것만으로는 차단이 아니다. id 를 아는 사람은 계속
      // 투표할 수 있고, 나중에 오탐으로 공개하면 조작된 점수를 달고 나타난다.
      // 없는 글과 같은 404 를 준다 — 상태를 알려주면 존재가 드러난다.
      if (post.status !== 'public') return { status: 404, jsonBody: { error: '없는 글입니다.' } };

      let prev = 0;
      try {
        const read = await c.item(voteId, postId).read();
        if (read.resource) prev = read.resource.dir;
      } catch { /* 처음 투표 — 없는 게 정상 */ }

      const next = prev === dir ? 0 : dir;   // 같은 방향 재클릭 = 취소
      const delta = next - prev;

      if (next === 0) await c.item(voteId, postId).delete();
      else await c.items.upsert({ id: voteId, type: 'vote', pk: postId, postId, userSub: user.sub, dir: next });

      // 미리 읽어둔 post.score 에 더하면, 그 사이 남이 투표했을 때 틀린 값을 돌려준다.
      // patch 응답이 갱신 후의 실제 값이므로 그걸 그대로 쓴다.
      let score = post.score || 0;
      if (delta !== 0) {
        const patched = await c.item(post.id, post.pk).patch([{ op: 'incr', path: '/score', value: delta }]);
        score = patched.resource.score;
      }

      return { jsonBody: { dir: next, score } };
    } catch (e) {
      context.error('투표 실패:', e.message);
      return dbFail(e, '처리하지 못했습니다.');
    }
  }
});

/* ── 댓글 ──
   파티션 키가 글 id 라 한 글의 댓글은 한 파티션에서 한 번에 읽힌다. */

const publicComment = (c, viewerSub = null) => ({
  id: c.id,
  mine: !!viewerSub && c.authorSub === viewerSub,
  body: c.body,
  author: c.authorName,
  createdAt: c.createdAt,
  ...(c.status ? { status: c.status } : {}),
  ...(c.updatedAt ? { updatedAt: c.updatedAt } : {})
});

app.http('commentsList', {
  route: 'posts/{id}/comments',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;
    const postId = request.params.id;

    try {
      const rows = await query({
        query: "SELECT * FROM c WHERE c.type = 'comment' AND c.pk = @p AND c.status = 'public' ORDER BY c.createdAt ASC",
        parameters: [{ name: '@p', value: postId }]
      });
      const viewer = session.current(request);
      return {
        jsonBody: { comments: rows.map((c) => publicComment(c, viewer && viewer.sub)) },
        headers: { 'Cache-Control': 'no-store' }
      };
    } catch (e) {
      context.error('댓글 조회 실패:', e.message);
      return dbFail(e, '댓글을 불러오지 못했습니다.');
    }
  }
});

app.http('commentsCreate', {
  route: 'posts/{id}/comments',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;
    const user = session.current(request);
    if (!user) return { status: 401, jsonBody: { error: '로그인이 필요합니다.' } };
    if (tooBig(request)) return { status: 413, jsonBody: { error: '요청이 너무 큽니다.' } };

    const blocked = await sanction.block(user.sub);
    if (blocked) return blocked;

    let body;
    try { body = await request.json(); } catch { return bad('요청 형식이 잘못됐습니다.'); }

    const text = String(body.body || '').trim();
    if (!text) return bad('내용을 입력해 주세요.');
    if (text.length > LIMIT.comment) return bad(`답변은 ${LIMIT.comment}자까지 쓸 수 있습니다.`);

    const postId = request.params.id;
    const c = container();

    try {
      const post = (await query({
        query: "SELECT * FROM c WHERE c.type = 'post' AND c.id = @id",
        parameters: [{ name: '@id', value: postId }]
      }))[0];
      // 보류·차단된 글에는 답변을 달 수 없다. 없는 글과 같은 404 를 준다
      if (!post || post.status !== 'public') return { status: 404, jsonBody: { error: '없는 글입니다.' } };

      // 도배 확인 — 글과 같은 기준을 쓴다
      const cfg = await settings.get();
      const since = new Date(Date.now() - cfg.postWindowMin * 60_000).toISOString();
      const [n] = await query({
        query: "SELECT VALUE COUNT(1) FROM c WHERE c.type = 'comment' AND c.authorSub = @u AND c.createdAt > @since",
        parameters: [{ name: '@u', value: user.sub }, { name: '@since', value: since }]
      });
      if (n >= cfg.postMax) {
        return {
          status: 429,
          jsonBody: { error: `잠시 후에 다시 작성해 주세요. ${cfg.postWindowMin}분에 ${cfg.postMax}개까지 올릴 수 있습니다.` }
        };
      }

      const hits = findBanned(text, cfg.bannedWords);
      const doc = {
        id: rid('c'),
        type: 'comment',
        pk: postId,
        postId,
        body: text,
        authorSub: user.sub,
        authorName: await profile.displayName(user).catch(() => user.name),
        createdAt: new Date().toISOString(),
        status: hits.length ? 'held' : 'public',
        ...(hits.length ? { heldWords: hits } : {})
      };
      await c.items.create(doc);

      // 답변 수는 공개된 것만 센다 — 보류 중인 걸 세면 "답변 1" 인데 아무것도 안 보인다
      if (doc.status === 'public') {
        await c.item(post.id, post.pk).patch([{ op: 'incr', path: '/answers', value: 1 }]);
      }

      return {
        status: 201,
        jsonBody: doc.status === 'held'
          ? { held: true, message: '부적절한 표현이 감지되어 검토 대기 중입니다. 오탐이면 곧 공개됩니다.' }
          : { held: false, comment: publicComment(doc) }
      };
    } catch (e) {
      context.error('댓글 작성 실패:', e.message);
      return dbFail(e, '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
  }
});

function bad(message) { return { status: 400, jsonBody: { error: message } }; }


/* ── 댓글 수정 ──
   자기 댓글만, 공개 상태인 글에만, 내용만 변경 가능 */
app.http('commentsUpdate', {
  route: 'posts/{postId}/comments/{commentId}',
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;
    const user = session.current(request);
    if (!user) return { status: 401, jsonBody: { error: '로그인이 필요합니다.' } };
    if (tooBig(request)) return { status: 413, jsonBody: { error: '요청이 너무 큽니다.' } };

    const postId = request.params.postId;
    const commentId = request.params.commentId;
    const c = container();

    try {
      // 글 존재/상태 확인
      const post = (await query({
        query: "SELECT * FROM c WHERE c.type = 'post' AND c.id = @id",
        parameters: [{ name: '@id', value: postId }]
      }))[0];
      if (!post || post.status !== 'public') {
        return { status: 404, jsonBody: { error: '없는 글입니다.' } };
      }

      // 댓글 존재/권한 확인
      const comment = (await query({
        query: "SELECT * FROM c WHERE c.type = 'comment' AND c.id = @id AND c.pk = @p",
        parameters: [{ name: '@id', value: commentId }, { name: '@p', value: postId }]
      }))[0];
      if (!comment) return { status: 404, jsonBody: { error: '없는 답변입니다.' } };
      if (comment.authorSub !== user.sub) return { status: 403, jsonBody: { error: '본인 답변만 수정할 수 있습니다.' } };
      if (comment.status === 'blocked') return { status: 403, jsonBody: { error: '차단된 답변은 수정할 수 없습니다.' } };
      if (comment.status === 'deleted') return { status: 403, jsonBody: { error: '삭제된 답변은 수정할 수 없습니다.' } };

      let body;
      try { body = await request.json(); } catch { return bad('요청 형식이 잘못됐습니다.'); }

      const text = String(body.body || '').trim();
      if (!text) return bad('내용을 입력해 주세요.');
      if (text.length > LIMIT.comment) return bad(`답변은 ${LIMIT.comment}자까지 쓸 수 있습니다.`);

      // 금칙어 확인
      const cfg = await settings.get();
      const hits = findBanned(text, cfg.bannedWords);
      const newStatus = hits.length ? 'held' : 'public';

      /* 고치기 전 상태를 patch 이전에 붙잡아 둔다. patch 가 문서를 바꾸고 나면
         comment.status 는 이미 새 상태라, 그걸 보고 답변 수를 조정하면 아무 일도
         일어나지 않는다 (실제로 이 순서 때문에 답변 수가 안 움직였다). */
      const prevStatus = comment.status;

      await c.item(commentId, postId).patch([
        { op: 'replace', path: '/body', value: text },
        { op: 'replace', path: '/status', value: newStatus },
        ...(hits.length ? [{ op: 'add', path: '/heldWords', value: hits }] : [{ op: 'remove', path: '/heldWords' }]),
        { op: 'replace', path: '/updatedAt', value: new Date().toISOString() }
      ]);

      // 답변 수 조정: public→held 면 -1, (held|blocked)→public 면 +1
      if (prevStatus === 'public' && newStatus === 'held') {
        await c.item(post.id, post.pk).patch([{ op: 'incr', path: '/answers', value: -1 }]);
      } else if (prevStatus !== 'public' && newStatus === 'public') {
        await c.item(post.id, post.pk).patch([{ op: 'incr', path: '/answers', value: 1 }]);
      }

      return {
        status: 200,
        jsonBody: newStatus === 'held'
          ? { held: true, message: '부적절한 표현이 감지되어 검토 대기 중입니다. 오탐이면 곧 공개됩니다.' }
          : { held: false, comment: publicComment({ ...comment, body: text, status: newStatus, updatedAt: new Date().toISOString() }, user.sub) }
      };
    } catch (e) {
      context.error('댓글 수정 실패:', e.message);
      return dbFail(e, '수정하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
  }
});

/* ── 댓글 삭제 ──
   자기 댓글만, 공개 상태인 글에서만 가능. 문서는 지우지 않고 status만 'deleted'로 */
app.http('commentsDelete', {
  route: 'posts/{postId}/comments/{commentId}',
  methods: ['DELETE'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;
    const user = session.current(request);
    if (!user) return { status: 401, jsonBody: { error: '로그인이 필요합니다.' } };

    const postId = request.params.postId;
    const commentId = request.params.commentId;
    const c = container();

    try {
      const post = (await query({
        query: "SELECT * FROM c WHERE c.type = 'post' AND c.id = @id",
        parameters: [{ name: '@id', value: postId }]
      }))[0];
      if (!post || post.status !== 'public') {
        return { status: 404, jsonBody: { error: '없는 글입니다.' } };
      }

      const comment = (await query({
        query: "SELECT * FROM c WHERE c.type = 'comment' AND c.id = @id AND c.pk = @p",
        parameters: [{ name: '@id', value: commentId }, { name: '@p', value: postId }]
      }))[0];
      if (!comment) return { status: 404, jsonBody: { error: '없는 답변입니다.' } };
      if (comment.authorSub !== user.sub) return { status: 403, jsonBody: { error: '본인 답변만 삭제할 수 있습니다.' } };
      if (comment.status === 'deleted') return { status: 400, jsonBody: { error: '이미 삭제된 답변입니다.' } };

      // 답변 수가 올라가 있는 상태(public)였다면 내린다
      if (comment.status === 'public') {
        await c.item(post.id, post.pk).patch([{ op: 'incr', path: '/answers', value: -1 }]);
      }

      await c.item(commentId, postId).patch([
        { op: 'replace', path: '/status', value: 'deleted' },
        { op: 'replace', path: '/body', value: '(삭제된 답변입니다.)' },
        { op: 'replace', path: '/deletedAt', value: new Date().toISOString() }
      ]);

      return { status: 200, jsonBody: { ok: true } };
    } catch (e) {
      context.error('댓글 삭제 실패:', e.message);
      return dbFail(e, '삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
  }
});


// 테스트가 레이트 리밋만 직접 부른다 — 나머지는 이 파일 안에서만 쓴다
module.exports = { _voteAllowed: voteAllowed };
