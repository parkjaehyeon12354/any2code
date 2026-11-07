(function () {
  const el = (id) => document.getElementById(id);

  /* ── 전기화학: 전압은 양이 아니라 비율이 정한다 ──

     두 오개념을 한 화면에서 깬다.
       "전극을 키우면 전압이 세진다" → 전압은 세기 성질. 하나도 안 변한다.
       "같은 금속·같은 용액이면 전압 0" → 농도만 달라도 전압이 생긴다(농도차 전지).

     네른스트: E = E° − (0.0592/n)·log Q,  농도차 전지는 E° = 0.
     검증(직접 계산): 10배차 → 29.6mV, 100배차 → 59.2mV,
                      0.20/0.80 → 17.82mV, 같은 농도 → 0. */

  /* 교과서의 0.0592 는 25°C 값일 뿐이고, 원래 계수는 2.303RT/F 로 온도에 비례한다.
     상수로 두면 "온도를 올리면 같은 농도차에서도 전압이 커진다"를 볼 수 없다.
     0°C 54.21 · 25°C 59.17 · 50°C 64.13 · 100°C 74.05 mV. */
  const NERNST = () => 2.303 * 8.314 * (S.temp + 273.15) / 96485;
  const N_ELECTRON = 2;      // Cu²⁺ + 2e⁻ → Cu

  const S = { sizeA: 1, sizeB: 1, concA: 0.1, concB: 1, temp: 25 };
  let running = true;
  let anim = 0;

  const canvas = el('canvas');
  const ctx = canvas.getContext('2d');
  const graph = el('nernst-graph');
  const gctx = graph.getContext('2d');
  let DPR = 1;

  /* 전압 계산. 묽은 쪽이 산화(전극이 녹아 이온이 늘어남),
     진한 쪽이 환원(이온이 전극에 달라붙음)되어 농도가 같아지는 방향으로 간다.
     ⚠ 전극 크기는 이 식 어디에도 들어가지 않는다 — 그게 이 화면의 핵심이다. */
  function cellVoltage() {
    const Q = S.concA / S.concB;
    return -(NERNST() / N_ELECTRON) * Math.log10(Q);
  }
  const Qval = () => S.concA / S.concB;

  // ── 무대 ──
  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const w = canvas.width / DPR, h = canvas.height / DPR;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#141a24';
    ctx.fillRect(0, 0, w, h);

    const E = cellVoltage();
    const flowing = Math.abs(E) > 1e-6;
    // 묽은 쪽이 산화(−극), 진한 쪽이 환원(+극)
    const leftIsDilute = S.concA < S.concB;

    const bw = w * 0.30, bh = h * 0.46;
    const by = h * 0.40;
    const lx = w * 0.10, rx = w - w * 0.10 - bw;

    // 비커 두 개
    [[lx, S.concA, S.sizeA, '왼쪽'], [rx, S.concB, S.sizeB, '오른쪽']].forEach(([x, conc, size, name], i) => {
      // 용액 — 농도가 진할수록 파랗게
      const t = Math.min(1, conc / 2);
      ctx.fillStyle = `rgba(${Math.round(60 - 30*t)}, ${Math.round(120 + 40*t)}, ${Math.round(170 + 60*t)}, ${0.35 + 0.4*t})`;
      ctx.fillRect(x, by, bw, bh);
      ctx.strokeStyle = 'rgba(255,255,255,.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, by - 6); ctx.lineTo(x, by + bh); ctx.lineTo(x + bw, by + bh); ctx.lineTo(x + bw, by - 6);
      ctx.stroke();

      // 용액 속 이온 — 농도에 비례
      const ions = Math.round(6 + conc * 16);
      ctx.fillStyle = 'rgba(168,218,220,.75)';
      for (let k = 0; k < ions; k++) {
        const px = x + 10 + ((k * 53) % (bw - 20));
        const py = by + 14 + ((k * 37) % (bh - 26)) + Math.sin(anim * 1.4 + k) * 2.5;
        ctx.beginPath(); ctx.arc(px, py, 2.8, 0, Math.PI * 2); ctx.fill();
      }

      /* 전극 — 크기 슬라이더가 바꾸는 것은 이 막대뿐이다.
         전압계 숫자는 이 값과 무관하다. */
      const ew = 12 + size * 5, eh = bh * 0.72;
      const ex = x + bw / 2 - ew / 2, ey = by - 26;
      const g = ctx.createLinearGradient(ex, 0, ex + ew, 0);
      g.addColorStop(0, '#f4a261'); g.addColorStop(1, '#c1743a');
      ctx.fillStyle = g;
      ctx.fillRect(ex, ey, ew, eh);

      // 라벨
      ctx.font = '600 11.5px ui-sans-serif, system-ui';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.fillText(`Cu²⁺ ${conc.toFixed(2)} M`, x + bw / 2, by + bh + 18);
      ctx.fillStyle = 'rgba(255,255,255,.5)';
      ctx.font = '10.5px ui-sans-serif, system-ui';
      ctx.fillText(`전극 ${size.toFixed(1)}배`, x + bw / 2, by + bh + 33);

      // 극성 표시
      if (flowing) {
        const isDil = (i === 0) === leftIsDilute;
        ctx.font = '700 12.5px ui-sans-serif, system-ui';
        ctx.fillStyle = isDil ? '#ffb4a2' : '#a8dadc';
        ctx.fillText(isDil ? '(−) 산화 · 녹는다' : '(+) 환원 · 달라붙는다', x + bw / 2, ey - 8);
      }
    });

    // 도선과 전압계
    const wireY = h * 0.16;
    ctx.strokeStyle = 'rgba(220,220,230,.75)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(lx + bw / 2, by - 26);
    ctx.lineTo(lx + bw / 2, wireY);
    ctx.lineTo(rx + bw / 2, wireY);
    ctx.lineTo(rx + bw / 2, by - 26);
    ctx.stroke();

    // 전자 흐름 — 산화 쪽에서 환원 쪽으로
    if (flowing && running) {
      const dir = leftIsDilute ? 1 : -1;
      ctx.fillStyle = '#4cc9f0';
      for (let k = 0; k < 7; k++) {
        const prog = ((anim * 0.35 + k / 7) % 1);
        const px = leftIsDilute
          ? lx + bw / 2 + prog * (rx - lx)
          : rx + bw / 2 - prog * (rx - lx);
        ctx.beginPath(); ctx.arc(px, wireY, 3.6, 0, Math.PI * 2); ctx.fill();
      }
    }

    // 전압계
    const vx = w / 2, vy = wireY;
    ctx.fillStyle = '#1c2531';
    ctx.strokeStyle = 'rgba(255,255,255,.5)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(vx, vy, 34, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.font = '700 15px ui-sans-serif, system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = Math.abs(E) < 1e-6 ? 'rgba(255,255,255,.5)' : '#ffd166';
    ctx.fillText((Math.abs(E) * 1000).toFixed(1), vx, vy + 1);
    ctx.font = '10px ui-sans-serif, system-ui';
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.fillText('mV', vx, vy + 15);

    // 염다리 — 이온이 지나는 길
    const sbY = by + bh * 0.30;
    ctx.strokeStyle = 'rgba(168,218,220,.55)';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(lx + bw, sbY);
    ctx.quadraticCurveTo(w / 2, sbY - 34, rx, sbY);
    ctx.stroke();
    ctx.lineCap = 'butt';

    if (flowing && running) {
      ctx.fillStyle = '#a8dadc';
      for (let k = 0; k < 5; k++) {
        const prog = ((anim * 0.22 + k / 5) % 1);
        const p = leftIsDilute ? prog : 1 - prog;
        const px = (lx + bw) + p * (rx - lx - bw);
        const py = sbY - 34 * (1 - Math.pow(2 * p - 1, 2)) * 0.75;
        ctx.beginPath(); ctx.arc(px, py, 3.4, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.font = '10.5px ui-sans-serif, system-ui';
    ctx.fillStyle = 'rgba(168,218,220,.85)';
    ctx.textAlign = 'center';
    ctx.fillText('염다리 — 이온이 지나갑니다 (전자 아님)', w / 2, sbY + 26);

    // 하단
    ctx.font = '600 12.5px ui-sans-serif, system-ui';
    ctx.fillStyle = flowing ? 'rgba(255,255,255,.62)' : 'rgba(255,180,162,.9)';
    ctx.fillText(
      flowing
        ? `양쪽 다 구리 · 양쪽 다 황산구리 — 그런데 ${(Math.abs(E)*1000).toFixed(1)} mV 가 나옵니다`
        : '농도가 같아 전압이 0 입니다 — 전극을 키워도 그대로입니다',
      w / 2, h - 8
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

    const pad = { l: 60, r: 24, t: 22, b: 40 };
    const gw = w - pad.l - pad.r, gh = h - pad.t - pad.b;
    const LMAX = 2.4;                                   // log Q 범위
    const X = (lq) => pad.l + (lq + LMAX) / (2 * LMAX) * gw;
    const vMax = (NERNST() / N_ELECTRON) * LMAX;
    const Y = (v) => pad.t + gh / 2 - v / vMax * (gh / 2);

    gctx.strokeStyle = P.grid;
    gctx.lineWidth = 1;
    gctx.font = '11px ui-sans-serif, system-ui';
    gctx.fillStyle = P.muted;
    gctx.textAlign = 'center';
    for (let lq = -2; lq <= 2; lq++) {
      gctx.beginPath(); gctx.moveTo(X(lq), pad.t); gctx.lineTo(X(lq), pad.t + gh); gctx.stroke();
      const ratio = Math.pow(10, -lq);
      gctx.fillText(lq === 0 ? '같음' : (ratio >= 1 ? ratio + '배' : '1/' + (1/ratio)), X(lq), h - 16);
    }
    gctx.fillText('농도비 (진한 쪽 ÷ 묽은 쪽)', pad.l + gw / 2, h - 3);

    gctx.textAlign = 'right';
    for (let mv = -60; mv <= 60; mv += 30) {
      const yy = Y(mv / 1000);
      gctx.beginPath(); gctx.moveTo(pad.l, yy); gctx.lineTo(pad.l + gw, yy); gctx.stroke();
      gctx.fillText(mv + ' mV', pad.l - 8, yy + 4);
    }

    // 0 선
    gctx.strokeStyle = P.grid; gctx.lineWidth = 1.6;
    gctx.beginPath(); gctx.moveTo(pad.l, Y(0)); gctx.lineTo(pad.l + gw, Y(0)); gctx.stroke();

    // 네른스트 직선
    gctx.beginPath();
    gctx.moveTo(X(-LMAX), Y(-(NERNST() / N_ELECTRON) * (-LMAX)));
    gctx.lineTo(X(LMAX), Y(-(NERNST() / N_ELECTRON) * LMAX));
    gctx.strokeStyle = '#e07a5f'; gctx.lineWidth = 3; gctx.stroke();

    // 29.6mV 눈금 안내
    gctx.setLineDash([4, 4]);
    gctx.strokeStyle = 'rgba(200,120,90,.5)'; gctx.lineWidth = 1.4;
    [-1, 1].forEach((lq) => {
      gctx.beginPath();
      gctx.moveTo(X(lq), Y(0)); gctx.lineTo(X(lq), Y(-(NERNST() / N_ELECTRON) * lq));
      gctx.stroke();
    });
    gctx.setLineDash([]);
    gctx.fillStyle = '#b4552f'; gctx.textAlign = 'left';
    gctx.font = '600 11.5px ui-sans-serif, system-ui';
    gctx.fillText('10배마다 29.6 mV 씩 — 100배로 벌려도 두 배뿐입니다',
                  pad.l + 10, pad.t + 16);

    // 현재 점
    const lq = Math.max(-LMAX, Math.min(LMAX, Math.log10(Qval())));
    gctx.beginPath(); gctx.arc(X(lq), Y(cellVoltage()), 7, 0, Math.PI * 2);
    gctx.fillStyle = P.ink; gctx.fill();
    gctx.strokeStyle = P.bg; gctx.lineWidth = 2.6; gctx.stroke();

    gctx.fillStyle = P.muted;
    gctx.textAlign = 'right';
    gctx.font = '11px ui-sans-serif, system-ui';
    gctx.fillText('전극 크기를 바꿔도 이 점은 움직이지 않습니다', pad.l + gw - 8, pad.t + gh - 8);
  }

  // ── 수치 ──
  function readout() {
    const E = cellVoltage(), Q = Qval();
    const nern = -(NERNST() / N_ELECTRON) * Math.log10(Q);

    el('r-e').textContent = (E * 1000).toFixed(2) + ' mV (' + E.toFixed(5) + ' V)';
    el('r-e0').textContent = '0.000 V (같은 금속)';
    el('r-q').textContent = Q.toFixed(4);
    el('r-nernst').textContent = (nern * 1000).toFixed(2) + ' mV';
    el('r-bridge').textContent = Math.abs(E) < 1e-6
      ? '이동 없음'
      : (S.concA < S.concB ? '양이온이 왼쪽 → 오른쪽' : '양이온이 오른쪽 → 왼쪽');

    el('s-size').textContent = (S.sizeA + S.sizeB).toFixed(1) + '배';
    el('s-volt').textContent = (Math.abs(E) * 1000).toFixed(1) + ' mV';

    const v = el('verdict');
    if (Math.abs(E) < 1e-6) {
      v.className = 'verdict';
      v.innerHTML = '농도가 같아 전압이 <strong>0</strong> 입니다. ' +
        '<strong>전극 크기를 5배로 키워도 그대로 0</strong> 입니다 — ' +
        '전압을 정하는 건 양이 아니라 농도의 비율이기 때문입니다.';
    } else if (S.sizeA + S.sizeB > 4) {
      v.className = 'verdict warn';
      v.innerHTML = `전극을 <strong>${(S.sizeA + S.sizeB).toFixed(1)}배</strong>로 키웠는데 ` +
        `전압은 <strong>${(Math.abs(E) * 1000).toFixed(1)} mV</strong> 그대로입니다. ` +
        '커진 전극이 바꾸는 건 전압이 아니라 <strong>얼마나 오래 쓸 수 있느냐</strong>입니다.';
    } else {
      const ratio = Math.max(S.concA, S.concB) / Math.min(S.concA, S.concB);
      v.className = 'verdict warn';
      v.innerHTML = `양쪽 다 구리, 양쪽 다 황산구리라 표준 전위차는 <strong>정확히 0</strong> 입니다. ` +
        `그런데 농도가 <strong>${ratio.toFixed(0)}배</strong> 다르다는 것만으로 ` +
        `<strong>${(Math.abs(E) * 1000).toFixed(1)} mV</strong> 가 나옵니다. ` +
        '자연이 두 농도를 같게 만들려고 밀기 때문입니다.';
    }

    el('note').textContent =
      `E = E° − (${NERNST().toFixed(4)}/${N_ELECTRON})·log Q = 0 − ${(NERNST()/N_ELECTRON).toFixed(4)} × ` +
      `${Math.log10(Q).toFixed(4)} = ${E.toFixed(5)} V. ` +
      `이 식에 전극 크기 항이 없습니다.`;
  }

  // ── 입력 ──
  const labels = {
    sizeA: (v) => Number(v).toFixed(1) + '배',
    sizeB: (v) => Number(v).toFixed(1) + '배',
    concA: (v) => Number(v).toFixed(2) + ' mol/L',
    concB: (v) => Number(v).toFixed(2) + ' mol/L',
    temp: (v) => Number(v) + ' °C (계수 ' + (2.303 * 8.314 * (Number(v) + 273.15) / 96485 * 1000).toFixed(1) + ' mV)'
  };

  ['sizeA', 'sizeB', 'concA', 'concB', 'temp'].forEach((k) => {
    const input = el(k);
    input.addEventListener('input', () => {
      S[k] = Number(input.value);
      el(k + '-out').textContent = labels[k](input.value);
      syncPresets();
      readout();
    });
  });

  const presetBox = el('presets');
  presetBox.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      S.concA = Number(b.dataset.ca); S.concB = Number(b.dataset.cb);
      S.sizeA = Number(b.dataset.sa); S.sizeB = Number(b.dataset.sb);
      ['sizeA', 'sizeB', 'concA', 'concB', 'temp'].forEach((k) => {
        el(k).value = S[k];
        el(k + '-out').textContent = labels[k](S[k]);
      });
      syncPresets(); readout();
    });
  });

  function syncPresets() {
    presetBox.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', String(
        Math.abs(Number(b.dataset.ca) - S.concA) < 1e-9 &&
        Math.abs(Number(b.dataset.cb) - S.concB) < 1e-9 &&
        Math.abs(Number(b.dataset.sa) - S.sizeA) < 1e-9 &&
        Math.abs(Number(b.dataset.sb) - S.sizeB) < 1e-9
      ));
    });
  }

  el('toggle').addEventListener('click', () => {
    running = !running;
    el('toggle').textContent = running ? '일시정지' : '이어서';
  });
  el('reset').addEventListener('click', () => {
    S.sizeA = 1; S.sizeB = 1; S.concA = 0.1; S.concB = 1;
    ['sizeA', 'sizeB', 'concA', 'concB', 'temp'].forEach((k) => {
      el(k).value = S[k];
      el(k + '-out').textContent = labels[k](S[k]);
    });
    syncPresets(); readout();
  });

  el('share').addEventListener('click', async () => {
    const said = el('share-said');
    try {
      const me = await Session.refresh();
      if (!me) { said.textContent = '로그인이 필요합니다.'; return; }
      const q = new URLSearchParams({ ca: S.concA, cb: S.concB, sa: S.sizeA, sb: S.sizeB, t: S.temp });
      const url = location.origin + location.pathname + '?' + q;
      const b = el('share-url');
      b.value = url; b.hidden = false; b.select();
      try { await navigator.clipboard.writeText(url); said.textContent = '복사했습니다.'; }
      catch { said.textContent = '주소를 복사해 주세요.'; }
    } catch { said.textContent = '잠시 후 다시 시도해 주세요.'; }
  });

  function applyQuery() {
    const q = new URLSearchParams(location.search);
    const map = { ca: 'concA', cb: 'concB', sa: 'sizeA', sb: 'sizeB', t: 'temp' };
    Object.entries(map).forEach(([key, id]) => {
      const v = Number(q.get(key));
      if (q.get(key) === null || !Number.isFinite(v)) return;
      const input = el(id);
      const c = Math.max(Number(input.min), Math.min(Number(input.max), v));
      S[id] = c; input.value = c;
      el(id + '-out').textContent = labels[id](c);
    });
    syncPresets();
  }

  function frame(ts) {
    if (running) anim = ts / 1000;
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
  readout();
  resize();
  window.GraphTheme.onChange(drawGraph);   // 밝기 모드가 바뀌면 새 팔레트로 다시 그린다
  window.addEventListener('resize', resize);
  requestAnimationFrame(frame);
})();
