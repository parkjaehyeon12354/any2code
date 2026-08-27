/* 최근 방문한 시뮬레이션 — 계정이나 서버로 보내지 않고 이 브라우저에만 저장한다. */
(function () {
  'use strict';

  var KEY = 'ans2quest:recentSimulations:v1';
  var LIMIT = 6;

  function read() {
    try {
      var value = JSON.parse(localStorage.getItem(KEY) || '[]');
      if (!Array.isArray(value)) return [];
      return value.filter(function (item) {
        return item && typeof item.href === 'string' &&
          item.href.indexOf('/simulation/') === 0 &&
          item.href !== '/simulation/' && typeof item.title === 'string';
      }).slice(0, LIMIT);
    } catch (_) {
      return [];
    }
  }

  function rememberCurrentPage() {
    var path = location.pathname.replace(/\/+$/, '') + (location.pathname.endsWith('/') ? '/' : '');
    if (path.indexOf('/simulation/') !== 0 || path === '/simulation/' || path === '/simulation/index.html') return;

    var heading = document.querySelector('main h1');
    if (!heading || !heading.textContent.trim()) return;
    var crumb = document.querySelector('.crumb');
    var parts = crumb ? crumb.textContent.split('·').map(function (part) { return part.trim(); }) : [];
    var item = {
      href: location.pathname,
      title: heading.textContent.trim(),
      subject: parts.length > 1 ? parts[1] : '과학',
      visitedAt: Date.now()
    };
    var next = read().filter(function (old) { return old.href !== item.href; });
    next.unshift(item);
    try { localStorage.setItem(KEY, JSON.stringify(next.slice(0, LIMIT))); } catch (_) {}
  }

  function relativeTime(time) {
    var elapsed = Math.max(0, Date.now() - Number(time || 0));
    var minute = 60000;
    if (elapsed < minute) return '방금 전';
    if (elapsed < 60 * minute) return Math.floor(elapsed / minute) + '분 전';
    if (elapsed < 24 * 60 * minute) return Math.floor(elapsed / (60 * minute)) + '시간 전';
    if (elapsed < 7 * 24 * 60 * minute) return Math.floor(elapsed / (24 * 60 * minute)) + '일 전';
    return new Date(time).toLocaleDateString('ko-KR');
  }

  function render() {
    var list = document.getElementById('recent-simulation-list');
    var empty = document.getElementById('recent-simulation-empty');
    if (!list) return;
    var items = read();
    list.textContent = '';
    if (empty) empty.hidden = items.length > 0;
    list.hidden = items.length === 0;

    items.forEach(function (item) {
      var link = document.createElement('a');
      link.className = 'recent-simulation-card';
      link.href = item.href;

      var meta = document.createElement('span');
      meta.className = 'recent-simulation-meta';
      meta.textContent = item.subject + ' · ' + relativeTime(item.visitedAt);
      var title = document.createElement('strong');
      title.textContent = item.title;
      var action = document.createElement('span');
      action.className = 'recent-simulation-action';
      action.textContent = '다시 열기 →';
      link.append(meta, title, action);
      list.appendChild(link);
    });
  }

  rememberCurrentPage();
  render();
  window.Ans2QuestRecentSimulations = { read: read, render: render };
})();
