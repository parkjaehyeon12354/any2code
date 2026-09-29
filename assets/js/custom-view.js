/* 창작마당 자료 하나를 실행한다. 올린 글자는 textContent 로만, HTML 은 WorkshopFrame 격리 칸에서만. */
(function () {
  const KIND_LABEL = { report: '보고서 양식', simulation: '시뮬레이션', inquiry: '탐구 주제·실험 설계', etc: '기타' };
  const ROLE_LABEL = { teacher: '선생님', admin: '관리자' };
  const $ = (id) => document.getElementById(id);
  const id = new URLSearchParams(location.search).get('id');
  let item = null;

  const mount = () => $('v-stage').replaceChildren(WorkshopFrame.create(item.html, item.title));

  function fail(message) {
    $('v-title').textContent = '자료를 열 수 없습니다';
    $('v-meta').textContent = message;
  }

  async function load() {
    if (!id) return fail('자료 주소가 잘못됐습니다. 커스텀 목록에서 다시 골라 주세요.');
    try {
      const res = await fetch('/api/workshop/' + encodeURIComponent(id), { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      item = data.item;
    } catch (e) {
      return fail((e && e.message) || '자료를 불러오지 못했습니다.');
    }
    document.title = `${item.title} — 커스텀 — Ans2Quest`;
    $('v-kind').textContent = KIND_LABEL[item.kind] || '기타';
    $('v-title').textContent = item.title;
    $('v-meta').textContent = [item.author, ROLE_LABEL[item.role], new Date(item.createdAt).toLocaleDateString('ko-KR')].filter(Boolean).join(' · ');
    if (item.desc) { $('v-desc').textContent = item.desc; $('v-desc').hidden = false; }
    $('v-actions').hidden = false; $('v-note').hidden = false;
    mount();
  }

  $('v-reload').addEventListener('click', mount);
  $('v-full').addEventListener('click', () => {
    const stage = $('v-stage');
    if (stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
  });

  load();
})();
