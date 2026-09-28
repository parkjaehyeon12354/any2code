const { app } = require('@azure/functions');
const session = require('../lib/session');
const { lockdown } = require('../lib/lockdown');
const { container, query, dbFail } = require('../lib/db');
const sanction = require('../lib/sanction');
const credit = require('../lib/credit');
const profile = require('../lib/profile');

/* 커스텀 창작마당 — 선생님(티처 요금제)과 관리자가 자료를 올리고, 누구나 본다.
   문서: type 'workshop', id 'w_…', pk 'workshop'(한 파티션 — 목록은 늘 전부 훑는다). */
const KINDS = ['report', 'simulation', 'inquiry', 'etc'];
const LIMIT = { title: 60, desc: 500, body: 4000, cell: 200, name: 100, sections: 50 };
const PK = 'workshop';

const bad = (message) => ({ status: 400, jsonBody: { error: message } });
const rid = () => 'w_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const tooBig = (request) => Number(request.headers.get('content-length') || 0) > 64 * 1024;
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/** 올릴 수 있는 사람인가 — 관리자는 요청마다 ADMIN_EMAILS 로, 선생님은 지금 요금제로 판정한다. */
async function uploaderRole(user) {
  if (!user) return null;
  if (session.isAdmin(user.email)) return 'admin';
  return credit.planOf(await credit.readDoc(user.sub)) === 'teacher' ? 'teacher' : null;
}

/* 보고서 양식 — 보고서 작성 화면의 커스텀 데이터 {title, sections}. 모르는 키는 버리고 길이를 자른다.
   세부 규칙(그래프 종류 등)은 가져올 때 화면의 normal() 이 한 번 더 거른다. */
function cleanTemplate(t) {
  if (!t || typeof t !== 'object' || !Array.isArray(t.sections)) return null;
  const sections = t.sections.filter((s) => s && typeof s === 'object').slice(0, LIMIT.sections).map((s) => {
    const type = s.type === 'table' || s.type === 'graph' ? s.type : 'text';
    const b = { type, name: str(s.name, LIMIT.name) };
    if (type === 'text') return { ...b, body: str(s.body, LIMIT.body) };
    if (type === 'graph') {
      Object.assign(b, { kind: str(s.kind, 20), x: str(s.x, LIMIT.name), y: str(s.y, LIMIT.name), trend: s.trend === true,
        err: s.err === 'sd' ? 'sd' : 'range', title: str(s.title, LIMIT.name), xu: str(s.xu, 20), yu: str(s.yu, 20), legend: str(s.legend, 10) });
    }
    const rows = (Array.isArray(s.cells) ? s.cells : []).filter(Array.isArray).slice(0, 31);
    b.cells = rows.map((r) => r.slice(0, 8).map((c) => str(c, LIMIT.cell)));
    return b;
  });
  return sections.length ? { title: str(t.title, LIMIT.title * 2), sections } : null;
}

/* 시뮬레이션 조건 — 시뮬레이션의 '공유 링크'. 우리 사이트의 /simulation/*.html 만 받고,
   주소(경로 + 쿼리)만 저장한다. 다른 사이트·javascript: 주소가 목록에 링크로 걸리면 안 된다. */
function cleanLink(raw) {
  let u;
  try { u = new URL(String(raw || '').trim(), 'https://ans2quest.com'); } catch { return null; }
  if (u.origin !== 'https://ans2quest.com' || !/^\/simulation\/[a-z0-9-]+\.html$/.test(u.pathname)) return null;
  return u.search.length > 400 ? null : u.pathname + u.search;
}

const summary = (t) => ({
  title: t.title,
  text: t.sections.filter((s) => s.type === 'text').length,
  table: t.sections.filter((s) => s.type === 'table').length,
  graph: t.sections.filter((s) => s.type === 'graph').length
});

/** 밖으로 내보낼 형태. 작성자 식별자(sub)는 넣지 않는다. 보고서 양식 본문은 가져오기 때 따로 준다. */
const publicItem = (d, viewerSub, admin) => ({
  id: d.id, kind: d.kind, title: d.title, desc: d.desc, author: d.authorName, role: d.authorRole, createdAt: d.createdAt,
  mine: !!viewerSub && d.authorSub === viewerSub,
  canDelete: admin || (!!viewerSub && d.authorSub === viewerSub),
  ...(d.kind === 'report' ? { report: summary(d.template) } : d.kind === 'simulation' ? { link: d.link } : { body: d.body })
});

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
        ? { query: "SELECT * FROM c WHERE c.type = 'workshop' AND c.pk = @p AND c.kind = @k",
            parameters: [{ name: '@p', value: PK }, { name: '@k', value: kind }] }
        : { query: "SELECT * FROM c WHERE c.type = 'workshop' AND c.pk = @p", parameters: [{ name: '@p', value: PK }] };
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

      const doc = { id: rid(), type: 'workshop', pk: PK, kind, title, desc, status: 'public',
        authorSub: user.sub, authorName: await profile.displayName(user).catch(() => user.name),
        authorRole: role, createdAt: new Date().toISOString() };
      if (kind === 'report') {
        doc.template = cleanTemplate(body.template);
        if (!doc.template) return bad('올릴 보고서 양식이 없습니다. 보고서 작성의 커스텀에서 만들고 임시 저장해 주세요.');
      } else if (kind === 'simulation') {
        doc.link = cleanLink(body.link);
        if (!doc.link) return bad('시뮬레이션의 「공유 링크 만들기」로 만든 주소를 붙여 넣어 주세요.');
      } else {
        doc.body = String(body.body || '').trim();
        if (!doc.body) return bad('내용을 입력해 주세요.');
        if (doc.body.length > LIMIT.body) return bad(`내용은 ${LIMIT.body}자까지 쓸 수 있습니다.`);
      }
      // ponytail: 도배 제한 없음 — 올리는 사람이 선생님·관리자뿐이라서. 학생에게 열 때 posts 처럼 기준 시간당 개수를 센다
      await container().items.create(doc);
      return { status: 201, jsonBody: { item: publicItem(doc, user.sub, role === 'admin') } };
    } catch (e) {
      context.error('창작마당 올리기 실패:', e.message);
      return dbFail(e, '올리지 못했습니다. 잠시 후 다시 시도해 주세요.');
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
      return { status: 204 };
    } catch (e) {
      if (e.code === 404) return { status: 404, jsonBody: { error: '없는 자료입니다.' } };
      context.error('창작마당 지우기 실패:', e.message);
      return dbFail(e, '지우지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
  }
});
