(async function () {
  const me = await Session.refresh();
  if (!me || me.role !== 'admin') return;

  document.getElementById('whoami').textContent =
    me.name + '님으로 로그인됨 · 오늘의 운영 현황입니다.';

  let REPORTS = [];   // GET /api/moderation/reports 로 채운다

  // 제재 대상 회원의 소명. 원 제재를 함께 들고 있어야 검토가 가능하다.

  // 금칙어 목록과 판정은 서버(api/src/functions/posts.js)에만 둔다.
  // 화면에서 다시 계산하면 두 목록이 갈라지고, 감지어가 실제 보류 사유와
  // 달라져서 판단을 그르친다. 여기서는 서버가 저장해 둔 words 를 표시만 한다.

  // 감지어를 강조해서 보여준다. esc 를 먼저 걸고 그 다음 <mark> 를 넣어야
  // 사용자가 쓴 태그가 실행되지 않는다.
  function highlight(text, words) {
    let html = esc(text);
    words.forEach((w) => {
      html = html.split(esc(w)).join('<mark>' + esc(w) + '</mark>');
    });
    return html;
  }

  let HELD = [];   // GET /api/moderation/held 로 채운다

  const STATUS = {
    wait:    { cls: 'badge-wait',  text: '대기' },
    done:    { cls: 'badge-ok',    text: '처리됨' },  // text 는 제재 내용으로 덮어쓴다
    denied:  { cls: 'badge-bad',   text: '기각' },
    granted: { cls: 'badge-ok',    text: '인용' },
    reduced: { cls: 'badge-wait',  text: '감경' },
    // 아래 셋은 서버가 글 문서에 저장하는 status 값과 이름이 같아야 한다
    held:    { cls: 'badge-wait', text: '보류' },
    public:  { cls: 'badge-ok',   text: '공개됨' },
    blocked: { cls: 'badge-bad',  text: '차단됨' }
  };

  const esc = escapeHtml;   // session.js 제공
  const badge = (s, override) =>
    '<span class="badge ' + STATUS[s].cls + '">' + esc(override || STATUS[s].text) + '</span>';

  // 제재 표기 — 표와 모달이 같은 문구를 쓰도록 한 곳에서 만든다
  const sanctionText = (days, blocked) =>
    (days === 0 ? '경고' : days + '일 제한') + (blocked ? ' · 글 차단' : '');

  /* 제한 해제일 미리보기. 여기서만 기기 시각으로 계산한다 — 실제 해제 시각은 서버가
     정하고, 이건 "몇 일이면 언제까지인지" 를 고르는 순간에 보여주는 어림값이다. */
  const untilDate = (days) => shortDate(new Date(Date.now() + days * 86400000));
  const fill = (id, rows, empty) => {
    const tbody = document.getElementById(id);
    // 표마다 열 수가 다르다. 고정값(6)을 쓰면 열이 늘어난 표에서 안내문이 어긋난다
    const cols = tbody.closest('table').querySelectorAll('thead th').length;
    tbody.innerHTML = rows.length
      ? rows.join('')
      : '<tr><td colspan="' + cols + '" class="empty">' + empty + '</td></tr>';
  };

  // 개요의 대기 건수도 표와 같은 원본을 보게 한다 (숫자가 따로 놀면 신뢰를 잃는다)
  let reportsLoading = true;

  function updatePendingCount() {
    const n = REPORTS.filter((r) => r.status === 'wait').length;
    document.getElementById('pending-count').textContent = reportsLoading ? '–' : n;
    const note = document.getElementById('pending-note');
    note.textContent = reportsLoading ? '불러오는 중' : (n ? '확인 필요' : '모두 처리됨');
    note.classList.toggle('warn', !reportsLoading && n > 0);
  }

  // 처리 후 상태가 바뀌므로 다시 그릴 수 있어야 한다
  /* 반복 위반 표시. 제재로 이어진 것만 센다 — 감경·해제는 같은 건의 후속이라
     함께 세면 한 번 걸린 사람이 세 번 걸린 것처럼 보인다. */
  const priorCount = (history) => (history || []).filter((h) => h.event === 'issued').length;

  const priorTag = (history) => {
    const n = priorCount(history);
    return n ? '<div class="cell-sub warn-text">이전 제재 ' + n + '건</div>' : '';
  };

  const HISTORY_EVENT = {
    issued: (h) => (h.days ? h.days + '일 제한' : '경고'),
    reduced: (h) => h.days + '일로 감경',
    lifted: () => '소명 인용 · 해제'
  };

  /* 모달의 이력 칸. 처리한 관리자까지 보여준다 — 운영자끼리 서로 확인할 수 있어야 한다.
     최근 5건까지만: 판단에 필요한 건 최근 경향이고, 길어지면 모달이 스크롤된다. */
  function fillHistory(rowId, boxId, history) {
    const list = history || [];
    const row = document.getElementById(rowId);
    row.hidden = !list.length;
    if (!list.length) return;

    const shown = list.slice(0, 5);
    document.getElementById(boxId).innerHTML =
      shown.map((h) => {
        const label = (HISTORY_EVENT[h.event] || ((x) => x.event))(h);
        /* 처리자는 아랫줄로 내린다. 한 줄에 붙이면 이메일이 길어서 단어 중간에
           잘리고("...@gm / ail.com"), 날짜·조치·사유가 칸처럼 어긋나 보인다. */
        return '<div class="hist-line">' +
          '<div><span class="hist-when">' + esc(shortDate(h.at)) + '</span> ' +
          esc(label) +
          (h.reason ? ' <span class="cell-muted">· ' + esc(h.reason) + '</span>' : '') +
          '</div>' +
          (h.by ? '<div class="hist-by">' + esc(h.by) + '</div>' : '') +
          '</div>';
      }).join('') +
      (list.length > shown.length
        ? '<div class="cell-sub">외 ' + (list.length - shown.length) + '건</div>' : '');
  }

  function renderReports() {
    if (reportsLoading) { fill('report-body', [], '불러오는 중…'); return; }
    fill('report-body', REPORTS.map((r) =>
      '<tr><td class="cell-name">' + esc(r.target) +
        '<div class="cell-sub">' + esc(r.targetAuthor || '') + '</div>' + priorTag(r.history) + '</td>' +
      '<td class="cell-wrap">' + esc(clip(r.targetText)) + '</td>' +
      '<td>' + esc(r.reason) + '</td>' +
      '<td class="cell-muted">' + esc(r.by) + '</td>' +
      '<td class="cell-muted">' + esc(shortDate(r.createdAt)) + '</td>' +
      '<td>' + badge(r.status, r.applied && sanctionText(r.applied.days, r.applied.blockedContent)) +
      (r.applied && r.applied.until
        ? '<div class="cell-sub">' + esc(shortDate(r.applied.until)) + ' 해제</div>' : '') + '</td>' +
      '<td><button type="button" class="row-action" data-report="' + esc(r.id) + '">' +
      (r.applied ? '다시 처리' : '처리') + '</button></td></tr>'
    ), '접수된 신고가 없습니다.');
  }

  /* 표에서는 길게 볼 이유가 없다 — 판단은 모달에서 전문을 보고 한다 */
  const clip = (t) => (t || '').length > 60 ? t.slice(0, 60) + '…' : (t || '');

  async function loadReports() {
    try {
      const res = await fetch('/api/moderation/reports', { credentials: 'same-origin' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
      REPORTS = (await res.json()).reports || [];
    } catch (e) {
      REPORTS = [];
      // resultBox 는 아래에서 const 로 선언된다 — 순서에 기대지 않고 직접 찾는다
      const box = document.getElementById('mod-result');
      box.textContent = '신고 목록을 불러오지 못했습니다: ' + e.message;
      box.hidden = false;
    } finally {
      reportsLoading = false;
      renderReports();
      updatePendingCount();
    }
  }

  renderReports();
  updatePendingCount();

  // ── 소명 ──
  let APPEALS = [];
  let appealsLoading = true;

  function updateAppealCount() {
    const n = APPEALS.filter((a) => a.status === 'wait').length;
    document.getElementById('appeal-count').textContent = appealsLoading ? '–' : n;
    const note = document.getElementById('appeal-note');
    note.textContent = appealsLoading ? '불러오는 중' : (n ? '확인 필요' : '모두 처리됨');
    note.classList.toggle('warn', !appealsLoading && n > 0);
  }

  function renderAppeals() {
    if (appealsLoading) { fill('appeal-body', [], '불러오는 중…'); return; }
    fill('appeal-body', APPEALS.map((a) =>
      '<tr><td class="cell-name">' + esc(a.who) + priorTag(a.history) + '</td>' +
      '<td class="cell-muted">' + sanctionText(a.orig.days) +
      '<div class="cell-sub">' + esc(a.reason) + '</div></td>' +
      '<td class="cell-wrap">' + esc(a.text.split('\n')[0]) + '</td>' +
      '<td class="cell-muted">' + esc(shortDate(a.createdAt)) + '</td>' +
      '<td>' + badge(a.status, a.decision && DECISION_LABEL[a.decision.decision]) +
      (a.decision && a.decision.days
        ? '<div class="cell-sub">' + a.decision.days + '일로 감경</div>' : '') + '</td>' +
      '<td><button type="button" class="row-action" data-appeal="' + esc(a.id) + '">' +
      (a.decision ? '다시 결정' : '검토') + '</button></td></tr>'
    ), '접수된 소명이 없습니다.');
  }

  const DECISION_LABEL = { denied: '기각 · 제재 유지', granted: '인용 · 즉시 해제', reduced: '감경' };

  async function loadAppeals() {
    try {
      const res = await fetch('/api/moderation/appeals', { credentials: 'same-origin' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
      APPEALS = (await res.json()).appeals || [];
    } catch (e) {
      APPEALS = [];
      const box = document.getElementById('ap-result');
      box.textContent = '소명 목록을 불러오지 못했습니다: ' + e.message;
      box.hidden = false;
    } finally {
      appealsLoading = false;
      renderAppeals();
      updateAppealCount();
    }
  }

  renderAppeals();
  updateAppealCount();

  // ── 보류 게시물 ──
  const heldResult = document.getElementById('held-result');
  let heldLoading = true;

  function updateHeldCount() {
    const n = HELD.filter((p) => p.status === 'held').length;
    document.getElementById('held-count').textContent = n;
    document.getElementById('held-total').textContent = heldLoading ? '' : n + '건';
    const note = document.getElementById('held-note');
    note.textContent = heldLoading ? '불러오는 중' : (n ? '확인 필요' : '모두 처리됨');
    note.classList.toggle('warn', !heldLoading && n > 0);
  }

  // shortDate·shortWhen 은 session.js 가 전역으로 준다 (모든 화면이 같은 시간대로 그린다)

  function renderHeld() {
    if (heldLoading) { fill('held-body', [], '불러오는 중…'); return; }
    fill('held-body', HELD.map((p) => {
      // 감지어는 걸릴 당시 기준으로 서버가 저장해 둔 값을 쓴다 —
      // 금칙어 목록이 바뀌어도 "왜 걸렸는지" 는 그대로 남아야 판단할 수 있다
      const words = p.words || [];
      const blocked = p.status === 'blocked';
      return '<tr><td class="cell-muted">' + esc(p.author || '알 수 없음') +
        '<div class="cell-sub">' + esc(p.title) + '</div></td>' +
        '<td class="cell-wrap">' + highlight(p.text, words) + '</td>' +
        '<td>' + words.map((w) => '<span class="word-tag">' + esc(w) + '</span>').join(' ') + '</td>' +
        '<td class="cell-muted">' + esc(shortDate(p.createdAt)) + '</td>' +
        '<td>' + badge(p.status) +
          (p.moderatedBy ? '<div class="cell-sub">' + esc(p.moderatedBy) + '</div>' : '') + '</td>' +
        '<td>' + (blocked
          ? '<button type="button" class="row-action" data-held-undo="' + esc(p.id) + '">되돌리기</button>'
          : '<button type="button" class="row-action" data-held-ok="' + esc(p.id) + '">공개</button> ' +
            '<button type="button" class="row-action danger" data-held-block="' + esc(p.id) + '">차단·제재</button>') +
        '</td></tr>';
    }), '보류 중인 게시물이 없습니다.');
  }

  function heldSay(msg) { heldResult.textContent = msg; heldResult.hidden = false; }

  /** 서버에 처리를 맡기고, 성공했을 때만 화면을 바꾼다 */
  async function moderate(id, action) {
    const res = await fetch('/api/moderation/posts/' + encodeURIComponent(id) + '/moderate', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '처리하지 못했습니다.');

    const p = HELD.find((x) => x.id === id);
    if (p) { p.status = data.status; p.moderatedBy = data.moderatedBy; p.moderatedAt = data.moderatedAt; }
    renderHeld();
    updateHeldCount();
    return data;
  }

  async function loadHeld() {
    try {
      const res = await fetch('/api/moderation/held', { credentials: 'same-origin' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
      HELD = (await res.json()).posts || [];
      heldResult.hidden = true;
    } catch (e) {
      HELD = [];
      heldSay('보류 목록을 불러오지 못했습니다: ' + e.message);
    } finally {
      heldLoading = false;
      renderHeld();
      updateHeldCount();
    }
  }

  renderHeld();
  updateHeldCount();
  loadHeld();     // 관리자 확인이 끝난 뒤라 여기서 부른다
  loadReports();
  loadAppeals();

  document.getElementById('held-body').addEventListener('click', async function (e) {
    const btn = e.target.closest('[data-held-ok],[data-held-block],[data-held-undo]');
    if (!btn) return;

    const id = btn.dataset.heldOk || btn.dataset.heldUndo || btn.dataset.heldBlock;
    const p = HELD.find((x) => x.id === id);
    if (!p) return;

    // 차단·제재는 신고와 같은 모달을 거친다 (제재 내용을 함께 정하기 위해)
    if (btn.dataset.heldBlock !== undefined) {
      openSanction(
        { target: p.title, reason: '욕설·비방 (' + (p.words || []).join(', ') + ')', ip: null },
        // 게시물 차단은 실제로 저장된다. 제재 일수·메시지 발송은 아직 서버가 없어
        // 화면 표시뿐이라, 무엇이 저장되고 무엇이 아닌지 결과에 그대로 적는다.
        async function (d) {
          await moderate(id, 'block');
          return '"' + p.title + '" 을(를) 차단했습니다. 커뮤니티 목록에서 즉시 사라집니다.\n' +
            '글은 지워지지 않았습니다 — 되돌리기로 복구할 수 있습니다.\n\n' +
            sanctionSummary(d) + '\n\n' +
            '[이용 제한·메시지 발송은 아직 저장되지 않습니다]';
        },
        heldResult
      );
      return;
    }

    const action = btn.dataset.heldOk !== undefined ? 'publish' : 'hold';
    btn.disabled = true;
    try {
      await moderate(id, action);
      heldSay(action === 'publish'
        ? '"' + p.title + '" 을(를) 공개했습니다. 커뮤니티 목록에 바로 나타납니다.'
        : '"' + p.title + '" 을(를) 다시 보류로 되돌렸습니다.');
    } catch (err) {
      heldSay(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // ── 신고 처리 모달 ──
  const dlg = document.getElementById('mod-dialog');
  const msgBox = document.getElementById('mod-message');
  const sendBox = document.getElementById('mod-send');
  const blockBox = document.getElementById('mod-blockcontent');
  const resultBox = document.getElementById('mod-result');
  let current = null;            // { target, reason, ip, applied? } — 신고 또는 보류 게시물
  let onApply = null;            // 확정 시 실행. 어디서 열었느냐에 따라 다르게 처리한다
  let onApplyResultBox = null;   // 결과를 띄울 곳 (연 화면에 따라 다름)
  let msgEdited = false;         // 관리자가 직접 고쳤으면 템플릿으로 덮어쓰지 않는다

  const days = () => Number(dlg.querySelector('input[name="duration"]:checked').value);

  function template() {
    const d = days();
    const limit = d === 0
      ? '이번 건은 경고로 처리되었으며 이용 제한은 적용되지 않았습니다.'
      : '이에 따라 ' + d + '일간 서비스 이용이 제한됩니다.';
    return '안녕하세요, Ans2Quest 운영팀입니다.\n\n' +
      '회원님의 「' + current.target + '」이(가) ‘' + current.reason + '’ 사유로 신고 접수되어 검토했습니다.\n' +
      limit +
      (blockBox.checked ? '\n신고된 글은 커뮤니티에서 가려졌습니다.' : '') +
      '\n\n이의가 있으시면 소명을 접수해 주세요.';
  }

  function refreshTemplate() {
    if (!msgEdited) msgBox.value = template();
  }

  // 선택한 제재가 실제로 언제까지인지 즉시 보여준다 — "7일"만 보면 감이 안 온다
  function refreshEffect() {
    const d = days();
    const blocked = blockBox.checked ? ' · 신고된 글도 차단' : '';
    document.getElementById('mod-effect').innerHTML = d === 0
      ? '<strong>경고</strong>만 기록됩니다. 이용 제한 없음.' + blocked
      : '<strong>' + d + '일 제한</strong> · <strong>' + untilDate(d) + '</strong>에 자동 해제' + blocked;
  }

  const refreshAll = () => { refreshTemplate(); refreshEffect(); };

  msgBox.addEventListener('input', function () { msgEdited = true; });
  dlg.querySelectorAll('input[name="duration"]').forEach((r) =>
    r.addEventListener('change', refreshAll));
  blockBox.addEventListener('change', refreshAll);
  sendBox.addEventListener('change', function () {
    msgBox.disabled = !sendBox.checked;   // 발송 안 할 거면 입력칸도 잠근다
  });

  // 신고와 보류 게시물이 같은 제재 모달을 쓴다. 다른 건 "확정했을 때 뭘 할지"뿐이라
  // 그것만 콜백으로 받는다 — 모달을 하나 더 만들 이유가 없다.
  function openSanction(ctx, apply, resultBoxEl) {
    current = ctx;
    onApply = apply;
    onApplyResultBox = resultBoxEl || null;

    document.getElementById('mod-target').textContent = current.target;
    document.getElementById('mod-reason').textContent = current.reason;
    document.getElementById('mod-ip').textContent = current.ip;

    // 이미 처리한 건이면 기존 제재를 보여주고 그 값으로 시작한다 —
    // 다시 처리할 때 뭘 걸어뒀는지 모르면 실수로 더 세게 걸게 된다
    const prevRow = document.getElementById('mod-prev-row');
    const prev = current.applied;
    prevRow.hidden = !prev;
    if (prev) {
      document.getElementById('mod-prev').textContent =
        sanctionText(prev.days, prev.blockedContent) +
        (prev.until ? ' (' + shortDate(prev.until) + ' 해제)' : '');
    }

    fillHistory('mod-history-row', 'mod-history', current.history);

    dlg.querySelector('input[name="duration"][value="' + (prev ? prev.days : 0) + '"]').checked = true;
    blockBox.checked = prev ? !!prev.blockedContent : true;
    sendBox.checked = true;
    msgBox.disabled = false;
    msgEdited = false;
    refreshAll();

    dlg.showModal();   // 초점 가둠·Esc 닫기는 네이티브가 처리
  }

  document.getElementById('report-body').addEventListener('click', function (e) {
    const btn = e.target.closest('[data-report]');
    if (!btn) return;
    const r = REPORTS.find((x) => x.id === btn.dataset.report);
    if (!r) return;

    openSanction(r, async function (d, blockContent) {
      const res = await fetch('/api/moderation/reports/' + encodeURIComponent(r.id) + '/resolve', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: d, blockContent: blockContent })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '처리하지 못했습니다.');

      r.status = 'done';
      r.applied = data.applied;
      renderReports();
      updatePendingCount();

      // 무엇이 실제로 적용됐는지 서버 응답 기준으로 말한다
      return (d === 0
          ? '경고로 처리했습니다. 이용 제한은 걸지 않았습니다.'
          : d + '일 이용 제한을 걸었습니다. ' + shortDate(data.applied.until) + ' 에 자동 해제됩니다.') +
        (blockContent ? '\n신고된 글은 커뮤니티에서 가려졌습니다 (보류 게시물에서 되돌릴 수 있습니다).' : '') +
        '\n\n' + sanctionSummary(d);
    });
  });

  const close = () => dlg.close();
  document.getElementById('mod-x').addEventListener('click', close);
  document.getElementById('mod-cancel').addEventListener('click', close);
  // 배경(backdrop) 클릭으로 닫기 — dialog 자체가 클릭 대상이면 바깥이다
  dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });

  /** 확정한 제재 내용을 사람이 읽는 형태로. 저장 여부와 무관하게 같은 형식이다. */
  function sanctionSummary(d) {
    const payload = {
      대상: current.target,
      사유: current.reason,
      제재: d === 0 ? '경고만 (이용 제한 없음)' : d + '일 이용 제한 (' + untilDate(d) + ' 해제)',
      게시물차단: blockBox.checked ? '예' : '아니오',
      메시지발송: sendBox.checked ? '예' : '아니오'
    };
    return Object.entries(payload).map(([k, v]) => k + ': ' + v).join('\n') +
      (sendBox.checked ? '\n\n─ 발송될 메시지 ─\n' + msgBox.value : '');
  }

  /* 확정 버튼.
     결과 문구는 처리 주체(onApply)가 돌려준다 — 여기서 만들면 실제로 저장한
     경우에도 "저장되지 않았습니다" 를 찍게 된다(실제로 그랬다).
     저장에 실패하면 모달을 닫지 않는다. 닫아버리면 실패한 줄 모르고 넘어간다. */
  document.getElementById('mod-confirm').addEventListener('click', async function () {
    const d = days();
    const box = onApplyResultBox || resultBox;
    const btn = this;

    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = '처리 중…';
    try {
      const msg = await onApply(d, blockBox.checked);
      box.textContent = msg || sanctionSummary(d);
      box.hidden = false;
      close();
      box.scrollIntoView({ block: 'nearest' });
    } catch (err) {
      box.textContent = '처리하지 못했습니다: ' + err.message;
      box.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = prev;
    }
  });

  // ── 소명 처리 모달 ──
  const apDlg = document.getElementById('ap-dialog');
  const apMsg = document.getElementById('ap-message');
  const apSend = document.getElementById('ap-send');
  const apReduceRow = document.getElementById('ap-reduce-row');
  const apResult = document.getElementById('ap-result');
  let apCurrent = null;
  let apMsgEdited = false;

  const decision = () => apDlg.querySelector('input[name="decision"]:checked').value;
  const newDays = () => Number(apDlg.querySelector('input[name="newdays"]:checked').value);

  // 결정별로 최종 제재가 무엇이 되는지 한 곳에서 계산한다
  function outcome() {
    const d = decision();
    if (d === 'granted') return { days: 0, label: '인용 · 즉시 해제', until: null };
    if (d === 'reduced') {
      const n = newDays();
      return { days: n, label: n + '일로 감경', until: untilDate(n) };
    }
    return { days: apCurrent.orig.days, label: '기각 · 제재 유지', until: apCurrent.orig.until };
  }

  function apTemplate() {
    const o = outcome();
    const body = decision() === 'granted'
      ? '검토 결과 제재를 해제했습니다. 불편을 드려 죄송합니다.'
      : decision() === 'reduced'
        ? '검토 결과 제재 기간을 ' + o.days + '일로 줄였습니다. ' + o.until + '에 해제됩니다.'
        : '검토 결과 원래 제재를 유지합니다.' +
          (apCurrent.orig.days > 0 ? ' ' + apCurrent.orig.until + '에 해제됩니다.' : '');
    return '안녕하세요, Ans2Quest 운영팀입니다.\n\n' +
      '‘' + apCurrent.reason + '’ 제재에 대한 이의를 접수해 검토했습니다.\n' +
      body + '\n\n추가로 궁금한 점이 있으면 회신해 주세요.';
  }

  function apRefresh() {
    apReduceRow.hidden = decision() !== 'reduced';
    const o = outcome();
    document.getElementById('ap-effect').innerHTML =
      '결과: <strong>' + esc(o.label) + '</strong>' +
      (o.until ? ' · <strong>' + o.until + '</strong>에 해제' : '');
    if (!apMsgEdited) apMsg.value = apTemplate();
  }

  apMsg.addEventListener('input', function () { apMsgEdited = true; });
  apDlg.querySelectorAll('input[name="decision"], input[name="newdays"]')
    .forEach((r) => r.addEventListener('change', apRefresh));
  apSend.addEventListener('change', function () { apMsg.disabled = !apSend.checked; });

  document.getElementById('appeal-body').addEventListener('click', function (e) {
    const btn = e.target.closest('[data-appeal]');
    if (!btn) return;
    apCurrent = APPEALS.find((a) => a.id === btn.dataset.appeal);
    if (!apCurrent) return;

    document.getElementById('ap-who').textContent = apCurrent.who;
    document.getElementById('ap-orig').textContent =
      sanctionText(apCurrent.orig.days) +
      (apCurrent.orig.until ? ' (' + shortDate(apCurrent.orig.until) + ' 해제)' : '');
    document.getElementById('ap-reason').textContent = apCurrent.reason;
    document.getElementById('ap-text').textContent = apCurrent.text;
    fillHistory('ap-history-row', 'ap-history', apCurrent.history);

    const prev = apCurrent.decision;
    apDlg.querySelector('input[name="decision"][value="' + (prev ? prev.decision : 'denied') + '"]').checked = true;
    apSend.checked = true;
    apMsg.disabled = false;
    apMsgEdited = false;
    apRefresh();

    apDlg.showModal();
  });

  const apClose = () => apDlg.close();
  document.getElementById('ap-x').addEventListener('click', apClose);
  document.getElementById('ap-cancel').addEventListener('click', apClose);
  apDlg.addEventListener('click', function (e) { if (e.target === apDlg) apClose(); });

  document.getElementById('ap-confirm').addEventListener('click', async function () {
    const o = outcome();
    const d = decision();
    const btn = this;
    const prev = btn.textContent;

    btn.disabled = true;
    btn.textContent = '처리 중…';
    try {
      const res = await fetch('/api/moderation/appeals/' + encodeURIComponent(apCurrent.id) + '/decide', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        // 감경일 때만 일수를 보낸다. 서버는 정수만 받는다 (null 이 0 으로 새면
        // "값을 안 보냄" 과 구분되지 않는다)
        body: JSON.stringify(d === 'reduced' ? { decision: d, days: o.days } : { decision: d })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 실패하면 모달을 닫지 않는다 — 닫으면 처리된 줄 안다
        apResult.textContent = '처리하지 못했습니다: ' + (data.error || res.status);
        apResult.hidden = false;
        return;
      }

      apCurrent.status = d;
      apCurrent.decision = { decision: d, days: data.days };
      renderAppeals();
      updateAppealCount();

      apResult.textContent =
        '신청자: ' + apCurrent.who + '\n' +
        '원 제재: ' + sanctionText(apCurrent.orig.days) + '\n' +
        '결정: ' + o.label + '\n' +
        (d === 'granted' ? '제재가 즉시 해제되어 다시 글을 쓸 수 있습니다.\n'
          : d === 'reduced' ? '제재가 ' + data.days + '일로 다시 계산되었습니다.\n'
          : '제재가 그대로 유지됩니다.\n') +
        '\n─ 메모 ─\n' + apMsg.value +
        '\n\n[메시지 발송 기능은 아직 없습니다]';
      apResult.hidden = false;
      apClose();
      apResult.scrollIntoView({ block: 'nearest' });
    } catch {
      apResult.textContent = '네트워크 오류입니다. 잠시 후 다시 시도해 주세요.';
      apResult.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = prev;
    }
  });

  // ── 설정 ──
  const setWords = document.getElementById('set-words');
  const setWindow = document.getElementById('set-window');
  const setMax = document.getElementById('set-max');
  const setSave = document.getElementById('set-save');
  const setResult = document.getElementById('set-result');
  const setSaved = document.getElementById('set-saved');

  function setSay(msg) { setResult.textContent = msg; setResult.hidden = false; }


  let SET_DEFAULTS = null;   // '기본값으로' 버튼이 쓴다. 서버가 아는 값이 유일한 기준이다

  /* 서버가 준 값만 그린다. 화면이 보낸 값을 그리면 서버가 다듬은 결과
     (공백 정리·중복 제거)와 어긋나서 "저장했는데 다르다" 가 된다. */
  function renderSettings(data) {
    const e = data.editable;
    SET_DEFAULTS = data.defaults;
    setWords.value = e.bannedWords.join('\n');
    setWindow.value = e.postWindowMin;
    setMax.value = e.postMax;

    document.getElementById('set-words-count').textContent =
      e.bannedWords.length + '개 / ' + data.limits.wordsMax + '개';
    setSaved.textContent = e.updatedAt
      ? '마지막 변경: ' + shortWhen(e.updatedAt) + ' · ' + e.updatedBy
      : '아직 바꾼 적 없습니다 (기본값)';

    // 환경 변수는 서버가 읽어준 현재 값을 그대로 보여준다
    const env = data.env;
    document.getElementById('set-env').innerHTML =
      row('점검 모드', env.lockdown
        ? badge('blocked', '켜짐 · 모든 API 503')
        : badge('public', '꺼짐 · 정상 운영')) +
      row('관리자', env.adminEmails.length
        ? env.adminEmails.map(esc).join('<br>')
        : '<span class="cell-muted">ADMIN_EMAILS 미설정</span>') +
      row('데이터베이스', env.cosmosConnected
        ? badge('public', '연결됨')
        : badge('blocked', 'COSMOS_CONNECTION 미설정')) +
      row('세션 만료', esc(env.sessionDays + '일')) +
      row('투표 제한', esc('분당 ' + data.fixed.voteMaxPerMin + '회') +
        '<div class="cell-sub">코드 고정 — 표 한 번에 설정을 읽지 않으려고 뺐습니다</div>');
  }

  function row(dt, ddHtml) {
    return '<div><dt>' + esc(dt) + '</dt><dd>' + ddHtml + '</dd></div>';
  }

  async function loadSettings() {
    try {
      const res = await fetch('/api/moderation/settings', { credentials: 'same-origin' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
      renderSettings(await res.json());
      setResult.hidden = true;
    } catch (e) {
      setSay('설정을 불러오지 못했습니다: ' + e.message +
        '\n서버 값을 모르는 상태로 저장하면 멀쩡한 설정을 덮어씁니다. 저장 버튼을 잠갔습니다.');
      // 빈 화면을 저장 가능한 상태로 두면 금칙어를 통째로 날린다
      setSave.disabled = true;
    }
  }

  async function saveSettings() {
    // 브라우저 검사를 먼저 통과시킨다 — 서버도 같은 범위를 확인하지만,
    // 왕복하지 않고 바로 알려주는 편이 낫다
    for (const input of [setWindow, setMax]) {
      if (!input.checkValidity()) { input.focus(); input.reportValidity(); return; }
    }

    const body = {
      bannedWords: setWords.value.split('\n').map((w) => w.trim()).filter(Boolean),
      postWindowMin: Number(setWindow.value),
      postMax: Number(setMax.value)
    };

    const prev = setSave.textContent;
    setSave.disabled = true;
    setSave.textContent = '저장 중…';
    try {
      const res = await fetch('/api/moderation/settings', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '저장하지 못했습니다.');
      renderSettings(data);
      setSay('저장했습니다. 다음 글부터 이 기준으로 판정합니다.');
    } catch (e) {
      setSay('저장하지 못했습니다: ' + e.message + '\n화면의 값은 그대로 두었습니다.');
    } finally {
      setSave.disabled = false;
      setSave.textContent = prev;
    }
  }

  setSave.addEventListener('click', saveSettings);

  // 기본값 되돌리기는 입력란만 채운다 — 저장은 따로 눌러야 한다.
  // 한 번의 실수로 금칙어 목록이 날아가면 안 된다.
  document.getElementById('set-reset').addEventListener('click', () => {
    if (!SET_DEFAULTS) return;   // 아직 못 불러왔다면 채울 기준이 없다
    setWords.value = SET_DEFAULTS.bannedWords.join('\n');
    setWindow.value = SET_DEFAULTS.postWindowMin;
    setMax.value = SET_DEFAULTS.postMax;
    setSay('기본값을 입력란에 채웠습니다. 적용하려면 저장을 누르세요.');
  });

  loadSettings();

  /* ── AI 크레딧 ──
     3시간마다 자동으로 채워지므로 평소엔 볼 일이 없다. 시연 중 소진처럼
     지금 당장 필요한 경우를 위한 화면이다. */
  const crBody = document.getElementById('cr-body');
  const crTotal = document.getElementById('cr-total');
  const crReset = document.getElementById('cr-reset');
  const crResult = document.getElementById('cr-result');
  const crFree = document.getElementById('cr-free');
  let CREDITS = [];

  const crSay = (msg) => {
    crResult.textContent = msg;
    crResult.hidden = false;
  };

  const fmtWhen = (iso) => {
    if (!iso) return '—';
    // 한국 시간으로 보여준다. 서버는 UTC 로 저장한다.
    const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
    return d.toISOString().slice(5, 16).replace('T', ' ');
  };

  function renderCredits() {
    if (!CREDITS.length) {
      crBody.innerHTML = '<tr><td colspan="6" class="empty">사용자가 없습니다.</td></tr>';
      return;
    }
    crBody.innerHTML = CREDITS.map((u) => {
      // 적게 남은 사람을 눈에 띄게 — 서버가 이미 그 순서로 준다
      // 100 미만이면 어느 모델로도 못 묻고, 300 미만이면 Gemini 를 못 쓴다(science.html 배지와 같은 기준)
      const cls = u.remaining < 100 ? ' style="color:var(--badge-bad-fg)"'
        : u.remaining < 300 ? ' style="color:var(--badge-wait-fg)"' : '';
      return '<tr>'
        + '<td>' + esc(u.name) + (u.email ? '<div class="cell-sub">' + esc(u.email) + '</div>' : '')
        + (u.plan !== 'free' ? '<div class="cell-sub">' + esc(u.planLabel) + ' · ' + fmtWhen(u.planUntil).slice(0, 5) + '까지</div>' : '') + '</td>'
        + '<td class="cell-muted">' + esc(u.provider || '—') + '</td>'
        + '<td' + cls + '><strong>' + u.remaining + '</strong> / ' + u.granted
        + (u.bonus ? '<div class="cell-sub">충전 ' + u.bonus + ' 포함</div>' : '') + '</td>'
        + '<td class="cell-muted">' + u.used + '</td>'
        + '<td class="cell-muted">' + fmtWhen(u.lastUsedAt) + '</td>'
        + '<td class="row-action"><button type="button" data-grant="' + esc(u.sub) + '">지급</button>'
        + ' <button type="button" data-revoke="' + esc(u.sub) + '">세션 끊기</button></td>'
        + '</tr>';
    }).join('');
  }

  async function loadCredits() {
    try {
      const res = await fetch('/api/moderation/credits', { credentials: 'same-origin' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
      const data = await res.json();
      CREDITS = data.users || [];
      crFree.textContent = data.freeCredits;
      crTotal.textContent = CREDITS.length + '명';

      const m = Math.ceil((data.resetInMs || 0) / 60000);
      crReset.textContent = m >= 60
        ? Math.floor(m / 60) + '시간 ' + (m % 60) + '분 뒤 초기화'
        : m + '분 뒤 초기화';
      crResult.hidden = true;
    } catch (e) {
      CREDITS = [];
      crSay('크레딧 목록을 불러오지 못했습니다: ' + e.message);
    } finally {
      renderCredits();
    }
  }

  /* 세션 끊기 — 그 사람이 로그인해 둔 모든 기기의 쿠키를 무효로 만든다(서버 session.revokeAll).
     쿠키 탈취 신고를 받았을 때 쓴다. 크레딧 목록에 있는 사람 = 로그인한 적이 있는 사람이라 여기 둔다. */
  crBody.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-revoke]');
    if (!btn) return;
    const sub = btn.dataset.revoke;
    const target = CREDITS.find((u) => u.sub === sub);
    const who = target ? target.name : sub;
    if (!confirm(who + ' 님이 로그인한 모든 기기에서 로그아웃시킵니다.\n다시 로그인하면 정상적으로 쓸 수 있습니다.')) return;

    btn.disabled = true;
    try {
      const res = await fetch('/api/moderation/sessions/revoke', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sub })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.status);
      if (data.self) { location.href = '/login'; return; }   // 자기 세션을 끊었으면 이 화면도 끝이다
      crSay(who + ' 님의 세션을 모두 끊었습니다.');
    } catch (e) {
      crSay('세션을 끊지 못했습니다: ' + e.message);
    } finally {
      btn.disabled = false;
    }
  });

  crBody.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-grant]');
    if (!btn) return;
    const sub = btn.dataset.grant;
    const target = CREDITS.find((u) => u.sub === sub);

    const input = prompt(
      '얼마나 지급할까요? (1 ~ 2000)\n\n'
      + (target ? target.name + ' — 현재 ' + target.remaining + ' 남음\n\n' : '')
      + '※ 다음 초기화 때 사라집니다.',
      '200'
    );
    if (input === null) return;

    const amount = Number(input);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 2000) {
      crSay('1 ~ 2000 사이의 값을 입력해 주세요.');
      return;
    }

    btn.disabled = true;
    try {
      const res = await fetch('/api/moderation/credits/grant', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sub, amount: Math.floor(amount) })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.status);
      crSay((target ? target.name : '사용자') + ' 에게 ' + Math.floor(amount)
        + ' 크레딧을 지급했습니다. 현재 ' + data.credit.remaining + ' 남음.');
      await loadCredits();
    } catch (e) {
      crSay('지급하지 못했습니다: ' + e.message);
      btn.disabled = false;
    }
  });

  loadCredits();

  /* ── 쿠폰 ──
     값 검사와 상한은 서버(coupon.js)가 한다. 화면은 받은 문구를 그대로 보여 준다. */
  const cpBody = document.getElementById('cp-body');
  const cpTotal = document.getElementById('cp-total');
  const cpResult = document.getElementById('cp-result');
  const cpForm = document.getElementById('cp-form');
  const cpKind = document.getElementById('cp-kind');
  const cpPlan = document.getElementById('cp-plan');
  const cpIssue = document.getElementById('cp-issue');
  const num = (id) => Number(document.getElementById(id).value);

  const cpSay = (msg) => { cpResult.textContent = msg; cpResult.hidden = false; };

  cpKind.addEventListener('change', () => {
    document.getElementById('cp-credit-part').hidden = cpKind.value !== 'credit';
    document.getElementById('cp-plan-part').hidden = cpKind.value !== 'plan';
  });

  async function loadCoupons() {
    try {
      const res = await fetch('/api/moderation/coupons', { credentials: 'same-origin' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
      const data = await res.json();
      // 요금제 목록은 서버 표(credit.PLANS)에서 받는다 — 화면에 따로 적어 두면 갈라진다
      if (!cpPlan.options.length) {
        cpPlan.innerHTML = data.plans.map((p) =>
          '<option value="' + esc(p.id) + '">' + esc(p.label) + ' (3시간마다 ' + p.credits + ')</option>').join('');
      }
      const list = data.coupons || [];
      cpTotal.textContent = list.length + '개';
      cpBody.innerHTML = list.length ? list.map((c) => '<tr>'
        + '<td class="cp-code">' + esc(c.code) + '</td>'
        + '<td>' + (c.kind === 'credit' ? '+' + c.amount + ' 크레딧' : esc(c.planLabel) + ' ' + c.days + '일') + '</td>'
        + '<td' + (c.used >= c.maxUses ? ' class="cell-muted"' : '') + '>' + c.used + ' / ' + c.maxUses + '</td>'
        + '<td class="cell-muted">' + (c.expiresAt ? fmtWhen(c.expiresAt).slice(0, 5) : '없음') + '</td>'
        + '<td class="cell-muted">' + esc(c.memo || '') + '</td>'
        + '<td class="cell-muted">' + fmtWhen(c.createdAt) + '</td>'
        + '</tr>').join('')
        : '<tr><td colspan="6" class="empty">아직 발급한 쿠폰이 없습니다.</td></tr>';
    } catch (e) {
      cpSay('쿠폰 목록을 불러오지 못했습니다: ' + e.message);
    }
  }

  cpForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const body = {
      kind: cpKind.value,
      count: num('cp-count'),
      maxUses: num('cp-max'),
      expiresOn: document.getElementById('cp-exp').value || null,
      memo: document.getElementById('cp-memo').value
    };
    if (body.kind === 'credit') body.amount = num('cp-amount');
    else { body.plan = cpPlan.value; body.days = num('cp-days'); }

    cpIssue.disabled = true;
    try {
      const res = await fetch('/api/moderation/coupons', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.status);
      // 코드는 한 줄에 하나 — 그대로 복사해 나눠 줄 수 있게
      cpSay('발급했습니다 (' + data.codes.length + '개):\n' + data.codes.join('\n'));
      await loadCoupons();
    } catch (e) {
      cpSay('발급하지 못했습니다: ' + e.message);
    } finally {
      cpIssue.disabled = false;
    }
  });

  loadCoupons();

  // ── 섹션 전환 ──
  // location.hash 를 쓰면 뒤로가기와 새로고침이 공짜로 동작한다.
  const navs = [...document.querySelectorAll('[data-nav]')];
  function show(name) {
    const target = document.getElementById(name) ? name : 'overview';
    document.querySelectorAll('.admin-main > section')
      .forEach((s) => s.classList.toggle('active', s.id === target));
    navs.forEach((a) => a.classList.toggle('active', a.dataset.nav === target));
  }
  show(location.hash.slice(1));
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));
})();
