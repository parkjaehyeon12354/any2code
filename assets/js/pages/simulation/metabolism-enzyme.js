(function () {
  const el = (id) => document.getElementById(id);

  /* ── 대사와 효소: 온도를 올리면 계속 빨라질까 ──

     화학에서 배운 "온도↑ = 속도↑" 가 효소에서는 어느 지점부터 뒤집힌다.
     단백질이 열에 풀려(변성) 일을 못 하게 되기 때문이다.

     설계는 Kimi K3, 검증은 직접 계산으로 대조했다.
       v = kcat · A(T) · f(T) · [E] · [S]/(Km+[S])
       A(T) = exp((Ea/R)(1/298 − 1/(T+273)))   ← 아레니우스, 계속 상승
       f(T) = 1/(1 + exp((T−50)/3))            ← 남아있는 정상 효소 비율
     확인한 값: 25°C·S=4 → 66.65 / S=Km=2 → 49.99(=Vmax/2) / 45°C·S=20 → 272.08
                65°C·S=20 → 6.63 / [E] 2배 → 정확히 2배 / 최적온도 45.41°C

     ⚠ K3 가 "55°C 에서 변성 없다면 633" 이라 했는데 실제로는 575.8 이다.
        A(55)=6.3333 을 과대평가했다. 화면에는 계산값을 쓴다. */

  /* Km 은 조작 변수다(S.km) — 곡선 모양을 정하는 값인데 상수라 못 만졌다.
     기본 2.0 이라 기존 검증값(25°C·S=4 → 66.65 등)이 그대로 유지된다. */
  const Km = () => S.km;
  const KCAT25 = 100;    // s⁻¹ (25°C 기준)
  const EA_R = 50000 / 8.314;   // Ea/R = 6013.95 K
  const T_HALF = 50;     // 절반이 변성되는 온도 (°C)
  const D_STEEP = 3;     // 변성이 얼마나 급한가

  const S = { temp: 25, sub: 4, enz: 1, km: 2.0 };
  let running = true;
  let anim = 0;
  let molecules = [];

  const canvas = el('canvas');
  const ctx = canvas.getContext('2d');
  const graph = el('temp-graph');
  const gctx = graph.getContext('2d');
  let DPR = 1;

  const arrhenius = (T) => Math.exp(EA_R * (1 / 298 - 1 / (T + 273)));
  const intact = (T) => 1 / (1 + Math.exp((T - T_HALF) / D_STEEP));
  const vmaxAt = (T) => KCAT25 * arrhenius(T) * intact(T) * S.enz;
  const rateAt = (T, sub) => vmaxAt(T) * sub / (Km() + sub);
  // 변성이 없다고 가정한 속도 — 학생이 머릿속에 그리는 선
  const idealAt = (T, sub) => KCAT25 * arrhenius(T) * S.enz * sub / (Km() + sub);

  const rate = () => rateAt(S.temp, S.sub);
  const ideal = () => idealAt(S.temp, S.sub);

  // 최적 온도 — 두 곡선의 곱이 최대인 지점. 0.05°C 간격이면 충분하다.
  function optimalTemp() {
    let bestT = 0, bestV = -1;
    for (let T = 0; T <= 80; T += 0.05) {
      const v = rateAt(T, S.sub);
      if (v > bestV) { bestV = v; bestT = T; }
    }
    return bestT;
  }

  const N = 44;
  function seed() {
    molecules = [];
    for (let i = 0; i < N; i++) {
      molecules.push({
        x: Math.random(), y: Math.random(),
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        kind: i < 10 ? 'E' : 'S',   // 효소 10, 나머지 기질
        busy: 0, flash: 0
      });
    }
  }

  // ── 무대 ──
  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const w = canvas.width / DPR, h = canvas.height / DPR;
    ctx.clearRect(0, 0, w, h);

    // 온도가 높을수록 배경이 붉게 — 위험 신호
    const heat = Math.max(0, Math.min(1, (S.temp - 40) / 40));
    ctx.fillStyle = `rgb(${Math.round(15 + 34 * heat)}, ${Math.round(20 - 4 * heat)}, ${Math.round(28 - 8 * heat)})`;
    ctx.fillRect(0, 0, w, h);

    const f = intact(S.temp);
    const pad = 14, top = 52;
    const iw = w - pad * 2, ih = h - top - pad - 20;

    // 분자
    const speedScale = 0.4 + arrhenius(S.temp) * 0.28;
    molecules.forEach((m, i) => {
      const px = pad + m.x * iw, py = top + m.y * ih;
      if (m.kind === 'E') {
        // 효소 — 변성 여부는 f(T) 비율만큼
        const denatured = (i / 10) >= f;
        if (m.flash > 0) {
          ctx.fillStyle = `rgba(255,209,102,${m.flash * 0.5})`;
          ctx.beginPath(); ctx.arc(px, py, 20, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = denatured ? '#8a8f98' : '#f4a261';
        if (denatured) {
          // 풀린 단백질 — 구불구불한 실
          ctx.strokeStyle = '#8a8f98';
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          for (let k = 0; k <= 12; k++) {
            const t = k / 12;
            const xx = px - 11 + t * 22;
            const yy = py + Math.sin(t * Math.PI * 3 + i) * 5;
            k ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
          }
          ctx.stroke();
        } else {
          // 정상 효소 — 기질이 들어갈 홈이 있는 덩어리
          ctx.beginPath(); ctx.arc(px, py, 10, 0.6, Math.PI * 2 - 0.6); ctx.fill();
        }
      } else {
        ctx.fillStyle = m.busy > 0 ? '#a8dadc' : '#7bdff2';
        ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI * 2); ctx.fill();
      }
    });

    // 상단 온도 막대
    const barY = 16, barH = 18, barX = pad, barW = iw;
    for (let i = 0; i < barW; i++) {
      const T = i / barW * 80;
      const v = rateAt(T, S.sub);
      const peak = rateAt(optT, S.sub);
      const t = peak > 0 ? v / peak : 0;
      ctx.fillStyle = `rgba(${Math.round(120 + 135 * t)}, ${Math.round(60 + 130 * t)}, ${Math.round(70 + 30 * t)}, .9)`;
      ctx.fillRect(barX + i, barY, 1, barH);
    }
    ctx.strokeStyle = 'rgba(255,255,255,.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barW, barH);

    // 최적온도 눈금
    const ox = barX + optT / 80 * barW;
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(255,255,255,.8)';
    ctx.beginPath(); ctx.moveTo(ox, barY - 4); ctx.lineTo(ox, barY + barH + 4); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '10px ui-sans-serif, system-ui';
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.textAlign = 'center';
    ctx.fillText('최적 ' + optT.toFixed(1) + '°C', ox, barY - 6);

    // 현재 온도 바늘
    const tx = barX + S.temp / 80 * barW;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(tx, barY + barH + 2);
    ctx.lineTo(tx - 5, barY + barH + 11);
    ctx.lineTo(tx + 5, barY + barH + 11);
    ctx.closePath(); ctx.fill();

    // 하단 안내
    ctx.textAlign = 'center';
    ctx.font = '600 12.5px ui-sans-serif, system-ui';
    if (f < 0.1) {
      ctx.fillStyle = '#ffb4a2';
      ctx.fillText('효소가 거의 다 풀렸습니다 — 기질을 아무리 넣어도 소용없습니다', w / 2, h - 8);
    } else if (S.temp > optT + 3) {
      ctx.fillStyle = '#ffb4a2';
      ctx.fillText(`${S.temp}°C — 최적온도를 넘겨 거꾸로 느려지는 중입니다`, w / 2, h - 8);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,.62)';
      ctx.fillText(`${S.temp}°C · 살아있는 효소 ${(f * 100).toFixed(1)}%`, w / 2, h - 8);
    }
  }

  let optT = 45.4;

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

    // 세로 눈금은 '변성 없다면' 곡선의 최댓값에 맞춘다 — 갈라짐이 보여야 한다
    let vTop = 0;
    for (let T = 0; T <= 80; T += 1) vTop = Math.max(vTop, idealAt(T, S.sub));
    vTop *= 1.05;

    const X = (T) => pad.l + T / 80 * gw;
    const Y = (v) => pad.t + gh - Math.min(1, v / vTop) * gh;

    gctx.strokeStyle = P.grid;
    gctx.lineWidth = 1;
    gctx.font = '11px ui-sans-serif, system-ui';
    gctx.fillStyle = P.muted;
    gctx.textAlign = 'center';
    for (let T = 0; T <= 80; T += 20) {
      gctx.beginPath(); gctx.moveTo(X(T), pad.t); gctx.lineTo(X(T), pad.t + gh); gctx.stroke();
      gctx.fillText(T + '°C', X(T), h - 16);
    }
    gctx.fillText('온도', pad.l + gw / 2, h - 3);
    gctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const v = vTop * i / 4;
      gctx.beginPath(); gctx.moveTo(pad.l, Y(v)); gctx.lineTo(pad.l + gw, Y(v)); gctx.stroke();
      gctx.fillText(v.toFixed(0), pad.l - 8, Y(v) + 4);
    }

    // 변성이 없다면 (회색 점선) — 학생이 머릿속에 그리는 선
    gctx.beginPath();
    for (let i = 0; i <= 160; i++) {
      const T = i / 160 * 80;
      const xx = X(T), yy = Y(idealAt(T, S.sub));
      i ? gctx.lineTo(xx, yy) : gctx.moveTo(xx, yy);
    }
    gctx.strokeStyle = '#6b6b76'; gctx.lineWidth = 2;
    gctx.setLineDash([7, 5]); gctx.stroke(); gctx.setLineDash([]);

    // 실제 효소 (빨간 실선)
    gctx.beginPath();
    for (let i = 0; i <= 160; i++) {
      const T = i / 160 * 80;
      const xx = X(T), yy = Y(rateAt(T, S.sub));
      i ? gctx.lineTo(xx, yy) : gctx.moveTo(xx, yy);
    }
    gctx.strokeStyle = '#c0392b'; gctx.lineWidth = 3; gctx.stroke();

    // 최적 온도
    gctx.setLineDash([4, 4]);
    gctx.strokeStyle = 'rgba(29,120,112,.7)'; gctx.lineWidth = 1.6;
    gctx.beginPath();
    gctx.moveTo(X(optT), Y(0)); gctx.lineTo(X(optT), Y(rateAt(optT, S.sub)));
    gctx.stroke(); gctx.setLineDash([]);
    gctx.fillStyle = '#1d7870'; gctx.textAlign = 'left';
    gctx.font = '600 11.5px ui-sans-serif, system-ui';
    gctx.fillText(`최적 ${optT.toFixed(1)}°C — 여기서 꺾입니다`, X(optT) + 6, Y(rateAt(optT, S.sub)) - 8);

    // 범례
    gctx.fillStyle = '#c0392b';
    gctx.fillText('실제 효소', pad.l + 10, pad.t + 16);
    gctx.fillStyle = '#6b6b76';
    gctx.fillText('열에 안 풀린다면 — 끝까지 올라갑니다', pad.l + 10, pad.t + 33);

    // 현재 위치
    gctx.beginPath(); gctx.arc(X(S.temp), Y(rate()), 6, 0, Math.PI * 2);
    gctx.fillStyle = P.ink; gctx.fill();
    gctx.strokeStyle = P.bg; gctx.lineWidth = 2.4; gctx.stroke();
  }

  // ── 수치 ──
  function readout() {
    optT = optimalTemp();
    const v = rate(), iv = ideal(), f = intact(S.temp);
    const sat = S.sub / (Km() + S.sub);

    el('r-v').textContent = v.toFixed(2) + ' µM/s';
    el('r-vmax').textContent = vmaxAt(S.temp).toFixed(2) + ' µM/s';
    el('r-alive').textContent = (f * 100).toFixed(1) + ' %';
    el('r-sat').textContent = (sat * 100).toFixed(1) + ' %';
    el('r-opt').textContent = optT.toFixed(1) + ' °C';

    el('s-real').textContent = v.toFixed(1);
    const si = el('s-ideal');
    si.textContent = iv.toFixed(1);
    si.className = iv > v * 1.15 ? 'up' : '';

    const verdict = el('verdict');
    if (f < 0.1) {
      verdict.className = 'verdict warn';
      verdict.innerHTML = `<strong>${S.temp}°C</strong> 에서 효소의 ` +
        `<strong>${(100 - f * 100).toFixed(1)}%</strong> 가 풀려버렸습니다. ` +
        `속도가 <strong>${v.toFixed(1)}</strong> 까지 떨어졌는데, ` +
        '<strong>기질을 아무리 넣어도 회복되지 않습니다</strong> — 일할 효소가 없으니까요.';
    } else if (S.temp > optT + 2) {
      verdict.className = 'verdict warn';
      verdict.innerHTML = `최적온도 <strong>${optT.toFixed(1)}°C</strong> 를 넘겼습니다. ` +
        `열에 안 풀린다면 <strong>${iv.toFixed(0)}</strong> 이 나와야 하는데 실제로는 ` +
        `<strong>${v.toFixed(0)}</strong> 입니다 — <strong>${(iv / v).toFixed(1)}배</strong> 손해입니다. ` +
        '온도를 올릴수록 더 벌어집니다.';
    } else if (S.sub >= 12) {
      verdict.className = 'verdict';
      verdict.innerHTML = `기질이 충분해 포화도가 <strong>${(sat * 100).toFixed(0)}%</strong> 입니다. ` +
        `여기서 기질을 더 넣어도 <strong>V<sub>max</sub> ${vmaxAt(S.temp).toFixed(0)}</strong> 을 못 넘습니다. ` +
        '대신 <strong>온도를 올려 보세요</strong> — 어디까지 빨라지는지.';
    } else {
      verdict.className = 'verdict';
      verdict.innerHTML = `현재 <strong>${v.toFixed(1)} µM/s</strong>. ` +
        `살아있는 효소가 <strong>${(f * 100).toFixed(0)}%</strong> 라 아직 손해가 거의 없습니다. ` +
        `온도를 <strong>55°C</strong> 로 올려 보세요 — 25°C 와 속도가 같아집니다.`;
    }

    el('note').textContent =
      `K\u2098 = ${Km().toFixed(1)} mM (반쯤 찼을 때의 농도), 절반이 변성되는 온도 ${T_HALF}°C. ` +
      `지금 살아있는 효소 비율 ${(f * 100).toFixed(1)}% × 아레니우스 ${arrhenius(S.temp).toFixed(2)}배 ` +
      `= 유효 V\u2098\u2090\u2093 ${vmaxAt(S.temp).toFixed(1)}.`;
  }

  // ── 입력 ──
  const labels = {
    temp: (v) => Number(v) + ' °C',
    sub: (v) => Number(v).toFixed(1) + ' mM',
    enz: (v) => Number(v).toFixed(1) + ' µM',
    km: (v) => Number(v).toFixed(1) + ' mM'
  };

  ['temp', 'sub', 'enz', 'km'].forEach((k) => {
    const input = el(k);
    input.addEventListener('input', () => {
      S[k] = Number(input.value);
      el(k + '-out').textContent = labels[k](input.value);
      syncPresets(); readout();
    });
  });

  const presetBox = el('presets');
  presetBox.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      S.temp = Number(b.dataset.t); S.sub = Number(b.dataset.s); S.enz = Number(b.dataset.e);
      ['temp', 'sub', 'enz', 'km'].forEach((k) => {
        el(k).value = S[k];
        el(k + '-out').textContent = labels[k](S[k]);
      });
      syncPresets(); readout();
    });
  });

  function syncPresets() {
    presetBox.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', String(
        Number(b.dataset.t) === S.temp &&
        Math.abs(Number(b.dataset.s) - S.sub) < 1e-9 &&
        Math.abs(Number(b.dataset.e) - S.enz) < 1e-9
      ));
    });
  }

  el('toggle').addEventListener('click', () => {
    running = !running;
    el('toggle').textContent = running ? '일시정지' : '이어서';
  });
  el('reset').addEventListener('click', () => {
    S.temp = 25; S.sub = 4; S.enz = 1;
    ['temp', 'sub', 'enz', 'km'].forEach((k) => {
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
      const q = new URLSearchParams({ t: S.temp, s: S.sub, e: S.enz, k: S.km });
      const url = location.origin + location.pathname + '?' + q;
      const b = el('share-url');
      b.value = url; b.hidden = false; b.select();
      try { await navigator.clipboard.writeText(url); said.textContent = '복사했습니다.'; }
      catch { said.textContent = '주소를 복사해 주세요.'; }
    } catch { said.textContent = '잠시 후 다시 시도해 주세요.'; }
  });

  function applyQuery() {
    const q = new URLSearchParams(location.search);
    const map = { t: 'temp', s: 'sub', e: 'enz', k: 'km' };
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

  // ── 루프 ──
  let last = 0;
  function frame(ts) {
    const now = ts / 1000;
    if (!last) last = now;
    const dt = Math.min(0.1, now - last);
    last = now;

    if (running) {
      anim = now;
      const f = intact(S.temp);
      const speed = (0.35 + arrhenius(S.temp) * 0.22);
      molecules.forEach((m, i) => {
        // 변성된 효소는 거의 안 움직인다
        const denatured = m.kind === 'E' && (i / 10) >= f;
        const sp = denatured ? 0.08 : speed;
        m.x += m.vx * dt * sp; m.y += m.vy * dt * sp;
        if (m.x < 0 || m.x > 1) { m.vx = -m.vx; m.x = Math.max(0, Math.min(1, m.x)); }
        if (m.y < 0 || m.y > 1) { m.vy = -m.vy; m.y = Math.max(0, Math.min(1, m.y)); }
        if (m.flash > 0) m.flash = Math.max(0, m.flash - dt * 2.5);
        if (m.busy > 0) m.busy = Math.max(0, m.busy - dt);
      });
      // 반응 속도에 비례해 기질을 생성물로 — 눈에 보이는 사건
      const events = rate() / 300 * dt * 26;
      let whole = Math.floor(events);
      if (Math.random() < events - whole) whole++;
      for (let k = 0; k < whole; k++) {
        const enzymes = molecules.filter((m, i) => m.kind === 'E' && (i / 10) < f);
        const subs = molecules.filter((m) => m.kind === 'S' && m.busy <= 0);
        if (!enzymes.length || !subs.length) break;
        const e2 = enzymes[(Math.random() * enzymes.length) | 0];
        const s2 = subs[(Math.random() * subs.length) | 0];
        e2.flash = 1; s2.busy = 1.1;
      }
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
  seed();
  readout();
  resize();
  window.GraphTheme.onChange(drawGraph);   // 밝기 모드가 바뀌면 새 팔레트로 다시 그린다
  window.addEventListener('resize', resize);
  requestAnimationFrame(frame);
})();
