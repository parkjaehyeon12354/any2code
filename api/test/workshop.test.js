/* 커스텀 창작마당 — 선생님이 AI 로 만든 HTML 을 올리고, 누구나 사이트 안에서 실행한다.
   (1) 올리는 사람은 티처 요금제와 관리자뿐이다(서버가 판정 — 화면의 버튼은 편의일 뿐),
   (2) HTML 은 200KB 까지. 목록은 HTML 을 읽지도 싣지도 않고, 실행 화면이 하나씩 받는다. 작성자 sub 는 안 나간다,
   (3) 올린 HTML 은 격리 칸(sandbox, allow-same-origin 없음)에서만 돈다 — 그게 이 기능의 보안 전부라 문자열로 못 박는다,
   (4) 지우기는 올린 사람과 관리자만, 계정을 지우면 자료도 지워진다. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

process.env.SESSION_SECRET = 's'.repeat(48);
process.env.ADMIN_EMAILS = 'boss@example.com';

const azPath = require.resolve('@azure/functions');
const routes = {};
require.cache[azPath] = {
  id: azPath, filename: azPath, loaded: true,
  exports: { app: { http: (name, cfg) => { routes[name] = cfg; } } }
};
require('../src/functions/workshop.js');

const session = require('../src/lib/session');
const credit = require('../src/lib/credit');
const profile = require('../src/lib/profile');
const db = require('../src/lib/db');
const { createFake } = require('./fake-container');
const { fake, state } = createFake();
db._setContainer(fake);
const queries = [];
const realQuery = fake.items.query;
fake.items.query = (spec) => { queries.push(spec.query); return realQuery(spec); };

const ROOT = path.join(__dirname, '../..');
const cookieFor = (sub, email = sub + '@example.com') => {
  const c = session.issue({ sub, name: '이름' + sub.slice(-1), email, provider: 'google' });
  return `${c.name}=${encodeURIComponent(c.value)}`;
};
const call = (name, { cookie = null, body, query = '', id } = {}) => routes[name].handler({
  url: 'https://ans2quest.com/api/workshop' + query,
  params: { id },
  headers: { get: (k) => ({ cookie, 'content-length': '100' }[k.toLowerCase()] ?? null) },
  json: async () => body
}, { error: () => {}, warn: () => {}, log: () => {} });

const teacher = (sub) => state.docs.push({ id: credit.docId(sub), type: 'credit', pk: sub, plan: 'teacher', planUntil: '2999-01-01T00:00:00.000Z' });
teacher('google:t1');
teacher('google:t2');
state.docs.push({ id: credit.docId('google:old'), type: 'credit', pk: 'google:old', plan: 'teacher', planUntil: '2000-01-01T00:00:00.000Z' });
const T1 = cookieFor('google:t1'), T2 = cookieFor('google:t2'), BOSS = cookieFor('google:boss', 'boss@example.com');
const up = (cookie, body) => call('workshopCreate', { cookie, body });
const HTML = '<!DOCTYPE html><html><head><title>진자</title></head><body><canvas></canvas><script>let t = 0;</script></body></html>';

test('티처 요금제와 관리자만 올린다 — 학생·기간 지난 티처 403, 비로그인 401', async () => {
  const body = { kind: 'simulation', title: '달에서의 단진자', html: HTML };
  assert.strictEqual((await up(null, body)).status, 401);
  assert.strictEqual((await up(cookieFor('google:kid'), body)).status, 403);
  assert.strictEqual((await up(cookieFor('google:old'), body)).status, 403, '요금제 기간이 지나면 선생님이 아니다');
  assert.strictEqual(state.docs.filter((d) => d.type === 'workshop').length, 0);

  const t = await up(T1, body);
  assert.strictEqual(t.status, 201, JSON.stringify(t.jsonBody));
  assert.strictEqual(t.jsonBody.item.role, 'teacher');
  const a = await up(BOSS, { ...body, kind: 'report', title: '관리자 자료' });
  assert.strictEqual(a.jsonBody.item.role, 'admin', '요금제가 없어도 관리자는 올린다');
});

test('HTML 은 있어야 하고 200KB 까지다 — 한글은 바이트로 센다', async () => {
  for (const html of ['', '   ', null, { x: 1 }]) {
    assert.strictEqual((await up(T1, { kind: 'etc', title: '빈 것', html })).status, 400, `막혀야 한다: ${JSON.stringify(html)}`);
  }
  const edge = '<p>' + 'a'.repeat(200 * 1024 - 7) + '</p>';
  assert.strictEqual(Buffer.byteLength(edge), 200 * 1024);
  assert.strictEqual((await up(T1, { kind: 'etc', title: '딱 200KB', html: edge })).status, 201);
  const hangul = '가'.repeat(70 * 1024);   // 글자 수는 70K, 바이트는 210KB
  const res = await up(T1, { kind: 'etc', title: '한글', html: hangul });
  assert.strictEqual(res.status, 400);
  assert.match(res.jsonBody.error, /200KB/);
});

test('목록은 HTML 을 읽지도 싣지도 않고, 실행 화면은 하나를 HTML 째로 받는다', async () => {
  const made = (await up(T1, { kind: 'inquiry', title: '효소 실험 설계 도구', desc: '온도별', html: HTML })).jsonBody.item;
  queries.length = 0;
  await call('workshopList', {});
  const list = (await call('workshopList', { query: '?kind=inquiry' })).jsonBody;
  assert.strictEqual(queries.filter((q) => /c\.type = 'workshop'/.test(q)).length, 2);
  // 가짜 컨테이너는 SQL 을 해석하지 않는다 — 예약어를 필드로 쓰면 여기선 통과하고 실서버에서만 실패한다(c.desc 가 그랬다)
  const RESERVED = /\bc\.(desc|asc|order|by|value|select|from|where|top|limit|offset|in|join|group|between|like|not|and|or|is|as|case|when|then|else|end|exists|set|on|left|right|inner|cross|distinct|having|escape|udf|undefined|null|true|false|array|cast|convert|insert|into|update|with|over|for|outer)\b/i;
  assert.ok(queries.every((q) => !RESERVED.test(q)), '예약어를 c.필드 로 썼다: ' + queries.find((q) => RESERVED.test(q)));
  assert.ok(queries.every((q) => !/SELECT \*/.test(q) && !/c\.html/.test(q)), '목록 쿼리가 HTML 을 읽으면 한 번에 RU 를 크게 먹는다: ' + queries);
  const item = list.items.find((i) => i.id === made.id);
  assert.strictEqual(item.html, undefined);
  assert.strictEqual(item.size, Buffer.byteLength(HTML));
  assert.ok(!JSON.stringify(list).includes('google:'), '작성자 sub 가 새면 안 된다');

  const one = await call('workshopGet', { id: made.id });
  assert.strictEqual(one.jsonBody.item.html, HTML);
  assert.ok(!JSON.stringify(one.jsonBody).includes('google:'));
  assert.strictEqual((await call('workshopGet', { id: 'w_none' })).status, 404);
  // 다른 문서 종류를 id 로 집어 오지 못한다
  assert.strictEqual((await call('workshopGet', { id: credit.docId('google:t1') })).status, 404);
});

test('목록 — 종류로 거르고, 최신순이며, 올릴 수 있는지 알려준다', async () => {
  const all = (await call('workshopList', {})).jsonBody;
  assert.ok(all.items.length >= 4);
  assert.ok(all.items.every((x, i) => i === 0 || all.items[i - 1].createdAt >= x.createdAt), '최신순');
  const sims = (await call('workshopList', { query: '?kind=simulation' })).jsonBody.items;
  assert.ok(sims.length && sims.every((x) => x.kind === 'simulation'));
  assert.strictEqual((await call('workshopList', { query: '?kind=bogus' })).jsonBody.items.length, all.items.length, '모르는 종류는 전체');
  assert.deepStrictEqual(
    [await call('workshopList', {}), await call('workshopList', { cookie: cookieFor('google:kid') }),
      await call('workshopList', { cookie: T1 }), await call('workshopList', { cookie: BOSS })].map((r) => r.jsonBody.canUpload),
    [false, false, true, true]);
});

test('지우기는 올린 사람과 관리자만', async () => {
  const mine = (await up(T1, { kind: 'etc', title: '지울 자료', html: HTML })).jsonBody.item;
  assert.strictEqual((await call('workshopDelete', { cookie: T2, id: mine.id })).status, 403, '다른 선생님은 못 지운다');
  assert.strictEqual((await call('workshopDelete', { id: mine.id })).status, 401);
  assert.strictEqual((await call('workshopDelete', { cookie: T1, id: mine.id })).status, 204);
  assert.strictEqual((await call('workshopDelete', { cookie: T1, id: mine.id })).status, 404);

  const other = (await up(T2, { kind: 'etc', title: '관리자가 지울 자료', html: HTML })).jsonBody.item;
  const seen = (await call('workshopGet', { cookie: BOSS, id: other.id })).jsonBody.item;
  assert.deepStrictEqual([seen.mine, seen.canDelete], [false, true]);
  assert.strictEqual((await call('workshopDelete', { cookie: BOSS, id: other.id })).status, 204);
});

const jpeg = (n) => 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n - 4, 7)]).toString('base64');
const thumbs = () => state.docs.filter((d) => d.type === 'workshopThumb');

test('대표 이미지 — JPEG 만 64KB 까지, 따로 두고 목록엔 있다는 표시만, 지우면 같이 지운다', async () => {
  const before = [state.docs.filter((d) => d.type === 'workshop').length, thumbs().length];
  const svg = 'data:image/jpeg;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>').toString('base64');
  for (const thumb of [svg, 'data:image/png;base64,' + jpeg(100).split(',')[1], 'data:image/jpeg;base64,@@@', jpeg(64 * 1024 + 1), { x: 1 }, 'data:image/jpeg;base64,']) {
    const r = await up(T1, { kind: 'etc', title: '이미지', html: HTML, thumb });
    assert.strictEqual(r.status, 400, `막혀야 한다: ${String(thumb).slice(0, 40)}`);
  }
  assert.match((await up(T1, { kind: 'etc', title: '이미지', html: HTML, thumb: jpeg(64 * 1024 + 1) })).jsonBody.error, /64KB/);
  assert.deepStrictEqual([state.docs.filter((d) => d.type === 'workshop').length, thumbs().length], before, '막힌 요청은 아무것도 남기지 않는다');

  const withImg = (await up(T1, { kind: 'simulation', title: '그림 있는 자료', html: HTML, thumb: jpeg(64 * 1024) })).jsonBody.item;
  const plain = (await up(T1, { kind: 'simulation', title: '그림 없는 자료', html: HTML, thumb: '' })).jsonBody.item;
  assert.deepStrictEqual([withImg.thumb, plain.thumb], [true, false]);

  queries.length = 0;
  const list = await call('workshopList', {});
  assert.ok(queries.every((q) => !/c\.data|workshopThumb/.test(q)), '목록이 이미지를 읽으면 안 된다: ' + queries);
  assert.ok(JSON.stringify(list.jsonBody).length < 20000, '목록에 이미지 데이터가 실렸다');
  assert.deepStrictEqual(['그림 있는 자료', '그림 없는 자료'].map((t) => list.jsonBody.items.find((i) => i.title === t).thumb), [true, false]);

  const img = await call('workshopThumb', { id: withImg.id });
  assert.strictEqual(img.status, undefined);
  assert.strictEqual(img.headers['Content-Type'], 'image/jpeg');
  assert.strictEqual(img.headers['X-Content-Type-Options'], 'nosniff');
  assert.ok(Buffer.isBuffer(img.body) && img.body.equals(Buffer.from(jpeg(64 * 1024).split(',')[1], 'base64')));
  assert.strictEqual((await call('workshopThumb', { id: plain.id })).status, 404);
  assert.strictEqual((await call('workshopThumb', { id: 'w_none' })).status, 404);

  assert.strictEqual((await call('workshopDelete', { cookie: T1, id: withImg.id })).status, 204);
  assert.strictEqual(thumbs().filter((d) => d.id === 'thumb:' + withImg.id).length, 0, '자료를 지우면 이미지도 지운다');
  assert.strictEqual((await call('workshopThumb', { id: withImg.id })).status, 404);
});

test('계정을 지우면 올린 자료도 지워지고, 이름을 바꾸면 작성자명도 바뀐다', async () => {
  await up(T2, { kind: 'etc', title: '남은 자료', html: HTML });
  const pic = (await up(T2, { kind: 'etc', title: '그림 있는 남은 자료', html: HTML, thumb: jpeg(2000) })).jsonBody.item;
  assert.strictEqual(thumbs().filter((d) => d.id === 'thumb:' + pic.id).length, 1);
  await profile.save({ sub: 'google:t2', name: '이름2', email: 'google:t2@example.com' }, { name: '새이름' });
  assert.ok(state.docs.filter((d) => d.type === 'workshop' && d.authorSub === 'google:t2').every((d) => d.authorName === '새이름'));
  await profile.purge('google:t2');
  assert.strictEqual(state.docs.filter((d) => d.type === 'workshop' && d.authorSub === 'google:t2').length, 0);
  assert.strictEqual(thumbs().filter((d) => d.id === 'thumb:' + pic.id).length, 0, '대표 이미지도 지운다');
  assert.ok(state.docs.some((d) => d.type === 'workshop' && d.authorSub === 'google:t1'), '다른 사람 자료는 그대로');
});

test('올린 HTML 은 사이트와 격리된 칸에서만 돈다', () => {
  /* allow-same-origin 이 들어가면 올린 HTML 이 ans2quest.com 출처로 돌아 보는 사람의 세션으로 API 를 부른다.
     팝업·상단 이동을 주면 사이트 밖(피싱)으로 끌고 나갈 수 있다. */
  const src = fs.readFileSync(path.join(ROOT, 'assets/js/workshop-frame.js'), 'utf8');
  const sandbox = src.match(/const SANDBOX = '([^']+)'/)[1].split(/\s+/);
  for (const bad of ['allow-same-origin', 'allow-top-navigation', 'allow-top-navigation-by-user-activation', 'allow-popups', 'allow-popups-to-escape-sandbox']) {
    assert.ok(!sandbox.includes(bad), `sandbox 에 ${bad} 가 있으면 안 된다`);
  }
  assert.ok(sandbox.includes('allow-scripts'), '스크립트가 안 돌면 시뮬레이션이 안 된다');
  assert.match(src, /setAttribute\('sandbox', SANDBOX\)/);
  assert.match(src, /\.srcdoc = /, 'HTML 은 srcdoc 로만 넣는다 — blob:/새 창은 우리 출처로 열린다');
  assert.doesNotMatch(src, /createObjectURL|window\.open|\.innerHTML/);

  // 올린 HTML 을 다루는 두 화면만 cdnjs · jsdelivr 를 허용하고, 외부로 보내는 연결은 막는다. 나머지 사이트는 그대로
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'staticwebapp.config.json'), 'utf8'));
  for (const route of ['/custom', '/custom/view']) {
    const r = cfg.routes.find((x) => x.route === route);
    const csp = r && r.headers && r.headers['Content-Security-Policy'];
    assert.ok(csp, `${route} 에 CSP 가 없다`);
    assert.match(csp, /script-src 'self' 'unsafe-inline' https:\/\/cdnjs\.cloudflare\.com https:\/\/cdn\.jsdelivr\.net;/);
    assert.match(csp, /connect-src 'self' https:\/\/cdn\.jsdelivr\.net https:\/\/cdnjs\.cloudflare\.com;/);
    assert.match(csp, /form-action 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.doesNotMatch(csp, /unsafe-eval|script-src[^;]*https:(?!\/\/)/);
  }
  assert.doesNotMatch(cfg.globalHeaders['Content-Security-Policy'], /cdnjs|script-src[^;]*jsdelivr/, '다른 화면의 스크립트 정책은 넓히지 않는다');
  // 대표 이미지는 캐시한다 — 규칙은 처음 맞는 것 하나만 쓰이니 /api/* (no-store) 보다 앞이어야 한다
  const at = (route) => cfg.routes.findIndex((x) => x.route === route);
  assert.ok(at('/api/workshop-thumb/*') >= 0 && at('/api/workshop-thumb/*') < at('/api/*'), '/api/workshop-thumb/* 규칙이 /api/* 앞에 없다');
  assert.match(cfg.routes[at('/api/workshop-thumb/*')].headers['Cache-Control'], /max-age=\d{5,}/);
  for (const page of ['custom.html', 'custom-view.html']) {
    assert.match(fs.readFileSync(path.join(ROOT, page), 'utf8'), /<script src="\/assets\/js\/workshop-frame\.js"><\/script>/);
  }
});

test('종류 목록이 서버 · 필터 · 올리기 폼 · 카드 그림 · 이름표 · 모든 헤더에서 같다', async () => {
  /* 종류는 여섯 군데에 따로 적혀 있다. 한 곳만 빠지면 조용히 어긋난다 — 헤더 링크로 왔는데 필터에 없거나,
     올린 자료가 어느 필터에도 안 걸려 목록에서 사라지거나, 카드 그림이 비거나 */
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const KINDS = [...read('api/src/functions/workshop.js').match(/const KINDS = \[([^\]]+)\]/)[1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
  assert.deepStrictEqual(KINDS, ['report', 'simulation', 'inquiry', 'game', 'quiz', 'etc']);
  for (const kind of ['game', 'quiz']) assert.strictEqual((await up(T1, { kind, title: kind + ' 자료', html: HTML })).status, 201);

  const page = read('custom.html');
  const order = (re) => [...page.matchAll(re)].map((m) => m[1]);
  assert.deepStrictEqual(order(/<input type="checkbox" value="(\w+)"/g), KINDS, '종류 필터');
  const form = page.match(/<select id="up-kind">[\s\S]*?<\/select>/)[0];
  assert.deepStrictEqual([...form.matchAll(/<option value="(\w+)">/g)].map((m) => m[1]), KINDS, '올리기 폼');
  for (const k of KINDS) {
    assert.match(page, new RegExp(`<symbol id="g-${k}"`), `카드 기본 그림 g-${k}`);
    assert.match(page, new RegExp(`\.k-${k} \{ --k: #`), `종류 색 .k-${k}`);
  }
  for (const f of ['assets/js/custom-workshop.js', 'assets/js/custom-view.js']) {
    const labels = read(f).match(/const KIND_LABEL = \{([^}]+)\}/)[1];
    assert.deepStrictEqual([...labels.matchAll(/(\w+):/g)].map((m) => m[1]), KINDS, f);
  }
  const pages = fs.readdirSync(ROOT, { recursive: true }).filter((f) => f.endsWith('.html') && !/node_modules|^api[\/]/.test(f));
  const withMenu = pages.filter((f) => read(f).includes('/custom?kind='));
  assert.ok(withMenu.length >= 29, '헤더 드롭다운이 있는 페이지 ' + withMenu.length);
  for (const f of withMenu) {
    assert.deepStrictEqual([...read(f).matchAll(/href="\/custom\?kind=(\w+)"/g)].map((m) => m[1]), KINDS, f + ' 헤더의 「종류별로 보기」');
  }
});

const like = (cookie, id) => call('workshopLike', { cookie, id });
const likes = () => state.docs.filter((d) => d.type === 'workshopLike');

test('추천 — 로그인한 누구나 한 번, 다시 누르면 취소, 내 자료는 못 하고, 자료를 지우면 같이 지운다', async () => {
  const KID = cookieFor('google:kid');
  const it = (await up(T1, { kind: 'simulation', title: '추천 받을 자료', html: HTML })).jsonBody.item;
  assert.deepStrictEqual([it.likes, it.liked], [0, false]);
  assert.strictEqual((await like(null, it.id)).status, 401);
  assert.strictEqual((await like(T1, it.id)).status, 403, '올린 사람은 자기 자료를 추천하지 못한다');
  assert.strictEqual((await like(KID, 'w_none')).status, 404);
  assert.strictEqual((await like(KID, credit.docId('google:t1'))).status, 404, '다른 종류의 문서는 추천 대상이 아니다');
  assert.deepStrictEqual((await like(KID, it.id)).jsonBody, { liked: true, likes: 1 }, '학생도 추천한다');
  assert.deepStrictEqual((await like(T2, it.id)).jsonBody, { liked: true, likes: 2 });
  assert.deepStrictEqual((await like(KID, it.id)).jsonBody, { liked: false, likes: 1 }, '다시 누르면 취소');
  assert.deepStrictEqual((await like(KID, it.id)).jsonBody, { liked: true, likes: 2 });
  assert.strictEqual(likes().filter((l) => l.wid === it.id).length, 2, '한 사람 한 문서');

  // 목록 · 실행 화면이 수와 「내가 눌렀나」를 보는 사람마다 준다 — 누른 사람의 sub 는 내보내지 않는다
  const seen = async (cookie) => (await call('workshopList', { cookie })).jsonBody.items.find((x) => x.id === it.id);
  assert.deepStrictEqual([(await seen(KID)).likes, (await seen(KID)).liked, (await seen(T1)).liked, (await seen(null)).liked], [2, true, false, false]);
  const one = (await call('workshopGet', { cookie: T2, id: it.id })).jsonBody.item;
  assert.deepStrictEqual([one.likes, one.liked], [2, true]);
  assert.ok(!JSON.stringify((await call('workshopList', { cookie: KID })).jsonBody).includes('google:'), '추천한 사람의 sub 가 새면 안 된다');

  // 자료를 지우면 추천도 — 남기면 목록이 매번 헛읽는다
  assert.strictEqual((await call('workshopDelete', { cookie: T1, id: it.id })).status, 204);
  assert.strictEqual(likes().filter((l) => l.wid === it.id).length, 0);
});

test('추천 — 탈퇴하면 그 사람이 누른 추천과 그 사람 자료에 달린 추천이 지워진다 · 분당 한도', async () => {
  teacher('google:t3');
  const T3 = cookieFor('google:t3'), FAN = cookieFor('google:fan');
  const a = (await up(T3, { kind: 'etc', title: 't3 가 올린 자료', html: HTML })).jsonBody.item;
  const b = (await up(T1, { kind: 'etc', title: 't1 이 올린 자료', html: HTML })).jsonBody.item;
  await like(FAN, a.id); await like(T3, b.id); await like(FAN, b.id);
  await profile.purge('google:t3');
  assert.strictEqual(likes().filter((l) => l.wid === a.id).length, 0, '떠난 사람 자료에 달린 추천');
  assert.deepStrictEqual(likes().filter((l) => l.wid === b.id).map((l) => l.userSub), ['google:fan'], '떠난 사람이 누른 추천만 지우고 남의 것은 둔다');

  const SPAM = cookieFor('google:spam');
  const codes = [];
  for (let i = 0; i < 31; i++) codes.push((await like(SPAM, b.id)).status || 200);
  assert.deepStrictEqual([codes[29], codes[30]], [200, 429], '분당 30번까지');
});
