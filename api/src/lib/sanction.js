/* 이용 제한 확인.

   제재는 사용자당 문서 하나(id = pk = 사용자 sub)다. 기간이 지난 건 문서를
   지우지 않고 그대로 둔다 — 이력이 남아야 반복 위반을 알 수 있다.
   그래서 "제재가 있느냐" 가 아니라 "지금 유효하냐" 를 물어야 한다.

   reports.js(발급)와 posts.js(집행)가 함께 쓴다. 집행이 없으면 제재는
   화면에만 있는 문구다. */
const { query } = require('./db');

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
  // 언제 풀리는지 알려주지 않으면 "왜 안 되지" 하고 계속 시도한다
  const when = new Date(s.until).toLocaleDateString('ko-KR');
  return {
    status: 403,
    jsonBody: {
      error: `이용이 제한된 상태입니다. (${s.reason} · ${when} 해제)`,
      suspendedUntil: s.until
    }
  };
}

module.exports = { active, block };
