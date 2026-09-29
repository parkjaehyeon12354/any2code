const { app } = require('@azure/functions');
const session = require('../lib/session');
const { lockdown } = require('../lib/lockdown');
const { container, query, dbFail } = require('../lib/db');
const sanction = require('../lib/sanction');
const credit = require('../lib/credit');
const profile = require('../lib/profile');

/* 커스텀 창작마당 — 선생님(티처 요금제)과 관리자가 HTML(시뮬레이션·양식·도구)을 올리고, 누구나 실행해 본다.
   문서: type 'workshop', id 'w_…', pk 'workshop'(한 파티션 — 목록은 늘 전부 훑는다).
   HTML 은 여기서 거르지 않는다 — 화면이 사이트와 격리된 칸(sandbox, allow-same-origin 없음)에서만 실행한다
   (assets/js/workshop-frame.js). 그 격리가 이 기능의 보안 전부다.
   대표 이미지(선택)는 따로 둔다: type 'workshopThumb', id 'thumb:<자료 id>', 같은 파티션 — 목록이 이미지를 싣지 않고,
   카드마다 /api/workshop-thumb/{id} 로 한 장씩 받는다(작은 문서 한 번 읽기). 없으면 화면이 종류별 그림을 그린다. */
const KINDS = ['report', 'simulation', 'inquiry', 'game', 'quiz', 'etc'];
const LIMIT = { title: 60, desc: 500, htmlBytes: 200 * 1024, thumbBytes: 64 * 1024 };
const PK = 'workshop';

const bad = (message) => ({ status: 400, jsonBody: { error: message } });
const rid = () => 'w_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
// HTML 200KB(JSON 이스케이프로 조금 불어남) + 대표 이미지 64KB 의 base64(약 86KB)
const tooBig = (request) => Number(request.headers.get('content-length') || 0) > 352 * 1024;
const thumbId = (id) => 'thumb:' + id;

/* 대표 이미지 — 화면이 400×250 JPEG 로 줄여 data URL 로 보낸다. 우리 출처에서 그대로 내려보내는 바이트라
   JPEG 만 받는다(머리 바이트까지 확인). SVG·HTML 을 이미지라고 우겨 넣지 못하게. 없으면 null. */
function readThumb(v) {
  if (v == null || v === '') return null;
  const m = typeof v === 'string' && /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(v);
  const buf = m && Buffer.from(m[1], 'base64');
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return { error: '대표 이미지를 읽지 못했습니다. 다른 그림으로 해 보세요.' };
  if (buf.length > LIMIT.thumbBytes) return { error: `대표 이미지는 ${LIMIT.thumbBytes / 1024}KB 까지입니다.` };
  return buf;
}

/** 올릴 수 있는 사람인가 — 관리자는 요청마다 ADMIN_EMAILS 로, 선생님은 지금 요금제로 판정한다. */
async function uploaderRole(user) {
  if (!user) return null;
  if (session.isAdmin(user.email)) return 'admin';
  return credit.planOf(await credit.readDoc(user.sub)) === 'teacher' ? 'teacher' : null;
}

/** 밖으로 내보낼 형태. 작성자 식별자(sub)는 넣지 않는다. HTML 은 실행 화면에서 하나씩만 받는다(full). */
const publicItem = (d, viewerSub, admin, full = false) => ({
  id: d.id, kind: d.kind, title: d.title, desc: d.desc, author: d.authorName, role: d.authorRole, createdAt: d.createdAt, size: d.size, thumb: !!d.thumb,
  mine: !!viewerSub && d.authorSub === viewerSub,
  canDelete: admin || (!!viewerSub && d.authorSub === viewerSub),
  ...(full ? { html: d.html } : {})
});

// 목록은 HTML 을 읽지 않는다 — 한 건에 수백 KB 라, 다 읽으면 목록 한 번에 RU 를 크게 먹는다.
// desc 는 Cosmos SQL 예약어(ORDER BY … DESC)라 c.desc 로 쓰면 쿼리가 통째로 실패한다(라이브 503) — c["desc"] 로 쓴다
const FIELDS = 'c.id, c.kind, c.title, c["desc"], c.authorName, c.authorRole, c.authorSub, c.createdAt, c.size, c.thumb';

/* ── 목록 ── 비로그인도 본다. 올릴 수 있는 사람인지(canUpload)도 함께 준다 — 화면이 올리기 버튼을 그린다 */
app.http('workshopList', {
  route: 'workshop',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;
    const kind = new URL(request.url).searchParams.get('kind');
    const user = session.current(request);
    try {
      const spec = KINDS.includes(kind)
        ? { query: `SELECT ${FIELDS} FROM c WHERE c.type = 'workshop' AND c.pk = @p AND c.kind = @k`,
            parameters: [{ name: '@p', value: PK }, { name: '@k', value: kind }] }
        : { query: `SELECT ${FIELDS} FROM c WHERE c.type = 'workshop' AND c.pk = @p`, parameters: [{ name: '@p', value: PK }] };
      const [rows, role] = await Promise.all([query(spec), uploaderRole(user)]);
      rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return {
        jsonBody: { items: rows.map((d) => publicItem(d, user && user.sub, role === 'admin')), canUpload: !!role },
        headers: { 'Cache-Control': 'no-store' }
      };
    } catch (e) {
      context.error('창작마당 목록 실패:', e.message);
      return dbFail(e, '목록을 불러오지 못했습니다.');
    }
  }
});

/* ── 올리기 ── */
app.http('workshopCreate', {
  route: 'workshop',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;
    const user = session.current(request);
    if (!user) return { status: 401, jsonBody: { error: '로그인이 필요합니다.' } };
    if (tooBig(request)) return { status: 413, jsonBody: { error: '요청이 너무 큽니다.' } };
    try {
      const blocked = await sanction.block(user.sub);
      if (blocked) return blocked;
      const role = await uploaderRole(user);
      if (!role) return { status: 403, jsonBody: { error: '선생님(티처 요금제)과 관리자만 올릴 수 있습니다.' } };

      let body;
      try { body = await request.json(); } catch { return bad('요청 형식이 잘못됐습니다.'); }
      const kind = String(body.kind || '');
      const title = String(body.title || '').trim();
      const desc = String(body.desc || '').trim();
      if (!KINDS.includes(kind)) return bad('종류를 골라 주세요.');
      if (!title) return bad('제목을 입력해 주세요.');
      if (title.length > LIMIT.title) return bad(`제목은 ${LIMIT.title}자까지 쓸 수 있습니다.`);
      if (desc.length > LIMIT.desc) return bad(`설명은 ${LIMIT.desc}자까지 쓸 수 있습니다.`);

      const html = typeof body.html === 'string' ? body.html : '';
      const size = Buffer.byteLength(html);
      if (!html.trim()) return bad('HTML 파일을 고르거나 코드를 붙여 넣어 주세요.');
      if (size > LIMIT.htmlBytes) return bad(`HTML 은 ${LIMIT.htmlBytes / 1024}KB 까지 올릴 수 있습니다. 지금 ${Math.ceil(size / 1024)}KB 입니다.`);
      const thumb = readThumb(body.thumb);
      if (thumb && thumb.error) return bad(thumb.error);

      const doc = { id: rid(), type: 'workshop', pk: PK, kind, title, desc, html, size, thumb: !!thumb, status: 'public',
        authorSub: user.sub, authorName: await profile.displayName(user).catch(() => user.name),
        authorRole: role, createdAt: new Date().toISOString() };
      // 이미지를 먼저 넣는다 — 자료가 먼저 생기고 이미지가 실패하면 목록이 없는 그림을 부른다(그래도 화면은 기본 그림으로 버틴다)
      if (thumb) await container().items.create({ id: thumbId(doc.id), type: 'workshopThumb', pk: PK, data: thumb.toString('base64'), createdAt: doc.createdAt });
      // ponytail: 도배 제한 없음 — 올리는 사람이 선생님·관리자뿐이라서. 학생에게 열 때 posts 처럼 기준 시간당 개수를 센다
      await container().items.create(doc);
      return { status: 201, jsonBody: { item: publicItem(doc, user.sub, role === 'admin') } };
    } catch (e) {
      context.error('창작마당 올리기 실패:', e.message);
      return dbFail(e, '올리지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
  }
});

/* ── 하나(HTML 포함) ── 실행 화면이 부른다. 누구나 본다 */
app.http('workshopGet', {
  route: 'workshop/{id}',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;
    const user = session.current(request);
    try {
      const doc = (await container().item(request.params.id, PK).read()).resource;
      if (!doc || doc.type !== 'workshop') return { status: 404, jsonBody: { error: '없는 자료입니다.' } };
      const admin = !!user && session.isAdmin(user.email);
      return { jsonBody: { item: publicItem(doc, user && user.sub, admin, true) }, headers: { 'Cache-Control': 'no-store' } };
    } catch (e) {
      if (e.code === 404) return { status: 404, jsonBody: { error: '없는 자료입니다.' } };
      context.error('창작마당 자료 조회 실패:', e.message);
      return dbFail(e, '자료를 불러오지 못했습니다.');
    }
  }
});

/* ── 지우기 ── 올린 사람과 관리자만 */
app.http('workshopDelete', {
  route: 'workshop/{id}',
  methods: ['DELETE'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;
    const user = session.current(request);
    if (!user) return { status: 401, jsonBody: { error: '로그인이 필요합니다.' } };
    try {
      const item = container().item(request.params.id, PK);
      const doc = (await item.read()).resource;
      if (!doc || doc.type !== 'workshop') return { status: 404, jsonBody: { error: '없는 자료입니다.' } };
      if (doc.authorSub !== user.sub && !session.isAdmin(user.email)) {
        return { status: 403, jsonBody: { error: '올린 사람과 관리자만 지울 수 있습니다.' } };
      }
      await item.delete();
      if (doc.thumb) await container().item(thumbId(doc.id), PK).delete().catch((e) => { if (e.code !== 404) context.warn('대표 이미지 지우기 실패:', e.message); });
      return { status: 204 };
    } catch (e) {
      if (e.code === 404) return { status: 404, jsonBody: { error: '없는 자료입니다.' } };
      context.error('창작마당 지우기 실패:', e.message);
      return dbFail(e, '지우지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
  }
});

/* ── 대표 이미지 ── 카드의 <img> 가 부른다. 자료 id 가 바뀌지 않고 이미지를 고치는 기능도 없어서 오래 캐시한다
   (staticwebapp.config.json 의 /api/workshop-thumb/* 규칙 — /api/* 의 no-store 보다 앞에 있어야 한다) */
app.http('workshopThumb', {
  route: 'workshop-thumb/{id}',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;
    try {
      const doc = (await container().item(thumbId(request.params.id), PK).read()).resource;
      if (!doc || doc.type !== 'workshopThumb') return { status: 404, jsonBody: { error: '대표 이미지가 없습니다.' } };
      return {
        body: Buffer.from(doc.data, 'base64'),
        headers: { 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox",
          'Cache-Control': 'public, max-age=31536000, immutable' }
      };
    } catch (e) {
      if (e.code === 404) return { status: 404, jsonBody: { error: '대표 이미지가 없습니다.' } };
      context.error('창작마당 대표 이미지 실패:', e.message);
      return dbFail(e, '대표 이미지를 불러오지 못했습니다.');
    }
  }
});
