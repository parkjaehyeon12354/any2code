(function () {
  // 과목별 공간. 색은 훑을 때의 보조 신호일 뿐, 이름 텍스트가 항상 함께 나온다.
  const SUBJECTS = {
    physics: { name: '물리학',   color: 'var(--subject-physics)' },
    chem:    { name: '화학',     color: 'var(--subject-chem)' },
    bio:     { name: '생명과학', color: 'var(--subject-bio)' },
    earth:   { name: '지구과학', color: 'var(--subject-earth)' }
  };

  let POSTS = [];           // GET /api/posts 로 채운다
  let votes = {};           // 내 투표 상태. 서버가 함께 내려준다

  const esc = escapeHtml;   // session.js 제공
  let channel = 'all';
  let sort = 'hot';
  let loading = true;

  const el = (id) => document.getElementById(id);
  const notice = el('notice');

  function say(msg) {
    notice.textContent = msg;
    notice.hidden = false;
  }
  function hush() { notice.hidden = true; }


  /* 작성 시각을 상대 표현으로. 서버는 ISO 문자열만 주고 판단은 화면에서 한다 —
     "3분 전"을 서버가 계산해 캐시되면 시간이 멈춘 것처럼 보인다. */
  function ago(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
    if (s < 60) return '방금 전';
    if (s < 3600) return Math.floor(s / 60) + '분 전';
    if (s < 86400) return Math.floor(s / 3600) + '시간 전';
    if (s < 172800) return '어제';
    if (s < 2592000) return Math.floor(s / 86400) + '일 전';
    return shortDate(iso);
  }

  // ── 과목 목록 ──
  function renderChannels() {
    const counts = { all: POSTS.length };
    POSTS.forEach(p => { counts[p.subject] = (counts[p.subject] || 0) + 1; });
    const item = (key, name, color) =>
      '<button type="button" class="channel" data-channel="' + key + '" aria-pressed="' + (channel === key) + '">' +
      (color ? '<span class="dot" style="background:' + color + '"></span>' : '<span class="dot" style="background:var(--muted-soft)"></span>') +
      esc(name) + '<span class="count">' + (counts[key] || 0) + '</span></button>';

    el('channels').innerHTML =
      item('all', '전체', null) +
      Object.entries(SUBJECTS).map(([k, s]) => item(k, s.name, s.color)).join('');
  }

  // ── 게시글 목록 ──
  function visiblePosts() {
    // ponytail: 전체를 한 번 받아 화면에서 거른다. 과목 탭을 눌러도 왕복이 없고
    // 과목별 개수도 맞는다. 글이 수천 개를 넘으면 서버 필터(?channel=)로 바꿀 것 —
    // API 는 이미 그 파라미터를 받는다.
    let list = POSTS.filter(p => channel === 'all' || p.subject === channel);
    if (sort === 'unanswered') list = list.filter(p => p.answers === 0);
    // 점수는 서버가 준 값이 이미 내 투표를 포함한다 — 여기서 더하면 두 번 세진다
    list.sort((a, b) => sort === 'new'
      ? new Date(b.createdAt) - new Date(a.createdAt)
      : b.score - a.score);
    return list;
  }

  function renderPosts() {
    if (loading) {
      el('posts').innerHTML = '<p class="empty">불러오는 중…</p>';
      return;
    }
    const list = visiblePosts();
    if (!list.length) {
      el('posts').innerHTML = '<p class="empty">' +
        (sort === 'unanswered'
          ? '답변을 기다리는 질문이 없습니다. 모두 답변이 달렸어요.'
          : '아직 이 과목에 올라온 질문이 없습니다. 첫 질문을 남겨보세요.') + '</p>';
      return;
    }
    el('posts').innerHTML = list.map(p => {
      const s = SUBJECTS[p.subject];
      const v = votes[p.id] || 0;
      const arrow = (dir, d) =>
        '<button type="button" data-vote="' + p.id + '" data-dir="' + d + '" ' +
        'aria-pressed="' + (v === d) + '" aria-label="' + (d > 0 ? '추천' : '비추천') + '">' +
        '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="' + dir +
        '" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
      // 제목은 글 화면으로 가는 링크다 — 주소가 생겨야 공유·북마크·검색이 된다
      return '<article class="post">' +
        '<div class="vote">' +
          arrow('M3 10l5-5 5 5', 1) +
          '<span class="score">' + p.score + '</span>' +
          arrow('M3 6l5 5 5-5', -1) +
        '</div>' +
        '<div class="post-main">' +
          '<h3 class="post-title"><a href="/q/' + encodeURIComponent(p.id) + '">' +
            esc(p.title) + '</a></h3>' +
          '<p class="post-excerpt">' + esc(p.excerpt) + '</p>' +
          '<div class="post-meta">' +
            '<span class="subject"><span class="dot" style="background:' + s.color + '"></span>' + esc(s.name) + '</span>' +
            '<span class="sep" aria-hidden="true">·</span><span>' + esc(p.author) + '</span>' +
            '<span class="sep" aria-hidden="true">·</span><span>' + esc(ago(p.createdAt)) + '</span>' +
            '<span class="sep" aria-hidden="true">·</span><span>답변 ' + p.answers + '</span>' +
            (p.answers === 0 ? '<span class="tag tag-open">답변 기다리는 중</span>' : '') +
          '</div>' +
        '</div>' +
      '</article>';
    }).join('');
  }


  // ── 이벤트 ──
  el('channels').addEventListener('click', function (e) {
    const b = e.target.closest('[data-channel]');
    if (!b) return;
    channel = b.dataset.channel;
    renderChannels(); renderPosts();
  });

  el('sorts').addEventListener('click', function (e) {
    const b = e.target.closest('[data-sort]');
    if (!b) return;
    sort = b.dataset.sort;
    el('sorts').querySelectorAll('[data-sort]').forEach(x =>
      x.setAttribute('aria-pressed', String(x.dataset.sort === sort)));
    renderPosts();
  });


  el('posts').addEventListener('click', async function (e) {
    const b = e.target.closest('[data-vote]');
    if (!b) return;
    if (!Session.load()) { say('추천하려면 로그인이 필요합니다.'); return; }

    const id = b.dataset.vote, dir = Number(b.dataset.dir);
    b.disabled = true;
    try {
      const res = await fetch('/api/posts/' + encodeURIComponent(id) + '/vote', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: dir })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { say(data.error || '처리하지 못했습니다.'); return; }

      // 서버가 확정한 값으로만 갱신한다 — 미리 그렸다가 실패하면 화면이 거짓말을 한다
      votes[id] = data.dir;
      const p = POSTS.find(x => x.id === id);
      if (p) p.score = data.score;
      hush();
      renderPosts();
    } catch {
      say('네트워크 오류입니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      b.disabled = false;
    }
  });

  // ── 글쓰기 ──
  const modal = el('write-modal');
  const form = el('write-form');
  const formError = el('write-error');

  const showError = (msg) => { formError.textContent = msg; formError.hidden = false; };

  function counter(inputId, countId, max) {
    const input = el(inputId), out = el(countId);
    const sync = () => {
      out.textContent = input.value.length + ' / ' + max;
      out.classList.toggle('over', input.value.length >= max);
    };
    input.addEventListener('input', sync);
    return sync;
  }
  const syncTitle = counter('w-title', 'w-title-count', 120);
  const syncBody = counter('w-body', 'w-body-count', 4000);

  el('ask').addEventListener('click', function () {
    if (!Session.load()) { window.location.href = '/login'; return; }
    formError.hidden = true;
    // 현재 보고 있는 과목을 기본값으로 — 물리학 탭에서 눌렀으면 물리학이 맞을 확률이 높다
    if (channel !== 'all') el('w-subject').value = channel;
    modal.showModal();
    el('w-title').focus();
  });

  modal.addEventListener('click', function (e) {
    if (e.target.closest('[data-close]')) modal.close();
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();   // method="dialog" 기본 동작(그냥 닫기)을 막는다
    const submit = el('w-submit');
    const payload = {
      subject: el('w-subject').value,
      title: el('w-title').value.trim(),
      body: el('w-body').value.trim()
    };
    if (!payload.title || !payload.body) { showError('제목과 내용을 모두 입력해 주세요.'); return; }

    submit.disabled = true;
    submit.textContent = '올리는 중…';
    try {
      const res = await fetch('/api/posts', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showError(data.error || '저장하지 못했습니다.'); return; }

      modal.close();
      form.reset(); syncTitle(); syncBody();

      if (data.held) {
        say(data.message);   // 보류된 글은 목록에 없다 — 사라진 걸로 오해하지 않게
      } else {
        hush();
        POSTS.push(data.post);
        channel = 'all'; sort = 'new';   // 방금 쓴 글이 맨 위에 보이도록
        el('sorts').querySelectorAll('[data-sort]').forEach(x =>
          x.setAttribute('aria-pressed', String(x.dataset.sort === sort)));
        renderChannels(); renderPosts();
      }
    } catch {
      showError('네트워크 오류입니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      submit.disabled = false;
      submit.textContent = '올리기';
    }
  });

  // ── 첫 로드 ──
  async function load() {
    try {
      const res = await fetch('/api/posts', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      POSTS = data.posts || [];
      votes = data.votes || {};
      hush();
    } catch {
      POSTS = [];
      say('글 목록을 불러오지 못했습니다. 새로고침해 주세요.');
    } finally {
      loading = false;
      renderChannels();
      renderPosts();
    }
  }

  renderChannels();
  renderPosts();

  // 둘 다 세션 쿠키를 알아서 싣고 나간다 — 순서를 기다릴 이유가 없다
  // ── 이용 제한 안내 · 소명 ──
  const suspended = el('suspended');
  const apModal = el('appeal-modal');
  const apForm = el('appeal-form');
  const apError = el('appeal-error');

  function showSuspension(user) {
    if (!user || !user.suspendedUntil) { suspended.hidden = true; return; }
    /* 영구 제재는 해제일이 없다. until 이 9999-12-31 이라 그대로 찍으면
       "9999-12-31 에 자동 해제됩니다" 가 나온다 — 사용자에게 거짓말이 된다.
       영구는 소명으로만 풀리므로 그 경로를 안내한다. */
    if (user.suspendedPermanent) {
      el('suspended-title').textContent = '계정이 영구 정지된 상태입니다';
      el('suspended-detail').textContent =
        '사유: ' + (user.suspendedReason || '운영 정책 위반') + ' · 자동으로 해제되지 않습니다. ' +
        '해제를 원하면 아래에서 소명을 제출해 주세요.';
      suspended.hidden = false;
      return;
    }
    const when = shortDate(user.suspendedUntil);
    el('suspended-title').textContent = '현재 글쓰기가 제한된 상태입니다';
    el('suspended-detail').textContent =
      '사유: ' + (user.suspendedReason || '운영 정책 위반') + ' · ' + when + '에 자동 해제됩니다. ' +
      '제한 중에는 질문과 답변을 올릴 수 없습니다.';
    suspended.hidden = false;
  }

  el('ap-text').addEventListener('input', function () {
    el('ap-count').textContent = this.value.length + ' / 2000';
  });

  el('appeal-open').addEventListener('click', function () {
    apError.hidden = true;
    apModal.showModal();
    el('ap-text').focus();
  });

  apModal.addEventListener('click', function (e) {
    if (e.target.closest('[data-close]') || e.target === apModal) apModal.close();
  });

  apForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const submit = el('ap-submit');
    const text = el('ap-text').value.trim();
    if (!text) { el('ap-text').focus(); return; }

    submit.disabled = true;
    submit.textContent = '접수 중…';
    try {
      const res = await fetch('/api/appeals', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 실패하면 닫지 않는다 — 닫으면 접수된 줄 알고 기다린다
        apError.textContent = data.error || '소명을 접수하지 못했습니다.';
        apError.hidden = false;
        return;
      }
      apModal.close();
      apForm.reset();
      el('ap-count').textContent = '0 / 2000';
      say(data.message || '소명이 접수됐습니다.');
    } catch {
      apError.textContent = '네트워크 오류입니다. 잠시 후 다시 시도해 주세요.';
      apError.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = '접수';
    }
  });

  showSuspension(Session.load());              // 캐시로 즉시
  Session.refresh().then(showSuspension);      // 서버 확인 후 다시
  load();
})();
