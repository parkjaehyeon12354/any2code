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
/* 저장소 루트의 프론트엔드 파일을 읽는다.

   ⚠ 경로를 그대로 붙이지 않고 후보를 순서대로 본다.

   파일이 옮겨지면 ENOENT 로 깨지기 때문이다. 실제로 겪었다 — assets/ 폴더로
   정리하면서 nav-user.js 를 참조하던 검사 두 개가 무너져 배포가 두 번 막혔다
   (32836034697, 32836870198). 정작 검사하려던 로직은 멀쩡했는데, 파일 위치만
   바뀌어도 빨간불이 켜지는 구조였다.

   테스트가 확인해야 할 것은 "파일이 어디 있는가" 가 아니라 "그 안의 로직이
   맞는가" 다. 그래서 이름으로 찾는다.

   다 없으면 그건 진짜 문제이므로 어디를 찾았는지 알려주며 실패한다. */
const ROOTS = ['', 'assets/js', 'assets/css', 'assets', 'pages'];

function readRoot(name) {
  // 경로가 붙어 있으면(simulation/index.html) 그대로도 한 번 본다
  for (const r of ROOTS) {
    const full = path.join(__dirname, '../..', r, name);
    if (fs.existsSync(full)) return fs.readFileSync(full, 'utf8');
  }
  // 폴더가 바뀐 경우 — 파일 이름만 떼어 다시 찾는다
  const base = path.basename(name);
  if (base !== name) {
    for (const r of ROOTS) {
      const full = path.join(__dirname, '../..', r, base);
      if (fs.existsSync(full)) return fs.readFileSync(full, 'utf8');
    }
  }
  throw new Error(
    `${name} 를 찾을 수 없습니다. 찾아본 곳: ` +
    ROOTS.map((r) => r || '(루트)').join(', ')
  );
}


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
  /* 무대는 --surface-dark 로 항상 어둡고 캔버스는 흰 계열로 그린다.
     기존 두 시뮬레이션과 같은 규칙이다 — 캔버스 색을 토큰에서 읽어오게
     만들면 다크/라이트에서 대비가 뒤집혀 한쪽이 안 보인다. */
  for (const f of ['simulation/particle-motion.html', 'simulation/chemical-bond.html']) {
    const html = readRoot(f);
    assert.ok(/background: var\(--surface-dark\)/.test(html),
      `${f} 의 무대가 --surface-dark 를 써야 한다`);
  }
});

test('생명과학 시뮬레이션 두 개가 드롭다운에 연결돼 있다', () => {
  const files = ['Index.html', 'community.html', 'guide.html', 'post.html',
                 'simulation/pendulum.html', 'simulation/electromagnetic-induction.html',
                 'simulation/particle-motion.html', 'simulation/chemical-bond.html',
                 'simulation/cell-structure.html', 'simulation/genetics-evolution.html'];
  for (const f of files) {
    const html = readRoot(f);
    assert.ok(/href="\/simulation\/cell-structure\.html"/.test(html),
      `${f} 에 세포의 구조 링크가 없다`);
    assert.ok(/href="\/simulation\/genetics-evolution\.html"/.test(html),
      `${f} 에 유전과 진화 링크가 없다`);
    assert.ok(!/<span class="soon">세포의 구조<\/span>/.test(html),
      `${f} 에서 세포의 구조가 아직 '준비 중' 이다`);
    assert.ok(!/<span class="soon">유전과 진화<\/span>/.test(html),
      `${f} 에서 유전과 진화가 아직 '준비 중' 이다`);
  }
});

test('생명과학 시뮬레이션이 공용 스크립트를 읽는다', () => {
  for (const f of ['simulation/cell-structure.html', 'simulation/genetics-evolution.html']) {
    const html = readRoot(f);
    for (const js of ['theme.js', 'session.js', 'nav-user.js', 'nav-dropdown.js', 'mobile-menu.js']) {
      assert.ok(html.includes(js), `${f} 가 ${js} 를 안 읽는다`);
    }
    assert.ok(/id="mobile-menu"/.test(html), `${f} 에 모바일 메뉴가 없다`);
    assert.ok(/background: var\(--surface-dark\)/.test(html),
      `${f} 의 무대가 --surface-dark 를 써야 한다`);
  }
});

test('유전 시뮬레이션의 교배 계산이 멘델 법칙과 맞는다', () => {
  /* 이 화면의 존재 이유다. 계산이 틀리면 학생이 틀린 걸 배운다.
     punnettCells 를 꺼내 직접 돌려본다. */
  const html = readRoot('simulation/genetics-evolution.html');
  const m = html.match(/function punnettCells\(\)[\s\S]*?\n  \}/);
  assert.ok(m, 'punnettCells 를 찾을 수 없다');

  const fn = new Function('S', m[0] + '; return punnettCells();');
  const tally = (a, b) => {
    const out = fn({ parents: [a, b] });
    const c = { BB: 0, Bb: 0, bb: 0 };
    out.forEach((g) => c[g]++);
    return c;
  };

  // Bb × Bb → 1:2:1, 겉모습 3:1 (교과서의 대표 사례)
  let c = tally('Bb', 'Bb');
  assert.deepStrictEqual(c, { BB: 1, Bb: 2, bb: 1 }, 'Bb × Bb 는 1:2:1 이어야 한다');
  assert.strictEqual(c.BB + c.Bb, 3, '겉모습은 검정 3 : 흰색 1');

  // BB × bb → 전부 Bb (잡종 1대가 모두 우성)
  c = tally('BB', 'bb');
  assert.deepStrictEqual(c, { BB: 0, Bb: 4, bb: 0 }, 'BB × bb 는 전부 Bb 여야 한다');

  // Bb × bb → 1:1 (검정 2 : 흰색 2). 검정을 3 으로 잘못 세면 안 된다
  c = tally('Bb', 'bb');
  assert.deepStrictEqual(c, { BB: 0, Bb: 2, bb: 2 }, 'Bb × bb 는 Bb 2 : bb 2 여야 한다');

  // bb × bb → 전부 bb (열성끼리는 우성이 나올 수 없다)
  c = tally('bb', 'bb');
  assert.deepStrictEqual(c, { BB: 0, Bb: 0, bb: 4 }, 'bb × bb 에서 검정이 나오면 안 된다');
});

test('지구과학 시뮬레이션 두 개가 드롭다운에 연결돼 있다', () => {
  const files = ['Index.html', 'community.html', 'guide.html', 'post.html',
                 'simulation/pendulum.html', 'simulation/particle-motion.html',
                 'simulation/cell-structure.html', 'simulation/plate-tectonics.html',
                 'simulation/earth-seasons.html'];
  for (const f of files) {
    const html = readRoot(f);
    assert.ok(/href="\/simulation\/plate-tectonics\.html"/.test(html),
      `${f} 에 판과 지각 변동 링크가 없다`);
    assert.ok(/href="\/simulation\/earth-seasons\.html"/.test(html),
      `${f} 에 외권과 천체 링크가 없다`);
    assert.ok(!/<span class="soon">판과 지각 변동<\/span>/.test(html),
      `${f} 에서 판과 지각 변동이 아직 '준비 중' 이다`);
    assert.ok(!/<span class="soon">외권과 천체<\/span>/.test(html),
      `${f} 에서 외권과 천체가 아직 '준비 중' 이다`);
  }
});

test('지구과학 시뮬레이션이 공용 스크립트를 읽는다', () => {
  for (const f of ['simulation/plate-tectonics.html', 'simulation/earth-seasons.html']) {
    const html = readRoot(f);
    for (const js of ['theme.js', 'session.js', 'nav-user.js', 'nav-dropdown.js', 'mobile-menu.js']) {
      assert.ok(html.includes(js), `${f} 가 ${js} 를 안 읽는다`);
    }
    assert.ok(/id="mobile-menu"/.test(html), `${f} 에 모바일 메뉴가 없다`);
    assert.ok(/background: var\(--surface-dark\)/.test(html),
      `${f} 의 무대가 --surface-dark 를 써야 한다`);
  }
});

test('계절 계산이 교과서 값과 맞는다', () => {
  /* 이 화면의 존재 이유는 "계절은 거리가 아니라 기울기 때문" 을 보이는 것이다.
     계산이 틀리면 오해를 바로잡기는커녕 새 오해를 만든다.
     실제 함수를 꺼내 서울의 교과서 값이 나오는지 확인한다. */
  const html = readRoot('simulation/earth-seasons.html');

  const grab = (name) => {
    const m = html.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n  \\}`));
    assert.ok(m, `${name} 를 찾을 수 없다`);
    return m[0];
  };

  // S(기울기)와 city(위도)를 주입해 실제 코드를 그대로 돌린다
  const make = (tilt, lat) => new Function('S', 'city', 'rad', 'deg', `
    ${grab('declination')}
    ${grab('noonAltitude')}
    ${grab('dayLength')}
    return { declination, noonAltitude, dayLength };
  `)({ tilt }, () => ({ lat }),
     (d) => d * Math.PI / 180, (r) => r * 180 / Math.PI);

  const seoul = make(23.5, 37.5);
  const near = (a, b, tol, msg) =>
    assert.ok(Math.abs(a - b) < tol, `${msg}: ${a.toFixed(2)} (기대 ${b}±${tol})`);

  // 서울 하지 76°, 동지 29°, 춘분 52.5° — 교과서에 그대로 나오는 값
  near(seoul.noonAltitude(172), 76.0, 0.5, '서울 하지 남중고도');
  near(seoul.noonAltitude(355), 29.0, 0.5, '서울 동지 남중고도');
  near(seoul.noonAltitude(79), 52.5, 0.5, '서울 춘분 남중고도');
  near(seoul.dayLength(79), 12.0, 0.3, '춘분 낮 길이');

  // 기울기 0 → 계절이 사라진다. 이 화면의 핵심 주장이다.
  const flat = make(0, 37.5);
  for (const day of [79, 172, 265, 355]) {
    near(flat.noonAltitude(day), 52.5, 0.1, `기울기 0 ${day}일 남중고도`);
    near(flat.dayLength(day), 12.0, 0.1, `기울기 0 ${day}일 낮 길이`);
  }

  // 남반구는 계절이 반대 — 시드니는 12월에 태양이 높다
  const sydney = make(23.5, -33.9);
  assert.ok(sydney.noonAltitude(355) > sydney.noonAltitude(172),
    '남반구는 12월(동지 날짜)에 태양이 더 높아야 한다');

  // 북극권 위쪽은 하지에 백야(24h)
  const arctic = make(23.5, 70);
  assert.strictEqual(arctic.dayLength(172), 24, '위도 70°는 하지에 백야여야 한다');
  assert.strictEqual(arctic.dayLength(355), 0, '위도 70°는 동지에 극야여야 한다');
});

test('판 경계 판정이 밀도 차이를 따른다', () => {
  /* "무거운 판이 밑으로 들어간다" 가 이 화면이 가르치려는 전부다.
     대륙끼리는 아무도 안 들어가고 솟아야 한다(히말라야). */
  const html = readRoot('simulation/plate-tectonics.html');
  const kinds = html.match(/const KINDS = \{[\s\S]*?\n  \};/);
  const subFn = html.match(/function subducting\(\)[\s\S]*?\n  \}/);
  assert.ok(kinds && subFn, 'KINDS 나 subducting 을 찾을 수 없다');

  const run = (left, right, bnd) => new Function('S', `
    ${kinds[0]}
    const L = () => KINDS[S.left], R = () => KINDS[S.right];
    ${subFn[0]}
    return subducting();
  `)({ left, right, bnd });

  // 해양판이 대륙판보다 무겁다 → 해양판이 들어간다
  assert.strictEqual(run('ocean', 'cont', 'convergent'), 'left', '해양판(왼쪽)이 들어가야 한다');
  assert.strictEqual(run('cont', 'ocean', 'convergent'), 'right', '해양판(오른쪽)이 들어가야 한다');
  /* 해양 + 해양도 섭입한다 — 나이가 많아 차갑고 무거워진 쪽이 들어간다(일본, 마리아나).

     ⚠ 예전에는 밀도가 같다고 null 을 돌려줘서 대륙충돌 그림이 그려졌다.
     그런데 landform() 은 "해구 + 호상 열도" 라고 말해서, 오른쪽 패널과
     화면이 정반대인 상태였다. 설명과 그림이 어긋나면 학생이 틀리게 배운다. */
  assert.ok(run('ocean', 'ocean', 'convergent') !== null,
    '해양판끼리도 섭입이 일어나야 한다(호상 열도)');
  // 대륙 + 대륙 → 아무도 안 들어간다. 솟아서 습곡 산맥이 된다.
  assert.strictEqual(run('cont', 'cont', 'convergent'), null, '대륙끼리는 섭입이 없어야 한다');
  // 발산·보존 경계에는 섭입이 없다
  assert.strictEqual(run('ocean', 'cont', 'divergent'), null, '발산 경계에 섭입이 있으면 안 된다');
  assert.strictEqual(run('ocean', 'cont', 'transform'), null, '보존 경계에 섭입이 있으면 안 된다');
});

test('판구조론 — 섭입 판정과 화면 지형 설명이 어긋나지 않는다', () => {
  /* 오른쪽 패널이 "해구" 라고 하는데 그림에는 해구가 없으면 학생이 혼란스럽다.
     실제로 그런 상태였다. 둘을 함께 꺼내 대조한다. */
  const html = readRoot('simulation/plate-tectonics.html');
  const kinds = html.match(/const KINDS = \{[\s\S]*?\n  \};/);
  const subFn = html.match(/function subducting\(\)[\s\S]*?\n  \}/);
  const landFn = html.match(/function landform\(\)[\s\S]*?\n  \}/);
  assert.ok(kinds && subFn && landFn, '필요한 함수를 찾을 수 없다');

  const run = (left, right) => new Function('S', `
    ${kinds[0]}
    const L = () => KINDS[S.left], R = () => KINDS[S.right];
    ${subFn[0]}
    ${landFn[0]}
    return { sub: subducting(), land: landform() };
  `)({ left, right, bnd: 'convergent' });

  for (const [l, r] of [['ocean', 'cont'], ['ocean', 'ocean'], ['cont', 'cont']]) {
    const { sub, land } = run(l, r);
    const saysTrench = land.name.includes('해구');
    assert.strictEqual(sub !== null, saysTrench,
      `${l}+${r}: 섭입=${sub} 인데 지형은 "${land.name}" — 그림과 설명이 어긋난다`);
    // 섭입이 있으면 진원이 깊어져야 한다(베니오프대)
    if (sub !== null) {
      assert.ok(land.depth.includes('700'),
        `${l}+${r}: 섭입대인데 지진 깊이가 "${land.depth}" 다`);
    }
  }
});

test('시뮬레이션 상세 페이지에서도 드롭다운이 열린다', () => {
  /* 이 두 페이지만 nav-dropdown.js 를 안 읽고 있었다. 드롭다운 마크업도 없어서
     과목을 누르면 그냥 /simulation/ 로 이동해버렸다 — "안 열리고 목록으로 튄다".
     지금은 과목 넷을 「시뮬레이션」 하나로 접고 그 안에 과목별 열로 넣었다.
     트리거가 /simulation/ 인 것은 의도한 것이다 — hover·focus 로 열리고,
     클릭하면 목록으로 간다(심화 탐구와 같은 방식). */
  for (const f of ['simulation/pendulum.html', 'simulation/electromagnetic-induction.html']) {
    const html = readRoot(f);
    assert.ok(/nav-dropdown\.js/.test(html), `${f} 가 nav-dropdown.js 를 읽어야 한다`);
    assert.ok(/data-dropdown="simulation"/.test(html), `${f} 에 드롭다운 마크업이 있어야 한다`);
    /* 과목 넷이 최상위에 남아 있으면 네비가 다시 다섯 갈래로 벌어진다. */
    for (const old of ['physics', 'chemistry', 'biology', 'earthscience']) {
      assert.ok(!new RegExp(`data-dropdown="${old}"`).test(html),
        `${f} 에 옛 과목 드롭다운(${old})이 남아 있다`);
    }
  }
});

test('시뮬레이션 목록 페이지로 가는 길이 있다', () => {
  /* 예전에는 "목록 페이지는 안 쓴다"며 링크가 없어야 통과하는 검사였다.
     그런데 파일은 계속 남아 라이브에서 200 이었고, 시뮬이 8개에서 21개로
     늘면서 과목별 드롭다운만으로는 전체를 한눈에 볼 곳이 없어졌다.
     목록을 되살렸으니 이제는 링크가 있어야 한다. */
  const files = ['Index.html', 'community.html', 'guide.html', 'post.html',
                 'simulation/index.html', 'simulation/pendulum.html',
                 'simulation/electromagnetic-induction.html'];
  for (const f of files) {
    const html = readRoot(f);
    assert.ok(/href="\/simulation\/"/.test(html),
      `${f} 에 시뮬레이션 목록 링크가 없다`);
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

test('로그인 화면은 순수 로그인만 한다', () => {
  /* 예전엔 소셜 로그인 버튼 아래에 약관 동의 체크박스가 있었다. 그런데 서버가
     신규 가입자를 어차피 /welcome 으로 보내 거기서 동의를 받으므로, 로그인
     화면의 체크박스는 화면 넛지일 뿐 실제 강제가 아니었다 — 이미 가입한
     사용자도 로그인마다 약관 링크를 보게 되는 게 자연스럽지 않다.
     로그인은 소셜 버튼만 누르면 바로 진행돼야 한다. */
  const html = readRoot('login.html');
  assert.ok(!/id="agree"/.test(html), '로그인 화면에 동의 체크박스가 남아 있으면 안 된다');
  assert.ok(!/class="auth-agree"/.test(html), '동의 블록 마크업이 남아 있으면 안 된다');
  assert.ok(!/if \(!agree\.checked\)/.test(html), '동의 체크 가드가 남아 있으면 안 된다');

  // 그렇다고 강제 자체가 사라진 건 아니다 — /welcome 이 대신 받는다는 걸 문서화한다
  const w = readRoot('welcome.html');
  assert.ok(/id="w-agree"/.test(w), '/welcome 에 실제 동의 체크박스가 있어야 한다');
});

test('회원가입(welcome)이 약관 동의를 실제로 강제한다', () => {
  /* 예전엔 /welcome 이 "동의는 로그인 화면에서 이미 받았다" 며 조용한
     안내문만 보여주고 agree: true 를 하드코딩해서 서버로 보냈다 — 로그인
     화면 체크박스를 없애면 아무 동의도 없이 서버가 '동의했다' 고 기록하게
     된다. 진짜 강제(termsAcceptedAt)가 이뤄지는 화면에 진짜 체크박스가
     있어야 한다. */
  const html = readRoot('welcome.html');
  assert.ok(/type="checkbox" id="w-agree"/.test(html), '체크박스가 있어야 한다');
  assert.ok(/href="\/terms"/.test(html) && /href="\/privacy"/.test(html),
    '두 문서로 가는 링크가 있어야 한다');

  // 미체크 상태에서 제출하면 서버로 안 나가야 한다
  const submit = html.slice(html.indexOf("form.addEventListener('submit'"));
  assert.ok(/if \(!agree\.checked\)[\s\S]{0,200}return;/.test(submit.slice(0, 600)),
    '미동의 상태에서 제출을 막아야 한다');
});

test('회원가입 버튼을 비활성으로 두지 않는다', () => {
  /* disabled 로 막으면 왜 안 눌리는지 알 수 없다. 누르게 두고 이유를 보여준다. */
  const html = readRoot('welcome.html');
  const guard = html.slice(html.indexOf('if (!agree.checked)'));
  assert.ok(/fail\(/.test(guard.slice(0, 300)), '막을 때 이유를 화면에 알려야 한다');
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
  const src = readRoot('assets/js/nav-user.js');
  assert.ok(/user && user\.onboarded === false/.test(src),
    'Session.refresh() 의 결과(user)로 판정해야 한다');
  assert.ok(!/drawn\.onboarded/.test(src),
    '캐시(drawn)로 판정하면 안 된다');
});

test('약관·정책 문서는 가드에서 제외된다', () => {
  // 동의하려면 읽을 수 있어야 한다. 여기서 되돌리면 무한 루프다.
  const src = readRoot('assets/js/nav-user.js');
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

test('회원가입은 별도 화면(/signup)이다', () => {
  /* "시작하기" 버튼이 곧장 /login(소셜 버튼 나열)으로 가면 신규 사용자에게
     "가입" 이라는 개념이 화면에 없다 — 로그인이자 가입인 화면 하나뿐이었다.
     지금은 /signup 이 따로 있고, 두 화면이 서로 오갈 수 있다. */
  const signup = readRoot('signup.html');
  assert.ok(/id="switch-link"/.test(signup), '로그인으로 건너가는 링크가 있어야 한다');
  assert.ok(/href="\/login"/.test(signup), '전환 링크가 /login 을 가리켜야 한다');

  const login = readRoot('login.html');
  assert.ok(/id="switch-link"/.test(login), '회원가입으로 건너가는 링크가 있어야 한다');
  assert.ok(/href="\/signup"/.test(login), '전환 링크가 /signup 을 가리켜야 한다');

  // 두 화면 다 같은 OAuth 흐름(Session.startLogin)을 쓴다 — 서버가 신규/기존을
  // 알아서 구분하므로 signup 전용 API 가 새로 필요하지 않다.
  assert.ok(/Session\.startLogin/.test(signup), 'signup 도 같은 로그인 흐름을 써야 한다');
});

test('"시작하기" 버튼은 전부 회원가입으로 간다', () => {
  /* 사용자 지시: "시작하기 빼고 그 자리에 회원가입 만들어". 남아있는 곳이
     하나라도 있으면 그 페이지만 옛날 방식(로그인 화면에 바로 던짐)으로 남는다. */
  const fs = require('node:fs');
  const path = require('node:path');
  const ROOT = path.join(__dirname, '..', '..');

  function walk(dir) {
    let out = [];
    for (const name of fs.readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git') continue;
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) out = out.concat(walk(full));
      else if (name.endsWith('.html')) out.push(full);
    }
    return out;
  }

  const offenders = [];
  for (const file of walk(ROOT)) {
    const html = fs.readFileSync(file, 'utf8');
    if (/<a href="\/login">시작하기<\/a>/.test(html)) offenders.push(file);
  }
  assert.deepStrictEqual(offenders, [], '아직 /login 으로 바로 가는 "시작하기" 가 남아 있다');
});
