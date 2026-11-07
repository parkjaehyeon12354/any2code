(function () {
  const el = (id) => document.getElementById(id);

  /* ── 화학 반응: 평형은 정지가 아니라 균형이다 ──

     "평형에 도달하면 반응이 멈춘다" 가 흔한 오개념이다. 농도 그래프가
     평평해지니 그렇게 읽힌다. 하지만 평평한 건 '순 변화' 뿐이고,
     A→B 와 B→A 는 같은 속도로 계속 일어난다.

     그래서 화면에 두 가지를 나란히 둔다(Solar 제안):
       순 변화 → 평형에서 0 으로 수렴
       전환 횟수 → 평형 후에도 계속 올라감
     이 대비가 "겉보기는 멈춤, 속은 계속" 을 보여준다.

     두 번째 오개념 "촉매가 생성물을 더 만든다" 도 같은 화면에서 깨진다.
     촉매는 kf 와 kr 을 같은 배율로 곱하므로 K = kf/kr 이 변하지 않는다.

     모델: A ⇌ B (1차 정·역반응). 해석해가 있어 발산 걱정이 없다.
       [A](t) = [A]eq + ([A]0 − [A]eq)·exp(−(kf+kr)t)
       [A]eq = [A]0/(1+K),  K = kf/kr,  τ = 1/(kf+kr)
     직접 계산해 검증했다: kf=.08 kr=.04 A0=.5 → K=2, [A]eq=0.1667, τ=8.33s */

  const S = { kf: 0.08, kr: 0.04, a0: 0.5, cat: 1, temp: 25, dH: 0 };
  let running = true;
  let t = 0;                 // 반응 시각 (초)
  let flips = 0;             // 지금까지 일어난 전환 횟수
  let history = [];          // 그래프용 [t, A, B, 초당전환]
  let particles = [];
  let sparks = [];

  const canvas = el('canvas');
  const ctx = canvas.getContext('2d');
  const graph = el('conc-graph');
  const gctx = graph.getContext('2d');
  let DPR = 1;

  /* 온도 효과 — 촉매와 무엇이 다른지가 이 화면의 두 번째 대비다.
     촉매: kf 와 kr 을 같은 배율로 곱한다 → K 불변, 도달만 빠름
     온도: 반트호프로 K 자체가 바뀐다 → 평형 위치가 옮겨간다

     반트호프  ln(K2/K1) = −ΔH/R · (1/T2 − 1/T1)
     아레니우스 kf(T) = kf(298)·exp(−Ea/R · (1/T − 1/298)),  Ea = 50 kJ/mol
     kr 은 kf/K 로 따라온다 — 그래야 K 가 반트호프와 정확히 맞는다.

     직접 계산해 검증: ΔH=−50kJ, 25→75°C 면 K 2.0 → 0.11 (발열은 작아진다)
                      ΔH=+50kJ 면 2.0 → 36.33 (흡열은 커진다)
                      ΔH=0 이면 2.0 그대로, kf 만 18.17배 빨라진다 */
  const R_GAS = 8.314;                   // J/(mol·K)
  const EA = 50000;                      // 활성화 에너지 J/mol
  const T0 = 298;                        // 기준 25°C (K)
  const tempK = () => S.temp + 273;

  // 이 온도의 평형 상수 — 25°C 값 kf/kr 에서 반트호프로 옮긴다
  const Kconst = () => (S.kf / S.kr) *
    Math.exp(-(S.dH * 1000) / R_GAS * (1 / tempK() - 1 / T0));

  // 촉매는 둘 다 같은 배율(K 불변), 온도는 아레니우스로 kf 를 올린다
  const kfEff = () => S.kf * S.cat * Math.exp(-EA / R_GAS * (1 / tempK() - 1 / T0));
  const krEff = () => kfEff() / Kconst();
  const aEq = () => S.a0 / (1 + Kconst());
  const bEq = () => S.a0 - aEq();
  const tau = () => 1 / (kfEff() + krEff());

  // 해석해 — 수치적분이 아니라 공식이라 오차가 쌓이지 않는다
  function concAt(time) {
    const ae = aEq();
    const a = ae + (S.a0 - ae) * Math.exp(-(kfEff() + krEff()) * time);
    return { a, b: S.a0 - a };
  }

  const N = 60;                                  // 화면 입자 수
  function seed() {
    particles = [];
    for (let i = 0; i < N; i++) {
      particles.push({
        x: Math.random(), y: Math.random(),
        vx: (Math.random() - 0.5) * 0.16,
        vy: (Math.random() - 0.5) * 0.16,
        isB: false,
        glow: 0
      });
    }
    sparks = [];
  }

  /* 화면 입자를 지금 농도에 맞게 맞춘다.
     농도는 해석해로 정확히 계산하고, 입자는 그 결과를 '표현' 한다.
     전환이 일어날 때마다 flips 를 올려 "멈추지 않았다" 를 보여준다. */
  function syncParticles(dt) {
    const { a, b } = concAt(t);
    const wantB = Math.round(b / S.a0 * N);
    const haveB = particles.filter((p) => p.isB).length;

    // 순 변화에 따른 전환
    if (wantB > haveB) {
      let need = wantB - haveB;
      for (const p of particles) {
        if (need <= 0) break;
        if (!p.isB) { p.isB = true; p.glow = 1; flips++; need--; }
      }
    } else if (wantB < haveB) {
      let need = haveB - wantB;
      for (const p of particles) {
        if (need <= 0) break;
        if (p.isB) { p.isB = false; p.glow = 1; flips++; need--; }
      }
    }

    /* ⚠ 여기가 이 화면의 핵심이다.
       순 변화가 0 이어도 정·역 반응은 계속 일어난다. 실제 전환 횟수는
       vf·(입자수/농도) 만큼이므로, 평형에서도 그만큼 A↔B 를 맞바꾼다.
       이걸 빼면 평형에서 화면이 얼어붙어 오개념을 오히려 굳힌다. */
    const vf = kfEff() * a;                       // mol/L/s
    const exchanges = vf / S.a0 * N * dt;         // 이 프레임에 일어날 교환 수
    let whole = Math.floor(exchanges);
    if (Math.random() < exchanges - whole) whole++;

    for (let i = 0; i < whole; i++) {
      const aList = particles.filter((p) => !p.isB);
      const bList = particles.filter((p) => p.isB);
      if (!aList.length || !bList.length) break;
      // A 하나를 B 로, B 하나를 A 로 — 개수는 그대로, 사건은 두 번
      const pa = aList[(Math.random() * aList.length) | 0];
      const pb = bList[(Math.random() * bList.length) | 0];
      pa.isB = true; pa.glow = 1;
      pb.isB = false; pb.glow = 1;
      flips += 2;
      sparks.push({ x: pa.x, y: pa.y, life: 1 });
      sparks.push({ x: pb.x, y: pb.y, life: 1 });
    }
    if (sparks.length > 60) sparks.splice(0, sparks.length - 60);
  }

  // ── 무대 ──
  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const w = canvas.width / DPR, h = canvas.height / DPR;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#121821';
    ctx.fillRect(0, 0, w, h);

    const pad = 16, top = 46;
    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(pad, top, w - pad * 2, h - top - pad);

    const { a, b } = concAt(t);

    // 상단 막대 — A 와 B 의 비율
    const barW = w - pad * 2, barY = 16, barH = 16;
    const aFrac = a / S.a0;
    ctx.fillStyle = '#5b8def';
    ctx.fillRect(pad, barY, barW * aFrac, barH);
    ctx.fillStyle = '#e8615d';
    ctx.fillRect(pad + barW * aFrac, barY, barW * (1 - aFrac), barH);
    ctx.font = '600 11.5px ui-sans-serif, system-ui';
    ctx.fillStyle = 'rgba(255,255,255,.95)';
    ctx.textAlign = 'left';
    ctx.fillText(`A ${a.toFixed(3)}`, pad + 6, barY + 12);
    ctx.textAlign = 'right';
    ctx.fillText(`B ${b.toFixed(3)}`, pad + barW - 6, barY + 12);

    // 입자
    const ix = pad + 6, iy = top + 6, iw = w - pad * 2 - 12, ih = h - top - pad - 12;
    particles.forEach((p) => {
      const px = ix + p.x * iw, py = iy + p.y * ih;
      if (p.glow > 0) {
        ctx.fillStyle = `rgba(255,209,102,${p.glow * 0.55})`;
        ctx.beginPath(); ctx.arc(px, py, 13, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = p.isB ? '#e8615d' : '#5b8def';
      ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill();
    });

    // 전환 섬광
    sparks.forEach((s) => {
      const px = ix + s.x * iw, py = iy + s.y * ih;
      ctx.strokeStyle = `rgba(255,209,102,${s.life * 0.8})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, (1 - s.life) * 22 + 6, 0, Math.PI * 2); ctx.stroke();
    });

    // 평형 여부
    const vf = kfEff() * a, vr = krEff() * b;
    const atEq = Math.abs(vf - vr) < vf * 0.02 && t > tau();
    ctx.textAlign = 'center';
    ctx.font = '700 13px ui-sans-serif, system-ui';
    ctx.fillStyle = atEq ? '#ffd166' : 'rgba(255,255,255,.62)';
    ctx.fillText(
      atEq ? '평형 — 농도는 그대로인데 전환은 계속됩니다' : `반응 진행 중 · ${t.toFixed(1)}초`,
      w / 2, h - 6
    );
  }

  // ── 그래프 ──
  function drawGraph() {
    /* 캔버스는 CSS 를 못 받으니 색을 여기서 받아온다. 예전에는 '#f7f7f5' 를
       박아 놔서 다크 모드에서도 하얀 박스가 그대로 떠 있었다. */
    const P = window.GraphTheme.palette();
    gctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const w = graph.width / DPR, h = graph.height / DPR;
    gctx.clearRect(0, 0, w, h);
    gctx.fillStyle = P.bg;
    gctx.fillRect(0, 0, w, h);

    const pad = { l: 58, r: 62, t: 20, b: 36 };
    const gw = w - pad.l - pad.r, gh = h - pad.t - pad.b;
    const tMax = Math.max(20, tau() * 6);
    const cMax = S.a0 * 1.08;

    const X = (tt) => pad.l + Math.min(1, tt / tMax) * gw;
    const Y = (c) => pad.t + gh - c / cMax * gh;

    gctx.strokeStyle = P.grid;
    gctx.lineWidth = 1;
    gctx.font = '11px ui-sans-serif, system-ui';
    gctx.fillStyle = P.muted;
    gctx.textAlign = 'center';
    for (let i = 0; i <= 4; i++) {
      const xx = pad.l + gw * i / 4;
      gctx.beginPath(); gctx.moveTo(xx, pad.t); gctx.lineTo(xx, pad.t + gh); gctx.stroke();
      gctx.fillText((tMax * i / 4).toFixed(0) + 's', xx, h - 14);
    }
    gctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const yy = pad.t + gh * i / 4;
      gctx.beginPath(); gctx.moveTo(pad.l, yy); gctx.lineTo(pad.l + gw, yy); gctx.stroke();
      gctx.fillText((cMax * (1 - i / 4)).toFixed(2), pad.l - 8, yy + 4);
    }

    // 평형 농도 기준선
    [[aEq(), '#5b8def', '[A] 평형'], [bEq(), '#e8615d', '[B] 평형']].forEach(([c, col, lab]) => {
      gctx.setLineDash([4, 5]);
      gctx.strokeStyle = col; gctx.globalAlpha = .45; gctx.lineWidth = 1.5;
      gctx.beginPath(); gctx.moveTo(pad.l, Y(c)); gctx.lineTo(pad.l + gw, Y(c)); gctx.stroke();
      gctx.globalAlpha = 1; gctx.setLineDash([]);
      gctx.fillStyle = col; gctx.textAlign = 'left';
      gctx.font = '11px ui-sans-serif, system-ui';
      gctx.fillText(`${lab} ${c.toFixed(3)}`, pad.l + gw + 6, Y(c) + 4);
    });

    // 농도 곡선
    [['a', '#5b8def'], ['b', '#e8615d']].forEach(([key, col]) => {
      gctx.beginPath();
      for (let i = 0; i <= 200; i++) {
        const tt = i / 200 * tMax;
        const c = concAt(tt)[key];
        const xx = X(tt), yy = Y(c);
        i ? gctx.lineTo(xx, yy) : gctx.moveTo(xx, yy);
      }
      gctx.strokeStyle = col; gctx.lineWidth = 2.6; gctx.stroke();
    });

    /* 초당 전환 횟수 — 평형에서도 0 이 아니라는 것이 이 그래프의 요점.
       화면 아래쪽에 별도 눈금으로 겹쳐 그린다. */
    const rateMax = kfEff() * S.a0 * 1.15;
    const Yr = (v) => pad.t + gh - v / rateMax * gh * 0.42;
    gctx.beginPath();
    for (let i = 0; i <= 200; i++) {
      const tt = i / 200 * tMax;
      const c = concAt(tt);
      const vf = kfEff() * c.a;
      const xx = X(tt), yy = Yr(vf);
      i ? gctx.lineTo(xx, yy) : gctx.moveTo(xx, yy);
    }
    gctx.strokeStyle = '#2a9d8f'; gctx.lineWidth = 2.2;
    gctx.setLineDash([7, 4]); gctx.stroke(); gctx.setLineDash([]);
    const eqRate = kfEff() * aEq();
    gctx.fillStyle = '#1d7870';
    gctx.textAlign = 'left';
    gctx.font = '600 11.5px ui-sans-serif, system-ui';
    gctx.fillText(`정반응 속도 — 평형에서도 ${eqRate.toFixed(4)} 로 0 이 아닙니다`,
                  pad.l + 8, Yr(eqRate) - 8);

    // 현재 시각
    if (t < tMax) {
      gctx.strokeStyle = 'rgba(0,0,0,.35)'; gctx.lineWidth = 1.5;
      gctx.beginPath(); gctx.moveTo(X(t), pad.t); gctx.lineTo(X(t), pad.t + gh); gctx.stroke();
    }

    gctx.fillStyle = P.muted;
    gctx.textAlign = 'center';
    gctx.font = '11px ui-sans-serif, system-ui';
    gctx.fillText('시간 (초)', pad.l + gw / 2, h - 2);
  }

  // ── 수치 ──
  function readout() {
    const { a, b } = concAt(t);
    const vf = kfEff() * a, vr = krEff() * b;
    const net = vf - vr;

    el('r-a').textContent = a.toFixed(4) + ' mol/L';
    el('r-b').textContent = b.toFixed(4) + ' mol/L';
    el('r-vf').textContent = vf.toFixed(5);
    el('r-vr').textContent = vr.toFixed(5);
    el('r-k').textContent = Kconst().toFixed(3);

    const sNet = el('s-net');
    sNet.textContent = (net >= 0 ? '+' : '') + net.toFixed(5);
    sNet.className = Math.abs(net) < 1e-4 ? '' : (net > 0 ? 'down' : 'up');
    el('s-flips').textContent = flips.toLocaleString() + ' 회';

    const atEq = Math.abs(net) < vf * 0.02 && t > tau();
    const v = el('verdict');
    if (atEq) {
      v.className = 'verdict warn';
      v.innerHTML = '<strong>평형입니다.</strong> 순 변화는 0 에 가깝지만 ' +
        `정반응 속도가 <strong>${vf.toFixed(5)}</strong> 로 여전히 0 이 아닙니다. ` +
        '전환 횟수가 계속 올라가는 것을 보세요 — ' +
        '<strong>반응이 멈춘 게 아니라 양방향이 같은 속도로 달리고 있습니다.</strong>';
    } else if (S.cat > 1.05) {
      v.className = 'verdict';
      v.innerHTML = `촉매 <strong>${S.cat}배</strong>로 ` +
        `<strong>${(1 / S.cat * 100).toFixed(0)}%</strong> 시간에 평형에 닿습니다. ` +
        `그런데 도착점은 <strong>[A] ${aEq().toFixed(3)} · [B] ${bEq().toFixed(3)}</strong> 로 ` +
        '촉매가 없을 때와 <strong>완전히 같습니다.</strong>';
    } else {
      v.className = 'verdict';
      v.innerHTML = `반응이 진행 중입니다. 정반응이 역반응보다 빨라 ` +
        `A 가 줄고 B 가 늘어납니다. ` +
        `<strong>[A] ${aEq().toFixed(3)} · [B] ${bEq().toFixed(3)}</strong> 에서 균형이 맞습니다.`;
    }

    el('note').textContent =
      `K = ${Kconst().toFixed(3)} (${S.temp}°C, ΔH ${S.dH > 0 ? '+' : ''}${S.dH} kJ/mol). ` +
      `촉매는 두 속도상수를 같은 배율로 키우므로 K 는 변하지 않습니다. ` +
      `평형 도달 시간 τ = ${tau().toFixed(2)}초.`;
  }

  // ── 입력 ──
  const labels = {
    kf: (v) => Number(v).toFixed(3) + ' /s',
    kr: (v) => Number(v).toFixed(3) + ' /s',
    a0: (v) => Number(v).toFixed(2) + ' mol/L',
    cat: (v) => Number(v) <= 1.001 ? '없음 (1배)' : Number(v).toFixed(1) + '배',
    temp: (v) => Number(v) + ' °C'
  };

  /* 반응열은 세 값 중 하나만 쓴다 — 연속 슬라이더로 두면 학생이
     "발열이면 K 가 작아진다" 라는 구분을 잡기 어렵다. */
  function setDH(v) {
    S.dH = v;
    el('dh-out').textContent = (v < 0 ? '발열 ' : v > 0 ? '흡열 +' : '열중성 ') + v + ' kJ/mol';
    el('dh-exo').setAttribute('aria-pressed', String(v < 0));
    el('dh-zero').setAttribute('aria-pressed', String(v === 0));
    el('dh-endo').setAttribute('aria-pressed', String(v > 0));
    restart(); readout();
  }

  function restart() { t = 0; flips = 0; history = []; seed(); }

  ['kf', 'kr', 'a0', 'cat', 'temp'].forEach((k) => {
    const input = el(k);
    input.addEventListener('input', () => {
      S[k] = Number(input.value);
      el(k + '-out').textContent = labels[k](input.value);
      restart();
      syncPresets();
      readout();
    });
  });

  el('dh-exo').addEventListener('click', () => setDH(-50));
  el('dh-zero').addEventListener('click', () => setDH(0));
  el('dh-endo').addEventListener('click', () => setDH(50));

  const presetBox = el('presets');
  presetBox.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      S.kf = Number(b.dataset.kf);
      S.kr = Number(b.dataset.kr);
      S.a0 = Number(b.dataset.a0);
      S.cat = Number(b.dataset.cat);
      ['kf', 'kr', 'a0', 'cat', 'temp'].forEach((k) => {
        el(k).value = S[k];
        el(k + '-out').textContent = labels[k](S[k]);
      });
      restart(); syncPresets(); readout();
    });
  });

  function syncPresets() {
    presetBox.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', String(
        Math.abs(Number(b.dataset.kf) - S.kf) < 1e-9 &&
        Math.abs(Number(b.dataset.kr) - S.kr) < 1e-9 &&
        Math.abs(Number(b.dataset.a0) - S.a0) < 1e-9 &&
        Math.abs(Number(b.dataset.cat) - S.cat) < 1e-9
      ));
    });
  }

  el('toggle').addEventListener('click', () => {
    running = !running;
    el('toggle').textContent = running ? '일시정지' : '이어서';
  });
  el('reset').addEventListener('click', () => {
    S.kf = 0.08; S.kr = 0.04; S.a0 = 0.5; S.cat = 1;
    ['kf', 'kr', 'a0', 'cat'].forEach((k) => {
      el(k).value = S[k];
      el(k + '-out').textContent = labels[k](S[k]);
    });
    restart(); syncPresets(); readout();
  });

  el('share').addEventListener('click', async () => {
    const said = el('share-said');
    try {
      const me = await Session.refresh();
      if (!me) { said.textContent = '로그인이 필요합니다.'; return; }
      const q = new URLSearchParams({ kf: S.kf, kr: S.kr, a0: S.a0, cat: S.cat, temp: S.temp, dh: S.dH });
      const url = location.origin + location.pathname + '?' + q;
      const b = el('share-url');
      b.value = url; b.hidden = false; b.select();
      try { await navigator.clipboard.writeText(url); said.textContent = '복사했습니다.'; }
      catch { said.textContent = '주소를 복사해 주세요.'; }
    } catch { said.textContent = '잠시 후 다시 시도해 주세요.'; }
  });

  function applyQuery() {
    const q = new URLSearchParams(location.search);
    ['kf', 'kr', 'a0', 'cat', 'temp'].forEach((k) => {
      const v = Number(q.get(k));
      if (q.get(k) === null || !Number.isFinite(v)) return;
      const input = el(k);
      const c = Math.max(Number(input.min), Math.min(Number(input.max), v));
      S[k] = c; input.value = c;
      el(k + '-out').textContent = labels[k](c);
    });
    const dh = Number(q.get('dh'));
    if ([-50, 0, 50].includes(dh)) setDH(dh);
    syncPresets();
  }

  // ── 루프 ──
  let last = 0;
  function frame(ts) {
    const now = ts / 1000;
    if (!last) last = now;
    const dt = Math.min(0.1, now - last);
    last = now;

    if (running) {
      t += dt;
      // 입자 이동
      particles.forEach((p) => {
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.x < 0 || p.x > 1) { p.vx = -p.vx; p.x = Math.max(0, Math.min(1, p.x)); }
        if (p.y < 0 || p.y > 1) { p.vy = -p.vy; p.y = Math.max(0, Math.min(1, p.y)); }
        if (p.glow > 0) p.glow = Math.max(0, p.glow - dt * 3);
      });
      sparks.forEach((s) => { s.life -= dt * 2.2; });
      sparks = sparks.filter((s) => s.life > 0);

      syncParticles(dt);
      readout();
    }
    draw(); drawGraph();
    requestAnimationFrame(frame);
  }

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || 900;
    canvas.width = w * DPR;
    canvas.height = Math.round(w * 0.54) * DPR;
    canvas.style.height = Math.round(w * 0.54) + 'px';
    const gw = graph.clientWidth || 900;
    graph.width = gw * DPR;
    graph.height = 360 * DPR;
  }

  applyQuery();
  restart();
  readout();
  resize();
  window.GraphTheme.onChange(drawGraph);   // 밝기 모드가 바뀌면 새 팔레트로 다시 그린다
  window.addEventListener('resize', resize);
  requestAnimationFrame(frame);
})();
