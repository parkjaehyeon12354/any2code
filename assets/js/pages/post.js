(function () {
  const SUBJECTS = {
    physics: { name: '물리학',   color: 'var(--subject-physics)' },
    chem:    { name: '화학',     color: 'var(--subject-chem)' },
    bio:     { name: '생명과학', color: 'var(--subject-bio)' },
    earth:   { name: '지구과학', color: 'var(--subject-earth)' }
  };

  const esc = escapeHtml;                 // session.js 제공
  const el = (id) => document.getElementById(id);
  const notice = el('notice');
  const box = el('thread');

  /* 주소는 /q/{id}. 서버가 이 파일로 rewrite 하므로 경로에서 직접 읽는다.
     예전에 공유된 /post.html?id=… 링크도 계속 열려야 하니 둘 다 받는다. */
  const id = location.pathname.startsWith('/q/')
    ? decodeURIComponent(location.pathname.slice(3))
    : new URLSearchParams(location.search).get('id');

  let post = null;
  let myVote = 0;
  let comments = null;                    // null = 아직 안 받음 (빈 배열과 구분)
  let editing = null;                     // 수정 중인 답변 id (null = 없음)
  let postEditing = false;                // 글 수정 폼을 띄우는 중인가

  const say = (msg) => { notice.textContent = msg; notice.hidden = false; };
  const hush = () => { notice.hidden = true; };

  /* 작성 시각은 화면에서 계산한다 — 서버가 "3분 전"을 만들어 캐시되면
     시간이 멈춘 것처럼 보인다. */
  function ago(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
    if (s < 60) return '방금 전';
    if (s < 3600) return Math.floor(s / 60) + '분 전';
    if (s < 86400) return Math.floor(s / 3600) + '시간 전';
    if (s < 172800) return '어제';
    if (s < 2592000) return Math.floor(s / 86400) + '일 전';
    return shortDate(iso);
  }

  const arrow = (path, dir) =>
    '<button type="button" data-dir="' + dir + '" ' +
    'aria-pressed="' + (myVote === dir) + '" aria-label="' + (dir > 0 ? '추천' : '비추천') + '">' +
    '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="' + path +
    '" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';

  /* 자기 글에는 안 붙인다 — 서버가 어차피 거절하므로 반드시 실패할 버튼이 된다.
     비로그인에게도 안 붙인다 (누르면 로그인으로 튕기기만 한다). */
  function reportBtn(targetId, mine) {
    if (mine || !Session.load()) return '';
    return '<div class="report-row">' +
      '<button type="button" class="report" data-report="' + esc(targetId) + '">' +
      '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 2v12M3 3h9l-2 3 2 3H3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '신고</button></div>';
  }

  function answersHtml() {
    if (comments === null) return '<p class="answer-empty">답변을 불러오는 중…</p>';
    if (!comments.length) return '<p class="answer-empty">아직 답변이 없습니다. 아는 만큼만 적어주셔도 도움이 됩니다.</p>';
    return comments.map(function (c) {
      /* 수정 중인 답변은 본문 자리에 폼을 그린다. 폼이 render() 밖에서 만들어지면
         다음 render() 가 쓰고 있던 내용을 지운다. */
      if (c.id === editing) {
        return '<div class="answer" id="ans-' + esc(c.id) + '">' +
          '<div class="answer-meta"><span class="who">' + esc(c.author) + '</span>' +
          '<span class="sep" aria-hidden="true">·</span>' + esc(ago(c.createdAt)) + '</div>' +
          '<form class="answer-edit-form" data-for="' + esc(c.id) + '">' +
            '<textarea aria-label="답변 수정" maxlength="2000">' + esc(c.body) + '</textarea>' +
            '<div class="row">' +
              '<span class="hint">2000자까지</span>' +
              '<button type="button" class="btn btn-ghost cancel-edit">취소</button>' +
              '<button type="submit" class="btn btn-primary">저장</button>' +
            '</div>' +
          '</form>' +
        '</div>';
      }

      var actions = '';
      if (c.mine) {
        actions =
          '<div class="answer-actions">' +
            '<button type="button" class="edit" data-edit="' + esc(c.id) + '">수정</button>' +
            '<button type="button" class="delete" data-delete="' + esc(c.id) + '">삭제</button>' +
          '</div>';
      }
      return '<div class="answer" id="ans-' + esc(c.id) + '">' +
        '<div class="answer-meta"><span class="who">' + esc(c.author) + '</span>' +
        '<span class="sep" aria-hidden="true">·</span>' + esc(ago(c.createdAt)) +
        (c.updatedAt ? '<span class="sep" aria-hidden="true">·</span>수정됨' : '') + '</div>' +
        '<div class="answer-body">' + esc(c.body) + '</div>' +
        actions +
        reportBtn(c.id, c.mine) +
      '</div>';
    }).join('');
  }

  function render() {
    if (!post) return;
    /* 글 수정 폼도 render() 가 그린다 — 답변 수정 폼과 같은 이유다
       (리스너 중복 등록 방지). */
    if (postEditing) {
      box.innerHTML =
        '<form class="post-edit-form answer-edit-form">' +
          '<div class="field"><label for="post-edit-title">제목</label>' +
          '<input id="post-edit-title" maxlength="120" value="' + esc(post.title) + '"></div>' +
          '<div class="field"><label for="post-edit-body">내용</label>' +
          '<textarea id="post-edit-body" aria-label="글 수정" maxlength="4000">' + esc(post.body) + '</textarea></div>' +
          '<div class="row">' +
            '<span class="hint">제목 120자 · 내용 4000자까지</span>' +
            '<button type="button" class="btn btn-ghost cancel-post-edit">취소</button>' +
            '<button type="submit" class="btn btn-primary">저장</button>' +
          '</div>' +
        '</form>';
      return;
    }
    const s = SUBJECTS[post.subject] || { name: post.subject, color: 'var(--muted-soft)' };
    box.innerHTML =
      '<div class="thread-head">' +
        '<div class="vote">' +
          arrow('M3 10l5-5 5 5', 1) +
          '<span class="score">' + post.score + '</span>' +
          arrow('M3 6l5 5 5-5', -1) +
        '</div>' +
        '<div>' +
          '<h1>' + esc(post.title) + '</h1>' +
          '<div class="thread-meta">' +
            '<span class="subject"><span class="dot" style="background:' + s.color + '"></span>' + esc(s.name) + '</span>' +
            '<span class="sep" aria-hidden="true">·</span><span>' + esc(post.author) + '</span>' +
            '<span class="sep" aria-hidden="true">·</span><span>' + esc(ago(post.createdAt)) + '</span>' +
            (post.updatedAt ? '<span class="sep" aria-hidden="true">·</span><span>수정됨</span>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="thread-body">' + esc(post.body) + '</div>' +
      /* 자기 글에만 붙인다 — 남의 글에 보이면 반드시 실패할 버튼이 된다 */
      (post.mine
        ? '<div class="answer-actions">' +
            '<button type="button" class="edit" data-post-edit>수정</button>' +
            '<button type="button" class="delete" data-post-delete>삭제</button>' +
          '</div>'
        : '') +
      reportBtn(post.id, post.mine) +
      '<section class="answers">' +
        '<h2>답변 ' + post.answers + '</h2>' +
        answersHtml() +
        '<form class="answer-form" id="answer-form">' +
          '<label for="answer-text">답변 쓰기</label>' +
          '<textarea id="answer-text" maxlength="2000" ' +
            'placeholder="아는 만큼만 적어주셔도 됩니다. 왜 그런지까지 적으면 더 좋아요."></textarea>' +
          '<div class="row">' +
            '<span class="hint">' + (Session.load() ? '' : '답변하려면 로그인이 필요합니다.') + '</span>' +
            '<button type="submit" class="btn btn-primary">답변 올리기</button>' +
          '</div>' +
        '</form>' +
      '</section>';
  }

  // ── 투표 ──
  box.addEventListener('click', async function (e) {
    const b = e.target.closest('[data-dir]');
    if (!b) return;
    if (!Session.load()) { say('추천하려면 로그인이 필요합니다.'); return; }

    b.disabled = true;
    try {
      const res = await fetch('/api/posts/' + encodeURIComponent(id) + '/vote', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: Number(b.dataset.dir) })
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) { say(data.error || '처리하지 못했습니다.'); return; }
      // 서버가 확정한 값만 반영한다 — 미리 그렸다가 실패하면 화면이 거짓말을 한다
      myVote = data.dir;
      post.score = data.score;
      hush();
      render();
    } catch {
      say('네트워크 오류입니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      b.disabled = false;
    }
  });

  // ── 답변 작성 ──
  box.addEventListener('submit', async function (e) {
    if (!e.target.closest('#answer-form')) return;
    e.preventDefault();
    if (!Session.load()) { window.location.href = '/login'; return; }

    const ta = el('answer-text');
    const submit = e.target.querySelector('button[type=submit]');
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }

    submit.disabled = true;
    submit.textContent = '올리는 중…';
    try {
      const res = await fetch('/api/posts/' + encodeURIComponent(id) + '/comments', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text })
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) { say(data.error || '저장하지 못했습니다.'); return; }

      if (data.held) {
        say(data.message);      // 보류된 답변은 목록에 없다 — 사라진 걸로 오해하지 않게
      } else {
        hush();
        comments.push(data.comment);
        post.answers += 1;
      }
      render();
    } catch {
      say('네트워크 오류입니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      submit.disabled = false;
      submit.textContent = '답변 올리기';
    }
  });

  // ── 신고 ──
  const reportModal = el('report-modal');
  const reportForm = el('report-form');
  const reportError = el('report-error');
  let reportTargetId = null;

  box.addEventListener('click', function (e) {
    const b = e.target.closest('[data-report]');
    if (!b) return;
    reportTargetId = b.dataset.report;
    reportError.hidden = true;
    // 무엇을 신고하는지 보여준다 — 답변이 여러 개면 어느 것인지 헷갈린다
    const answer = (comments || []).find(function (c) { return c.id === reportTargetId; });
    el('report-target').textContent = answer ? answer.body : post.body;
    reportModal.showModal();
  });

  reportModal.addEventListener('click', function (e) {
    if (e.target.closest('[data-close]') || e.target === reportModal) reportModal.close();
  });

  reportForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const submit = el('report-submit');
    const reason = reportForm.querySelector('input[name=reason]:checked');
    if (!reason) return;

    submit.disabled = true;
    submit.textContent = '접수 중…';
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId: reportTargetId, reason: reason.value })
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        // 모달을 닫지 않는다 — 닫으면 실패한 줄 모르고 넘어간다
        reportError.textContent = data.error || '신고를 접수하지 못했습니다.';
        reportError.hidden = false;
        return;
      }
      reportModal.close();
      say(data.message || '신고가 접수됐습니다.');
    } catch {
      reportError.textContent = '네트워크 오류입니다. 잠시 후 다시 시도해 주세요.';
      reportError.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = '신고';
    }
  });

  // ── 답변 수정 ──
  /* 수정 폼은 render() 가 그린다 (editing 상태를 보고). 리스너는 box 하나에만
     위임으로 붙인다 — 폼에 직접 붙이면 render() 마다 새 폼에 다시 붙어 쌓이고,
     저장 한 번에 요청이 여러 번 나간다. */
  box.addEventListener('click', function (e) {
    const editBtn = e.target.closest('[data-edit]');
    if (editBtn) {
      editing = editBtn.dataset.edit;
      render();
      const ta = box.querySelector('.answer-edit-form textarea');
      if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
      return;
    }
    if (e.target.closest('.cancel-edit')) {
      editing = null;
      render();
    }
  });

  box.addEventListener('submit', async function (e) {
    const form = e.target.closest('.answer-edit-form');
    if (!form) return;
    e.preventDefault();

    const commentId = form.dataset.for;
    const comment = comments.find(function (c) { return c.id === commentId; });
    if (!comment) return;

    const ta = form.querySelector('textarea');
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    if (text === comment.body) { editing = null; render(); return; }   // 안 바뀌었으면 요청도 안 보낸다

    const submitBtn = form.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    submitBtn.textContent = '저장 중…';

    try {
      const res = await fetch('/api/posts/' + encodeURIComponent(id) + '/comments/' + encodeURIComponent(commentId), {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text })
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        say(data.error || '수정하지 못했습니다.');
        submitBtn.disabled = false;
        submitBtn.textContent = '저장';
        return;                     // 폼을 닫지 않는다 — 닫으면 쓴 내용이 날아간다
      }

      if (data.held) {
        // 보류된 답변은 목록에서 빠진다. 사라진 걸로 오해하지 않게 이유를 알린다
        say(data.message);
        comments = comments.filter(function (c) { return c.id !== commentId; });
        post.answers = Math.max(0, post.answers - 1);
      } else {
        hush();
        comment.body = data.comment.body;
        comment.updatedAt = data.comment.updatedAt;
      }
      editing = null;
      render();
    } catch {
      say('네트워크 오류입니다. 잠시 후 다시 시도해 주세요.');
      submitBtn.disabled = false;
      submitBtn.textContent = '저장';
    }
  });

  // ── 답변 삭제 ──
  box.addEventListener('click', async function (e) {
    const delBtn = e.target.closest('[data-delete]');
    if (!delBtn) return;

    const commentId = delBtn.dataset.delete;
    if (!comments.some(function (c) { return c.id === commentId; })) return;

    if (!confirm('이 답변을 삭제하시겠습니까? 삭제하면 복구할 수 없습니다.')) return;

    delBtn.disabled = true;
    delBtn.textContent = '삭제 중…';

    try {
      const res = await fetch('/api/posts/' + encodeURIComponent(id) + '/comments/' + encodeURIComponent(commentId), {
        method: 'DELETE',
        credentials: 'same-origin'
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) { say(data.error || '삭제하지 못했습니다.'); return; }

      hush();
      /* 서버 목록은 status='public' 만 준다 — 삭제된 답변은 새로고침하면
         아예 사라진다. 화면에 흔적을 남기면 새로고침 전후가 달라진다. */
      comments = comments.filter(function (x) { return x.id !== commentId; });
      post.answers = Math.max(0, post.answers - 1);
      render();
    } catch {
      say('네트워크 오류입니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      delBtn.disabled = false;
      delBtn.textContent = '삭제';
    }
  });

  // ── 글 수정 ──
  box.addEventListener('click', function (e) {
    if (e.target.closest('[data-post-edit]')) {
      postEditing = true;
      render();
      const t = el('post-edit-title');
      if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
      return;
    }
    if (e.target.closest('.cancel-post-edit')) {
      postEditing = false;
      render();
    }
  });

  box.addEventListener('submit', async function (e) {
    const form = e.target.closest('.post-edit-form');
    if (!form) return;
    e.preventDefault();

    const titleEl = el('post-edit-title');
    const bodyEl = el('post-edit-body');
    const title = titleEl.value.trim();
    const text = bodyEl.value.trim();
    if (!title) { titleEl.focus(); return; }
    if (!text) { bodyEl.focus(); return; }
    // 안 바뀌었으면 요청도 안 본다 — 고치지 않았는데 "수정됨" 이 붙는 건 거짓말이다
    if (title === post.title && text === post.body) { postEditing = false; render(); return; }

    const submitBtn = form.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    submitBtn.textContent = '저장 중…';

    try {
      const res = await fetch('/api/posts/' + encodeURIComponent(id), {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body: text })
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        say(data.error || '수정하지 못했습니다.');
        submitBtn.disabled = false;
        submitBtn.textContent = '저장';
        return;                     // 폼을 닫지 않는다 — 쓴 내용이 날아간다
      }

      if (data.held) {
        // 보류된 글은 이 주소에서도 404 다 — 더 읽을 수 없으니 목록으로 본다
        alert(data.message);
        window.location.href = '/community';
        return;
      }
      hush();
      post = data.post;
      postEditing = false;
      document.title = post.title + ' — Ans2Quest';
      render();
    } catch {
      say('네트워크 오류입니다. 잠시 후 다시 시도해 주세요.');
      submitBtn.disabled = false;
      submitBtn.textContent = '저장';
    }
  });

  // ── 글 삭제 ──
  box.addEventListener('click', async function (e) {
    const delBtn = e.target.closest('[data-post-delete]');
    if (!delBtn) return;

    if (!confirm('이 글을 삭제하시겠습니까? 달린 답변도 함께 삭제되며 복구할 수 없습니다.')) return;

    delBtn.disabled = true;
    delBtn.textContent = '삭제 중…';

    try {
      const res = await fetch('/api/posts/' + encodeURIComponent(id), {
        method: 'DELETE',
        credentials: 'same-origin'
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        say(data.error || '삭제하지 못했습니다.');
        delBtn.disabled = false;
        delBtn.textContent = '삭제';
        return;
      }
      // 지워진 글은 이 주소에서 404 다 — 목록으로 본다
      window.location.href = '/community';
    } catch {
      say('네트워크 오류입니다. 잠시 후 다시 시도해 주세요.');
      delBtn.disabled = false;
      delBtn.textContent = '삭제';
    }
  });

  // ── 첫 로드 ──
  const notFound = (msg) => {
    box.innerHTML = '<p class="state">' + esc(msg) +
      '<br><a href="/community">커뮤니티로 돌아가기</a></p>';
  };

  async function load() {
    if (!id) { notFound('주소에 글 번호가 없습니다.'); return; }
    try {
      const res = await fetch('/api/posts/' + encodeURIComponent(id), { credentials: 'same-origin' });
      // 보류·차단된 글도 404 다. 상태를 알려주면 "그런 글이 있긴 하다" 가 드러난다
      if (res.status === 404) { notFound('없는 글이거나 검토 중인 글입니다.'); return; }
      if (!res.ok) throw new Error(res.status);

      const data = await res.json();
      post = data.post;
      myVote = data.myVote || 0;
      document.title = post.title + ' — Ans2Quest';
      render();

      // 답변은 본문을 그린 뒤에 채운다 — 읽을 것부터 먼저 보여준다
      const cr = await fetch('/api/posts/' + encodeURIComponent(id) + '/comments', { credentials: 'same-origin' });
      comments = cr.ok ? (await cr.json()).comments || [] : [];
      render();
    } catch {
      notFound('글을 불러오지 못했습니다.');
    }
  }

  // 세션이 확인되면 로그인 안내 문구가 달라진다 — 이미 그려졌으면 다시 그린다
  Session.refresh().then(render);
  load();
})();
