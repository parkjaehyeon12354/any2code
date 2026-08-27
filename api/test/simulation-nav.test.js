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

test('생명과학 시뮬레이션 네 개가 실제로 있다', () => {
  for (const f of ['ecology-population', 'neural-signal',
                   'circulation-transport', 'metabolism-enzyme']) {
    assert.ok(fs.existsSync(path.join(SIM_DIR, f + '.html')), f + '.html 이 없다');
  }
});

test('생명과학 상수가 코드에 실제로 있다', () => {
  /* 숫자를 박아 두는 이유: 이 값들은 교과서와 대조해 확인한 것이라
     누가 무심코 바꾸면 물리적으로 틀린 화면이 된다.
     전부 브라우저에서도 재확인했다. */
  const eco = read(path.join(SIM_DIR, 'ecology-population.html'));
  /* 번식률 r 은 상수에서 슬라이더로 바뀌었다. 기본값은 그대로 0.5 여야
     N*=13.33, P*=25 라는 검증값이 유지된다. */
  assert.match(eco, /birth: 0\.5 \}/, '피식자 번식률 기본값 0.5');
  assert.match(eco, /id="birth"[^>]*value="0\.5"/, '번식률 슬라이더 기본값 0.5');
  assert.match(eco, /const e = 0\.3/, '전환효율 0.3');
  assert.match(eco, /const m = 0\.08/, '포식자 사망률 0.08');

  const neu = read(path.join(SIM_DIR, 'neural-signal.html'));
  assert.match(neu, /TAU = 10\.0/, '막 시상수 10ms');
  /* 역치는 상수에서 슬라이더로 바뀌었다. 기본 15 여야 -55mV 라는 교과서 값이 나온다. */
  assert.match(neu, /vth: 15 \}/, '역치 기본값 15 (= -55mV)');
  assert.match(neu, /id="vth"[^>]*value="15"/, '역치 슬라이더 기본값 15');
  assert.match(neu, /V_REST = -70/, '휴지전위 -70mV');
  assert.match(neu, /V_PEAK = 30/, '정점 +30mV');

  const cir = read(path.join(SIM_DIR, 'circulation-transport.html'));
  /* 반지름은 상수에서 지름 슬라이더로 바뀌었다. 기본 8µm 이어야
     반지름 4e-4 cm 라는 기존 검증값이 유지된다. */
  assert.match(cir, /capD: 8 \}/, '모세혈관 지름 기본값 8µm (= 반지름 4e-4 cm)');
  assert.match(cir, /id="capD"[^>]*value="8"/, '모세혈관 지름 슬라이더 기본값 8');

  const enz = read(path.join(SIM_DIR, 'metabolism-enzyme.html'));
  /* Km 도 슬라이더가 됐다. 기본 2.0 이어야 25°C·S=4 → 66.65 가 유지된다. */
  assert.match(enz, /km: 2\.0 \}/, '미카엘리스 상수 기본값 2.0 mM');
  assert.match(enz, /id="km"[^>]*value="2"/, 'Km 슬라이더 기본값 2');
  assert.match(enz, /T_HALF = 50/, '절반 변성 온도 50도');
});

test('신경 시뮬은 진폭을 자극 세기와 무관하게 그린다', () => {
  /* 실무율이 이 화면의 전부다. spikeVoltage 가 자극 세기를 인자로
     받기 시작하면 "세게 누르면 크게"가 되어 오개념을 그대로 가르친다. */
  const neu = read(path.join(SIM_DIR, 'neural-signal.html'));
  const m = neu.match(/function spikeVoltage\(([^)]*)\)/);
  assert.ok(m, 'spikeVoltage 함수가 없다');
  assert.strictEqual(m[1].trim(), 'age', 'spikeVoltage 는 age 하나만 받아야 한다');
});

test('신경 시뮬의 불응기 비교는 부동소수점 안전값을 쓴다', () => {
  /* refLeft > 0 으로 두면 불응기가 끝나는 순간 3.55e-15 가 남아
     시간이 0 만큼 흐르는 교착에 빠진다(실제로 t=34.47 에서 멈췄다).
     임계값 비교여야 한다. */
  const neu = read(path.join(SIM_DIR, 'neural-signal.html'));
  assert.ok(!/if \(refLeft > 0\)/.test(neu),
    'refLeft > 0 은 교착을 만든다 — 임계값 비교를 쓸 것');
  assert.match(neu, /refLeft > 1e-9/, '임계값 비교가 있어야 한다');
});


test('시뮬레이션 묶대는 디자인 시스템 토큰으로 통일했다', () => {
  /* --stage-bg (#0b100e)는 디자인 시스템에 없는 고립 색이었다.
     다크에서 --surface-dark (#080808)와 미묘하게 어긋나 푸터와 묶대가 다른
     어둠이 됐다. 묶대 배경은 --surface-dark 로 통일하고 토큰은 없앴다.
     새 시뮬을 만들 때 낡은 토큰을 다시 가져오면 이 검사가 막는다. */
  const css = read(path.join(ROOT, 'assets/css/styles.css'));
  assert.ok(!css.includes('--stage-bg:'), 'styles.css 에 --stage-bg 정의가 되돌아왔다');
  for (const f of fs.readdirSync(SIM_DIR).filter((x) => x.endsWith('.html') && x !== 'index.html')) {
    const h = read(path.join(SIM_DIR, f));
    assert.ok(!h.includes('--stage-bg'), f + ' 가 --stage-bg 를 쓴다 — --surface-dark 로 바꿀 것');
  }
});


test('심화 탐구 주제의 시뮬레이션 링크가 살아 있다', () => {
  /* 주제 카드의 '시뮬레이션 열기' 버튼이 404 로 가면 학생은 탐구를 못 시작한다.
     주제를 추가할 때 링크를 잘못 적으면 이 검사가 막는다. */
  const js = read(path.join(ROOT, 'assets/js/research-topics.js'));
  assert.ok(!js.includes('\ufffd'), 'research-topics.js 에 깨진 문자(U+FFFD)가 있다');
  const links = [...js.matchAll(/link:'(\/simulation\/[a-z-]+\.html)'/g)].map((m) => m[1]);
  assert.ok(links.length >= 22, '시뮬레이션 연결 주제가 22개 미만이다');
  /* 스물한 개 시뮬 전부에 주제가 하나씩은 있어야 한다 — 하나라도 빠지면
     그 시뮬은 심화 탐구에서 도달할 수 없다. */
  const files = fs.readdirSync(SIM_DIR).filter((x) => x.endsWith('.html') && x !== 'index.html');
  const linked = new Set(links.map((l) => path.basename(l)));
  const missing = files.filter((f) => !linked.has(f));
  assert.deepStrictEqual(missing, [], '주제가 없는 시뮬레이션: ' + missing.join(','));
  for (const l of links) {
    assert.ok(fs.existsSync(path.join(ROOT, l)), l + ' 파일이 없다');
  }
  const bad = [...js.matchAll(/\{s:'([a-z]+)'/g)].map((m) => m[1])
    .filter((s) => !['physics', 'chemistry', 'biology', 'earth'].includes(s));
  assert.deepStrictEqual(bad, [], '알 수 없는 과목 코드: ' + bad.join(','));
});


test('산과 염기의 약산 모드가 실제 물리를 쓴다', () => {
  /* 약산은 전하 균형 [H+]=[A-]+[OH-] 를 풀어야 한다.
     sqrt(Ka*C) 근사만 쓰면 Ka 가 큰 약산(pKa 2, 이온화도 27%)에서 크게 틀린다.
     실제로 pKa=2·C=0.1 이면 근사 pH 1.50 vs 정확 1.568 — 이분법으로 푼다. */
  const ab = read(path.join(SIM_DIR, 'acid-base.html'));
  assert.match(ab, /if \(!weak\) return hExact\(c\);/,
    '강산·약산 분기가 없다 — 약산 모드가 강산 식으로 계산된다');
  assert.match(ab, /ka \* c \/ \(x \+ ka\)/, '전하 균형식이 없다 — 근사만 쓰면 pKa 2 에서 틀린다');
  assert.match(ab, /id="pka"/, 'pKa 슬라이더가 없다');
  assert.match(ab, /id="r-alpha"/, '이온화도 표시가 없다');
  assert.match(ab, /kind-weak/, '강산·약산 전환이 없다');
});

test('단진자의 질량은 주기에 들어가지 않는다', () => {
  /* 이 슬라이더의 존재 이유다 — 주기 공식에 질량이 없다.
     저항 항만 질량으로 나뉜다(같은 저항 힘이 질량으로 나뉨).
     누가 주기 계산에 질량을 넣으면 오개념을 그대로 가르치게 된다. */
  const pd = read(path.join(SIM_DIR, 'pendulum.html'));
  const acc = pd.match(/const acc = .*;/);
  assert.ok(acc, '가속도 식이 없다');
  assert.ok(!/G \/ \(params\.L \* params\.m\)|params\.m \* G/.test(acc[0]),
    '주기 항에 질량이 들어갔다 — 주기는 질량과 무관하다');
  assert.match(pd, /params\.b \/ params\.m/, '저항이 질량으로 안 나뉜다 — 무거운 추가 더 천천히 멈춰야 한다');
  assert.match(pd, /id="mass"/, '질량 슬라이더가 없다');
});

test('전자기 유도의 기전력은 코일 면적에 비례한다', () => {
  /* Phi = B*A. 면적 배율이 자기선속에 곱해져야 한다. */
  const em = read(path.join(SIM_DIR, 'electromagnetic-induction.html'));
  /* 주석에 같은 글자가 있으면 단순 'params.area/20' 검사는
     면적을 빼도 통과한다 — 실제로 그랬다. 곱해지는 식 전체를 본다. */
  assert.match(em, /params\.strength\*\(params\.area\/20\)/,
    '자기선속에 면적이 안 곱해진다 — Phi=B*A 가 아니다');
  assert.match(em, /id="area"/, '면적 슬라이더가 없다');
});


test('단진자의 중력 가속도가 조작 변수다', () => {
  /* T = 2pi*sqrt(L/g). g 가 상수로 박혀 있으면 "달에서는 어떨까" 를 볼 수 없다.
     실측 확인(L=1m, 8도): 달 1.62 -> 4.943s, 화성 3.72 -> 3.262s,
     지구 9.81 -> 2.009s, 목성 24.79 -> 1.263s. 손계산과 0.1% 안에서 일치. */
  const pd = read(path.join(SIM_DIR, 'pendulum.html'));
  assert.match(pd, /id="grav"/, '중력 슬라이더가 없다');
  assert.match(pd, /const G = \(\) => params\.g;/,
    '중력이 상수로 돌아갔다 — 슬라이더를 움직여도 주기가 안 변한다');
  /* 주기 계산과 가속도 계산 둘 다 g 를 함수로 읽어야 한다.
     한쪽만 고치면 화면의 이론값과 실제 진자가 따로 논다. */
  assert.match(pd, /Math\.sqrt\(params\.L \/ G\(\)\)/, '이론 주기가 g 를 안 읽는다');
  assert.match(pd, /-\(G\(\) \/ params\.L\)/, '가속도가 g 를 안 읽는다');
});

test('열과 통계의 측정 속력은 실제 표본에서 나온다', () => {
  /* 입자 수 슬라이더의 존재 이유 — 표본이 작으면 평균이 이론값에서 벗어난다.
     측정값을 이론식 vRms 로만 그리면 8개로 줄여도 숫자가 꿈쩍하지 않아
     슬라이더가 아무 일도 안 하는 것처럼 보인다.
     실측: 200개일 때 이론 대비 평균 3.0% 차, 8개일 때 15.8% 차. */
  const tg = read(path.join(SIM_DIR, 'thermal-gas.html'));
  assert.match(tg, /id="count"/, '입자 수 슬라이더가 없다');
  assert.match(tg, /const va = sampleRms\(0\) \|\| vRms/,
    '측정 속력이 표본이 아니라 이론식이다 — 입자 수를 줄여도 안 흔들린다');
  assert.match(tg, /i < S\.count/, 'seed 가 고정 개수를 쓴다 — 슬라이더가 안 먹는다');
});


test('개체와 생태계의 번식률이 조작 변수다', () => {
  /* 이 화면 본문은 "피식자에게 좋은 일을 해주면 정작 늘어나는 건 포식자" 라고
     단언한다. P* = r/a 이고 N* = m/(ea) 라 번식률은 포식자 균형점만 올린다.
     r 이 상수로 박혀 있으면 학생이 그 주장을 확인할 방법이 없다.
     실측(a=0.02): r 0.2/0.5/1.2 -> P* 10.0/25.0/60.0, N* 은 13.33 고정. */
  const ec = read(path.join(SIM_DIR, 'ecology-population.html'));
  assert.match(ec, /id="birth"/, '번식률 슬라이더가 없다');
  assert.match(ec, /const pStar = \(\) => S\.birth \/ S\.attack;/,
    '포식자 균형점이 번식률을 안 읽는다 — 슬라이더를 움직여도 P* 가 그대로다');
  /* 미분식도 같이 읽어야 한다. 균형점 표시만 고치면 숫자는 변하는데
     실제 개체수 곡선은 옛 번식률로 도는 따로국밥이 된다. */
  assert.match(ec, /const dN = S\.birth \* N - a \* N \* P;/,
    '피식자 미분식이 번식률을 안 읽는다');
});


test('화학 반응의 온도가 평형 상수를 바꾼다', () => {
  /* 본문이 "온도를 바꾸면 K 값 자체가 달라진다. 발열은 K 가 작아지고
     흡열은 커진다 — 시험에 자주 나온다" 고 단언하는데 온도 슬라이더가
     없어서 확인할 방법이 없었다. 촉매(K 불변)와의 대비가 이 화면의 핵심이다.
     반트호프 ln(K2/K1) = -dH/R (1/T2 - 1/T1).
     실측(25->75도, K1=2): 발열 -50kJ -> 0.110, 열중성 -> 2.000, 흡열 +50kJ -> 36.333.
     촉매 8배로 올려도 K 는 2.000 그대로. */
  const cr = read(path.join(SIM_DIR, 'chemical-reaction.html'));
  assert.match(cr, /id="temp"/, '온도 슬라이더가 없다');
  assert.match(cr, /id="dh-exo"/, '발열·흡열 선택이 없다 — 온도만으로는 K 방향을 못 보인다');
  /* K 가 반트호프를 타야 한다. kf/kr 만 쓰면 온도를 올려도 K 가 그대로다. */
  assert.match(cr, /Math\.exp\(-\(S\.dH \* 1000\) \/ R_GAS \* \(1 \/ tempK\(\) - 1 \/ T0\)\)/,
    '평형 상수가 반트호프 식을 안 쓴다');
  /* kr 은 kf/K 로 따라와야 K 가 반트호프와 정확히 맞는다.
     kr 도 아레니우스로 따로 올리면 K 가 어긋난다. */
  assert.match(cr, /const krEff = \(\) => kfEff\(\) \/ Kconst\(\);/,
    '역반응 속도상수가 K 를 안 따라간다 — 평형이 반트호프와 어긋난다');
});


test('천체 운동의 중심 천체가 조작 변수다', () => {
  /* GM 이 지구로 고정이라 달·화성 궤도를 볼 수 없었다.
     T = 2pi*sqrt(a^3/GM). 실측(a=10000km): 지구 166.0분, 달 1496.3분,
     목성 9.3분 — 손계산과 일치.
     주의: 본문 공식 표기 'T = 2pi(a^3/GM)' 는 텍스트라 건드리면 안 된다.
     식별자를 일괄 치환하면 화면에 GM() 이라고 찍힌다. */
  const om = read(path.join(SIM_DIR, 'orbital-motion.html'));
  assert.match(om, /id="gm"/, '중심 천체 슬라이더가 없다');
  assert.match(om, /const GM = \(\) => S\.gm;/, 'GM 이 상수로 돌아갔다');
  assert.match(om, /Math\.sqrt\(a \* a \* a \/ GM\(\)\)/, '주기 계산이 GM 을 안 읽는다');
  /* 슬라이더는 log10 눈금이다. 상태에 로그 값을 그대로 넣으면 GM 이 5.6 이 된다. */
  assert.match(om, /S\[k\] = k === 'gm' \? Math\.pow\(10, Number\(input\.value\)\)/,
    '로그 슬라이더 값을 실제 GM 으로 변환하지 않는다');
  assert.match(om, /T = 2π√\(a³\/GM\) —/, '본문 공식 표기가 깨졌다');
});

test('순환의 모세혈관 지름이 총단면적을 바꾼다', () => {
  /* 총단면적 = 개수 x 한 개 단면적인데 개수만 조작할 수 있었다.
     실측: 지름 4/8/12um -> 총단면적 390/1558/3506 cm2 (지름 제곱 비례),
     유속은 0.2139/0.0535/0.0238 cm/s 로 반비례. */
  const ct = read(path.join(SIM_DIR, 'circulation-transport.html'));
  assert.match(ct, /id="capD"/, '모세혈관 지름 슬라이더가 없다');
  assert.match(ct, /const CAP_R = \(\) => S\.capD \/ 2 \/ 10000;/, '반지름이 상수로 돌아갔다');
  /* 단면적도 함께 함수여야 한다. 상수로 두면 지름을 바꿔도 총단면적이 안 변한다. */
  assert.match(ct, /const CAP_AREA1 = \(\) => Math\.PI \* CAP_R\(\) \* CAP_R\(\);/,
    '단면적이 상수라 지름 변경이 반영되지 않는다');
  assert.match(ct, /CAP_AREA1\(\);/, '총단면적 계산이 옛 상수를 쓴다');
});

test('대사와 효소의 Km 이 조작 변수다', () => {
  /* 미카엘리스-멘텐 곡선 모양을 정하는 값인데 상수였다.
     v = Vmax*S/(Km+S). 실측(25도, S=4, E=1): Km 0.5/2/10 -> 88.87/66.65/28.56,
     S=Km=4 에서 49.99 = Vmax(99.98)/2 로 정확히 절반. */
  const me = read(path.join(SIM_DIR, 'metabolism-enzyme.html'));
  assert.match(me, /id="km"/, 'Km 슬라이더가 없다');
  assert.match(me, /const Km = \(\) => S\.km;/, 'Km 이 상수로 돌아갔다');
  assert.match(me, /vmaxAt\(T\) \* sub \/ \(Km\(\) \+ sub\)/, '반응 속도가 Km 을 안 읽는다');
  assert.match(me, /S\.sub \/ \(Km\(\) \+ S\.sub\)/, '포화도가 Km 을 안 읽는다');
});


test('신경의 역치가 조작 변수이고 자극과 독립이다', () => {
  /* 측정 패널에 '역치 -55mV' 를 보여주면서 못 만지게 하고 있었다.
     ⚠ 여기서 한 번 틀렸다: drive 를 S.vth * I / ITH 로 두면 t = -TAU*ln(1 - S.vth/drive)
     에서 S.vth 가 약분돼 사라진다. 역치를 8 로 내리든 25 로 올리든 충전 시간이
     13.86ms 로 똑같았다. 자극이 만드는 탈분극은 역치와 무관해야 한다.
     실측(고친 뒤): 역치15·자극80 → 13.86ms, 역치8·자극80 → 5.11ms,
     역치20·자극80 → 영영 못 닿음, 역치20·자극100 → 16.09ms. 봉우리는 늘 100mV. */
  const ns = read(path.join(SIM_DIR, 'neural-signal.html'));
  assert.match(ns, /id="vth"/, '역치 슬라이더가 없다');
  assert.match(ns, /const VTH0 = 15\.0;/, '자극 환산 기준값이 없다');
  assert.ok(!/drive\w* = S\.vth \* I \/ ITH/.test(ns),
    '자극 세기가 역치에 비례한다 — 역치가 약분돼 슬라이더가 아무 일도 못 한다');
  assert.match(ns, /var drive = VTH0 \* I \/ ITH/, '자극이 만드는 탈분극이 기준값을 안 쓴다');
  assert.match(ns, /state\.v >= S\.vth/, '발화 판정이 역치를 안 읽는다');
  /* 그래프의 역치선도 따라와야 한다. -55 로 박아 두면 역치를 올려도 선이 그대로다. */
  assert.match(ns, /const vthMv = V_REST \+ S\.vth;/, '그래프 역치선이 고정값이다');
});

test('방사능의 아이소톱을 고를 수 있다', () => {
  /* ISO 테이블(탄소-14 5730년, 요오드-131 8.02일, 세슘-137 30.17년)이 코드에
     있는데 화면에 고르는 수단이 없었다. 반감기 범위가 얼마나 다른지는
     숫자를 나란히 봐야 와닿는다. */
  const rd = read(path.join(SIM_DIR, 'radioactivity.html'));
  assert.match(rd, /id="iso-chips"/, '아이소톱 선택 UI 가 없다');
  assert.match(rd, /Object\.keys\(ISO\)\.forEach/, 'ISO 테이블에서 버튼을 만들지 않는다');
  assert.match(rd, /function syncIsoChips\(\)/, '선택 상태 표시가 없다');
});

test('지구 계절의 근일점 날짜가 조작 변수다', () => {
  /* '태양에 가장 가까운 때는 1월' 이라고 해놓고 그 1월을 못 바꿨다.
     7월로 옮겨도 계절의 원인은 자전축 기울기라는 게 이 변수의 존재 이유다.
     ⚠ (day - 79) 는 춘분 기준이라 다른 값이다. 같이 바꾸면 낮 길이가 깨진다.
     실측: 4일 → 1월 4일, 186일 → 7월 5일, 365일 → 12월 31일. */
  const es = read(path.join(SIM_DIR, 'earth-seasons.html'));
  assert.match(es, /id="peri"/, '근일점 슬라이더가 없다');
  assert.ok(!/- 4\) \/ 365\.24/.test(es), '근일점이 아직 상수로 남아 있다');
  assert.match(es, /\(day - S\.peri\) \/ 365\.24/, '궤도 각도가 근일점을 안 읽는다');
  assert.match(es, /- 79\) \/ 365\.24/, '춘분 기준까지 바꿔 버렸다 — 낮 길이가 깨진다');
});


test('시뮬레이션 목록 페이지에 네비로 갈 수 있다', () => {
  /* simulation/index.html 은 파일도 멀쩡하고 라이브에서 200 인데,
     어디서도 링크가 없어 주소를 직접 쳐야만 들어갈 수 있었다.
     8/20 커밋에서 '목록 페이지를 없애고 드롭다운에서 바로 단진자로' 하며
     지웠다가 파일만 되살아나고 링크는 안 돌아온 것이다.
     드롭다운은 과목별로 흩어져 있어 21개를 한눈에 볼 곳이 목록뿐이다. */
  const idx = read(path.join(SIM_DIR, 'index.html'));
  assert.ok(idx.length > 1000, '목록 페이지가 비어 있다');

  const pages = ['community.html', 'guide.html', 'Index.html', 'post.html']
    .map((f) => [f, path.join(ROOT, f)])
    .concat(fs.readdirSync(SIM_DIR).filter((f) => f.endsWith('.html'))
      .map((f) => ['simulation/' + f, path.join(SIM_DIR, f)]));

  for (const [name, file] of pages) {
    const html = read(file);
    if (!html.includes('mega-dropdown')) continue;
    /* 드롭다운 트리거 1개 + 모바일 메뉴 1개. 한쪽만 고치면 데스크톱과 모바일이
       서로 다른 사이트가 된다 — 실제로 그렇게 갈라진 적이 있다. */
    const n = (html.match(/href="\/simulation\/"/g) || []).length;
    assert.strictEqual(n, 2, name + ' 의 목록 링크가 ' + n + '개다 (드롭다운 트리거 1 + 모바일 1 이어야 한다)');
    /* 과목 넷은 시뮬레이션 하나로 접혔다. 열 제목으로 남되, 누르면 그 과목만
       걸린 목록으로 가야 한다 — 푸터의 ?subject= 링크와 같은 경로다. */
    assert.match(html, /<p class="mega-label"><a href="\/simulation\/\?subject=physics">물리학<\/a><\/p>/,
      name + ' 의 과목 열 제목이 필터로 연결되지 않았다');
  }
});


test('그래프가 무대와 같은 열에 있다', () => {
  /* 그래프가 첫 화면에서 752px 아래였다. 조작 패널이 무대보다 393px 길어서
     오른쪽 열 아래가 텅 비고, 그래프는 두 열이 끝난 다음에 있었다.
     링크로 건너뛰게 해봤자 아래에 있다는 사실은 그대로다.
     측정값·공유·그래프를 왼쪽 열(무대 아래)로 넣어 빈 공간을 채웠다 —
     스크롤 752px → 평균 280px. 점프 링크는 뺐다. */
  const files = fs.readdirSync(SIM_DIR).filter((f) => f.endsWith('.html') && f !== 'index.html');
  for (const f of files) {
    const html = read(path.join(SIM_DIR, f));
    const sp = html.indexOf('<div class="side-panels">');
    assert.ok(sp > 0, f + ' 에 왼쪽 열이 없다');
    assert.ok(html.indexOf('<section class="analysis-panel"', sp) > sp, f + ' 에 분석 패널이 없다');
    /* 왼쪽 열이 닫히기 전에 분석 패널이 나와야 한다. 바깥으로 빠지면
       다시 조작 패널 길이만큼 밀린다.
       ⚠ 네 번 틀렸다. 인덱스로 여는/닫는 짝을 세려다 두 번(측정 스트립·분석
       패널 안에도 같은 들여쓰기의 </div> 가 있다), 열 끝 모양만 보다 한 번
       (분석 패널을 빼도 뒤의 것들이 같은 모양을 만든다), 캔버스 수로 보다
       한 번(화학 결합은 그래프 없이 설명만 있는 분석 패널이다).
       분석 패널에 붙은 id="analysis" 가 유일하고 확실한 표시다. */
    const colEnd = html.search(/<\/section>\n {4}<\/div>\n\n {4}<div/);
    assert.ok(colEnd > sp, f + ' 의 왼쪽 열이 닫히는 자리를 찾을 수 없다');
    const column = html.slice(sp, colEnd);
    assert.match(column, /<section class="analysis-panel" id="analysis"/,
      f + ' 의 그래프가 왼쪽 열 밖에 있다 — 조작 패널 길이만큼 아래로 밀린다');
    assert.ok(!/graph-jump/.test(html),
      f + ' 에 점프 링크가 남아 있다 — 그래프가 바로 아래라 필요 없다');
  }
});

test('판과 지각 변동의 침강판이 캔버스를 벗어나지 않는다', () => {
  /* 길이를 H() 비율로만 잡아 판 끝이 오른쪽·아래로 삐져나가 잘린 채
     멈춘 것처럼 보였다. 가로 여유로도 자르고 clip 으로 막는다. */
  const pt = read(path.join(SIM_DIR, 'plate-tectonics.html'));
  assert.match(pt, /const room = goesLeft \? trenchX : W\(\) - trenchX;/,
    '가로 여유를 안 본다 — 판이 옆으로 삐져나간다');
  assert.match(pt, /ctx\.rect\(0, 0, W\(\), H\(\)\); ctx\.clip\(\);/,
    '캔버스 클리핑이 없다');
  /* 진원은 갈색 맨틀 위에 찍혀서 옅은 주황으로는 안 보였다. 테두리로 대비를 준다. */
  assert.match(pt, /strokeStyle = `rgba\(255,255,255,\$\{a \* \.9\}\)`/,
    '진원 점에 테두리가 없다 — 맨틀 배경에 묻힌다');
});


test('측정값이 그래프 위 가로 스트립으로 나온다', () => {
  /* 측정값이 오른쪽 사이드바 세로 목록이라 조작 패널에 밀려 한참 아래였다.
     최윤지가 입자의 운동에서 무대 아래 가로 스트립으로 옮겼고, 그 방식을
     나머지에도 맞췄다. 세포의 구조만 제외 — 측정값 자체가 없다. */
  const files = fs.readdirSync(SIM_DIR)
    .filter((f) => f.endsWith('.html') && f !== 'index.html' && f !== 'cell-structure.html');
  for (const f of files) {
    const html = read(path.join(SIM_DIR, f));
    assert.match(html, /class="panel measurement-strip"/, f + ' 에 측정 스트립이 없다');
    /* 스트립이 그래프보다 뒤에 있으면 옮긴 의미가 없다. */
    const si = html.indexOf('class="panel measurement-strip"');
    const ai = html.indexOf('<section class="analysis-panel"');
    assert.ok(si > 0 && ai > si, f + ' 의 측정 스트립이 그래프보다 아래에 있다');
    /* 사이드바에 옛 측정 패널이 남으면 값이 두 군데서 갱신돼 하나가 멈춘다. */
    assert.ok(!/<(div|section) class="panel[^"]*">\s*<div class="panel-head"><h2>측정<\/h2>/.test(html),
      f + ' 사이드바에 옛 측정 패널이 남아 있다');
    assert.match(html, /\.measurement-strip \.read \{ display: grid/, f + ' 에 스트립 스타일이 없다');
  }
});


test('입자의 운동은 크기가 이미 질량에 연동돼 있다', () => {
  /* '입자 지름 슬라이더를 넣자'는 제안이 있었는데, 코드를 보니 반지름이
     이미 질량에서 나온다 — Math.cbrt(S.mass). 게다가 그 r 을 벽 충돌과
     입자 충돌 판정에 그대로 쓴다. 지름 슬라이더를 따로 넣으면 질량과
     크기가 어긋나 '무거운데 작은 입자' 같은 게 생긴다.
     이 검사는 그 연결이 끊기는 것을 막는다. */
  const pm = read(path.join(SIM_DIR, 'particle-motion.html'));
  assert.match(pm, /return 2\.2 \+ Math\.cbrt\(S\.mass\) \* 0\.55;/,
    '입자 반지름이 질량에서 나오지 않는다');
  /* 그리기용으로만 쓰고 충돌은 고정값으로 하면 크기 변화가 물리에 반영되지 않는다. */
  assert.match(pm, /p\.x - r < b\.x/, '벽 충돌 판정이 반지름을 안 쓴다');
  assert.match(pm, /const cell = r \* 2\.2;/, '입자 충돌 격자가 반지름을 안 쓴다');
  assert.ok(!/id="psize"|id="diameter"/.test(pm),
    '지름 슬라이더가 따로 생겼다 — 질량과 크기가 어긋난다');
});


test('전기화학의 네른스트 계수가 온도를 따른다', () => {
  /* 본문이 '농도비를 10배 벌리면 29.6 mV' 라고 설명하는데 그게 25°C 값이라는 걸
     볼 수 없었다. 계수는 2.303RT/F 로 온도에 비례한다.
     실측: 0°C 27.10 · 25°C 29.58 · 50°C 32.06 · 100°C 37.03 mV — 손계산과 일치.
     ⚠ 그래프 축(vMax)까지 같이 안 움직이면 선이 잘린다. 화면 수식의 0.0592 도
     하드코딩이라 온도를 바꿔도 그대로였다. */
  const ec = read(path.join(SIM_DIR, 'electrochemistry.html'));
  assert.match(ec, /id="temp"/, '온도 슬라이더가 없다');
  assert.match(ec, /const NERNST = \(\) => 2\.303 \* 8\.314 \* \(S\.temp \+ 273\.15\) \/ 96485;/,
    '네른스트 계수가 온도를 안 읽는다');
  assert.ok(!/NERNST \/ N_ELECTRON/.test(ec),
    '계수를 함수로 안 부르는 자리가 남았다 — 그 자리만 25°C 로 굳는다');
  assert.match(ec, /const vMax = \(NERNST\(\) \/ N_ELECTRON\) \* LMAX;/,
    '그래프 축이 온도를 안 따른다 — 선이 잘린다');
  /* 화면에 찍히는 계산 수식은 온도를 따라야 한다.
     ⚠ 공식 표기(formula-main), 힌트, 주석의 0.0592 는 "교과서의 25°C 값"을
     가리키는 서술이라 그대로 둔다. 템플릿 문자열 안의 계산값만 본다. */
  assert.match(ec, /`E = E° − \(\$\{NERNST\(\)\.toFixed\(4\)\}\//,
    '화면 수식이 온도를 안 따른다');
  /* N_ELECTRON 은 Cu2+ 의 전자 수라 물리 상수다. */
  assert.match(ec, /const N_ELECTRON = 2;/, '전자 수까지 건드렸다');
  assert.match(ec, /t: 'temp'/, '공유 링크로 온도가 복원되지 않는다');
});

test('빛과 파동의 파장이 조작 변수다', () => {
  /* 본문이 'v = fλ 에서 f 가 고정' 이라 설명하고 측정 패널에 λ₂/λ₁ 비도 있는데
     정작 원래 파장을 못 바꿨다. 파장을 바꿔도 비는 그대로라는 게 요점이다 —
     굴절을 정하는 건 파장이 아니라 굴절률이다.
     실측: 20·34·60px 어디서든 λ₂/λ₁ = 0.667 (n1=1, n2=1.5). */
  const wi = read(path.join(SIM_DIR, 'wave-interference.html'));
  assert.match(wi, /id="wl"/, '파장 슬라이더가 없다');
  assert.match(wi, /const basePx = S\.wl;/, '파면 간격이 파장을 안 읽는다');
  assert.match(wi, /\['angle', 'n1', 'n2', 'wl'\]/, '파장이 배선에 빠졌다');
  /* 비는 굴절률만으로 정해져야 한다. 파장이 끼면 물리가 틀린다. */
  assert.match(wi, /el\('r-lam'\)\.textContent = \(S\.n1 \/ S\.n2\)\.toFixed\(3\);/,
    '파장 비가 굴절률만으로 계산되지 않는다');
});


test('해양과 순환의 나침반과 그래프가 어두운 묵대와 맞는다', () => {
  /* 묵대는 밝기 모드와 무관하게 어둡다(surface-dark). 그런데 나침반 글자를
     어두운 회색 rgba(60,70,80)으로, 바람 라벨을 어두운 갈색으로 그려서
     안 보였다. T-S 그래프 배경은 #f7f7f5 하드코딩이라 어두운 graph-wrap 위에
     하얀 박스가 떠 보였다.
     그래프는 랩이 두 모드에서 항상 어두우니 캔버스도 어둡게 — 한 팔레트로
     두 모드에서 다 맞는다. 테마 감지 JS 는 넣지 않는다. */
  const oc = read(path.join(SIM_DIR, 'ocean-circulation.html'));
  assert.match(oc, /ctx\.fillStyle = 'rgba\(255,255,255,\.92\)';[\s\S]{0,120}ctx\.fillText\('북'/, '나침반 글자가 밝지 않다');
  assert.ok(!/ctx\.fillStyle = 'rgba\(60,70,80/.test(oc.replace(/\/\*[\s\S]*?\*\//g, '')),
    '나침반 글자가 어두운 회색으로 돌아갔다');
  assert.match(oc, /gctx\.fillStyle = '#12181f';/, '그래프 배경이 어둡지 않다');
  assert.ok(!/#f7f7f5/.test(oc.replace(/\/\*[\s\S]*?\*\//g, '')),
    '그래프 배경이 하얀색 하드코딩으로 돌아갔다');
});

test('화학 시뮬레이션이 교육과정 상수를 실제로 쓴다', () => {
  /* 숫자를 눈대중으로 넣으면 화면은 그럴듯한데 답이 틀린다.
     설계 단계에서 Solar 가 제시한 값도 두 건이 틀려 직접 계산으로 잡았다.
     여기서는 "그 상수가 코드에 실제로 있는지" 만 지킨다. */
  const must = {
    'chemical-reaction.html': [
      /kf \/ S\.kr/,              // 평형 상수 K = kf/kr
      /Math\.exp\(-\(kfEff\(\) \+ krEff\(\)\)/  // 해석해
    ],
    'acid-base.html': [
      /Math\.sqrt\(c \* c \+ 4 \* Kw\(\)\)/,     // 물의 자동 이온화 포함 정확식
      /13\.995/,                                  // 25°C pKw
      /13\.017/                                   // 60°C pKw
    ],
    'electrochemistry.html': [
      /temp: 25 \}/,                // 기본 25°C — 계수 59.2 mV 로 교과서 값과 같다
      /N_ELECTRON = 2/             // Cu²⁺ + 2e⁻
    ],
    'radioactivity.html': [
      /5730/,                      // 탄소-14
      /8\.02/,                     // 요오드-131
      /30\.17/,                    // 세슘-137
      /1 - Math\.pow\(0\.5, dt \/ S\.half\)/  // 무기억 붕괴 확률
    ]
  };
  const missing = [];
  for (const [file, patterns] of Object.entries(must)) {
    const src = read(path.join(SIM_DIR, file));
    patterns.forEach((re) => {
      if (!re.test(src)) missing.push(`${file}: ${re} 없음`);
    });
  }
  assert.deepStrictEqual(missing, [], '화학 시뮬레이션에서 상수·공식이 빠졌다');
});

test('방사능 시뮬레이션이 원자마다 남은 수명을 그리지 않는다', () => {
  /* 원자에 "남은 수명 바" 를 그리면 "원자에 시계가 있다" 는 오개념이
     오히려 굳는다. 개별 원자는 나이를 먹지 않고, 매 순간 같은 확률로
     붕괴한다는 것이 이 화면의 요점이다. */
  const src = read(path.join(SIM_DIR, 'radioactivity.html'));
  const draw = src.match(/function draw\(\)[\s\S]*?\n  \}/);
  assert.ok(draw, 'draw() 를 찾지 못했다');
  assert.ok(
    !/수명|lifetime|remaining|countdown/i.test(draw[0]),
    'draw() 안에 원자별 수명 표시가 있다 — 오개념을 굳힌다'
  );
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

test('만들어 놓은 페이지가 준비중으로 죽어 있지 않다', () => {
  /* 실제로 있는 페이지인데 네비에서 <span class="soon"> 이면,
     사용자는 그런 게 있는 줄도 모른다. 링크가 틀린 것보다 나쁘다 —
     아무 일도 안 일어나니 버그로 신고조차 안 된다.

     실제로 심화 탐구(/research)가 시뮬레이션 15개 파일의 모바일 메뉴에서
     "준비중" 으로 죽어 있었다. 페이지는 멀쩡히 배포돼 있었다.
     시뮬 링크만 비교하는 기존 검사로는 안 잡혔다. */
  const built = {
    '심화 탐구': 'research/index.html',
    '커뮤니티': 'community.html',
    'AI 과학 도우미': 'science.html',
    '가이드': 'guide.html'
  };
  const dead = [];
  for (const file of PAGES) {
    const src = read(file);
    for (const [label, target] of Object.entries(built)) {
      if (!fs.existsSync(path.join(ROOT, target))) continue;   // 아직 안 만든 건 넘어감
      const re = new RegExp(`<span class="soon">\\s*${label}\\s*</span>`);
      if (re.test(src)) dead.push(`${path.relative(ROOT, file)}: "${label}" 이 준비중인데 ${target} 은 있다`);
    }
  }
  assert.deepStrictEqual(dead, [], '만들어 둔 페이지가 네비에서 죽어 있다');
});

test('네비 링크가 아무 데도 가지 않는 채로 남지 않는다', () => {
  /* href="#" 은 드롭다운을 여는 용도로는 정당하다 — 과목별 메뉴가 그렇다.
     하지만 갈 수 있는 실제 페이지가 있는데 "#" 이면 클릭이 먹통이 된다.
     심화 탐구가 그랬다: 어떤 파일은 /research, 어떤 파일은 # 였다. */
  const broken = [];
  for (const file of PAGES) {
    const src = read(file);
    // data-dropdown 트리거 중, 같은 이름의 실제 페이지가 있는 것
    for (const m of src.matchAll(/<a href="#" data-dropdown="([^"]+)"[^>]*>([^<]*)<\/a>/g)) {
      const key = m[1];
      const hasPage = fs.existsSync(path.join(ROOT, `${key}/index.html`)) ||
                      fs.existsSync(path.join(ROOT, `${key}.html`));
      if (hasPage) broken.push(`${path.relative(ROOT, file)}: "${m[2]}" 가 href="#" 인데 /${key} 페이지가 있다`);
    }
  }
  assert.deepStrictEqual(broken, [], '갈 수 있는 페이지인데 링크가 죽어 있다');
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
