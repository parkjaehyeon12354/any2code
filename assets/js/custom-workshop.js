/* 커스텀 창작마당 — 목록(누구나)과 올리기(선생님·관리자). 올릴 수 있는지는 서버가 목록과 함께 알려 준다.
   올린 사람이 쓴 글자는 전부 textContent 로만 넣는다(innerHTML 금지). */
(function () {
  const KIND_LABEL = { report: '보고서 양식', simulation: '시뮬레이션 조건', inquiry: '탐구 주제·실험 설계', etc: '기타' };
  const ROLE_LABEL = { teacher: '선생님', admin: '관리자' };
  const REPORT_KEY = 'ans2quest_research_report_custom_v1';   // 보고서 작성 화면의 커스텀 임시 저장
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  const kind = KIND_LABEL[new URLSearchParams(location.search).get('kind')] ? new URLSearchParams(location.search).get('kind') : '';
  const tabs = [...document.querySelectorAll('.kind-tabs a')];
  (tabs.find((a) => a.dataset.kind === kind) || tabs[0]).setAttribute('aria-current', 'page');
  if (kind) $('empty-text').textContent = KIND_LABEL[kind] + ' 자료가 올라오면 여기에 나타납니다.';

  const form = $('up-form'), msg = $('up-msg');

  /* ── 목록 ── */
  function card(it) {
    const li = el('li', 'custom-card edu-panel');
    const tags = el('div', 'card-tags');
    tags.append(el('span', 'tag primary', KIND_LABEL[it.kind] || '기타'));
    if (ROLE_LABEL[it.role]) tags.append(el('span', 'tag', ROLE_LABEL[it.role]));
    li.append(tags, el('h3', null, it.title));
    if (it.desc) li.append(el('p', null, it.desc));
    if (it.report) {
      const r = it.report;
      li.append(el('p', null, `「${r.title || '제목 없음'}」 · 글 ${r.text} · 표 ${r.table} · 그래프 ${r.graph}`));
    } else if (it.link) {
      const a = el('a', 'open', '이 조건으로 시뮬레이션 열기 →');
      a.href = it.link;   // 서버가 /simulation/*.html 경로만 저장한다
      li.append(a);
    } else if (it.body) {
      const d = el('details'); d.append(el('summary', null, '내용 보기'), el('p', 'body', it.body)); li.append(d);
    }
    const foot = el('div', 'card-foot');
    foot.append(el('span', null, `${it.author} · ${new Date(it.createdAt).toLocaleDateString('ko-KR')}`));
    if (it.canDelete) {
      const del = el('button', 'btn btn-ghost', '지우기'); del.type = 'button';
      del.addEventListener('click', () => remove(it, del));
      foot.append(del);
    }
    li.append(foot);
    return li;
  }

  async function load() {
    $('list-msg').hidden = true;
    let data;
    try {
      const res = await fetch('/api/workshop' + (kind ? '?kind=' + kind : ''), { cache: 'no-store' });
      data = await res.json();
      if (!res.ok) throw new Error(data.error);
    } catch (e) {
      $('count').textContent = '';
      $('list-msg').textContent = (e && e.message) || '목록을 불러오지 못했습니다.';
      $('list-msg').hidden = false;
      return;
    }
    $('items').replaceChildren(...data.items.map(card));
    $('empty').hidden = data.items.length > 0;
    $('count').textContent = `자료 ${data.items.length}개`;
    $('up-open').hidden = !data.canUpload || !form.hidden;
  }

  async function remove(it, btn) {
    if (!confirm(`「${it.title}」을(를) 지우시겠습니까? 지우면 복구할 수 없습니다.`)) return;
    btn.disabled = true;
    const res = await fetch('/api/workshop/' + encodeURIComponent(it.id), { method: 'DELETE' }).catch(() => null);
    if (res && (res.ok || res.status === 404)) return load();
    btn.disabled = false;
    const data = res ? await res.json().catch(() => ({})) : {};
    $('list-msg').textContent = data.error || '지우지 못했습니다. 잠시 후 다시 시도해 주세요.';
    $('list-msg').hidden = false;
  }

  /* ── 올리기 ── */
  const savedReport = () => { try { return JSON.parse(localStorage.getItem(REPORT_KEY) || 'null'); } catch { return null; } };

  function showKind() {
    const k = $('up-kind').value;
    const group = k === 'report' || k === 'simulation' ? k : 'text';
    form.querySelectorAll('[data-for]').forEach((f) => { f.hidden = f.dataset.for !== group; });
    $('up-link').required = group === 'simulation';
    $('up-body').required = group === 'text';
    if (group !== 'report') return;
    const t = savedReport();
    const n = (type) => (t && Array.isArray(t.sections) ? t.sections.filter((s) => s && (s.type || 'text') === type).length : 0);
    const out = $('up-report');
    out.replaceChildren();
    if (t && Array.isArray(t.sections) && t.sections.length) {
      out.textContent = `이 브라우저에 임시 저장된 커스텀 보고서 「${t.title || '제목 없음'}」 — 글 ${n('text')} · 표 ${n('table')} · 그래프 ${n('graph')}. 이 양식을 올립니다.`;
    } else {
      out.append('이 브라우저에 임시 저장된 커스텀 보고서가 없습니다. ');
      const a = el('a', null, '보고서 작성에서 커스텀 양식을 만들고 임시 저장 →'); a.href = '/research/report'; out.append(a);
    }
  }

  $('up-open').addEventListener('click', () => {
    form.hidden = false; $('up-open').hidden = true;
    if (kind) $('up-kind').value = kind;
    showKind(); $('up-title').focus();
  });
  $('up-cancel').addEventListener('click', () => { form.hidden = true; $('up-open').hidden = false; msg.textContent = ''; });
  $('up-kind').addEventListener('change', showKind);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const k = $('up-kind').value;
    const body = { kind: k, title: $('up-title').value.trim(), desc: $('up-desc').value.trim() };
    if (k === 'report') body.template = savedReport();
    else if (k === 'simulation') body.link = $('up-link').value.trim();
    else body.body = $('up-body').value.trim();
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true; msg.className = 'up-msg'; msg.textContent = '올리는 중…';
    let res, data = {};
    try { res = await fetch('/api/workshop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); data = await res.json(); }
    catch { res = null; }
    submit.disabled = false;
    if (!res || !res.ok) { msg.className = 'up-msg error'; msg.textContent = data.error || '올리지 못했습니다. 잠시 후 다시 시도해 주세요.'; return; }
    form.reset(); form.hidden = true; msg.textContent = '';
    await load();
    $('count').textContent += ' · 올렸습니다';
  });

  load();
})();
