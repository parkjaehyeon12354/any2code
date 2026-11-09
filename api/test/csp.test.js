/* CSP 점검 — script-src 에서 'unsafe-inline' 을 뺀 상태를 지킨다.

   'unsafe-inline' 이 있으면 이스케이프를 한 군데만 빠뜨려도 끼워 넣은 <script> 나
   onerror= 가 그대로 실행된다. 빼 두면 그런 실수가 있어도 브라우저가 막는다(마지막 방어선).
   대신 화면에 인라인 스크립트가 하나라도 남으면 그 화면이 조용히 멈추므로, 여기서 미리 잡는다.

   예외: 커스텀 창작마당(/custom, /custom/view). 선생님이 올린 HTML 을 srcdoc iframe 으로
   돌리는데, srcdoc 은 부모 화면의 CSP 를 물려받는다. 올린 HTML 의 인라인 스크립트가 돌아야
   하므로 이 두 화면만 'unsafe-inline' 을 남긴다. 그 HTML 은 allow-same-origin 없는
   sandbox 안이라 사이트 쿠키·API 에 닿지 못한다(assets/js/workshop-frame.js).
   실행: cd api && node --test */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'staticwebapp.config.json'), 'utf8'));
const CUSTOM_PAGES = ['custom.html', 'custom-view.html'];

function allHtml(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) allHtml(full, out);
    else if (name.endsWith('.html')) out.push(full);
  }
  return out;
}

const scriptSrc = (csp) => (csp.split(';').map((s) => s.trim()).find((s) => s.startsWith('script-src')) || '');

test("사이트 기본 CSP 의 script-src 에 'unsafe-inline' 이 없다", () => {
  const csp = CONFIG.globalHeaders['Content-Security-Policy'];
  assert.ok(scriptSrc(csp), 'script-src 가 있어야 한다');
  assert.ok(!scriptSrc(csp).includes("'unsafe-inline'"), scriptSrc(csp));
  assert.ok(!scriptSrc(csp).includes("'unsafe-eval'"), scriptSrc(csp));
});

test("'unsafe-inline' 을 쓰는 라우트는 커스텀 창작마당뿐이다", () => {
  const relaxed = CONFIG.routes
    .filter((r) => r.headers && r.headers['Content-Security-Policy'])
    .filter((r) => scriptSrc(r.headers['Content-Security-Policy']).includes("'unsafe-inline'"))
    .map((r) => r.route).sort();
  assert.deepStrictEqual(relaxed, ['/custom', '/custom-view.html', '/custom.html', '/custom/view']);
});

test('커스텀 화면은 .html 주소로 열어도 같은 CSP 를 받는다', () => {
  // 라우트에만 걸어 두면 /custom.html 로 직접 열었을 때 기본 CSP 가 붙어, 올린 자료가 안 돌아간다
  const csp = (route) => CONFIG.routes.find((r) => r.route === route).headers['Content-Security-Policy'];
  assert.strictEqual(csp('/custom.html'), csp('/custom'));
  assert.strictEqual(csp('/custom-view.html'), csp('/custom/view'));
});

test('커스텀 외 화면에는 인라인 <script> 가 없다', () => {
  const offenders = [];
  for (const file of allHtml(ROOT)) {
    if (CUSTOM_PAGES.includes(path.relative(ROOT, file))) continue;
    const html = fs.readFileSync(file, 'utf8');
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const attrs = m[1];
      if (/\bsrc=/.test(attrs)) continue;
      if (/type="application\/(?:ld\+)?json"/.test(attrs)) continue;   // 데이터 블록은 실행되지 않는다
      offenders.push(path.relative(ROOT, file));
    }
  }
  assert.deepStrictEqual(offenders, [], '인라인 스크립트는 assets/js/pages/ 로 옮겨야 한다');
});

test('어느 화면에도 인라인 이벤트 핸들러(onclick= 등)가 없다', () => {
  const offenders = [];
  for (const file of allHtml(ROOT)) {
    const html = fs.readFileSync(file, 'utf8');
    if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(html)) offenders.push(path.relative(ROOT, file));
  }
  assert.deepStrictEqual(offenders, [], '이벤트는 addEventListener 로 단다 — CSP 가 막는다');
});

test('화면이 부르는 스크립트 파일이 모두 있다', () => {
  const missing = [];
  for (const file of allHtml(ROOT)) {
    for (const [, src] of fs.readFileSync(file, 'utf8').matchAll(/<script src="(\/[^"]+)"/g)) {
      if (!fs.existsSync(path.join(ROOT, src))) missing.push(path.relative(ROOT, file) + ' → ' + src);
    }
  }
  assert.deepStrictEqual(missing, []);
});
