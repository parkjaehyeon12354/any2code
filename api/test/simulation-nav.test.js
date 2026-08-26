/* 시뮬레이션 페이지와 네비게이션 일관성 검사.

   이 저장소는 파일을 옮기거나 새 시뮬레이션을 붙일 때 배포가 여러 번 깨졌다.
   깨진 이유는 거의 항상 "한쪽만 고쳐서" 였다 — 드롭다운은 고쳤는데 모바일
   메뉴는 그대로라 두 화면이 서로 다른 사이트가 되는 식이다.

   그래서 여기서는 개별 페이지의 로직이 아니라 **사이트 전체의 일관성**을 본다:
     - 링크가 걸린 시뮬레이션은 파일이 실제로 있는가
     - 모든 페이지의 네비가 서로 같은가
     - 카드가 ready 인데 링크가 없거나, 링크가 있는데 준비중으로 남아있지 않은가

   화면 코드를 문자열로 검사하는 이유는 이 저장소에 jsdom 이 없고 의존성을
   늘리지 않는 것이 규칙이기 때문이다. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const SIM_DIR = path.join(ROOT, 'simulation');

const read = (p) => fs.readFileSync(p, 'utf8');

// 저장소 안의 모든 HTML (node_modules 제외)
function allHtml(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) allHtml(full, out);
    else if (name.endsWith('.html')) out.push(full);
  }
  return out;
}

const PAGES = allHtml(ROOT);

// 이번에 추가한 두 개
const NEW_SIMS = ['atmosphere-weather.html', 'ocean-circulation.html'];

test('새 물리 시뮬레이션 세 개가 연결됐다', () => {
  /* 빛과 파동(굴절·전반사), 천체의 운동(궤도·중력), 열과 통계(속력 분포).
     파일·카드·네비 셋 다 있어야 실제로 들어갈 수 있다. */
  const html = read(path.join(SIM_DIR, 'index.html'));
  for (const [topic, file] of [['wave', 'wave-interference.html'],
                               ['astronomy', 'orbital-motion.html'],
                               ['thermal', 'thermal-gas.html']]) {
    assert.ok(fs.existsSync(path.join(SIM_DIR, file)), `${file} 이 없다`);
    const card = html.match(
      new RegExp(`<article class="simulation-card ([^"]+)" data-topic="${topic}">(.*?)</article>`, 's')
    );
    assert.ok(card, `${topic} 카드가 없다`);
    assert.ok(card[1].split(/\s+/).includes('ready'), `${topic} 카드가 아직 준비중이다`);
    assert.ok(card[2].includes(`href="/simulation/${file}"`), `${topic} 카드에 링크가 없다`);
  }
});

test('새 물리 페이지에 필요한 요소가 다 있다', () => {
  for (const [file, ids] of [
    ['wave-interference.html', ['canvas', 'angle-graph', 'angle', 'n1', 'n2', 'r-t2', 'r-crit', 'verdict']],
    ['orbital-motion.html', ['canvas', 'orbit-graph', 'sma', 'ecc', 'gravity', 'r-period', 'r-area', 'verdict']],
    ['thermal-gas.html', ['canvas', 'dist-graph', 'temp', 'mA', 'mB', 'r-ek', 'r-graham', 'verdict']]
  ]) {
    const html = read(path.join(SIM_DIR, file));
    for (const id of ids) {
      assert.ok(html.includes(`id="${id}"`), `${file} 에 #${id} 가 없다`);
    }
    assert.ok(/<details>[\s\S]*더 알아보기/.test(html), `${file} 에 '더 알아보기' 가 없다`);
    assert.ok(html.includes('share'), `${file} 에 공유 기능이 없다`);
  }
});

test('물리 시뮬레이션이 실제 물리 상수를 쓴다', () => {
  /* 값을 눈대중으로 박아 넣으면 조건이 바뀔 때 조용히 틀린다.
     공식과 상수를 코드에 두고 계산해야 슬라이더를 움직여도 맞는다. */
  const wave = read(path.join(SIM_DIR, 'wave-interference.html'));
  assert.ok(wave.includes('3.0e8') || wave.includes('3.00e8'), '빛의 속력 상수가 없다');
  assert.ok(/Math\.asin/.test(wave), '스넬 법칙(asin) 계산이 없다');

  const orbit = read(path.join(SIM_DIR, 'orbital-motion.html'));
  assert.ok(orbit.includes('3.986e5'), '지구 중력상수 GM 이 없다');
  assert.ok(orbit.includes('6378'), '지구 반지름이 없다');
  assert.ok(/solveE|케플러 방정식/.test(orbit), '케플러 방정식 풀이가 없다');

  const thermal = read(path.join(SIM_DIR, 'thermal-gas.html'));
  assert.ok(thermal.includes('1.380649e-23'), '볼츠만 상수가 없다');
  assert.ok(thermal.includes('6.02214076e23'), '아보가드로 수가 없다');
  assert.ok(/mbPdf|맥스웰/.test(thermal), '맥스웰-볼츠만 분포가 없다');
});

test('궤도 시뮬레이션이 지표 아래를 지나지 않는다', () => {
  /* a=10000, e=0.4 는 근지점이 6000km 로 지표(6378km) 아래다.
     존재할 수 없는 궤도라 e 를 자동으로 제한해야 한다.

     ⚠ 이름만 찾으면 안 된다. clampEcc 를 _clampEcc 로 바꾸고 호출을 주석
        처리해도 /clampEcc/ 는 여전히 매치돼 테스트가 통과해 버렸다.
        제한 로직이 '실제로 실행되는지' 를 봐야 한다. */
  const orbit = read(path.join(SIM_DIR, 'orbital-motion.html'));

  // 제한 함수가 정의돼 있어야 한다
  assert.ok(/const\s+clampEcc\s*=/.test(orbit),
    'clampEcc 정의가 없다 — 궤도가 지구를 뚫는다');
  assert.ok(/maxEcc/.test(orbit) && /MIN_ALT/.test(orbit),
    '근지점 고도 하한(MIN_ALT)과 최대 이심률(maxEcc) 계산이 없다');

  /* 주석이 아닌 '실제 호출' 이 최소 세 곳 있어야 한다:
     슬라이더 입력 / 프리셋 클릭 / 공유 링크 복원.
     한 곳이라도 빠지면 그 경로로 지표 아래 궤도가 들어온다. */
  const live = orbit
    .replace(/\/\*[\s\S]*?\*\//g, '')      // 블록 주석 제거
    .replace(/^\s*\/\/.*$/gm, '');          // 줄 주석 제거
  const calls = (live.match(/(?<![_\w])clampEcc\s*\(\s*\)/g) || []).length;
  assert.ok(calls >= 3,
    `clampEcc 실제 호출이 ${calls}곳뿐이다 — 슬라이더·프리셋·공유링크 세 경로 모두 필요하다`);
});

test('새 지구과학 시뮬레이션 파일이 실제로 있다', () => {
  for (const f of NEW_SIMS) {
    assert.ok(fs.existsSync(path.join(SIM_DIR, f)), `${f} 가 없다`);
  }
});

test('링크가 걸린 시뮬레이션은 파일이 반드시 있다', () => {
  /* 없는 파일로 링크를 걸면 사용자는 404 를 본다.
     드롭다운에 이름만 올려두고 파일을 안 만든 적이 있어 이걸 막는다. */
  const missing = [];
  for (const p of PAGES) {
    const html = read(p);
    for (const m of html.matchAll(/href="\/simulation\/([^"]+\.html)"/g)) {
      if (!fs.existsSync(path.join(SIM_DIR, m[1]))) {
        missing.push(`${path.relative(ROOT, p)} → ${m[1]}`);
      }
    }
  }
  assert.deepStrictEqual(missing, [], '없는 시뮬레이션으로 링크가 걸려 있다');
});

test('드롭다운과 모바일 메뉴가 같은 시뮬레이션을 가리킨다', () => {
  /* 데스크톱 네비(#nav-links)만 고치고 모바일 메뉴를 빠뜨리면
     휴대폰 사용자에게는 새 시뮬레이션이 존재하지 않는 것과 같다.
     실제로 이 저장소 주석에도 "반드시 일치시킬 것" 이라고 적혀 있다.

     단, privacy/terms 처럼 데스크톱 네비를 "시뮬레이션" 링크 하나로만 두고
     모바일에만 전체 목록을 펼치는 페이지가 있다. 좁은 헤더를 위한 의도된
     설계이므로, 드롭다운으로 목록을 펼치는 페이지끼리만 비교한다. */
  const problems = [];
  for (const p of PAGES) {
    const html = read(p);
    if (!html.includes('mega-dropdown')) continue;

    const navStart = html.indexOf('id="nav-links"');
    const mobileStart = html.indexOf('class="mobile-menu"');
    if (navStart < 0 || mobileStart < 0) continue;   // 네비가 없는 페이지

    const desktop = html.slice(navStart, mobileStart);
    const mobile = html.slice(mobileStart);

    const grab = (s) => new Set(
      [...s.matchAll(/href="\/simulation\/([^"]+\.html)"/g)].map((m) => m[1])
    );
    const d = grab(desktop), m = grab(mobile);
    const rel = path.relative(ROOT, p);

    // 양쪽 모두 본다 — 한 방향만 보면 반대쪽에 빠진 것을 놓친다
    for (const sim of d) {
      if (!m.has(sim)) problems.push(`${rel}: 모바일 메뉴에 ${sim} 없음`);
    }
    for (const sim of m) {
      if (!d.has(sim)) problems.push(`${rel}: 드롭다운에 ${sim} 없음`);
    }
  }
  assert.deepStrictEqual(problems, [], '데스크톱과 모바일 네비가 어긋난다');
});

test('시뮬레이션을 나열하는 페이지는 모두 같은 목록을 보여준다', () => {
  /* 페이지마다 네비가 다르면 사용자는 어디서 왔느냐에 따라 다른 사이트를 본다.

     기준은 "개별 시뮬레이션을 나열하는가" 다. mega-dropdown 유무로 가르면
     안 된다 — privacy/terms/admin/settings 는 드롭다운 없이도 10개를 그대로
     나열하고, research/* 는 `/simulation/` 하나로만 묶는다. 둘 다 정상이다. */
  const sets = new Map();
  for (const p of PAGES) {
    const html = read(p);
    const sims = [...new Set(
      [...html.matchAll(/href="\/simulation\/([^"]+\.html)"/g)].map((m) => m[1])
    )].sort();
    if (sims.length === 0) continue;             // 나열하지 않는 페이지
    sets.set(path.relative(ROOT, p), sims.join(','));
  }
  assert.ok(sets.size > 10, '비교할 페이지가 너무 적다 — 네비 마크업이 바뀌었나?');

  const values = [...new Set(sets.values())];
  assert.strictEqual(values.length, 1,
    '페이지마다 네비의 시뮬레이션 목록이 다르다:\n' +
    [...sets].map(([k, v]) => `  ${k}\n    ${v}`).join('\n'));
});

test('시뮬레이션을 나열하지 않는 페이지도 갈 길은 있다', () => {
  /* research/* 처럼 개별 목록을 안 그리더라도, 최소한 시뮬레이션 목록으로는
     갈 수 있어야 막다른 페이지가 되지 않는다.
     로그인·환영 페이지처럼 네비 자체가 없는 화면은 대상이 아니다. */
  for (const p of PAGES) {
    const html = read(p);
    if (!html.includes('id="nav-links"')) continue;
    if (/href="\/simulation\/[^"]+\.html"/.test(html)) continue;   // 이미 나열함
    assert.ok(/href="\/simulation\/?"/.test(html),
      `${path.relative(ROOT, p)} 에서 시뮬레이션으로 갈 길이 없다`);
  }
});

test('새 시뮬레이션이 준비중으로 남아있지 않다', () => {
  /* 파일을 만들어 놓고 <span class="soon"> 을 안 지우면
     만들었는데도 사용자는 못 들어간다. */
  for (const p of PAGES) {
    const html = read(p);
    for (const label of ['대기와 기상', '해양과 순환']) {
      assert.ok(!html.includes(`<span class="soon">${label}</span>`),
        `${path.relative(ROOT, p)} 에 "${label}" 이 아직 준비중으로 있다`);
    }
  }
});

test('시뮬레이션 파일이 있으면 목록 카드도 연결돼 있다', () => {
  /* 만들어 놓고 카드를 안 붙이면, 목록에서는 "준비중" 으로 보여 아무도 못 들어간다.
     실제로 여섯 개(화학2·생명2·지구2)가 그 상태로 남아 있었다 —
     네비 드롭다운에만 링크가 있어서 "링크가 걸린 파일" 검사로는 안 잡혔다. */
  const html = read(path.join(SIM_DIR, 'index.html'));
  const linkedInCards = new Set(
    [...html.matchAll(/<article class="simulation-card[^"]*"[^>]*>(?:(?!<\/article>).)*?href="\/simulation\/([^"]+)"/gs)]
      .map((m) => m[1])
  );

  const files = fs.readdirSync(SIM_DIR).filter((f) => f.endsWith('.html') && f !== 'index.html');
  const orphans = files.filter((f) => !linkedInCards.has(f));
  assert.deepStrictEqual(orphans, [],
    '이 시뮬레이션은 파일이 있는데 목록 카드에 연결되지 않았다 — 사용자는 못 들어간다');
});

test('목록 카드가 ready 면 링크가 있고, 링크가 있으면 ready 다', () => {
  const html = read(path.join(SIM_DIR, 'index.html'));
  const cards = [...html.matchAll(
    /<article class="simulation-card ([^"]+)" data-topic="([^"]+)">(.*?)<\/article>/gs
  )];
  assert.ok(cards.length > 0, '카드를 하나도 못 찾았다 — 마크업이 바뀌었나?');

  for (const [, cls, topic, body] of cards) {
    const ready = cls.split(/\s+/).includes('ready');
    const hasLink = /href="\/simulation\/[^"]+\.html"/.test(body);
    assert.strictEqual(ready, hasLink,
      `카드 "${topic}": ready=${ready} 인데 링크는 ${hasLink} 다 — 한쪽만 고쳤다`);
  }
});

test('연결된 카드에는 미리보기 그림이 있다', () => {
  /* 미리보기가 비면 목록에서 회색 칸으로 보인다 — 만들다 만 것처럼 읽힌다. */
  const html = read(path.join(SIM_DIR, 'index.html'));
  const cards = [...html.matchAll(
    /<article class="simulation-card ([^"]+)" data-topic="([^"]+)">(.*?)<\/article>/gs
  )];
  for (const [, cls, topic, body] of cards) {
    if (!cls.split(/\s+/).includes('ready')) continue;
    assert.ok(body.includes('<svg'), `"${topic}" 카드에 미리보기 SVG 가 없다`);
  }
});

test('카드마다 미리보기 그림이 서로 다르다', () => {
  /* 예전에는 미리보기를 JS 가 canvas 에 그렸는데, 그 코드가
       if (단진자) {...} else {전자기 유도}
     였다. 시뮬레이션이 둘일 때는 맞았지만 여덟 개로 늘자 단진자를 뺀
     일곱 장이 전부 '전자기 유도' 그림이 됐다. 카드는 멀쩡했고 화면만 틀렸다.

     지금은 각 카드의 <svg> 를 그대로 보여준다. 같은 그림이 두 번 나오면
     복사해 붙이다 라벨만 안 고친 것이므로 여기서 막는다. */
  const html = read(path.join(SIM_DIR, 'index.html'));
  const cards = [...html.matchAll(
    /<article class="simulation-card ([^"]+)" data-topic="([^"]+)">(.*?)<\/article>/gs
  )];

  const seen = new Map();
  for (const [, cls, topic, body] of cards) {
    if (!cls.split(/\s+/).includes('ready')) continue;
    const svg = body.match(/<svg.*?<\/svg>/s);
    assert.ok(svg, `"${topic}" 에 SVG 가 없다`);
    const label = svg[0].match(/aria-label="([^"]*)"/);
    assert.ok(label && label[1].trim(), `"${topic}" SVG 에 aria-label 이 없다`);

    if (seen.has(label[1])) {
      assert.fail(`"${topic}" 와 "${seen.get(label[1])}" 의 미리보기가 같다: ${label[1]}`);
    }
    seen.set(label[1], topic);
  }
  assert.ok(seen.size >= 8, `연결된 카드가 ${seen.size}개뿐이다 — 카드가 빠졌나?`);
});

test('미리보기를 canvas 로 다시 그리지 않는다', () => {
  /* 카드별 분기를 JS 에 두면 시뮬레이션이 늘 때마다 여기를 고쳐야 하고,
     안 고치면 엉뚱한 그림이 조용히 반복된다. SVG 를 그대로 쓰는 편이 맞다. */
  const html = read(path.join(SIM_DIR, 'index.html'));
  assert.ok(!/drawSimulationPreviews/.test(html),
    'canvas 미리보기 코드가 되살아났다 — 카드의 SVG 를 그대로 쓸 것');
  assert.ok(!/\.sim-preview svg \{[^}]*display:\s*none/.test(html),
    'SVG 미리보기를 CSS 로 숨기고 있다 — 카드가 빈 칸으로 보인다');
});

test('새 지구과학 카드 두 개가 실제로 연결됐다', () => {
  const html = read(path.join(SIM_DIR, 'index.html'));
  for (const [topic, file] of [['weather', 'atmosphere-weather.html'],
                               ['ocean', 'ocean-circulation.html']]) {
    const m = html.match(
      new RegExp(`<article class="simulation-card ([^"]+)" data-topic="${topic}">(.*?)</article>`, 's')
    );
    assert.ok(m, `${topic} 카드가 없다`);
    assert.ok(m[1].includes('ready'), `${topic} 카드가 아직 준비중이다`);
    assert.ok(m[2].includes(file), `${topic} 카드가 ${file} 로 연결되지 않았다`);
  }
});

test('새 시뮬레이션에 미리보기 그림이 있다', () => {
  /* 미리보기가 비면 목록에서 회색 칸으로 보인다 — 만들다 만 것처럼 읽힌다. */
  const html = read(path.join(SIM_DIR, 'index.html'));
  for (const topic of ['weather', 'ocean']) {
    const m = html.match(
      new RegExp(`data-topic="${topic}">(.*?)</article>`, 's')
    );
    assert.ok(m[1].includes('<svg'), `${topic} 카드에 미리보기 SVG 가 없다`);
  }
});

test('새 시뮬레이션 페이지에 필요한 요소가 다 있다', () => {
  for (const f of NEW_SIMS) {
    const html = read(path.join(SIM_DIR, f));

    assert.ok(/<canvas id="canvas"/.test(html), `${f}: 무대 canvas 가 없다`);
    assert.ok(/id="toggle"/.test(html), `${f}: 일시정지 버튼이 없다`);
    assert.ok(/id="share"/.test(html), `${f}: 공유 버튼이 없다`);
    assert.ok(/Session\.refresh\(\)/.test(html),
      `${f}: 공유가 로그인을 확인하지 않는다`);
    assert.ok(/<details><summary>더 알아보기<\/summary>/.test(html),
      `${f}: 설명 패널이 없다`);

    // 접근성 — canvas 는 스크린리더가 내용을 읽을 수 없으니 라벨이 필요하다
    for (const m of html.matchAll(/<canvas[^>]*>/g)) {
      assert.ok(/aria-label=/.test(m[0]),
        `${f}: aria-label 없는 canvas 가 있다 — ${m[0]}`);
    }
  }
});

test('CSS 변수는 styles.css 에 있는 것만 쓴다', () => {
  /* 없는 변수를 쓰면 색이 통째로 빠진 채 배포된다.
     --line/--surface/--accent 를 쓸 뻔했는데 이 저장소엔 없는 이름이다. */
  const css = read(path.join(ROOT, 'assets/css/styles.css'));
  const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));

  for (const f of NEW_SIMS) {
    const html = read(path.join(SIM_DIR, f));
    const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    const used = new Set([...style.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
    const missing = [...used].filter((v) => !defined.has(v));
    assert.deepStrictEqual(missing, [],
      `${f} 가 styles.css 에 없는 변수를 쓴다`);
  }
});
