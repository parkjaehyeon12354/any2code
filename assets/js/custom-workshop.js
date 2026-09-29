/* 커스텀 창작마당 — 목록(누구나)과 올리기(선생님·관리자). 올릴 수 있는지는 서버가 목록과 함께 알려 준다.
   목록은 한 번에 다 받아 화면에서 거르고 25개(5×5)씩 쪽을 나눈다.
   올린 사람이 쓴 글자는 전부 textContent 로만 넣는다(innerHTML 금지). 올린 HTML 은 WorkshopFrame 격리 칸에서만 돈다. */
(function () {
  const KIND_LABEL = { report: '보고서 양식', simulation: '시뮬레이션', inquiry: '탐구 주제·실험 설계', game: '게임', quiz: '퀴즈', etc: '기타' };
  const MAX_BYTES = 200 * 1024;
  const THUMB_BYTES = 64 * 1024;   // 서버 한도와 같다(functions/workshop.js)
  const PER_PAGE = 25;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const kb = (n) => Math.ceil((n || 0) / 1024) + 'KB';

  const boxes = [...document.querySelectorAll('#kinds input')];
  // 헤더 드롭다운의 /custom?kind=… 로 오면 그 종류만 켠다
  const first = new URLSearchParams(location.search).get('kind');
  if (KIND_LABEL[first]) boxes.forEach((b) => { b.checked = b.value === first; });

  const form = $('up-form'), msg = $('up-msg'), code = $('up-html'), preview = $('up-preview');
  let items = [], page = 1;

  /* ── 목록 ── */
  const shortDate = (iso) => {
    const d = new Date(iso);
    return (d.getFullYear() === new Date().getFullYear() ? '' : d.getFullYear() + '.') + (d.getMonth() + 1) + '.' + d.getDate();
  };
  // 기본 그림끼리 너무 똑같아 보이지 않게 id 로 빛 위치만 조금씩 옮긴다
  const glow = (id) => [...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 100, 7) + '%';

  function card(it) {
    const li = el('li', 'ws-card k-' + (KIND_LABEL[it.kind] ? it.kind : 'etc'));
    const thumb = el('div', 'ws-thumb');
    thumb.style.setProperty('--gx', glow(it.id));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 160 100');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#g-' + (KIND_LABEL[it.kind] ? it.kind : 'etc'));
    svg.append(use);
    thumb.append(svg);
    if (it.thumb) {
      const img = el('img');
      img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
      img.addEventListener('error', () => img.remove());   // 못 받으면 기본 그림이 그대로 보인다
      img.src = '/api/workshop-thumb/' + encodeURIComponent(it.id);
      thumb.append(img);
    }
    const body = el('div', 'ws-body');
    const kind = el('p', 'ws-kind');
    kind.append(el('span', 'filter-dot'), KIND_LABEL[it.kind] || '기타');
    const h3 = el('h3');
    const open = el('a', 'open', it.title);
    open.href = '/custom/view?id=' + encodeURIComponent(it.id);
    h3.title = it.title;
    h3.append(open);
    const meta = el('p', 'ws-meta');
    meta.append(el('span', null, `${it.author} · ${shortDate(it.createdAt)}`));
    if (it.canDelete) {
      const del = el('button', 'ws-del', '지우기'); del.type = 'button';
      del.setAttribute('aria-label', `「${it.title}」 지우기`);
      del.addEventListener('click', () => remove(it, del));
      meta.append(del);
    }
    body.append(kind, h3, meta);
    li.append(thumb, body);
    return li;
  }

  function draw() {
    const on = boxes.filter((b) => b.checked).map((b) => b.value);
    const word = $('q').value.trim().toLocaleLowerCase('ko-KR');
    const list = items.filter((it) => on.includes(it.kind)
      && (!word || `${it.title} ${it.desc || ''} ${it.author}`.toLocaleLowerCase('ko-KR').includes(word)));
    const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    page = Math.min(page, pages);
    const from = (page - 1) * PER_PAGE;

    $('ws-title').textContent = on.length === 1 ? KIND_LABEL[on[0]] : '전체 자료';
    $('count').textContent = list.length > PER_PAGE ? `${list.length}개 중 ${from + 1}–${Math.min(from + PER_PAGE, list.length)}` : `${list.length}개`;
    $('items').replaceChildren(...list.slice(from, from + PER_PAGE).map(card));
    $('empty').hidden = items.length > 0;
    $('none').hidden = !items.length || list.length > 0;

    const pager = $('pager');
    pager.replaceChildren();
    if (pages < 2) return;
    const btn = (label, p, name) => {
      const b = el('button', null, label); b.type = 'button';
      b.disabled = p < 1 || p > pages;
      if (name) b.setAttribute('aria-label', name);
      if (p === page && !name) b.setAttribute('aria-current', 'page');
      b.addEventListener('click', () => { page = p; draw(); $('ws-title').scrollIntoView({ block: 'start' }); });
      pager.append(b);
    };
    btn('‹', page - 1, '이전 쪽');
    for (let p = 1; p <= pages; p++) btn(String(p), p);
    btn('›', page + 1, '다음 쪽');
  }

  async function load() {
    $('list-msg').hidden = true;
    let data;
    try {
      const res = await fetch('/api/workshop', { cache: 'no-store' });
      data = await res.json();
      if (!res.ok) throw new Error(data.error);
    } catch (e) {
      $('count').textContent = '';
      $('list-msg').textContent = (e && e.message) || '목록을 불러오지 못했습니다.';
      $('list-msg').hidden = false;
      return;
    }
    items = data.items;
    boxes.forEach((b) => { b.parentElement.querySelector('.filter-count').textContent = items.filter((it) => it.kind === b.value).length; });
    draw();
    $('up-open').hidden = !data.canUpload || !form.hidden;
  }

  boxes.forEach((b) => b.addEventListener('change', () => { page = 1; draw(); }));
  $('q').addEventListener('input', () => { page = 1; draw(); });

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
  const fail = (text) => { msg.className = 'up-msg error'; msg.textContent = text; };

  /* 대표 이미지 — 카드 크기(16:10)로 가운데를 잘라 400×250 JPEG 로 줄인다. 사진 원본을 그대로 올리면
     목록 한 쪽에 수 MB 가 실린다. 서버는 JPEG 만 받는다 */
  let thumb = '';
  async function shrink(file) {
    const bmp = await createImageBitmap(file);
    const W = 400, H = 250, s = Math.max(W / bmp.width, H / bmp.height);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);   // 투명한 PNG 가 까맣게 되지 않게
    g.drawImage(bmp, (W - bmp.width * s) / 2, (H - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
    if (bmp.close) bmp.close();
    for (const q of [0.82, 0.7, 0.55, 0.4]) {
      const url = cv.toDataURL('image/jpeg', q);
      if ((url.length - 23) * 3 / 4 <= THUMB_BYTES) return url;
    }
    throw new Error('too big');
  }
  function setThumb(url) {
    thumb = url;
    $('up-thumb-img').hidden = !url;
    $('up-thumb-clear').hidden = !url;
    if (url) $('up-thumb-img').src = url; else { $('up-thumb-img').removeAttribute('src'); $('up-thumb').value = ''; }
  }
  $('up-thumb').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return setThumb('');
    try { setThumb(await shrink(f)); msg.textContent = ''; }
    catch { setThumb(''); fail('이 그림은 읽지 못했습니다. PNG · JPG 로 올려 주세요.'); }
  });
  $('up-thumb-clear').addEventListener('click', () => setThumb(''));

  $('up-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    code.value = await f.text();
    if (!$('up-title').value.trim()) $('up-title').value = f.name.replace(/\.html?$/i, '').slice(0, 60);
    showSize(); closePreview();
  });
  code.addEventListener('input', () => { showSize(); closePreview(); });
  $('up-try').addEventListener('click', () => {
    if (!code.value.trim()) return fail('HTML 파일을 고르거나 코드를 붙여 넣어 주세요.');
    msg.textContent = '';
    preview.replaceChildren(WorkshopFrame.create(code.value, '미리보기'));
    preview.hidden = false;
  });

  $('up-open').addEventListener('click', () => {
    form.hidden = false; $('up-open').hidden = true;
    const on = boxes.filter((b) => b.checked);
    if (on.length === 1) $('up-kind').value = on[0].value;
    showSize(); $('up-title').focus();
  });
  $('up-cancel').addEventListener('click', () => { form.hidden = true; $('up-open').hidden = false; msg.textContent = ''; closePreview(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!code.value.trim()) return fail('HTML 파일을 고르거나 코드를 붙여 넣어 주세요.');
    if (size() > MAX_BYTES) return fail(`HTML 은 ${kb(MAX_BYTES)} 까지 올릴 수 있습니다.`);
    const body = { kind: $('up-kind').value, title: $('up-title').value.trim(), desc: $('up-desc').value.trim(), html: code.value, thumb };
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true; msg.className = 'up-msg'; msg.textContent = '올리는 중…';
    let res, data = {};
    try { res = await fetch('/api/workshop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); data = await res.json(); }
    catch { res = null; }
    submit.disabled = false;
    if (!res || !res.ok) return fail(data.error || '올리지 못했습니다. 잠시 후 다시 시도해 주세요.');
    form.reset(); setThumb(''); form.hidden = true; msg.textContent = ''; closePreview();
    page = 1;
    await load();
    $('count').textContent += ' · 올렸습니다';
  });

  load();
})();
