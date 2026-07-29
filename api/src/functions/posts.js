const { app } = require('@azure/functions');
const session = require('../lib/session');
const { lockdown } = require('../lib/lockdown');
const { container, query } = require('../lib/db');

/* 과목은 서버가 정한 목록만 받는다. 클라이언트가 보낸 값을 그대로 파티션 키로
   쓰면 아무 문자열이나 새 파티션이 되어 데이터가 흩어진다. */
const SUBJECTS = ['physics', 'chem', 'bio', 'earth'];

const LIMIT = { title: 120, body: 4000 };

/* 자동 보류 필터. admin.html 과 같은 목록이다.
   '고아' 처럼 정상 문맥에도 쓰이는 단어가 있어 오탐이 반드시 생긴다 —
   그래서 삭제가 아니라 보류이고, 사람이 최종 판단한다. */
const BANNED_WORDS = ['씨발', '시발', '병신', '개새끼', '좆', '지랄', '새끼', '꺼져', '고아'];
const findBanned = (text) => BANNED_WORDS.filter((w) => text.includes(w));

const rid = (prefix) => prefix + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/* ── 도배 방지 ──
   글: 최근 10분 내 5개까지. DB 를 세므로 인스턴스가 재시작해도 유지된다.
   투표: 분당 30번까지. 표는 사람당 하나라 남는 건 RU 소모뿐이니
   인스턴스 메모리로 충분하다 (재시작하면 초기화 — 감수한다). */
const POST_WINDOW_MS = 10 * 60 * 1000;
const POST_MAX_IN_WINDOW = 5;

const voteLog = new Map();   // sub → [timestamp]
function voteAllowed(sub, now = Date.now()) {
  const arr = (voteLog.get(sub) || []).filter((t) => now - t < 60_000);
  if (arr.length >= 30) { voteLog.set(sub, arr); return false; }
  arr.push(now);
  voteLog.set(sub, arr);
  return true;
}

/* 본문 상한(4000자)보다 훨씬 큰 요청은 파싱 전에 자른다 —
   수십 MB JSON 을 받아서 파싱한 뒤에야 거절하면 그 자체가 부하다. */
const tooBig = (request) => Number(request.headers.get('content-length') || 0) > 32 * 1024;

/** 목록에 나갈 형태. 작성자 식별자(sub)는 밖으로 내보내지 않는다. */
const publicPost = (p) => ({
  id: p.id,
  subject: p.subject,
  title: p.title,
  excerpt: p.body.length > 200 ? p.body.slice(0, 200) + '…' : p.body,
  author: p.authorName,
  createdAt: p.createdAt,
  score: p.score || 0,
  answers: p.answers || 0,
  lab: !!p.lab
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
        jsonBody: { posts: posts.map(publicPost), votes },
        headers: { 'Cache-Control': 'no-store' }
      };
    } catch (e) {
      context.error('목록 조회 실패:', e.message);
      return fail(e, '목록을 불러오지 못했습니다.');
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

    // 도배 확인 — 이 사용자가 최근 10분간 쓴 글 수
    try {
      const since = new Date(Date.now() - POST_WINDOW_MS).toISOString();
      const [n] = await query({
        query: "SELECT VALUE COUNT(1) FROM c WHERE c.type = 'post' AND c.authorSub = @u AND c.createdAt > @since",
        parameters: [{ name: '@u', value: user.sub }, { name: '@since', value: since }]
      });
      if (n >= POST_MAX_IN_WINDOW) {
        return { status: 429, jsonBody: { error: '잠시 후에 다시 작성해 주세요. 10분에 5개까지 올릴 수 있습니다.' } };
      }
    } catch (e) {
      context.error('도배 확인 실패:', e.message);
      return fail(e, '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }

    const hits = findBanned(title + '\n' + text);
    const doc = {
      id: rid('p'),
      type: 'post',
      pk: subject,
      subject,
      title,
      body: text,
      authorSub: user.sub,
      authorName: user.name,
      createdAt: new Date().toISOString(),
      score: 0,
      answers: 0,
      lab: false,
      status: hits.length ? 'held' : 'public',
      ...(hits.length ? { heldWords: hits } : {})
    };

    try {
      await container().items.create(doc);
    } catch (e) {
      context.error('작성 실패:', e.message);
      return fail(e, '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
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
      return fail(e, '처리하지 못했습니다.');
    }
  }
});

function bad(message) { return { status: 400, jsonBody: { error: message } }; }

/* DB 실패를 돌려준다. 설정 누락은 따로 알려준다 — 값이 아니라 "무엇을 등록해야
   하는지"만 말하므로 비밀이 새지 않고, 배포 후 원인을 응답만 보고 알 수 있다. */
function fail(e, message) {
  if (e && e.code === 'NO_COSMOS_CONFIG') {
    return { status: 503, jsonBody: { error: '서버에 데이터베이스가 연결되지 않았습니다. (COSMOS_CONNECTION 미설정)' } };
  }
  return { status: 503, jsonBody: { error: message } };
}

module.exports = { SUBJECTS, LIMIT, findBanned, publicPost, _voteAllowed: voteAllowed };
