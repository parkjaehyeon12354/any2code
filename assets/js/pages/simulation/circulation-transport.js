(function () {
  const el = (id) => document.getElementById(id);

  /* ── 순환과 수송: 굵을수록 빠를까 ──

     연속방정식 A·v = Q. 설계는 Solar 4 Pro, 상수는 직접 계산으로 대조했다.
     Solar 는 처음에 모세혈관 N=100 을 제시했다가 계산 도중 스스로
     "이러면 총단면적이 대동맥보다 작아 역전이 안 일어난다"고 잡아내고
     N≈3.12e9(대동맥의 500배)로 고쳤다. 그 값이 교과서와 맞는다:
       대동맥 3.14cm² 26.53cm/s / 모세혈관 1568cm² 0.053cm/s / 통과 1.88초
     교과서: 모세혈관 유속 0.03~0.1cm/s, 통과 1~2초. */

  /* 모세혈관 지름은 조작 변수다(S.capD, µm). 총단면적을 정하는 두 값 중
     개수만 만질 수 있었다. 지름 8µm 이면 반지름 4e-4 cm 로 기존값과 같다. */
  const CAP_R = () => S.capD / 2 / 10000;
  const CAP_LEN = 0.1;             // 모세혈관 길이 cm (1mm)
  // CAP_R 이 가변이라 이것도 상수로 두면 그림과 숫자가 어긋난다
  const CAP_AREA1 = () => Math.PI * CAP_R() * CAP_R();

  const S = { ncap: 31, flow: 5, aorta: 2.0, capD: 8 };
  let running = true;
  let cells = [];
  let o2dots = [];

  const canvas = el('canvas');
  const ctx = canvas.getContext('2d');
  const graph = el('area-graph');
  const gctx = graph.getContext('2d');
  let DPR = 1;

  const Q = () => S.flow * 1000 / 60;                 // cm³/s
  const aortaArea = () => Math.PI * Math.pow(S.aorta / 2, 2);
  const capArea = () => S.ncap * 1e8 * CAP_AREA1();     // 슬라이더 1 = 1억
  const venaArea = () => 2 * Math.PI * Math.pow(S.aorta * 1.4 / 2, 2);

  const vAorta = () => Q() / aortaArea();
  const vCap = () => Q() / capArea();
  const vVena = () => Q() / venaArea();
  const transitTime = () => CAP_LEN / vCap();

  /* 산소 전달률 — 통과 시간이 충분해야 다 넘긴다.
     확산에 약 1.5초가 필요하다고 두고 지수적으로 붙인다.
     ponytail: 단순 1차 확산 근사. 헤모글로빈 해리곡선까지는 과하다. */
  const O2_TAU = 1.5;
  const o2Transfer = () => 1 - Math.exp(-transitTime() / O2_TAU);

  // 혈관 단계 — 그래프용. 교과서의 전형적인 값 비율.
  function vessels() {
    const a = aortaArea(), c = capArea(), v = venaArea();
    return [
      { name: '대동맥', area: a },
      { name: '동맥', area: a * 6 },
      { name: '세동맥', area: a * 40 },
      { name: '모세혈관', area: c },
      { name: '세정맥', area: c * 0.45 },
      { name: '정맥', area: a * 18 },
      { name: '대정맥', area: v }
    ];
  }

  function seed() {
    cells = [];
    for (let i = 0; i < 26; i++) {
      cells.push({ s: i / 26, lane: (i % 5), o2: 1, spent: 0 });
    }
    o2dots = [];
  }

  // ── 무대 ──
  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const w = canvas.width / DPR, h = canvas.height / DPR;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#141a20';
    ctx.fillRect(0, 0, w, h);

    const pad = 18, top = 40;
    const iw = w - pad * 2, ih = h - top - pad - 26;
    const midY = top + ih / 2;

    // 세 구간: 대동맥(좁고 빠름) → 모세혈관(넓게 퍼짐) → 대정맥
    const x1 = pad + iw * 0.22;        // 대동맥 끝
    const x2 = pad + iw * 0.72;        // 모세혈관 끝
    const aortaH = Math.max(8, Math.min(46, S.aorta * 15));
    const capBandH = ih * 0.78;
    /* 모세혈관 다발 선(lanes)과 적혈구가 앉는 자리(laneY)가 서로 다른
       칸 수로 계산되고 있었다 — 선은 lanes(3~11, 모세혈관 수에 따라
       가변)로, 적혈구는 고정 5칸(capBandH / 5)으로. 칸 수가 안 맞으면
       적혈구가 실제로 그려진 가는 선 사이·바깥으로 떨어져 "혈관을
       넘어가는" 것처럼 보인다. 하나로 통일한다. */
    const lanes = Math.max(3, Math.min(11, Math.round(3 + S.ncap / 12)));
    const laneY = (lane) => midY - capBandH / 2 + ((lane % lanes) + 0.5) * capBandH / lanes;

    // 대동맥
    ctx.fillStyle = 'rgba(230,57,70,.18)';
    ctx.beginPath();
    ctx.moveTo(pad, midY - aortaH / 2);
    ctx.lineTo(x1, midY - aortaH / 2);
    ctx.lineTo(x1, midY + aortaH / 2);
    ctx.lineTo(pad, midY + aortaH / 2);
    ctx.closePath(); ctx.fill();

    /* 모세혈관 다발. 예전엔 모든 선이 입구·출구 양쪽에서 거의 같은 한
       점으로 수렴하는 베지어 곡선이라 눈알(렌즈) 모양처럼 보였다.
       실제 모세혈관은 세동맥 한 가닥이 여러 갈래로 갈라졌다가 세정맥
       한 가닥으로 다시 모이는 구조다 — 입구·출구도 약하게 퍼뜨리고
       곡률을 낮춰 갈라지는 다발처럼 그린다. */
    ctx.strokeStyle = 'rgba(230,57,70,.16)';
    ctx.lineWidth = Math.max(2, capBandH / lanes * 0.42);
    for (let i = 0; i < lanes; i++) {
      const y = midY - capBandH / 2 + (i + 0.5) * capBandH / lanes;
      const spread = (y - midY) * 0.35;   // 입구·출구도 살짝 갈라지게
      ctx.beginPath();
      ctx.moveTo(x1, midY + spread);
      ctx.bezierCurveTo(x1 + (x2 - x1) * 0.3, y, x2 - (x2 - x1) * 0.3, y, x2, midY + spread);
      ctx.stroke();
    }

    // 대정맥
    const venaH = Math.max(10, Math.min(58, S.aorta * 1.4 * 15));
    ctx.fillStyle = 'rgba(123,223,242,.16)';
    ctx.beginPath();
    ctx.moveTo(x2, midY - venaH / 2);
    ctx.lineTo(pad + iw, midY - venaH / 2);
    ctx.lineTo(pad + iw, midY + venaH / 2);
    ctx.lineTo(x2, midY + venaH / 2);
    ctx.closePath(); ctx.fill();

    // 조직으로 넘어간 산소 — 적혈구가 있던 자리에서 바깥으로 퍼진다
    o2dots.forEach((d) => {
      const u = (d.s - 0.22) / 0.5;
      const ly = laneY(d.lane);
      const px = x1 + u * (x2 - x1);
      const py = ly + (ly > midY ? 1 : -1) * (1 - d.life) * 22;
      ctx.fillStyle = `rgba(244,162,97,${d.life * .8})`;
      ctx.beginPath(); ctx.arc(px, py, 2.6, 0, Math.PI * 2); ctx.fill();
    });

    // 적혈구
    cells.forEach((c) => {
      let px, py;
      if (c.s < 0.22) {
        px = pad + c.s / 0.22 * (x1 - pad);
        py = midY + (c.lane - 2) * aortaH / 6;
      } else if (c.s < 0.72) {
        const u = (c.s - 0.22) / 0.5;
        const ly = laneY(c.lane);
        px = x1 + u * (x2 - x1);
        py = midY + (ly - midY) * Math.sin(Math.min(1, u * 3.2) * Math.PI / 2) *
             (u > 0.8 ? (1 - (u - 0.8) / 0.2 * 0.88) : 1);
      } else {
        const u = (c.s - 0.72) / 0.28;
        px = x2 + u * (pad + iw - x2);
        py = midY + (c.lane - 2) * venaH / 6;
      }
      const t = c.o2;
      ctx.fillStyle = `rgb(${Math.round(123 + 107 * t)}, ${Math.round(223 - 166 * t)}, ${Math.round(242 - 172 * t)})`;
      ctx.beginPath(); ctx.ellipse(px, py, 4.6, 3.4, 0, 0, Math.PI * 2); ctx.fill();
    });

    // 구간 라벨
    ctx.font = '600 11.5px ui-sans-serif, system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,.72)';
    ctx.fillText('대동맥', (pad + x1) / 2, top - 12);
    ctx.fillText('모세혈관', (x1 + x2) / 2, top - 12);
    ctx.fillText('대정맥', (x2 + pad + iw) / 2, top - 12);

    ctx.font = '11px ui-sans-serif, system-ui';
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.fillText(vAorta().toFixed(1) + ' cm/s', (pad + x1) / 2, h - 10);
    ctx.fillText(vCap().toFixed(3) + ' cm/s', (x1 + x2) / 2, h - 10);
    ctx.fillText(vVena().toFixed(1) + ' cm/s', (x2 + pad + iw) / 2, h - 10);

    const o2 = o2Transfer();
    ctx.font = '600 12.5px ui-sans-serif, system-ui';
    if (o2 < 0.5) {
      ctx.fillStyle = '#ffb4a2';
      ctx.fillText(`너무 빨라 산소를 ${(o2 * 100).toFixed(0)}% 밖에 못 넘겼습니다`, w / 2, top - 26);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.fillText(`모세혈관 통과 ${transitTime().toFixed(2)}초 · 산소 ${(o2 * 100).toFixed(0)}% 전달`, w / 2, top - 26);
    }
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

    const V = vessels();
    const pad = { l: 66, r: 26, t: 26, b: 46 };
    const gw = w - pad.l - pad.r;
    const halfH = (h - pad.t - pad.b) / 2;
    const midY = pad.t + halfH;

    const maxA = Math.max(...V.map((v) => v.area));
    const maxV = Math.max(...V.map((v) => Q() / v.area));
    const bw = gw / V.length;

    V.forEach((v, i) => {
      const cx = pad.l + bw * (i + 0.5);
      const isCap = v.name === '모세혈관';

      // 위: 총단면적 (로그로 눌러야 모세혈관이 화면을 다 먹지 않는다)
      const ah = Math.pow(v.area / maxA, 0.42) * (halfH - 16);
      gctx.fillStyle = isCap ? 'rgba(29,120,112,.85)' : 'rgba(29,120,112,.35)';
      gctx.fillRect(cx - bw * 0.32, midY - ah, bw * 0.64, ah);

      // 아래: 유속
      const sp = Q() / v.area;
      const sh = Math.pow(sp / maxV, 0.42) * (halfH - 16);
      gctx.fillStyle = isCap ? 'rgba(192,57,43,.85)' : 'rgba(192,57,43,.35)';
      gctx.fillRect(cx - bw * 0.32, midY, bw * 0.64, sh);

      /* 라벨 7개가 좁은 화면에서 서로 겹친다. 칸 폭에 맞춰 글자를 줄이고,
         그래도 좁으면 한 칸 걸러 세로로 어긋나게 둔다. */
      const fs = Math.max(8.5, Math.min(11, bw * 0.16));
      gctx.font = (isCap ? '600 ' : '') + fs + 'px ui-sans-serif, system-ui';
      gctx.fillStyle = isCap ? '#1a201d' : 'rgba(110,110,110,.95)';
      gctx.textAlign = 'center';
      const tight = gctx.measureText(v.name).width > bw * 0.92;
      gctx.fillText(v.name, cx, h - 22 + (tight && i % 2 ? 12 : 0));
    });

    gctx.strokeStyle = P.grid;
    gctx.lineWidth = 1.4;
    gctx.beginPath(); gctx.moveTo(pad.l, midY); gctx.lineTo(pad.l + gw, midY); gctx.stroke();

    gctx.textAlign = 'left';
    gctx.font = '600 11.5px ui-sans-serif, system-ui';
    gctx.fillStyle = '#1d7870';
    gctx.fillText('↑ 총단면적', pad.l + 4, pad.t + 12);
    gctx.fillStyle = '#c0392b';
    gctx.fillText('↓ 유속', pad.l + 4, midY + 16);

    gctx.textAlign = 'center';
    gctx.font = '11px ui-sans-serif, system-ui';
    gctx.fillStyle = P.muted;
    if (gw > 380) {
      gctx.fillText('심장에서 나가 →  조직을 지나  → 심장으로 돌아옴', pad.l + gw / 2, h - 6);
    }
  }

  // ── 수치 ──
  function readout() {
    const va = vAorta(), vc = vCap(), t = transitTime(), o2 = o2Transfer();
    el('r-va').textContent = va.toFixed(2) + ' cm/s';
    el('r-vc').textContent = vc.toFixed(4) + ' cm/s';
    el('r-ac').textContent = capArea().toFixed(0) + ' cm²';
    el('r-time').textContent = t.toFixed(2) + ' 초';
    el('r-o2').textContent = (o2 * 100).toFixed(1) + ' %';

    const ratioA = capArea() / aortaArea();
    const ratioV = va / vc;
    el('s-area').textContent = ratioA.toFixed(0) + ' 배';
    el('s-speed').textContent = ratioV.toFixed(0) + ' 배';

    const v = el('verdict');
    if (o2 < 0.5) {
      v.className = 'verdict warn';
      v.innerHTML = `모세혈관 통과가 <strong>${t.toFixed(2)}초</strong> 밖에 안 됩니다. ` +
        `산소를 <strong>${(o2 * 100).toFixed(0)}%</strong> 만 넘기고 그냥 지나쳐 버립니다 — ` +
        '<strong>피가 빠른 게 좋은 게 아닙니다.</strong>';
    } else {
      v.className = 'verdict';
      v.innerHTML = `총단면적이 <strong>${ratioA.toFixed(0)}배</strong> 넓어지니 ` +
        `유속은 정확히 <strong>${ratioV.toFixed(0)}배</strong> 느려집니다 — ` +
        '두 숫자가 <strong>같습니다.</strong> 곱하면 어디서나 같은 값이니까요.';
    }

    el('note').textContent =
      `A×v = ${(aortaArea() * va).toFixed(1)} cm³/s (대동맥) = ` +
      `${(capArea() * vc).toFixed(1)} (모세혈관) = ${(venaArea() * vVena()).toFixed(1)} (대정맥). ` +
      `어디서나 같습니다 — 이게 연속방정식입니다.`;
  }

  // ── 입력 ──
  const labels = {
    ncap: (v) => (Number(v) / 10).toFixed(1) + ' 억',
    flow: (v) => Number(v).toFixed(1) + ' L/분',
    aorta: (v) => Number(v).toFixed(1) + ' cm',
    capD: (v) => Number(v).toFixed(1) + ' µm'
  };
  ['ncap', 'flow', 'aorta', 'capD'].forEach((k) => {
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
      S.ncap = Number(b.dataset.n); S.flow = Number(b.dataset.f); S.aorta = Number(b.dataset.a);
      ['ncap', 'flow', 'aorta', 'capD'].forEach((k) => {
        el(k).value = S[k]; el(k + '-out').textContent = labels[k](S[k]);
      });
      syncPresets(); readout();
    });
  });
  function syncPresets() {
    presetBox.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', String(
        Number(b.dataset.n) === S.ncap &&
        Math.abs(Number(b.dataset.f) - S.flow) < 1e-9 &&
        Math.abs(Number(b.dataset.a) - S.aorta) < 1e-9));
    });
  }

  el('toggle').addEventListener('click', () => {
    running = !running;
    el('toggle').textContent = running ? '일시정지' : '이어서';
  });
  el('reset').addEventListener('click', () => {
    S.ncap = 31; S.flow = 5; S.aorta = 2.0;
    ['ncap', 'flow', 'aorta', 'capD'].forEach((k) => {
      el(k).value = S[k]; el(k + '-out').textContent = labels[k](S[k]);
    });
    seed(); syncPresets(); readout();
  });

  el('share').addEventListener('click', async () => {
    const said = el('share-said');
    try {
      const me = await Session.refresh();
      if (!me) { said.textContent = '로그인이 필요합니다.'; return; }
      const q = new URLSearchParams({ n: S.ncap, f: S.flow, a: S.aorta, d: S.capD });
      const url = location.origin + location.pathname + '?' + q;
      const b = el('share-url');
      b.value = url; b.hidden = false; b.select();
      try { await navigator.clipboard.writeText(url); said.textContent = '복사했습니다.'; }
      catch { said.textContent = '주소를 복사해 주세요.'; }
    } catch { said.textContent = '잠시 후 다시 시도해 주세요.'; }
  });

  function applyQuery() {
    const q = new URLSearchParams(location.search);
    const map = { n: 'ncap', f: 'flow', a: 'aorta', d: 'capD' };
    Object.entries(map).forEach(([key, id]) => {
      const raw = q.get(key);
      if (raw === null) return;
      const val = Number(raw);
      if (!Number.isFinite(val)) return;
      const input = el(id);
      const c = Math.max(Number(input.min), Math.min(Number(input.max), val));
      S[id] = c; input.value = c;
      el(id + '-out').textContent = labels[id](c);
    });
  }

  let last = 0;
  function frame(ts) {
    const now = ts / 1000;
    if (!last) last = now;
    const dt = Math.min(0.05, now - last);
    last = now;

    if (running) {
      // 화면에서는 구간별 속도 비를 유지하되 배속을 건다.
      // 실제 비(500배)를 그대로 쓰면 모세혈관에서 멈춘 것처럼 보인다.
      const base = 0.16;
      const vc = vCap(), va = vAorta();
      cells.forEach((c) => {
        let sp;
        if (c.s < 0.22) sp = base * (va / 26.5);
        else if (c.s < 0.72) sp = base * 0.1 * Math.pow(vc / 0.053, 0.7);
        else sp = base * (vVena() / 6.77);
        c.s += sp * dt;

        // 모세혈관을 지나며 산소를 넘긴다
        if (c.s >= 0.22 && c.s < 0.72) {
          const drop = dt / Math.max(0.05, transitTime()) * o2Transfer();
          if (c.o2 > 1 - o2Transfer()) {
            c.o2 = Math.max(1 - o2Transfer(), c.o2 - drop);
            /* 산소 점은 '지금 그 적혈구가 있는 자리'에 띄워야 한다.
               위치 계산은 draw 안에 있으므로, 여기서는 진행도만 넘기고
               draw 가 같은 식으로 좌표를 구하게 한다. */
            if (Math.random() < drop * 3) {
              o2dots.push({ s: c.s, lane: c.lane, life: 1 });
            }
          }
        }
        if (c.s >= 1) { c.s = 0; c.o2 = 1; }
      });

      o2dots.forEach((d) => { d.life -= dt * 0.9; });
      o2dots = o2dots.filter((d) => d.life > 0);
      if (o2dots.length > 40) o2dots.splice(0, o2dots.length - 40);
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
    graph.height = 380 * DPR;
  }

  applyQuery();
  seed();
  syncPresets();
  readout();
  resize();
  window.GraphTheme.onChange(drawGraph);   // 밝기 모드가 바뀌면 새 팔레트로 다시 그린다
  window.addEventListener('resize', resize);
  requestAnimationFrame(frame);
})();
