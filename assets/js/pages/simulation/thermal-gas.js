(function () {
  const el = (id) => document.getElementById(id);

  /* ── 열과 통계: 온도가 같다 ≠ 속도가 같다 ──

     "같은 온도면 입자도 같은 속도" 가 흔한 오개념이다. 온도는 속도가 아니라
     '입자 하나당 평균 운동에너지' 의 눈금이다. ½mv² 이 같아야 하므로
     가벼운 입자가 더 빨라야 한다. 300K 에서 He 는 1368m/s, O2 는 484m/s 다.

     설계는 Solar 4 Pro 와 함께 잡았다. Solar 가 공식은 평균속력 √(8kT/πm) 로
     써놓고 숫자는 rms √(3kT/m) 로 계산한 오류가 있어 지적했고, 교육과정에서
     쓰는 rms 로 통일하기로 했다. 검증값은 전부 직접 계산해 확인했다. */

  const kB = 1.380649e-23;          // 볼츠만 상수 (J/K)
  const NA = 6.02214076e23;         // 아보가드로 수

  const S = { temp: 300, mA: 4, mB: 32, count: 46 };
  let running = true;

  const canvas = el('canvas');
  const ctx = canvas.getContext('2d');
  const graph = el('dist-graph');
  const gctx = graph.getContext('2d');
  let DPR = 1;

  // 분자량(g/mol) → 입자 하나의 질량(kg)
  const massOf = (M) => M / 1000 / NA;
  // 제곱평균제곱근 속력 — ½mv² = (3/2)kT 에서 바로 나온다
  const vRms = (T, M) => Math.sqrt(3 * kB * T / massOf(M));
  // 최빈 속력 — 분포의 봉우리
  const vMp = (T, M) => Math.sqrt(2 * kB * T / massOf(M));
  // 입자 하나의 평균 운동에너지 — 기체 종류와 무관
  const meanEk = (T) => 1.5 * kB * T;

  /* 맥스웰-볼츠만 속력 분포.
     f(v) = 4π(m/2πkT)^{3/2} v² exp(−mv²/2kT) */
  function mbPdf(v, T, M) {
    const m = massOf(M);
    const a = m / (2 * Math.PI * kB * T);
    return 4 * Math.PI * Math.pow(a, 1.5) * v * v * Math.exp(-m * v * v / (2 * kB * T));
  }

  /* 화면용 입자. 실제 속력(m/s)을 픽셀 속도로 줄여 쓴다.
     분포에서 뽑아야 "모두 같은 속도가 아니다" 가 눈에 보인다. */
/* 입자 수는 조작 변수다(S.count) — 적으면 표본 오차로 측정 속력이 이론값에서
     벗어난다. 그게 이 슬라이더의 존재 이유다. */
  let boxes = [[], []];

  // 맥스웰-볼츠만 분포에서 속력 하나를 뽑는다(기각 표본).
  function sampleSpeed(T, M) {
    const peak = vMp(T, M);
    const fMax = mbPdf(peak, T, M);
    for (let i = 0; i < 200; i++) {
      const v = Math.random() * peak * 3.2;
      if (Math.random() * fMax <= mbPdf(v, T, M)) return v;
    }
    return peak;
  }

  function seed() {
    boxes = [0, 1].map((k) => {
      const M = k === 0 ? S.mA : S.mB;
      const list = [];
      for (let i = 0; i < S.count; i++) {
        const speed = sampleSpeed(S.temp, M);
        const th = Math.random() * Math.PI * 2;
        list.push({
          x: Math.random(), y: Math.random(),      // 0~1 로 두고 그릴 때 환산
          dx: Math.cos(th), dy: Math.sin(th),
          speed
        });
      }
      return list;
    });
  }

  // ── 무대 ──
  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const w = canvas.width / DPR, h = canvas.height / DPR;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0f1620';
    ctx.fillRect(0, 0, w, h);

    const pad = 14, gap = 16;
    const bw = (w - pad * 2 - gap) / 2, bh = h - 62;
    const boxDefs = [
      { x: pad, label: '왼쪽', M: S.mA, color: '#6ee7f0', dim: 'rgba(110,231,240,.16)' },
      { x: pad + bw + gap, label: '오른쪽', M: S.mB, color: '#f2a65a', dim: 'rgba(242,166,90,.16)' }
    ];

    boxDefs.forEach((b, k) => {
      // 상자
      ctx.fillStyle = 'rgba(255,255,255,.03)';
      ctx.fillRect(b.x, 44, bw, bh);
      ctx.strokeStyle = 'rgba(255,255,255,.22)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(b.x, 44, bw, bh);

      // 제목 — 분자량과 속력
      const v = vRms(S.temp, b.M);
      ctx.fillStyle = b.color;
      ctx.font = '700 13px ui-sans-serif, system-ui';
      ctx.textAlign = 'left';
      ctx.fillText(`${b.M.toFixed(1)} g/mol`, b.x + 4, 20);
      ctx.fillStyle = 'rgba(255,255,255,.72)';
      ctx.font = '12px ui-sans-serif, system-ui';
      ctx.fillText(`${Math.round(v).toLocaleString()} m/s`, b.x + 4, 36);

      // 입자 — 무거울수록 크게
      const rad = 2.6 + Math.min(6, Math.sqrt(b.M) * 0.62);
      boxes[k].forEach((p) => {
        const px = b.x + 4 + p.x * (bw - 8);
        const py = 48 + p.y * (bh - 8);
        ctx.fillStyle = b.color;
        ctx.beginPath(); ctx.arc(px, py, rad, 0, Math.PI * 2); ctx.fill();
        // 빠른 입자는 꼬리를 남겨 속도감을 준다
        const tail = Math.min(16, p.speed / vRms(S.temp, b.M) * 9);
        ctx.strokeStyle = b.dim;
        ctx.lineWidth = rad * 1.1;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - p.dx * tail, py - p.dy * tail);
        ctx.stroke();
      });
    });

    // 가운데 안내
    const va = vRms(S.temp, S.mA), vb = vRms(S.temp, S.mB);
    const ratio = va / vb;
    ctx.textAlign = 'center';
    ctx.font = '600 12.5px ui-sans-serif, system-ui';
    ctx.fillStyle = 'rgba(255,255,255,.66)';
    const msg = Math.abs(ratio - 1) < 0.005
      ? `분자량이 같아 속도도 같습니다`
      : `같은 ${S.temp}K 인데 속도는 ${(ratio > 1 ? ratio : 1 / ratio).toFixed(2)}배 차이`;
    ctx.fillText(msg, w / 2, h - 8);
  }

  // ── 분포 그래프 ──
  function drawGraph() {
    /* 캔버스는 CSS 를 못 받으니 색을 여기서 받아온다. 예전에는 '#f7f7f5' 를
       박아 놔서 다크 모드에서도 하얀 박스가 그대로 떠 있었다. */
    const P = window.GraphTheme.palette();
    gctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const w = graph.width / DPR, h = graph.height / DPR;
    gctx.clearRect(0, 0, w, h);
    gctx.fillStyle = P.bg;
    gctx.fillRect(0, 0, w, h);

    const pad = { l: 52, r: 20, t: 20, b: 38 };
    const gw = w - pad.l - pad.r, gh = h - pad.t - pad.b;

    // x 축 범위 — 둘 중 빠른 쪽 기준
    const light = Math.min(S.mA, S.mB);
    const vMax = vMp(S.temp, light) * 3.1;
    const X = (v) => pad.l + v / vMax * gw;

    // y 축 — 두 분포의 최대값
    let peak = 0;
    [S.mA, S.mB].forEach((M) => {
      const p = mbPdf(vMp(S.temp, M), S.temp, M);
      if (p > peak) peak = p;
    });
    const Y = (f) => pad.t + gh - f / peak * gh * 0.92;

    // 눈금
    gctx.strokeStyle = P.grid;
    gctx.lineWidth = 1;
    gctx.font = '11px ui-sans-serif, system-ui';
    gctx.fillStyle = P.muted;
    gctx.textAlign = 'center';
    const step = vMax > 3000 ? 1000 : (vMax > 1200 ? 500 : 200);
    for (let v = 0; v <= vMax; v += step) {
      gctx.beginPath(); gctx.moveTo(X(v), pad.t); gctx.lineTo(X(v), pad.t + gh); gctx.stroke();
      gctx.fillText(v.toLocaleString(), X(v), h - 14);
    }
    gctx.fillText('속력 (m/s)', pad.l + gw / 2, h - 2);

    // 두 분포 곡선
    const defs = [
      { M: S.mA, color: '#2b9fb3', fill: 'rgba(110,231,240,.22)', name: '왼쪽' },
      { M: S.mB, color: '#c9722b', fill: 'rgba(242,166,90,.22)', name: '오른쪽' }
    ];
    defs.forEach((d) => {
      gctx.beginPath();
      gctx.moveTo(X(0), Y(0));
      for (let i = 0; i <= 240; i++) {
        const v = i / 240 * vMax;
        gctx.lineTo(X(v), Y(mbPdf(v, S.temp, d.M)));
      }
      gctx.lineTo(X(vMax), Y(0));
      gctx.closePath();
      gctx.fillStyle = d.fill; gctx.fill();
      gctx.strokeStyle = d.color; gctx.lineWidth = 2.4; gctx.stroke();

      // rms 세로선
      const v = vRms(S.temp, d.M);
      gctx.setLineDash([5, 5]);
      gctx.strokeStyle = d.color; gctx.lineWidth = 1.8;
      gctx.beginPath(); gctx.moveTo(X(v), pad.t + 6); gctx.lineTo(X(v), pad.t + gh); gctx.stroke();
      gctx.setLineDash([]);
      gctx.fillStyle = d.color;
      gctx.textAlign = 'left';
      gctx.font = '600 11.5px ui-sans-serif, system-ui';
      gctx.fillText(`${d.M.toFixed(1)} g/mol · ${Math.round(v).toLocaleString()} m/s`, X(v) + 5, pad.t + 16);
    });

    gctx.fillStyle = P.muted;
    gctx.textAlign = 'right';
    gctx.font = '11px ui-sans-serif, system-ui';
    gctx.fillText('입자 수', pad.l - 8, pad.t + 12);
  }

  /* 화면에 있는 입자들의 실제 rms. 이론값과 달리 표본이 작으면 흔들린다 —
     이론식만 보여주면 8개로 줄여도 숫자가 꿈쩍하지 않아, 입자 수 슬라이더가
     아무 일도 안 하는 것처럼 보인다. */
  function sampleRms(k) {
    const list = boxes[k];
    if (!list || !list.length) return 0;
    return Math.sqrt(list.reduce((a, p) => a + p.speed * p.speed, 0) / list.length);
  }

  // ── 수치 ──
  function readout() {
    const T = S.temp;
    const va = sampleRms(0) || vRms(T, S.mA), vb = sampleRms(1) || vRms(T, S.mB);
    const ek = meanEk(T);

    el('r-temp').textContent = T + ' K (' + (T - 273.15).toFixed(0) + '°C)';
    el('r-ek').textContent = ek.toExponential(3).replace('e-21', ' × 10⁻²¹') + ' J';
    const thA = vRms(T, S.mA), thB = vRms(T, S.mB);
    const gap = (m, th) => {
      const d = Math.abs(m - th) / th * 100;
      return d < 0.5 ? '' : ` (이론 ${Math.round(th).toLocaleString()}, ${d.toFixed(1)}% 차)`;
    };
    el('r-va').textContent = Math.round(va).toLocaleString() + ' m/s' + gap(va, thA);
    el('r-vb').textContent = Math.round(vb).toLocaleString() + ' m/s' + gap(vb, thB);
    el('r-graham').textContent = (va / vb).toFixed(3) + ' : 1';

    el('s-ek').textContent = '1.000 : 1';
    el('s-v').textContent = (va / vb).toFixed(3) + ' : 1';

    const v = el('verdict');
    const ratio = va / vb;
    if (Math.abs(S.mA - S.mB) < 0.05) {
      v.className = 'verdict';
      v.innerHTML = '분자량이 같으니 속도도 같습니다. ' +
        '<strong>질량이 달라야만 속도가 갈라집니다</strong> — 한쪽 분자량을 바꿔 보세요.';
    } else {
      const heavy = S.mA > S.mB ? '왼쪽' : '오른쪽';
      const light = S.mA > S.mB ? '오른쪽' : '왼쪽';
      const r = ratio > 1 ? ratio : 1 / ratio;
      v.className = 'verdict warn';
      v.innerHTML = `운동에너지는 <strong>양쪽 모두 똑같습니다</strong>(1:1). ` +
        `그런데 속도는 <strong>${r.toFixed(2)}배</strong> 차이입니다 — ` +
        `가벼운 ${light}이 훨씬 빠릅니다. ` +
        `½mv² 이 같으려면 질량이 작은 쪽이 빨라야 하기 때문입니다.`;
    }

    const mRatio = Math.max(S.mA, S.mB) / Math.min(S.mA, S.mB);
    el('note').textContent =
      `분자량 비 ${mRatio.toFixed(2)} → 속도 비 √${mRatio.toFixed(2)} = ` +
      `${Math.sqrt(mRatio).toFixed(3)}. 가벼운 기체가 그만큼 빨리 확산합니다(그레이엄 법칙).`;
  }

  // ── 입력 ──
  const labels = {
    temp: (v) => Number(v) + ' K',
    mA: (v) => Number(v).toFixed(1) + ' g/mol',
    mB: (v) => Number(v).toFixed(1) + ' g/mol',
    count: (v) => Number(v) + '개'
  };

  ['temp', 'mA', 'mB', 'count'].forEach((k) => {
    const input = el(k);
    input.addEventListener('input', () => {
      S[k] = Number(input.value);
      el(k + '-out').textContent = labels[k](input.value);
      seed();
      syncPresets();
      readout();
    });
  });

  const presetBox = el('presets');
  presetBox.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      S.mA = Number(b.dataset.a);
      S.mB = Number(b.dataset.b);
      S.temp = Number(b.dataset.t);
      ['temp', 'mA', 'mB'].forEach((k) => {
        el(k).value = S[k];
        el(k + '-out').textContent = labels[k](S[k]);
      });
      seed();
      syncPresets();
      readout();
    });
  });

  function syncPresets() {
    presetBox.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', String(
        Number(b.dataset.a) === S.mA &&
        Number(b.dataset.b) === S.mB &&
        Number(b.dataset.t) === S.temp
      ));
    });
  }

  el('toggle').addEventListener('click', () => {
    running = !running;
    el('toggle').textContent = running ? '일시정지' : '이어서';
  });
  el('reset').addEventListener('click', () => {
    S.temp = 300; S.mA = 4; S.mB = 32;
    ['temp', 'mA', 'mB'].forEach((k) => {
      el(k).value = S[k];
      el(k + '-out').textContent = labels[k](S[k]);
    });
    seed(); syncPresets(); readout();
  });

  el('share').addEventListener('click', async () => {
    const said = el('share-said');
    try {
      const me = await Session.refresh();
      if (!me) { said.textContent = '로그인이 필요합니다.'; return; }
      const q = new URLSearchParams({ temp: S.temp, mA: S.mA, mB: S.mB, count: S.count });
      const url = location.origin + location.pathname + '?' + q;
      const b = el('share-url');
      b.value = url; b.hidden = false; b.select();
      try { await navigator.clipboard.writeText(url); said.textContent = '복사했습니다.'; }
      catch { said.textContent = '주소를 복사해 주세요.'; }
    } catch { said.textContent = '잠시 후 다시 시도해 주세요.'; }
  });

  function applyQuery() {
    const q = new URLSearchParams(location.search);
    ['temp', 'mA', 'mB', 'count'].forEach((k) => {
      const v = Number(q.get(k));
      if (q.get(k) === null || !Number.isFinite(v)) return;
      const input = el(k);
      const c = Math.max(Number(input.min), Math.min(Number(input.max), v));
      S[k] = c; input.value = c;
      el(k + '-out').textContent = labels[k](c);
    });
    syncPresets();
  }

  // ── 루프 ──
  let last = 0;
  function frame(ts) {
    const now = ts / 1000;
    if (!last) last = now;
    const dt = Math.min(0.05, now - last);
    last = now;

    if (running) {
      /* 화면 속도 = 실제 속력 ÷ 기준값. 기준을 300K 헬륨으로 고정해
         온도·분자량을 바꾸면 화면에서도 그만큼 빨라지거나 느려진다. */
      const ref = vRms(300, 4);
      boxes.forEach((list) => {
        list.forEach((p) => {
          const s = p.speed / ref * 0.42;
          p.x += p.dx * s * dt;
          p.y += p.dy * s * dt;
          if (p.x < 0) { p.x = 0; p.dx = -p.dx; }
          if (p.x > 1) { p.x = 1; p.dx = -p.dx; }
          if (p.y < 0) { p.y = 0; p.dy = -p.dy; }
          if (p.y > 1) { p.y = 1; p.dy = -p.dy; }
        });
      });
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
  seed();
  readout();
  resize();
  window.GraphTheme.onChange(drawGraph);   // 밝기 모드가 바뀌면 새 팔레트로 다시 그린다
  window.addEventListener('resize', resize);
  requestAnimationFrame(frame);
})();
