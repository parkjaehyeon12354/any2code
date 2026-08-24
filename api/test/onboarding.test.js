/* 가입 절차(약관 동의) —
   로그인 쿠키가 있다고 가입이 끝난 게 아니다. 약관 동의까지 받아야 한다.
   이 검사가 무너지면 동의 없이 서비스를 쓸 수 있게 되므로, 우회 경로를
   하나씩 막았는지 확인한다. */
process.env.SESSION_SECRET = 'test-secret-for-onboarding';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const readRoot = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

test('동의는 명시적이어야 한다 — 기본값으로 통과하지 않는다', () => {
  const src = read('src/functions/profile.js');
  assert.ok(/body\.agree !== true/.test(src),
    'agree === true 를 확인해야 한다. truthy 검사면 문자열 "false" 도 통과한다');
  assert.ok(/status: 400/.test(src.slice(src.indexOf('agree !== true'))),
    '동의 없으면 400 이어야 한다');
});

test('약관 동의는 이름 변경 제한에 걸리지 않는다', () => {
  /* save() 는 이름 변경에 1분 제한을 건다. 가입 첫 화면의 이름 입력은 '변경'이
     아니라 최초 입력인데, save() 를 재사용하면 그 제한에 걸려 가입이 막힌다.
     실제로 그래서 별도 함수로 뒀다. */
  const src = read('src/lib/profile.js');
  const fn = src.slice(src.indexOf('async function acceptTerms'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.ok(!/RENAME_MIN_INTERVAL_MS/.test(body),
    'acceptTerms 는 이름 변경 제한을 적용하면 안 된다');
  assert.ok(!/renameOwnContent/.test(body),
    '가입 시점엔 옛 글이 없다 — 작성자명 갱신은 불필요하다');
});

test('이름과 생일은 선택이다', () => {
  const src = read('src/lib/profile.js');
  const fn = src.slice(src.indexOf('async function acceptTerms'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  // 빈 값이면 검증을 건너뛰어야 한다. 무조건 checkName 을 부르면 빈 이름이 400 이 된다.
  assert.ok(/rawName \? checkName\(rawName\) : null/.test(body),
    '이름이 비면 검증하지 않고 null 이어야 한다');
  assert.ok(/src\.birthday \? checkBirthday\(src\.birthday\) : null/.test(body),
    '생일이 비면 검증하지 않고 null 이어야 한다');
});

test('동의 시각을 남긴다 — boolean 이 아니라', () => {
  /* 약관이 바뀌면 그 시점보다 앞선 동의는 다시 받아야 한다.
     boolean 으로 두면 그 판단을 할 수 없다. */
  const src = read('src/lib/profile.js');
  assert.ok(/termsAcceptedAt: \(doc && doc\.termsAcceptedAt\) \|\| null/.test(src),
    'view 가 termsAcceptedAt 을 내보내야 한다');
  assert.ok(/path: '\/termsAcceptedAt', value: now/.test(src),
    '동의 시각을 기록해야 한다');
});

test('신규 문서는 미동의 상태로 만들어진다', () => {
  const src = read('src/lib/profile.js');
  const create = src.slice(src.indexOf('items.create({'), src.indexOf('lastLoginAt: now\n  });'));
  assert.ok(/termsAcceptedAt: null/.test(create),
    'ensure() 가 만드는 문서는 미동의여야 한다 — 로그인만으로 가입이 끝나면 안 된다');
});

test('콜백이 미동의 사용자를 가입 화면으로 보낸다', () => {
  const src = read('src/functions/auth.js');
  assert.ok(/\/welcome\?to=/.test(src), '콜백이 /welcome 으로 보내야 한다');
  // 원래 가려던 곳을 잃지 않아야 한다
  assert.ok(/encodeURIComponent\(target\)/.test(src),
    '돌아갈 경로를 ?to= 로 넘겨야 한다');
});

test('DB 실패가 기존 사용자를 가입 화면에 가두지 않는다', () => {
  /* profile.read 가 실패했다고 멀쩡한 기존 사용자를 가입 절차로 되돌리면,
     DB 가 흔들릴 때마다 전체 사용자가 갇힌다. */
  const auth = read('src/functions/auth.js');
  assert.ok(/let onboarded = true;/.test(auth),
    '/api/me 는 조회 실패 시 onboarded 를 true 로 둬야 한다');

  const cb = auth.slice(auth.indexOf('const target = session.stateTarget'));
  const guard = cb.slice(0, cb.indexOf('cookies:'));
  assert.ok(/catch \{[^}]*\}/.test(guard),
    '콜백의 온보딩 판정은 실패해도 통과시켜야 한다');
});

test('화면 가드는 캐시가 아니라 서버 응답을 믿는다', () => {
  /* sessionStorage 를 손대는 것만으로 가입 절차를 건너뛸 수 있으면 안 된다. */
  const src = readRoot('nav-user.js');
  assert.ok(/user && user\.onboarded === false/.test(src),
    'Session.refresh() 의 결과(user)로 판정해야 한다');
  assert.ok(!/drawn\.onboarded/.test(src),
    '캐시(drawn)로 판정하면 안 된다');
});

test('약관·정책 문서는 가드에서 제외된다', () => {
  // 동의하려면 읽을 수 있어야 한다. 여기서 되돌리면 무한 루프다.
  const src = readRoot('nav-user.js');
  const list = src.match(/var free = \[([^\]]+)\]/);
  assert.ok(list, '제외 목록이 있어야 한다');
  for (const p of ['/welcome', '/terms', '/privacy']) {
    assert.ok(list[1].includes(p), `${p} 는 제외돼야 한다`);
  }
});

test('가입 화면이 오픈 리다이렉트로 쓰이지 않는다', () => {
  const html = readRoot('welcome.html');
  const fn = html.slice(html.indexOf('function nextPath'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(/charAt\(0\) !== '\/'/.test(body), "'/' 로 시작하지 않으면 막아야 한다");
  assert.ok(/charAt\(1\) === '\/'/.test(body), "'//evil.com' 을 막아야 한다");
});

test('약관·정책 페이지에 라우팅이 걸려 있다', () => {
  const cfg = JSON.parse(readRoot('staticwebapp.config.json'));
  const routes = cfg.routes.map((r) => r.route);
  for (const r of ['/terms', '/privacy', '/welcome']) {
    assert.ok(routes.includes(r), `${r} 라우팅이 없다 — 404 가 난다`);
  }
});

test('약관과 정책 문서가 비어 있지 않다', () => {
  for (const f of ['terms.html', 'privacy.html']) {
    const html = readRoot(f);
    assert.ok(html.length > 3000, `${f} 가 너무 짧다`);
    // 링크가 서로를 가리켜야 한다
    assert.ok(/href="\/(terms|privacy)"/.test(html), `${f} 에 상호 링크가 없다`);
  }
});
