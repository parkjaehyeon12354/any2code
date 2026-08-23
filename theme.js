/* 밝기 모드.

   <head> 에서, 화면이 그려지기 전에 불러야 한다. 나중에 부르면 밝은 화면이 한 번
   번쩍인 뒤 어두워진다 — 다크 모드를 켜 둔 사람에게 그게 제일 거슬린다.

   저장값이 없으면 data-theme 을 아예 붙이지 않는다. 그래야 styles.css 의
   prefers-color-scheme 규칙이 살아서 기기 설정을 따른다. '자동' 이 기본값이다. */
(function () {
  var KEY = 'ans2quest_theme';
  var root = document.documentElement;

  function read() {
    try {
      var v = localStorage.getItem(KEY);
      return v === 'dark' || v === 'light' ? v : null;
    } catch (e) {
      return null;   // 시크릿 모드 등에서 막힐 수 있다. 그때는 기기 설정을 따른다.
    }
  }

  function apply(mode) {
    if (mode) root.setAttribute('data-theme', mode);
    else root.removeAttribute('data-theme');
  }

  apply(read());   // ← 그리기 전에 여기서 끝내야 한다

  /** 지금 실제로 어두운가 (저장값이 없으면 기기 설정을 본다) */
  function isDark() {
    var saved = read();
    if (saved) return saved === 'dark';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function toggle() {
    var next = isDark() ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch (e) { /* 저장만 못 할 뿐 화면은 바뀐다 */ }
    apply(next);
    paint();
  }

  var btn = null;

  function paint() {
    if (!btn) return;
    var dark = isDark();
    btn.setAttribute('aria-pressed', String(dark));
    btn.setAttribute('title', dark ? '밝게 보기' : '어둡게 보기');
    btn.setAttribute('aria-label', dark ? '밝게 보기' : '어둡게 보기');
    // 해가 보이면 '밝게', 달이 보이면 '어둡게' — 누르면 되는 상태를 그린다
    btn.innerHTML = dark
      ? '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="4" fill="currentColor"/>'
        + '<g stroke="currentColor" stroke-width="1.6" stroke-linecap="round">'
        + '<line x1="10" y1="1.5" x2="10" y2="3.5"/><line x1="10" y1="16.5" x2="10" y2="18.5"/>'
        + '<line x1="1.5" y1="10" x2="3.5" y2="10"/><line x1="16.5" y1="10" x2="18.5" y2="10"/>'
        + '<line x1="4" y1="4" x2="5.4" y2="5.4"/><line x1="14.6" y1="14.6" x2="16" y2="16"/>'
        + '<line x1="16" y1="4" x2="14.6" y2="5.4"/><line x1="5.4" y1="14.6" x2="4" y2="16"/></g></svg>'
      : '<svg viewBox="0 0 20 20" aria-hidden="true">'
        + '<path d="M16.5 12.2A7 7 0 0 1 7.8 3.5a7 7 0 1 0 8.7 8.7z" fill="currentColor"/></svg>';
  }

  function mount() {
    var nav = document.querySelector('.nav-inner');
    if (!nav || document.getElementById('theme-toggle')) return;

    btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'theme-toggle';
    btn.className = 'theme-toggle';
    btn.addEventListener('click', toggle);

    // 로그인 영역 바로 왼쪽. 없으면 맨 끝에 붙인다
    var cta = document.getElementById('nav-cta');
    if (cta) nav.insertBefore(btn, cta);
    else nav.appendChild(btn);

    paint();
  }

  /* 버튼을 되도록 빨리 붙인다.

     색 자체는 위 apply() 가 <head> 에서 즉시 입힌다. 하지만 버튼은 .nav-inner 가
     파싱된 뒤에야 붙일 수 있는데, DOMContentLoaded 를 기다리면 그게 400ms 쯤 걸린다.
     그 동안 헤더에 토글이 없어서 "다크 모드가 늦게 켜진다"는 느낌을 준다.

     그래서 .nav-inner 가 나타나는 즉시 붙인다. 문서가 아직 파싱 중이면
     requestAnimationFrame 으로 짧게 재시도하고, 끝나면 DOMContentLoaded 로 마무리한다. */
  if (document.readyState === 'loading') {
    var tries = 0;
    var poll = function () {
      if (document.getElementById('theme-toggle')) return;
      mount();
      if (document.getElementById('theme-toggle')) return;
      if (++tries < 240 && document.readyState === 'loading') {
        requestAnimationFrame(poll);
      }
    };
    requestAnimationFrame(poll);
    document.addEventListener('DOMContentLoaded', mount);   // 안전망
  } else {
    mount();
  }

  /* 저장값이 없는 사람은 기기 설정을 따르므로, OS 에서 바꾸면 아이콘도 따라가야 한다 */
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onChange = function () { if (!read()) paint(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
})();
