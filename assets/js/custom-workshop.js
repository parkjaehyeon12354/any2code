/* 커스텀 창작마당 — 목록(누구나)과 올리기(선생님·관리자). 올릴 수 있는지는 서버가 목록과 함께 알려 준다.
   올린 사람이 쓴 글자는 전부 textContent 로만 넣는다(innerHTML 금지). 올린 HTML 은 WorkshopFrame 격리 칸에서만 돈다. */
(function () {
  const KIND_LABEL = { report: '보고서 양식', simulation: '시뮬레이션', inquiry: '탐구 주제·실험 설계', etc: '기타' };
  const ROLE_LABEL = { teacher: '선생님', admin: '관리자' };
  const MAX_BYTES = 200 * 1024;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const kb = (n) => Math.ceil((n || 0) / 1024) + 'KB';

  const q = new URLSearchParams(location.search).get('kind');
  const kind = KIND_LABEL[q] ? q : '';
  const tabs = [...document.querySelectorAll('.kind-tabs a')];
  (tabs.find((a) => a.dataset.kind === kind) || tabs[0]).setAttribute('aria-current', 'page');
  if (kind) $('empty-text').textContent = KIND_LABEL[kind] + ' 자료가 올라오면 여기에 나타납니다.';

  const form = $('up-form'), msg = $('up-msg'), code = $('up-html'), preview = $('up-preview');

  /* ── 목록 ── */
  function card(it) {
    const li = el('li', 'custom-card edu-panel');
    const tags = el('div', 'card-tags');
    tags.append(el('span', 'tag primary', KIND_LABEL[it.kind] || '기타'));
    if (ROLE_LABEL[it.role]) tags.append(el('span', 'tag', ROLE_LABEL[it.role]));
    li.append(tags, el('h3', null, it.title));
    if (it.desc) li.append(el('p', null, it.desc));
    const open = el('a', 'open', '실행하기 →');
    open.href = '/custom/view?id=' + encodeURIComponent(it.id);
    li.append(open);
    const foot = el('div', 'card-foot');
    foot.append(el('span', null, `${it.author} · ${new Date(it.createdAt).toLocaleDateString('ko-KR')} · ${kb(it.size)}`));
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
  const size = () => new Blob([code.value]).size;
  function showSize() {
    const n = size();
    $('up-size').textContent = `${kb(n)} / ${kb(MAX_BYTES)}` + (n > MAX_BYTES ? ' — 너무 큽니다' : '');
  }
  function closePreview() { preview.replaceChildren(); preview.hidden = true; }

  $('up-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    code.value = await f.text();
    if (!$('up-title').value.trim()) $('up-title').value = f.name.replace(/\.html?$/i, '').slice(0, 60);
    showSize(); closePreview();
  });
  code.addEventListener('input', () => { showSize(); closePreview(); });
  $('up-try').addEventListener('click', () => {
    if (!code.value.trim()) { msg.className = 'up-msg error'; msg.textContent = 'HTML 파일을 고르거나 코드를 붙여 넣어 주세요.'; return; }
    msg.textContent = '';
    preview.replaceChildren(WorkshopFrame.create(code.value, '미리보기'));
    preview.hidden = false;
  });

  $('up-open').addEventListener('click', () => {
    form.hidden = false; $('up-open').hidden = true;
    if (kind) $('up-kind').value = kind;
    showSize(); $('up-title').focus();
  });
  $('up-cancel').addEventListener('click', () => { form.hidden = true; $('up-open').hidden = false; msg.textContent = ''; closePreview(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!code.value.trim()) { msg.className = 'up-msg error'; msg.textContent = 'HTML 파일을 고르거나 코드를 붙여 넣어 주세요.'; return; }
    if (size() > MAX_BYTES) { msg.className = 'up-msg error'; msg.textContent = `HTML 은 ${kb(MAX_BYTES)} 까지 올릴 수 있습니다.`; return; }
    const body = { kind: $('up-kind').value, title: $('up-title').value.trim(), desc: $('up-desc').value.trim(), html: code.value };
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true; msg.className = 'up-msg'; msg.textContent = '올리는 중…';
    let res, data = {};
    try { res = await fetch('/api/workshop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); data = await res.json(); }
    catch { res = null; }
    submit.disabled = false;
    if (!res || !res.ok) { msg.className = 'up-msg error'; msg.textContent = data.error || '올리지 못했습니다. 잠시 후 다시 시도해 주세요.'; return; }
    form.reset(); form.hidden = true; msg.textContent = ''; closePreview();
    await load();
    $('count').textContent += ' · 올렸습니다';
  });

  load();
})();
