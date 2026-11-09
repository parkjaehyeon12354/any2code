(function () {
  const el = (id) => document.getElementById(id);

  /* ── 화학 결합 ──

     레너드-존스 퍼텐셜로 두 원자 사이의 힘을 계산한다.

         U(r) = De·[(r0/r)^12 − 2·(r0/r)^6]
         F(r) = −dU/dr = 12·De/r0·[(r0/r)^13 − (r0/r)^7]

     r0 에서 U 가 최소이고 F = 0 이다. 이 화면의 목적은 "결합 길이" 가
     외워야 할 숫자가 아니라 힘이 균형을 이루는 지점이라는 것을 보이는 것이다.
     그래서 곡선을 그려놓고 끝내지 않고, 실제로 당겼다 놓을 수 있게 했다.

     실제 pm·eV 값을 쓰되 시간 규모는 화면에 맞게 조정한다. 실제 분자 진동은
     펨토초 단위라 그대로 두면 아무것도 안 보인다. */
  const PAIRS = [
    { id: 'h2',  label: 'H₂',  r0: 74,  De: 4.52, m: 1,  ca: '#e8e8e8', cb: '#e8e8e8', ra: 22, rb: 22,
      note: '수소 분자. 결합 길이 74 pm, 결합 에너지 4.52 eV. 가장 단순한 공유 결합입니다.' },
    { id: 'o2',  label: 'O₂',  r0: 121, De: 5.15, m: 16, ca: '#ff8f6b', cb: '#ff8f6b', ra: 34, rb: 34,
      note: '산소 분자. 이중 결합이라 수소보다 결합이 강하고, 원자가 무거워 천천히 진동합니다.' },
    { id: 'n2',  label: 'N₂',  r0: 110, De: 9.79, m: 14, ca: '#8fb8ff', cb: '#8fb8ff', ra: 32, rb: 32,
      note: '질소 분자. 삼중 결합으로 곡선이 가장 깊습니다 — 공기 중 질소가 좀처럼 반응하지 않는 이유입니다.' },
    { id: 'hcl', label: 'HCl', r0: 127, De: 4.43, m: 1,  ca: '#e8e8e8', cb: '#9ce8a0', ra: 22, rb: 38,
      note: '염화 수소. 크기가 다른 두 원자가 만납니다. 전기음성도 차이로 극성을 띱니다.' }
  ];

  const S = { pair: PAIRS[0], r: 74, temp: 0 };
  let v = 0;               // 거리의 변화 속도 (진동)
  let running = true;
  let dragging = false;
  let broken = false;      // 결합이 끊어졌는가

  const canvas = el('canvas');
  const ctx = canvas.getContext('2d');
  let DPR = 1;
  const W = () => canvas.width / DPR;
  const H = () => canvas.height / DPR;

  /* 거리 범위는 분자마다 r0 기준으로 잡는다.
     고정값(40~400pm)으로 두면 r0=74 인 H₂ 와 r0=127 인 HCl 에 동시에 맞출 수 없다.
     또 r0 의 3배를 넘어가면 힘이 0.0001 수준이라 놓아도 아무 일이 없어서,
     "당겼다 놓으면 돌아온다" 는 이 화면의 핵심이 보이지 않는다. */
  const minR = () => Math.round(S.pair.r0 * 0.55);
  const maxR = () => Math.round(S.pair.r0 * 2.4);

  /* 퍼텐셜과 힘. r 은 pm, U 는 eV. */
  function U(r) {
    const p = S.pair;
    const x = p.r0 / Math.max(r, 1);
    return p.De * (Math.pow(x, 12) - 2 * Math.pow(x, 6));
  }
  function F(r) {
    const p = S.pair;
    const x = p.r0 / Math.max(r, 1);
    // −dU/dr. 양수면 밀어내고 음수면 당긴다.
    return (12 * p.De / p.r0) * (Math.pow(x, 13) - Math.pow(x, 7));
  }

  function step(dt) {
    if (dragging) { v = 0; return; }

    /* 질량이 클수록 천천히 움직인다. 실제 진동수 규모를 그대로 쓰면
       화면에서 볼 수 없으므로 비례만 유지한다. */
    /* 실제 분자 진동은 펨토초 단위라 그대로 두면 화면에서 볼 수 없다.
       비례 관계(무거우면 느리다)만 유지하고 시간 규모를 키운다.

       ⚠ 두 가지를 조정했다.
       ① 질량을 √m 으로 나눈다. m 그대로 쓰면 O₂(16u)가 H₂보다 16배 느려
          되돌아오는 데 20초가 넘어 관찰이 안 된다.
       ② 힘에 상한을 둔다. 반발항이 r^13 이라 아주 가까우면 값이 폭발해
          입자가 화면 밖으로 튄다(실제로 속도 71911 까지 갔다). */
    const raw = F(S.r);
    const capped = Math.max(-0.6, Math.min(0.6, raw));
    const a = capped / Math.sqrt(S.pair.m) * 40000;
    v += a * dt;

    // 진동 세기 = 온도. 무작위로 흔들어 준다.
    if (S.temp > 0) {
      v += (Math.random() - 0.5) * S.temp * 0.9;
    }

    // 마찰을 조금 준다. 없으면 한 번 당긴 진동이 영원히 남아 관찰이 어렵다.
    v *= (1 - 2.6 * dt);

    S.r += v * dt;

    // 결합이 끊어졌는지 — 멀리 벗어나 되돌아올 힘이 거의 없는 상태
    /* 끊어짐 판정 — 거리가 아니라 에너지로 본다.
       거리로만 보면 조금 당긴 것도 '끊어짐' 이 되는데, 실제로는 되돌아온다.
       퍼텐셜 우물을 벗어날 만큼(전체 에너지 > 0) 흔들렸을 때만 끊어진 것이다. */
    const kinetic = 0.5 * S.pair.m * (v / 60) * (v / 60);
    broken = (U(S.r) + kinetic) > 0 && S.r > S.pair.r0 * 1.8;

    if (S.r < minR()) { S.r = minR(); v = Math.abs(v) * 0.5; }
    if (S.r > maxR()) { S.r = maxR(); v = -Math.abs(v) * 0.2; }

    el('dist').value = Math.round(S.r);
    el('dist-out').textContent = Math.round(S.r) + ' pm';
  }

  // ── 그래프 위 원자 무대 ──
  function geometry() {
    const p = S.pair;
    const pad = { l: W() < 600 ? 42 : 54, r: 8, t: 38, b: 52 };
    const rMin = minR(), rMax = maxR();
    const uMin = -p.De * 1.16, uMax = p.De * 0.82;
    const w = W() - pad.l - pad.r, h = H() - pad.t - pad.b;
    return {
      p, pad, rMin, rMax, uMin, uMax, w, h,
      sx: (r) => pad.l + (r - rMin) / (rMax - rMin) * w,
      sy: (u) => pad.t + (uMax - u) / (uMax - uMin) * h
    };
  }

  function drawAtom(x, y, radius, color, fixed) {
    const grd = ctx.createRadialGradient(x - radius * .3, y - radius * .3, radius * .1, x, y, radius);
    grd.addColorStop(0, '#fff'); grd.addColorStop(.35, color); grd.addColorStop(1, color);
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = fixed ? '#fff' : '#ffb35c'; ctx.lineWidth = fixed ? 2 : 3; ctx.stroke();
  }

  function atomXFor(r, q, movingRadius) {
    const eqX = q.sx(q.p.r0);
    if (r >= q.p.r0) return q.sx(r);
    /* r₀보다 가까운 구간은 짧게 압축해 전자구름이 서로 겹치는 모습으로 보인다.
       퍼텐셜의 실제 위치는 곡선 위 주황 점이 별도로 보여 준다. */
    const compression = (q.p.r0 - r) / (q.p.r0 - q.rMin);
    return eqX - compression * movingRadius * .9;
  }

  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W(), H());
    const q = geometry(), { p, pad, rMin, rMax, uMin, uMax, w, h, sx, sy } = q;

    ctx.font = `${W() < 600 ? 10 : 12}px system-ui`;
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(255,255,255,.68)'; ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const u = uMax - (uMax - uMin) * i / 4, py = sy(u);
      ctx.beginPath(); ctx.moveTo(pad.l, py); ctx.lineTo(pad.l + w, py); ctx.stroke();
      ctx.fillText(u.toFixed(1), pad.l - 8, py + 4);
    }
    ctx.textAlign = 'center';
    for (let i = 0; i <= 5; i++) {
      const r = rMin + (rMax - rMin) * i / 5, px = sx(r);
      ctx.beginPath(); ctx.moveTo(px, pad.t); ctx.lineTo(px, pad.t + h); ctx.stroke();
      ctx.fillText(Math.round(r), px, pad.t + h + 18);
    }

    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.beginPath(); ctx.moveTo(pad.l, sy(0)); ctx.lineTo(pad.l + w, sy(0)); ctx.stroke();
    ctx.strokeStyle = '#7cc4ff'; ctx.lineWidth = 3; ctx.beginPath();
    let started = false;
    for (let i = 0; i <= 280; i++) {
      const r = rMin + (rMax - rMin) * i / 280, u = U(r);
      const px = sx(r), py = sy(Math.max(uMin, u));
      started ? ctx.lineTo(px, py) : ctx.moveTo(px, py); started = true;
    }
    ctx.stroke();

    const eqX = sx(p.r0), eqY = sy(-p.De);
    ctx.strokeStyle = 'rgba(156,232,160,.75)'; ctx.setLineDash([5,4]);
    ctx.beginPath(); ctx.moveTo(eqX, pad.t); ctx.lineTo(eqX, pad.t + h); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#9ce8a0'; ctx.textAlign = 'center';
    ctx.fillText(`바닥 상태 · r₀ = ${p.r0} pm`, eqX, pad.t + 14);

    const fixedRadius = Math.min(25, p.ra * .72);
    const movingRadius = Math.min(28, p.rb * .72);
    /* 고정 원자는 최저점 바로 왼쪽에 둔다. 움직이는 원자가 r₀에 도착하면
       두 원의 가장자리가 맞닿아 안정한 결합 상태가 눈으로도 보인다. */
    const fixedX = eqX - fixedRadius - movingRadius + 2, fixedY = eqY;
    const energyX = sx(S.r);
    const energyY = Math.max(pad.t, Math.min(pad.t + h, sy(Math.max(uMin, U(S.r)))));
    const movingX = Math.max(movingRadius + 4, Math.min(W() - movingRadius - 4, atomXFor(S.r, q, movingRadius)));
    const movingY = fixedY;
    ctx.strokeStyle = 'rgba(255,179,92,.42)'; ctx.lineWidth = 1.5; ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.moveTo(energyX, energyY); ctx.lineTo(movingX, movingY); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#ffb35c'; ctx.beginPath(); ctx.arc(energyX, energyY, 6, 0, Math.PI * 2); ctx.fill();
    if (!broken) {
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(fixedX, fixedY); ctx.lineTo(movingX, movingY); ctx.stroke();
    }
    drawAtom(fixedX, fixedY, fixedRadius, p.ca, true);
    drawAtom(movingX, movingY, movingRadius, p.cb, false);
    ctx.fillStyle = 'rgba(255,255,255,.82)'; ctx.font = `600 ${W() < 600 ? 10 : 12}px system-ui`;
    ctx.textAlign = 'center'; ctx.fillText(dragging ? '이동 중' : '움직이는 원자', movingX, movingY - movingRadius - 10);

    if (!dragging && Math.abs(S.r - p.r0) >= 3 && !broken) {
      const dir = S.r > p.r0 ? -1 : 1, from = movingX + dir * 30, to = from + dir * 38;
      ctx.strokeStyle = S.r > p.r0 ? '#8fd0ff' : '#ff9d9d'; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(from, movingY); ctx.lineTo(to, movingY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(to, movingY); ctx.lineTo(to - dir * 8, movingY - 5); ctx.lineTo(to - dir * 8, movingY + 5); ctx.closePath(); ctx.fill();
    }

    ctx.strokeStyle = 'rgba(255,255,255,.58)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, pad.t + h); ctx.lineTo(pad.l + w, pad.t + h); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.82)'; ctx.font = `${W() < 600 ? 10 : 12}px system-ui`; ctx.textAlign = 'center';
    ctx.fillText('원자 사이 거리 r (pm)', pad.l + w / 2, H() - 10);
    ctx.save(); ctx.translate(15, pad.t + h / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('퍼텐셜 에너지 U (eV)', 0, 0); ctx.restore();
  }

  // ── 측정값 ──
  function readout() {
    const u = U(S.r), f = F(S.r), p = S.pair;
    el('r-dist').textContent = Math.round(S.r) + ' pm';
    el('r-eq').textContent = p.r0 + ' pm';
    el('r-energy').textContent = u.toFixed(2) + ' eV';
    el('r-force').textContent = (f > 0 ? '+' : '') + f.toFixed(3);

    let state, note;
    if (broken) {
      state = '끊어짐';
      note = '원자가 서로의 영향에서 벗어났습니다. 진동 세기를 낮추고 "결합 길이로" 를 눌러 보세요.';
    } else if (Math.abs(S.r - p.r0) < 3) {
      state = '안정';
      note = '힘이 균형을 이룬 상태입니다. 여기가 에너지가 가장 낮은 지점이라 원자가 이 거리를 유지합니다.';
      if (!dragging) el('stage-said').textContent = '그래프의 바닥 상태에 도착했습니다';
    } else if (S.r < p.r0) {
      state = '반발';
      note = '전자껍질이 겹치려 해서 밀어냅니다. 놓으면 결합 길이로 밀려납니다.';
    } else {
      state = '인력';
      note = '아직 서로 끌어당기고 있습니다. 놓으면 결합 길이로 당겨집니다.';
    }
    el('r-state').textContent = state;
    el('note').textContent = note;
  }

  // ── 원자 조합 버튼 ──
  const pairsBox = el('pairs');
  PAIRS.forEach((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = p.label;
    b.setAttribute('aria-pressed', p.id === S.pair.id ? 'true' : 'false');
    b.addEventListener('click', () => {
      S.pair = p;
      [...pairsBox.children].forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
      el('pair-note').textContent = p.note;
      resetToEq();
    });
    pairsBox.appendChild(b);
  });
  el('pair-note').textContent = S.pair.note;

  function syncRange() {
    const d = el('dist');
    d.min = minR(); d.max = maxR();
  }

  function resetToEq() {
    syncRange();
    S.r = S.pair.r0; v = 0; broken = false;
    el('dist').value = Math.round(S.r);
    el('dist-out').textContent = Math.round(S.r) + ' pm';
  }

  // ── 조작 ──
  el('dist').addEventListener('input', (e) => {
    S.r = Number(e.target.value); v = 0; broken = false;
    el('dist-out').textContent = S.r + ' pm';
  });
  el('temp').addEventListener('input', (e) => {
    S.temp = Number(e.target.value);
    el('temp-out').textContent = S.temp + '%';
  });
  el('toggle').addEventListener('click', () => {
    running = !running;
    el('toggle').textContent = running ? '일시정지' : '이어서';
  });
  el('reset').addEventListener('click', resetToEq);

  /* 캔버스에서 직접 끌기 — 슬라이더보다 이쪽이 직관적이다.
     "당겼다 놓으면 돌아온다" 를 몸으로 느끼게 하는 게 목적이다. */
  function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * W() / rect.width, y: (e.clientY - rect.top) * H() / rect.height };
  }
  function pointerR(clientX) {
    const rect = canvas.getBoundingClientRect(), q = geometry();
    const cx = (clientX - rect.left) * W() / rect.width;
    const movingRadius = Math.min(28, q.p.rb * .72), eqX = q.sx(q.p.r0);
    if (cx < eqX) {
      const compression = Math.min(1, (eqX - cx) / (movingRadius * .9));
      return q.p.r0 - compression * (q.p.r0 - q.rMin);
    }
    return Math.max(q.rMin, Math.min(q.rMax, q.rMin + (cx - q.pad.l) / q.w * (q.rMax - q.rMin)));
  }
  const onDown = (e) => {
    const q = geometry(), point = canvasPoint(e);
    const movingRadius = Math.min(28, q.p.rb * .72);
    const atomX = atomXFor(S.r, q, movingRadius), atomY = q.sy(-q.p.De);
    if (Math.hypot(point.x - atomX, point.y - atomY) > 46) return;
    dragging = true; broken = false;
    canvas.style.cursor = 'grabbing';
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    el('stage-said').textContent = '손을 놓으면 그래프의 바닥 상태로 돌아갑니다';
  };
  const onMove = (e) => {
    if (!dragging) return;
    S.r = pointerR(e.clientX);
    el('dist').value = Math.round(S.r);
    el('dist-out').textContent = Math.round(S.r) + ' pm';
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false; v = 0;
    canvas.style.cursor = 'grab';
    running = true;
    el('toggle').textContent = '일시정지';
    el('stage-said').textContent = '바닥 상태로 돌아가는 중입니다';
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onUp);
  canvas.style.touchAction = 'none';   // 모바일에서 드래그가 스크롤로 먹히지 않게

  // ── 공유 ──
  el('share').addEventListener('click', async () => {
    const said = el('share-said');
    try {
      const me = await Session.refresh();
      if (!me) { said.textContent = '로그인이 필요합니다.'; return; }
      const q = new URLSearchParams({ pair: S.pair.id, r: Math.round(S.r), temp: S.temp });
      const url = location.origin + location.pathname + '?' + q;
      const box = el('share-url');
      box.value = url; box.hidden = false; box.select();
      try { await navigator.clipboard.writeText(url); said.textContent = '복사했습니다.'; }
      catch { said.textContent = '주소를 복사해 주세요.'; }
    } catch { said.textContent = '잠시 후 다시 시도해 주세요.'; }
  });

  function applyQuery() {
    const q = new URLSearchParams(location.search);
    const pid = q.get('pair');
    const found = PAIRS.find((p) => p.id === pid);
    if (found) {
      S.pair = found;
      [...pairsBox.children].forEach((c, i) => c.setAttribute('aria-pressed', String(PAIRS[i].id === pid)));
      el('pair-note').textContent = found.note;
    }
    const r = Number(q.get('r'));
    if (Number.isFinite(r) && r) {
      syncRange();
      S.r = Math.max(minR(), Math.min(maxR(), r));
      el('dist').value = Math.round(S.r);
      el('dist-out').textContent = Math.round(S.r) + ' pm';
    } else {
      resetToEq();
    }
    const t = Number(q.get('temp'));
    if (Number.isFinite(t) && t > 0) {
      S.temp = Math.min(60, t);
      el('temp').value = S.temp;
      el('temp-out').textContent = S.temp + '%';
    }
  }

  // ── 루프 ──
  let last = 0, acc = 0;
  const DT = 1 / 120;
  function frame(ts) {
    const t = ts / 1000;
    if (!last) last = t;
    acc += Math.min(0.25, t - last);   // 탭 복귀 시 밀린 시간 폭주 방지
    last = t;
    if (running) { while (acc >= DT) { step(DT); acc -= DT; } } else { acc = 0; }
    draw(); readout();
    requestAnimationFrame(frame);
  }

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || 900;
    const canvasH = w < 600 ? Math.max(280, Math.round(w * 0.78)) : Math.round(w * 0.52);
    canvas.width = w * DPR;
    canvas.height = canvasH * DPR;
    canvas.style.height = canvasH + 'px';
  }

  applyQuery();
  resize();
  window.addEventListener('resize', resize);
  requestAnimationFrame(frame);
})();
