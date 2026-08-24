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

test('화학 시뮬레이션 두 개가 드롭다운에 연결돼 있다', () => {
  /* 시뮬레이션을 만들어놓고 링크를 안 걸면 아무도 못 찾는다.
     드롭다운이 있는 모든 페이지에서 갈 수 있어야 한다. */
  const files = ['Index.html', 'community.html', 'guide.html', 'post.html',
                 'simulation/pendulum.html', 'simulation/electromagnetic-induction.html',
                 'simulation/particle-motion.html', 'simulation/chemical-bond.html'];
  for (const f of files) {
    const html = readRoot(f);
    assert.ok(/href="\/simulation\/particle-motion\.html"/.test(html),
      `${f} 에 입자의 운동 링크가 없다`);
    assert.ok(/href="\/simulation\/chemical-bond\.html"/.test(html),
      `${f} 에 화학 결합 링크가 없다`);
    // '준비 중' 으로 남아 있으면 안 된다
    assert.ok(!/<span class="soon">입자의 운동<\/span>/.test(html),
      `${f} 에서 입자의 운동이 아직 '준비 중' 이다`);
    assert.ok(!/<span class="soon">화학 결합<\/span>/.test(html),
      `${f} 에서 화학 결합이 아직 '준비 중' 이다`);
  }
});

test('새 시뮬레이션이 공용 스크립트를 읽는다', () => {
  // 하나라도 빠지면 그 페이지만 네비게이션·테마가 죽는다(전에 실제로 겪었다)
  for (const f of ['simulation/particle-motion.html', 'simulation/chemical-bond.html']) {
    const html = readRoot(f);
    for (const js of ['theme.js', 'session.js', 'nav-user.js', 'nav-dropdown.js', 'mobile-menu.js']) {
      assert.ok(html.includes(js), `${f} 가 ${js} 를 안 읽는다`);
    }
    assert.ok(/id="mobile-menu"/.test(html), `${f} 에 모바일 메뉴가 없다`);
  }
});

test('시뮬레이션 캔버스가 테마와 무관하게 같은 그림을 그린다', () => {
  /* 무대는 --stage-bg 로 항상 어둡고 캔버스는 흰 계열로 그린다.
     기존 두 시뮬레이션과 같은 규칙이다 — 캔버스 색을 토큰에서 읽어오게
     만들면 다크/라이트에서 대비가 뒤집혀 한쪽이 안 보인다. */
  for (const f of ['simulation/particle-motion.html', 'simulation/chemical-bond.html']) {
    const html = readRoot(f);
    assert.ok(/background: var\(--stage-bg\)/.test(html),
      `${f} 의 무대가 --stage-bg 를 써야 한다`);
  }
});

test('시뮬레이션 상세 페이지에서도 드롭다운이 열린다', () => {
  /* 이 두 페이지만 nav-dropdown.js 를 안 읽고 있었다. 드롭다운 마크업도 없어서
     과목을 누르면 그냥 /simulation/ 로 이동해버렸다 — "안 열리고 목록으로 튄다". */
  for (const f of ['simulation/pendulum.html', 'simulation/electromagnetic-induction.html']) {
    const html = readRoot(f);
    assert.ok(/nav-dropdown\.js/.test(html), `${f} 가 nav-dropdown.js 를 읽어야 한다`);
    assert.ok(/data-dropdown="physics"/.test(html), `${f} 에 드롭다운 마크업이 있어야 한다`);
    // 트리거가 실제 경로면 드롭다운이 열리기 전에 이동해버린다
    assert.ok(/<a href="#" data-dropdown="physics">/.test(html),
      `${f} 의 드롭다운 트리거는 href="#" 이어야 한다`);
  }
});

test('안 쓰는 시뮬레이션 목록 페이지로 가는 링크가 없다', () => {
  const files = ['Index.html', 'community.html', 'guide.html', 'post.html',
                 'science.html', 'settings.html', 'admin.html', 'terms.html', 'privacy.html',
                 'simulation/index.html', 'simulation/pendulum.html',
                 'simulation/electromagnetic-induction.html'];
  for (const f of files) {
    const html = readRoot(f);
    assert.ok(!/href="\/simulation\/"/.test(html),
      `${f} 에 /simulation/ 링크가 남아 있다 — 안 쓰기로 한 페이지다`);
  }
});

test('목록 페이지를 지웠어도 시뮬레이션에 갈 수 있다', () => {
  // 목록을 없앤 대신 실제 실험으로 직접 가야 한다. 길이 끊기면 안 된다.
  for (const f of ['Index.html', 'community.html', 'science.html',
                   'simulation/pendulum.html', 'simulation/electromagnetic-induction.html']) {
    const html = readRoot(f);
    assert.ok(/href="\/simulation\/(pendulum|electromagnetic-induction)\.html"/.test(html),
      `${f} 에서 시뮬레이션으로 갈 길이 없다`);
  }
});

test('목록 페이지는 검색에 노출되지 않는다', () => {
  const html = readRoot('simulation/index.html');
  assert.ok(/name="robots" content="noindex/.test(html),
    '링크를 다 지웠어도 검색 결과로는 들어올 수 있다 — noindex 가 필요하다');
});

test('약관 동의는 로그인 화면에서 먼저 받는다', () => {
  /* 소셜 로그인은 누르는 순간 외부 제공자로 넘어가 되돌릴 수 없다.
     동의를 그 뒤에 받으면 "계정이 만들어진 뒤에 묻는" 꼴이 된다. */
  const html = readRoot('login.html');
  assert.ok(/id="agree"/.test(html), '로그인 화면에 동의 체크박스가 있어야 한다');
  assert.ok(/href="\/terms"/.test(html) && /href="\/privacy"/.test(html),
    '두 문서로 가는 링크가 있어야 한다');

  // 체크박스가 OAuth 버튼보다 뒤(아래)에 와야 한다 — 사용자가 요청한 배치
  assert.ok(html.indexOf('class="providers"') < html.indexOf('class="auth-agree"'),
    '동의는 로그인 버튼 아래에 둔다');

  // 동의 없이 누르면 이동하지 않아야 한다
  assert.ok(/if \(!agree\.checked\)[\s\S]{0,300}return;/.test(html),
    '미동의 상태에서 로그인 시작을 막아야 한다');
});

test('로그인 버튼을 비활성으로 두지 않는다', () => {
  /* disabled 로 막으면 왜 안 눌리는지 알 수 없다. 누르게 두고 이유를 보여준다. */
  const html = readRoot('login.html');
  const guard = html.slice(html.indexOf("if (!agree.checked)"));
  assert.ok(/notice\.textContent/.test(guard.slice(0, 400)),
    '막을 때 이유를 화면에 알려야 한다');
});

test('프로필 화면은 약관을 다시 묻지 않는다', () => {
  // 로그인 화면에서 이미 받았다. 또 물으면 두 번 묻는 꼴이다.
  const html = readRoot('welcome.html');
  assert.ok(!/type="checkbox"/.test(html),
    '/welcome 에 동의 체크박스가 남아 있으면 안 된다');
  assert.ok(/w-agreed/.test(html), '동의한 문서 링크는 남겨야 한다');
});

test('이름·생일은 건너뛸 수 있다', () => {
  const html = readRoot('welcome.html');
  assert.ok(/id="w-skip"/.test(html), '건너뛰기 경로가 있어야 한다');
  // 건너뛰면 빈 값으로 제출돼야 한다 — 그래야 가입은 끝난다
  const skip = html.slice(html.indexOf("el('w-skip')"));
  assert.ok(/value = ''/.test(skip.slice(0, 400)), '건너뛰면 빈 값으로 제출해야 한다');
});

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
