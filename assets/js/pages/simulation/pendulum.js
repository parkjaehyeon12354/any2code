(function () {
  const el = (id) => document.getElementById(id);

  /* ── 물리 ──
     단진자의 운동방정식. 근사 없이 sin θ 를 그대로 쓴다 —
     "각도가 크면 근사식과 어긋난다" 를 보여주는 게 이 화면의 목적이라
     θ 로 근사해 버리면 볼 것이 없어진다.

         θ'' = -(g/L)·sin θ - b·θ'

     적분은 반음(semi-implicit) 오일러다. 속도를 먼저 갱신하고 그 속도로 위치를 옮긴다.
     보통 오일러법을 쓰면 감쇠를 0으로 둬도 진폭이 서서히 커져서, 학생이 물리가 아니라
     수치 오차를 관찰하게 된다. 순서만 바꾸면 그 문제가 사라진다. */
  const G_EARTH = 9.80665;
  /* 중력 가속도는 이제 조작 변수다. 천체별 값(m/s²):
     달 1.62 · 화성 3.72 · 지구 9.81 · 목성 24.79 */
  const G = () => params.g;

  /* 화면 주사율(60Hz·144Hz)이 물리 결과를 바꾸면 안 되므로 고정 간격으로 적분한다.
     ponytail: 탭을 오래 숨겼다가 돌아오면 밀린 시간이 한꺼번에 들어온다. 0.25초로
     잘라 흘린다 — 그 구간의 운동은 건너뛰지만, 붙잡고 계산하면 화면이 멈춘다. */
  const DT = 1 / 480;
  const MAX_CATCHUP = 0.25;

  const state = {
    theta: 0,      // 연직에서 잰 각 (rad)
    omega: 0,      // 각속도 (rad/s)
    t: 0,          // 시작부터의 시각 (s)
    running: true
  };

  const params = { L: 1, deg: 20, b: 0, m: 1, g: G_EARTH };

  /* 주기 측정 — 아래로 0을 지나는 순간을 잡아 그 간격을 잰다.
     최대점을 추적하지 않는 이유: 감쇠가 있으면 최대점이 매번 달라져 흔들린다.
     0 통과는 감쇠가 있어도 위치가 안정적이다. */
  let lastCross = null;
  let periods = [];
  let prevTheta = 0;
  const graphHistory = { time: [], theta: [], omega: [] };
  let lastGraphSample = -Infinity;

  function reset() {
    state.theta = params.deg * Math.PI / 180;
    state.omega = 0;
    state.t = 0;
    prevTheta = state.theta;
    lastCross = null;
    periods = [];
    lastGraphSample = -Infinity;
    graphHistory.theta = [];
    graphHistory.omega = [];
    graphHistory.time = [];
  }

  function step() {
    // 반음 오일러: 속도 먼저, 그 속도로 위치
    /* 저항 '힘' 은 속도에 비례하고, 가속도는 그 힘을 질량으로 나눈 것이다.
       같은 저항에서 무거운 추는 천천히 멈춘다 — 주기(무저항)는 질량과 무관하지만
       감쇠는 관련이 있다. m=1 이면 기존 식과 같다. */
    const acc = -(G() / params.L) * Math.sin(state.theta) - (params.b / params.m) * state.omega;
    state.omega += acc * DT;
    state.theta += state.omega * DT;
    state.t += DT;

    // 아래로(+ → -) 0 통과. 선형 보간으로 정확한 시각을 잡는다
    if (prevTheta > 0 && state.theta <= 0) {
      const frac = prevTheta / (prevTheta - state.theta);   // 0..1
      const crossAt = state.t - DT + frac * DT;
      if (lastCross !== null) {
        periods.push(crossAt - lastCross);
        if (periods.length > 5) periods.shift();            // 최근 것만 본다
      }
      lastCross = crossAt;
    }
    prevTheta = state.theta;
  }

  /** 측정 주기. 아직 한 바퀴도 안 돌았으면 null */
  const measured = () =>
    periods.length ? periods.reduce((a, b) => a + b, 0) / periods.length : null;

  const idealPeriod = () => 2 * Math.PI * Math.sqrt(params.L / G());

  /* ── 그리기 ── */
  const canvas = el('canvas');
  const ctx = canvas.getContext('2d');
  const graphCanvas = el('pendulum-graph');
  const graphCtx = graphCanvas.getContext('2d');

  function resize() {
    const w = canvas.clientWidth;
    // 무대 높이를 조금 줄여 측정값과 그래프를 첫 화면에서 더 빨리 확인한다.
    const h = Math.round(w * 0.56);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const gw = graphCanvas.clientWidth, gh = 400;
    graphCanvas.width = Math.round(gw * dpr);
    graphCanvas.height = Math.round(gh * dpr);
    graphCanvas.style.height = gh + 'px';
    graphCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    const w = canvas.clientWidth;
    const h = canvas.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, w, h);

    const pivotX = w / 2;
    const pivotY = h * 0.14;
    // 줄이 가장 길 때(2m)도 화면 안에 들어오도록 축척을 맞춘다
    const scale = (h * 0.72) / 2;
    const len = params.L * scale;

    const bobX = pivotX + len * Math.sin(state.theta);
    const bobY = pivotY + len * Math.cos(state.theta);

    // 연직선 — 어디가 평형인지 보이면 각도를 읽기 쉽다
    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(pivotX, pivotY);
    ctx.lineTo(pivotX, pivotY + len + 16);
    ctx.stroke();
    ctx.setLineDash([]);

    // 진폭 호 — 어디까지 갔다 오는지
    const amp = params.deg * Math.PI / 180;
    ctx.strokeStyle = 'rgba(255,255,255,.22)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(pivotX, pivotY, len, Math.PI / 2 - amp, Math.PI / 2 + amp);
    ctx.stroke();

    // 줄
    ctx.strokeStyle = '#9a9a9a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pivotX, pivotY);
    ctx.lineTo(bobX, bobY);
    ctx.stroke();

    // 고정점
    ctx.fillStyle = '#9a9a9a';
    ctx.beginPath();
    ctx.arc(pivotX, pivotY, 5, 0, Math.PI * 2);
    ctx.fill();

    // 추 — 무대에서 가장 밝다. 눈이 여기로 오게 한다 (같은 재질이면 부피 ∝ 질량, 반지름 ∝ 세제곱근)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(bobX, bobY, 15 * Math.cbrt(params.m), 0, Math.PI * 2);
    ctx.fill();
  }

  /* ── 화면 갱신 ──
     숫자는 프레임마다 고치면 읽을 수가 없다. 10Hz 로 늦춘다. */
  let lastRead = 0;

  function paintNumbers() {
    const deg = state.theta * 180 / Math.PI;
    el('r-theta').textContent = deg.toFixed(3) + '°';
    el('r-omega').textContent = state.omega.toFixed(4) + ' rad/s';

    const m = measured();
    const ideal = idealPeriod();
    el('r-ideal').textContent = ideal.toFixed(3) + ' s';
    el('r-measured').textContent = m ? m.toFixed(3) + ' s' : '재는 중…';

    const gapEl = el('r-gap');
    if (!m) {
      gapEl.textContent = '—';
      gapEl.className = 'gap same';
      el('note').textContent = '한 번 왕복하면 주기가 나옵니다.';
      return;
    }

    const pct = (m - ideal) / ideal * 100;
    gapEl.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
    // 0.5% 아래면 사실상 같다고 봐도 되는 구간이라 색을 뺀다
    gapEl.className = Math.abs(pct) < 0.5 ? 'gap same' : 'gap';

    el('note').textContent = Math.abs(pct) < 0.5
      ? '이 각도에서는 근사식이 거의 그대로 맞습니다.'
      : '측정 주기가 근사식보다 깁니다. 각도가 커질수록 이 차이가 벌어집니다 — '
        + 'T = 2π√(L/g) 가 sin θ ≈ θ 로 놓고 유도한 식이기 때문입니다.';
  }

  function sampleGraph() {
    if (state.t - lastGraphSample < 0.05) return;
    lastGraphSample = state.t;
    graphHistory.time.push(state.t);
    graphHistory.theta.push(state.theta * 180 / Math.PI);
    graphHistory.omega.push(state.omega);
    if (graphHistory.theta.length > 240) { graphHistory.time.shift(); graphHistory.theta.shift(); graphHistory.omega.shift(); }
  }

  function drawGraph() {
    /* 캔버스는 CSS 를 못 받으니 색을 여기서 받아온다. */
    const P = window.GraphTheme.palette();
    const g=graphCtx,cw=graphCanvas.clientWidth,ch=graphCanvas.height/(window.devicePixelRatio||1),x=72,w=cw-96,plotH=125;
    g.clearRect(0,0,cw,ch);g.font='12px system-ui';g.textBaseline='middle';
    const minT=Math.max(0,state.t-12),maxT=Math.max(minT+.001,state.t);
    const chart=(values,top,color,title,unit,scale)=>{
      g.fillStyle=P.panel;g.fillRect(x,top,w,plotH);g.strokeStyle=P.grid;g.lineWidth=1;
      for(let j=0;j<=4;j++){const py=top+j/4*plotH,value=scale*(1-j/2);g.beginPath();g.moveTo(x,py);g.lineTo(x+w,py);g.stroke();g.fillStyle=P.muted;g.textAlign='right';g.fillText(value.toFixed(unit==='°'?1:2),x-9,py);}
      for(let j=0;j<=6;j++){const px=x+j/6*w,tick=minT+(maxT-minT)*j/6;g.beginPath();g.moveTo(px,top);g.lineTo(px,top+plotH);g.stroke();if(top>180){g.fillStyle=P.muted;g.textAlign='center';g.fillText(tick.toFixed(1),px,top+plotH+16);}}
      g.strokeStyle=P.muted;g.beginPath();g.moveTo(x,top);g.lineTo(x,top+plotH);g.lineTo(x+w,top+plotH);g.stroke();g.fillStyle=color;g.font='600 13px system-ui';g.textAlign='left';g.fillText(`${title}  현재 ${values.length?values[values.length-1].toFixed(unit==='°'?3:4):'0'} ${unit}`,x,top-14);g.font='12px system-ui';
      if(values.length>1){
        g.save();g.beginPath();g.rect(x+1,top+1,w-2,plotH-2);g.clip();
        g.strokeStyle=color;g.lineWidth=2;g.beginPath();values.forEach((v,i)=>{const px=x+(graphHistory.time[i]-minT)/(maxT-minT)*w,py=top+plotH/2-v/scale*plotH*.48;i?g.lineTo(px,py):g.moveTo(px,py)});g.stroke();
        const v=values[values.length-1],py=top+plotH/2-v/scale*plotH*.48;g.fillStyle=color;g.beginPath();g.arc(x+w-4,py,4,0,Math.PI*2);g.fill();g.restore();
      }
    };
    chart(graphHistory.theta,34,'#71aeff','각도 θ','°',90);
    chart(graphHistory.omega,225,'#e6a85c','각속도 ω','rad/s',12);
    g.fillStyle='rgba(255,255,255,.8)';g.textAlign='center';g.fillText('시간 t (s)',x+w/2,386);
  }

  let prev = performance.now();
  let acc = 0;

  function frame(now) {
    let elapsed = (now - prev) / 1000;
    prev = now;
    if (elapsed > MAX_CATCHUP) elapsed = MAX_CATCHUP;

    if (state.running) {
      acc += elapsed;
      while (acc >= DT) { step(); acc -= DT; }
    }

    draw();
    if (now - lastRead > 100) { paintNumbers(); lastRead = now; }
    sampleGraph();
    drawGraph();
    requestAnimationFrame(frame);
  }

  /* ── 조작 ── */
  const lenIn = el('len'), angIn = el('ang'), dampIn = el('damp'), massIn = el('mass'), gravIn = el('grav');

  /* 가까운 천체 이름을 붙인다 — 숫자만 보면 1.62 가 무슨 값인지 모른다.
     0.3 안쪽이면 그 천체로 본다(슬라이더 step 0.01 이라 정확히 맞추기 어렵다). */
  const BODIES = [[1.62, '달'], [3.72, '화성'], [8.87, '금성'], [9.81, '지구'], [24.79, '목성']];
  function bodyName(g) {
    const hit = BODIES.find(([v]) => Math.abs(g - v) < 0.3);
    return hit ? hit[1] : '가상';
  }

  function syncLabels() {
    el('len-out').textContent = params.L.toFixed(2) + ' m';
    el('ang-out').textContent = params.deg + '°';
    el('damp-out').textContent = params.b.toFixed(2) + ' /s';
    el('mass-out').textContent = params.m.toFixed(1) + ' kg';
    el('grav-out').textContent = params.g.toFixed(2) + ' m/s² · ' + bodyName(params.g);
  }

  lenIn.addEventListener('input', function () {
    params.L = Number(this.value);
    syncLabels();
    periods = []; lastCross = null;   // 길이가 바뀌면 이전 측정은 의미가 없다
  });

  angIn.addEventListener('input', function () {
    params.deg = Number(this.value);
    syncLabels();
    reset();                          // 처음 각도는 다시 놓아야 바뀐다
  });

  dampIn.addEventListener('input', function () {
    params.b = Number(this.value);
    syncLabels();
    periods = []; lastCross = null;
  });

  massIn.addEventListener('input', function () {
    params.m = Number(this.value);
    syncLabels();
    /* 측정 주기는 초기화하지 않는다 — 질량을 움직이는 바로 그 순간에도
       주기가 그대로인 걸 보는 게 이 슬라이더의 존재 이유다. */
  });

  gravIn.addEventListener('input', function () {
    params.g = Number(this.value);
    syncLabels();
    periods = []; lastCross = null;   // 중력이 바뀌면 이전 측정은 의미가 없다
  });

  el('toggle').addEventListener('click', function () {
    state.running = !state.running;
    this.textContent = state.running ? '일시정지' : '이어서';
  });

  el('reset').addEventListener('click', function () {
    reset();
    el('stage-said').textContent = '';
  });

  /* ── 공유 ──
     평소에는 주소를 손대지 않는다. 슬라이더를 움직일 때마다 history 를 바꾸면
     뒤로가기가 슬라이더 되감기가 되어 버린다. 누를 때만 주소를 만든다. */
  function shareUrl() {
    const u = new URL(location.href);
    u.search = new URLSearchParams({
      L: params.L.toFixed(2),
      a: String(params.deg),
      b: params.b.toFixed(2),
      m: params.m.toFixed(1),
      g: params.g.toFixed(2)
    }).toString();
    return u.toString();
  }

  el('share').addEventListener('click', async function () {
    const said = el('share-said');
    const box = el('share-url');
    const url = shareUrl();

    /* 로그인한 사람만 링크를 만든다.
       캐시(Session.load)가 아니라 서버에 물어본다 — 캐시는 로그아웃 뒤에도 잠시 남아
       있어서, 없는 세션을 믿고 링크를 내주게 된다. */
    let user = null;
    said.textContent = '확인 중…';
    try { user = await Session.refresh(); } catch { user = null; }

    if (!user) {
      /* 로그인하면 홈으로 떨어진다 (콜백이 '/' 로 고정). 지금 조건을 들고 있다가
         돌아왔을 때 이어서 쓸 수 있게 저장해 둔다 — 슬라이더를 다시 맞추게 하면
         공유하려던 그 조건이 아니게 된다. */
      try { sessionStorage.setItem('pendulum_share_pending', url); } catch { /* 저장만 못 할 뿐 */ }
      said.textContent = '로그인이 필요합니다. 로그인 화면으로 이동합니다…';
      box.hidden = true;
      window.location.href = '/login';
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      said.textContent = '복사했습니다.';
      box.hidden = true;
    } catch {
      // 권한이 없거나 브라우저가 막으면 직접 복사할 수 있게 보여준다
      box.value = url;
      box.hidden = false;
      box.select();
      said.textContent = '복사가 막혀 있어 주소를 띄웠습니다.';
    }
  });

  /* 공유 링크로 들어왔을 때만 조건을 복원한다. 값이 범위를 벗어나면 무시한다 —
     주소는 누구나 고칠 수 있고, 이상한 값이 들어오면 화면이 깨진다. */
  function applyQuery() {
    const q = new URLSearchParams(location.search);
    const num = (key, lo, hi, fallback) => {
      const v = Number(q.get(key));
      return Number.isFinite(v) && v >= lo && v <= hi ? v : fallback;
    };
    params.L = num('L', 0.2, 2, 1);
    params.deg = Math.round(num('a', 5, 90, 20));
    params.b = num('b', 0, 0.5, 0);
    params.m = num('m', 0.1, 2, 1);
    params.g = num('g', 1.6, 24.8, G_EARTH);

    lenIn.value = params.L;
    angIn.value = params.deg;
    dampIn.value = params.b;
    massIn.value = params.m;
    gravIn.value = params.g;

    if (q.has('L') || q.has('a') || q.has('b') || q.has('m') || q.has('g')) {
      el('stage-said').textContent = '공유된 조건으로 시작했습니다.';
      return true;
    }
    return false;
  }

  /* 공유하려다 로그인하러 갔던 사람을 위해. 로그인 콜백이 홈으로 고정돼 있어서
     이 화면으로 자동으로 돌아오지는 못한다. 다시 들어왔을 때 그때 조건을 되살린다. */
  function restorePending(hadQuery) {
    let pending = null;
    try {
      pending = sessionStorage.getItem('pendulum_share_pending');
      if (pending) sessionStorage.removeItem('pendulum_share_pending');
    } catch { return; }

    if (!pending || hadQuery) return;   // 주소에 조건이 있으면 그쪽이 우선이다

    let q;
    try { q = new URL(pending, location.href).searchParams; } catch { return; }

    const num = (key, lo, hi, fallback) => {
      const v = Number(q.get(key));
      return Number.isFinite(v) && v >= lo && v <= hi ? v : fallback;
    };
    params.L = num('L', 0.2, 2, params.L);
    params.deg = Math.round(num('a', 5, 90, params.deg));
    params.b = num('b', 0, 0.5, params.b);

    lenIn.value = params.L;
    angIn.value = params.deg;
    dampIn.value = params.b;
    el('stage-said').textContent = '로그인 전 조건을 되살렸습니다.';
    el('share-said').textContent = '공유 링크 만들기를 다시 눌러 주세요.';
  }

  restorePending(applyQuery());
  syncLabels();
  reset();
  resize();
  window.GraphTheme.onChange(drawGraph);   // 밝기 모드가 바뀌면 새 팔레트로 다시 그린다
  window.addEventListener('resize', resize);
  requestAnimationFrame(frame);
})();
