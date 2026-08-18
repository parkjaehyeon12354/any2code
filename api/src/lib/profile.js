/* 사용자 프로필.

   로그인은 지금까지 DB 에 아무것도 남기지 않았다 (서명 쿠키만 발급). 표시 이름과
   생일처럼 "사용자가 고른 값" 은 쿠키에 담을 수 없으니 문서가 필요하다.

   ⚠ id 에 sub 를 그대로 쓰지 말 것. 제재 문서가 이미 id = pk = sub 를 쓰고 있어서
   (reports.js), 같은 id 로 upsert 하면 로그인만 해도 그 사람의 제재가 통째로
   덮여 사라진다. 그래서 id 에 'user:' 를 붙인다. pk 는 sub 그대로 두어 제재·소명과
   같은 파티션에 모은다 — 한 사람 것을 한 번에 훑을 수 있다.

   생일은 밖으로 절대 내보내지 않는다. 대상이 고등학생이라 공개될 이유가 없고,
   글 목록은 사용자 문서를 아예 참조하지 않으므로 이 파일만 지키면 새지 않는다. */
const { container, query } = require('./db');
const sanction = require('./sanction');

const docId = (sub) => 'user:' + sub;

const NAME_MIN = 2;
const NAME_MAX = 20;

/* 표시 이름을 바꾸면 본인이 쓴 글·답변의 작성자명까지 함께 고친다. 이름을 바꾸는
   이유가 보통 "구글 본명이 그대로 노출돼서" 이므로, 옛 글에 본명이 남으면 바꾼
   의미가 없다. 대상은 항상 본인 문서뿐이라 범위가 자기 글 수로 제한된다.
   ponytail: 글 수만큼 patch 를 돈다. 한 사람이 수천 개를 쓰는 서비스가 되면
   비동기 큐로 옮겨야 한다 — 지금은 작성 제한이 10분 5개라 상한이 낮다. */
const RENAME_MIN_INTERVAL_MS = 60 * 1000;

/* 사칭 차단. 표시 이름은 글마다 공개되므로 운영자로 보이는 이름을 막는다. */
const RESERVED = ['관리자', '운영자', '운영팀', 'admin', 'administrator', 'ans2quest', '어드민'];

const bad = (m) => { const e = new Error(m); e.code = 'BAD_PROFILE'; throw e; };

/** 표시 이름 검사. 통과하면 다듬은 값을 돌려준다. */
function checkName(raw) {
  // 제어문자와 줄바꿈은 지운다 — 목록에서 줄을 깨거나 이름을 숨기는 데 쓰인다
  const name = String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f]/g, '').trim();

  if (name.length < NAME_MIN) bad(`이름은 ${NAME_MIN}자 이상이어야 합니다.`);
  if (name.length > NAME_MAX) bad(`이름은 ${NAME_MAX}자까지 쓸 수 있습니다.`);

  const flat = name.replace(/\s+/g, '').toLowerCase();
  if (RESERVED.some((w) => flat.includes(w))) bad('운영진으로 오해될 수 있는 이름은 쓸 수 없습니다.');

  return name;
}

/** 생일 검사. 빈 값은 "설정 안 함" 으로 허용한다 (필수로 물을 이유가 없다). */
function checkBirthday(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) bad('생일은 YYYY-MM-DD 형식이어야 합니다.');

  // 정규식만 보면 2026-02-31 이 통과한다. Date 로 되돌려 같은 날짜인지 확인한다.
  const d = new Date(s + 'T00:00:00Z');
  if (isNaN(d) || d.toISOString().slice(0, 10) !== s) bad('없는 날짜입니다.');

  const today = new Date().toISOString().slice(0, 10);
  if (s > today) bad('생일이 미래일 수는 없습니다.');
  if (s < '1900-01-01') bad('생일을 다시 확인해 주세요.');

  return s;
}

/** 밖으로 내보낼 형태. 소유자에게만 준다. */
const view = (doc, user) => ({
  name: doc && doc.displayName ? doc.displayName : user.name,   // 아직 안 바꿨으면 로그인 제공자 이름
  oauthName: user.name,
  nameChanged: !!(doc && doc.displayName),
  birthday: (doc && doc.birthday) || null,
  email: user.email,
  provider: user.provider,
  joinedAt: (doc && doc.joinedAt) || null,
  lastLoginAt: (doc && doc.lastLoginAt) || null,
  nameChangedAt: (doc && doc.nameChangedAt) || null
});

async function read(sub) {
  try {
    return (await container().item(docId(sub), sub).read()).resource || null;
  } catch {
    return null;   // 문서가 없거나 DB 를 못 읽는 경우. 둘 다 "아직 없음" 으로 다룬다.
  }
}

/** 로그인마다 호출. 제공자에서 온 값은 갱신하되 사용자가 고른 값은 건드리지 않는다. */
async function ensure(user) {
  const now = new Date().toISOString();
  const existing = await read(user.sub);

  if (existing) {
    // displayName·birthday 는 절대 덮지 않는다. 로그인 한 번에 설정이 초기화되면
    // 사용자는 "저장이 안 된다" 고 느낀다.
    await container().item(docId(user.sub), user.sub).patch([
      { op: 'set', path: '/lastLoginAt', value: now },
      { op: 'set', path: '/oauthName', value: user.name },
      { op: 'set', path: '/email', value: user.email }
    ]);
    return;
  }

  await container().items.create({
    id: docId(user.sub),
    type: 'user',
    pk: user.sub,
    userSub: user.sub,
    oauthName: user.name,
    email: user.email,
    provider: user.provider,
    displayName: null,
    birthday: null,
    joinedAt: now,
    lastLoginAt: now
  });
}

/** 글·답변에 박아 둘 작성자명. 아직 안 바꿨으면 제공자 이름. */
async function displayName(user) {
  const doc = await read(user.sub);
  return (doc && doc.displayName) || user.name;
}

/** 본인이 쓴 글·답변의 작성자명을 새 이름으로 맞춘다. 고친 개수를 돌려준다. */
async function renameOwnContent(sub, name) {
  const rows = await query({
    query: "SELECT c.id, c.pk FROM c WHERE c.type IN ('post', 'comment') AND c.authorSub = @u",
    parameters: [{ name: '@u', value: sub }]
  });
  const c = container();
  for (const r of rows) {
    await c.item(r.id, r.pk).patch([{ op: 'set', path: '/authorName', value: name }]);
  }
  return rows.length;
}

async function save(user, input) {
  const src = input && typeof input === 'object' ? input : {};
  const name = checkName(src.name);
  const birthday = checkBirthday(src.birthday);

  const existing = await read(user.sub);
  if (!existing) {
    // 로그인 시 만들어지지만, 그때 DB 가 죽어 있었을 수 있다. 여기서 한 번 더 만든다.
    await ensure(user);
  }

  const before = existing || (await read(user.sub));
  const now = new Date().toISOString();

  // 제공자 이름과 같으면 "안 바꾼 상태" 로 되돌린다 — 굳이 같은 값을 박아둘 이유가 없다
  const nextName = name === user.name ? null : name;
  const prevName = (before && before.displayName) || null;
  const nameChanged = nextName !== prevName;

  if (nameChanged && before && before.nameChangedAt &&
      Date.now() - Date.parse(before.nameChangedAt) < RENAME_MIN_INTERVAL_MS) {
    bad('이름은 1분에 한 번만 바꿀 수 있습니다.');
  }

  const ops = [{ op: 'set', path: '/birthday', value: birthday }];
  if (nameChanged) {
    ops.push({ op: 'set', path: '/displayName', value: nextName });
    ops.push({ op: 'set', path: '/nameChangedAt', value: now });
  }
  await container().item(docId(user.sub), user.sub).patch(ops);

  // 문서를 먼저 고치고 나서 옛 글을 맞춘다. 순서가 반대면 실패했을 때
  // 글에는 새 이름, 프로필에는 옛 이름이 남아 어느 쪽이 맞는지 알 수 없다.
  let renamed = 0;
  if (nameChanged) renamed = await renameOwnContent(user.sub, nextName || user.name);

  return { profile: view(await read(user.sub), user), renamed };
}

/* ── 제재·소명 내역 ──
   소유자에게만 준다.

   ⚠ 관리자 이메일(by, liftedBy, reducedBy)은 넣지 않는다. 제재받은 학생에게
   처리한 사람을 알려줄 이유가 없고, 알려주면 그 사람에게 직접 항의가 간다.

   ⚠ 두 종류를 한 쿼리로 묶어 ORDER BY 를 걸면 안 된다. 제재 문서에는 createdAt 이
   없고(at 을 쓴다), Cosmos 는 ORDER BY 대상 필드가 없는 문서를 결과에서 아예
   빼버린다 — 제재가 조용히 사라진다. 그래서 따로 읽고 JS 로 정렬한다. */
const sanctionView = (s) => ({
  reason: s.reason,
  days: s.days,
  until: s.until,
  at: s.at,
  active: s.until > new Date().toISOString(),
  lifted: !!s.liftedAt,          // 소명이 받아들여져 즉시 풀린 경우
  liftedAt: s.liftedAt || null,
  reducedAt: s.reducedAt || null
});

const appealView = (a) => ({
  id: a.id,
  text: a.text,
  createdAt: a.createdAt,
  status: a.status,                                        // wait | denied | granted | reduced
  decidedAt: (a.decision && a.decision.at) || null,
  reducedDays: a.decision && a.decision.decision === 'reduced' ? a.decision.days : null
});

/* 제재 이력 한 줄. by(관리자 식별자)는 빼고 내보낸다. */
const historyView = (h) => ({
  event: h.event,                                          // issued | reduced | lifted
  days: Number.isInteger(h.days) ? h.days : null,
  until: h.until || null,
  reason: h.reason || null,
  at: h.at
});

async function discipline(sub) {
  const [sanctions, appeals, log] = await Promise.all([
    query({
      query: "SELECT * FROM c WHERE c.type = 'sanction' AND c.pk = @s",
      parameters: [{ name: '@s', value: sub }]
    }),
    query({
      query: "SELECT * FROM c WHERE c.type = 'appeal' AND c.pk = @s",
      parameters: [{ name: '@s', value: sub }]
    }),
    sanction.history(sub)
  ]);

  return {
    /* 현재 제재는 사용자당 문서 하나다 (발급이 upsert) — 집행이 보는 값이다.
       history 는 덮이지 않는 이벤트 기록이라 지난 제재까지 남는다. 이력이 비어 있어도
       (기능 추가 전에 받은 제재) sanction 은 정확하므로 둘을 함께 내보낸다. */
    sanction: sanctions[0] ? sanctionView(sanctions[0]) : null,
    history: log.map(historyView),
    appeals: appeals.map(appealView).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  };
}

// NAME_MIN·NAME_MAX 는 화면이 input 의 minlength/maxlength 에 그대로 쓴다 (functions/profile.js)
module.exports = { ensure, read, save, view, displayName, discipline, NAME_MIN, NAME_MAX };
