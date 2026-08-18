/* 이용 제한 확인.

   제재는 사용자당 문서 하나(id = pk = 사용자 sub)다. 기간이 지난 건 문서를
   지우지 않고 그대로 둔다 — 이력이 남아야 반복 위반을 알 수 있다.
   그래서 "제재가 있느냐" 가 아니라 "지금 유효하냐" 를 물어야 한다.

   reports.js(발급)와 posts.js(집행)가 함께 쓴다. 집행이 없으면 제재는
   화면에만 있는 문구다. */
const { container, query } = require('./db');

/** 지금 유효한 제재. 없거나 기간이 지났으면 null. */
async function active(sub) {
  const rows = await query({
    query: "SELECT * FROM c WHERE c.type = 'sanction' AND c.pk = @s",
    parameters: [{ name: '@s', value: sub }]
  });
  const s = rows[0];
  return s && s.until > new Date().toISOString() ? s : null;
}

/** 제한 중이면 403 응답, 아니면 null. 핸들러에서 그대로 반환하면 된다. */
async function block(sub) {
  const s = await active(sub);
  if (!s) return null;
  /* 언제 풀리는지 알려주지 않으면 "왜 안 되지" 하고 계속 시도한다.

     시간대를 한국으로 고정한다. Azure Functions 는 UTC 로 돌아서 그냥 찍으면
     한국 새벽~오전 9시 구간이 하루 전으로 나온다 — 화면의 제재 배너(로컬 시간대)와
     이 문구가 서로 다른 날짜를 말하게 된다.
     'sv-SE' 로케일은 YYYY-MM-DD 를 주므로 화면(session.js 의 shortDate)과 모양도 같다. */
  const when = new Date(s.until).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  return {
    status: 403,
    jsonBody: {
      error: `이용이 제한된 상태입니다. (${s.reason} · ${when} 해제)`,
      suspendedUntil: s.until
    }
  };
}

/* ── 제재 이력 ──
   현재 제재는 사용자당 문서 하나(upsert)라 새 제재가 이전 것을 덮는다. 집행은 그
   하나만 보면 되지만, 본인에게 "언제 어떤 제재를 받았는지" 를 보여주려면 덮이지 않는
   기록이 따로 있어야 한다. 그래서 이벤트가 생길 때마다 문서를 하나 더 쌓는다.

   ⚠ 집행 경로(active/block)는 이 로그를 절대 보지 않는다. 로그가 근거가 되면
   기록 한 줄이 실패했을 때 제재가 누락되고, 그게 제재 자체보다 위험하다.
   반대 방향도 지킨다 — 로그 쓰기가 실패해도 제재 처리는 성공으로 끝난다.

   ⚠ 제재 문서(type='sanction')와 다른 type 을 쓴다. 같은 type 이면 active() 의
   조회에 이력이 섞여 들어와 이미 지난 제재로 사람을 막는다. */
const logId = () => 'sl_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const EVENTS = ['issued', 'reduced', 'lifted'];

/** 이력 한 줄 추가. 절대 덮지 않는다. */
async function log(entry) {
  if (!EVENTS.includes(entry.event)) throw new Error('알 수 없는 제재 이벤트: ' + entry.event);
  await container().items.create({
    id: logId(),
    type: 'sanctionLog',
    pk: entry.sub,
    userSub: entry.sub,
    event: entry.event,
    days: Number.isInteger(entry.days) ? entry.days : null,
    until: entry.until || null,
    reason: entry.reason || null,
    by: entry.by || null,          // 관리자 식별자 — 본인에게 내보낼 때는 뺀다
    at: new Date().toISOString()
  });
}

/** 한 사람의 제재 이력. 최근 것이 먼저.
    ORDER BY 를 쓰지 않고 JS 로 정렬한다 — 이력 수가 적고, 정렬 필드가 빠진 문서를
    Cosmos 가 결과에서 빼버리는 함정을 아예 피한다. */
async function history(sub) {
  const rows = await query({
    query: "SELECT * FROM c WHERE c.type = 'sanctionLog' AND c.pk = @s",
    parameters: [{ name: '@s', value: sub }]
  });
  return rows.sort((a, b) => (a.at < b.at ? 1 : -1));
}

module.exports = { active, block, log, history };
