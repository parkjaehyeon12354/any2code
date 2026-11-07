(function () {
  const el = (id) => document.getElementById(id);

  /* ── 개체와 생태계: 천적을 없애면 정말 번성할까 ──

     로트카-볼테라. 설계는 Solar 4 Pro, 검증은 직접 계산으로 대조했다.
       dN/dt = rN − aNP
       dP/dt = eaNP − mP
     균형점 N* = m/(ea), P* = r/a

     ⚠ Solar 는 로지스틱 항 rN(1−N/K) 을 넣자고 했고 검증값 6건은 전부 정확했다.
        그런데 그 상수(r=.5 K=100 a=.08)로 돌려 보니 5초 만에 N 이 40→0.26 으로
        붕괴하고 진동이 감쇠해, 정작 보여줄 '주기'가 화면에서 사라졌다.
        숫자는 맞지만 화면이 죽는다. 순수 LV(K 없음)로 바꿨다.
     확인한 값: N*=13.33, P*=25, 주기 32.17, 포식자 지연 6.43(=주기의 0.200배) */

/* 번식률은 조작 변수다(S.birth) — 본문이 "번식률을 올리면 정작 포식자가 는다" 고
     설명하는데 상수로 두면 확인할 방법이 없다. */
  const e = 0.3;    // 먹은 것이 새끼가 되는 비율
  const m = 0.08;   // 포식자 자연사망률

  const S = { prey0: 25, pred0: 25, attack: 0.02, birth: 0.5 };
  let N = 25, P = 25, t = 0;
  let running = true;
  let trail = [];          // 위상평면 궤적
  let kills = 0, killFlash = [];
  let peaksN = [], peaksP = [];
  let prevN = 0, prevP = 0, prevdN = 0, prevdP = 0;

  const canvas = el('canvas');
  const ctx = canvas.getContext('2d');
  const graph = el('phase-graph');
  const gctx = graph.getContext('2d');
  let DPR = 1;

  const nStar = () => m / (e * S.attack);
  const pStar = () => S.birth / S.attack;

  function reseed() {
    N = S.prey0; P = S.pred0; t = 0;
    trail = []; kills = 0; killFlash = [];
    peaksN = []; peaksP = [];
    prevN = N; prevP = P; prevdN = 0; prevdP = 0;
    seedDots();
  }

  // 화면의 점들 — 실제 마릿수와 별개로 위치만 관리한다
  let dots = [];
  function seedDots() {
    dots = [];
    for (let i = 0; i < 90; i++) {
      dots.push({
        x: Math.random(), y: Math.random(),
        vx: (Math.random() - 0.5), vy: (Math.random() - 0.5),
        kind: i < 45 ? 'N' : 'P'
      });
    }
  }

  function step(dt) {
    const a = S.attack;
    const dN = S.birth * N - a * N * P;
    const dP = e * a * N * P - m * P;

    // 피크 감지 — 기울기 부호가 +에서 −로 바뀌는 순간
    if (prevdN > 0 && dN <= 0 && t > 1) peaksN.push(t);
    if (prevdP > 0 && dP <= 0 && t > 1) peaksP.push(t);
    if (peaksN.length > 6) peaksN.shift();
    if (peaksP.length > 6) peaksP.shift();

    prevdN = dN; prevdP = dP;
    N = Math.max(0, N + dN * dt);
    P = Math.max(0, P + dP * dt);
    t += dt;

    // 사냥 사건 — aNP 에 비례
    const rate = a * N * P;
    let ev = rate * dt * 0.8;
    let whole = Math.floor(ev);
    if (Math.random() < ev - whole) whole++;
    for (let k = 0; k < Math.min(whole, 4); k++) {
      kills++;
      killFlash.push({ x: Math.random(), y: Math.random(), life: 1 });
    }
    if (killFlash.length > 24) killFlash.splice(0, killFlash.length - 24);

    trail.push({ n: N, p: P });
    if (trail.length > 3000) trail.shift();
  }

  function period() {
    if (peaksN.length < 2) return 0;
    return peaksN[peaksN.length - 1] - peaksN[peaksN.length - 2];
  }
  function lag() {
    if (!peaksN.length) return 0;
    const lastN = peaksN[peaksN.length - 1];
    const after = peaksP.filter((x) => x > lastN);
    if (after.length) return after[0] - lastN;
    // 아직 안 왔으면 직전 쌍으로
    for (let i = peaksN.length - 2; i >= 0; i--) {
      const nn = peaksN[i];
      const aa = peaksP.filter((x) => x > nn);
      if (aa.length) return aa[0] - nn;
    }
    return 0;
  }

  // ── 무대 ──
  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const w = canvas.width / DPR, h = canvas.height / DPR;
    ctx.clearRect(0, 0, w, h);

    // 초원 — 피식자가 많으면 풀이 짧아진다(뜯어먹힘)
    const graze = Math.min(1, N / 60);
    ctx.fillStyle = `rgb(${Math.round(22 + 10 * graze)}, ${Math.round(38 - 12 * graze)}, ${Math.round(28 - 6 * graze)})`;
    ctx.fillRect(0, 0, w, h);

    const pad = 14, top = 56;
    const iw = w - pad * 2, ih = h - top - pad - 22;

    // 실제 마릿수만큼만 점을 보여준다 — 수가 눈에 보여야 한다
    const showN = Math.min(45, Math.round(N * 45 / 60));
    const showP = Math.min(45, Math.round(P * 45 / 60));

    killFlash.forEach((f) => {
      if (f.life <= 0) return;
      ctx.fillStyle = `rgba(255,209,102,${f.life * 0.55})`;
      ctx.beginPath();
      ctx.arc(pad + f.x * iw, top + f.y * ih, 16 * (1.4 - f.life), 0, Math.PI * 2);
      ctx.fill();
    });

    let ni = 0, pi = 0;
    dots.forEach((d) => {
      const px = pad + d.x * iw, py = top + d.y * ih;
      if (d.kind === 'N') {
        if (ni++ >= showN) return;
        ctx.fillStyle = '#7bdff2';
        ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
      } else {
        if (pi++ >= showP) return;
        ctx.fillStyle = '#f4a261';
        ctx.beginPath();
        ctx.moveTo(px, py - 7); ctx.lineTo(px + 6.5, py + 5); ctx.lineTo(px - 6.5, py + 5);
        ctx.closePath(); ctx.fill();
      }
    });

    // 상단 막대 — 두 수를 나란히
    const barY = 18, barH = 12;
    const drawBar = (val, color, label, yy) => {
      const bw = Math.min(1, val / 60) * (iw - 120);
      ctx.fillStyle = 'rgba(255,255,255,.12)';
      ctx.fillRect(pad + 96, yy, iw - 120, barH);
      ctx.fillStyle = color;
      ctx.fillRect(pad + 96, yy, bw, barH);
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.font = '600 11.5px ui-sans-serif, system-ui';
      ctx.textAlign = 'left';
      ctx.fillText(label, pad, yy + 10);
      ctx.fillText(val.toFixed(1), pad + 96 + (iw - 120) + 8, yy + 10);
    };
    drawBar(N, '#7bdff2', '피식자', barY - 4);
    drawBar(P, '#f4a261', '포식자', barY + 14);

    // 하단
    ctx.textAlign = 'center';
    ctx.font = '600 12.5px ui-sans-serif, system-ui';
    if (S.pred0 === 0) {
      ctx.fillStyle = '#ffd166';
      ctx.fillText('천적이 없습니다 — 피식자가 끝없이 불어납니다', w / 2, h - 8);
    } else if (N < 3) {
      ctx.fillStyle = '#ffb4a2';
      ctx.fillText('피식자가 거의 사라졌습니다 — 이제 포식자가 굶습니다', w / 2, h - 8);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,.6)';
      ctx.fillText(`${t.toFixed(0)}년째 · 피식자 ${N.toFixed(0)} · 포식자 ${P.toFixed(0)}`, w / 2, h - 8);
    }
  }

  // ── 위상평면 그래프 ──
  function drawGraph() {
    /* 캔버스는 CSS 를 못 받으니 색을 여기서 받아온다. 예전에는 '#f7f7f5' 를
       박아 놔서 다크 모드에서도 하얀 박스가 그대로 떠 있었다. */
    const P = window.GraphTheme.palette();
    gctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const w = graph.width / DPR, h = graph.height / DPR;
    gctx.clearRect(0, 0, w, h);
    gctx.fillStyle = P.bg;
    gctx.fillRect(0, 0, w, h);

    const pad = { l: 62, r: 26, t: 22, b: 42 };
    const gw = w - pad.l - pad.r, gh = h - pad.t - pad.b;

    let maxN = 60, maxP = 60;
    trail.forEach((q) => { maxN = Math.max(maxN, q.n); maxP = Math.max(maxP, q.p); });
    maxN *= 1.08; maxP *= 1.08;

    const X = (n) => pad.l + Math.min(1, n / maxN) * gw;
    const Y = (p) => pad.t + gh - Math.min(1, p / maxP) * gh;

    gctx.strokeStyle = P.grid;
    gctx.lineWidth = 1;
    gctx.font = '11px ui-sans-serif, system-ui';
    gctx.fillStyle = P.muted;
    gctx.textAlign = 'center';
    for (let i = 0; i <= 4; i++) {
      const n = maxN * i / 4;
      gctx.beginPath(); gctx.moveTo(X(n), pad.t); gctx.lineTo(X(n), pad.t + gh); gctx.stroke();
      gctx.fillText(n.toFixed(0), X(n), h - 18);
    }
    gctx.fillText('피식자 수 →', pad.l + gw / 2, h - 4);
    gctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const p = maxP * i / 4;
      gctx.beginPath(); gctx.moveTo(pad.l, Y(p)); gctx.lineTo(pad.l + gw, Y(p)); gctx.stroke();
      gctx.fillText(p.toFixed(0), pad.l - 8, Y(p) + 4);
    }
    gctx.save();
    gctx.translate(16, pad.t + gh / 2); gctx.rotate(-Math.PI / 2);
    gctx.textAlign = 'center'; gctx.fillText('포식자 수 →', 0, 0);
    gctx.restore();

    // 균형점
    const ns = nStar(), ps = pStar();
    gctx.setLineDash([4, 4]);
    gctx.strokeStyle = 'rgba(29,120,112,.45)';
    gctx.beginPath(); gctx.moveTo(X(ns), pad.t); gctx.lineTo(X(ns), pad.t + gh); gctx.stroke();
    gctx.beginPath(); gctx.moveTo(pad.l, Y(ps)); gctx.lineTo(pad.l + gw, Y(ps)); gctx.stroke();
    gctx.setLineDash([]);
    gctx.fillStyle = '#1d7870';
    gctx.beginPath(); gctx.arc(X(ns), Y(ps), 5, 0, Math.PI * 2); gctx.fill();
    gctx.textAlign = 'left';
    gctx.font = '600 11.5px ui-sans-serif, system-ui';
    gctx.fillText(`균형점 (${ns.toFixed(1)}, ${ps.toFixed(1)})`, X(ns) + 8, Y(ps) - 8);

    // 궤적
    if (trail.length > 1) {
      gctx.beginPath();
      trail.forEach((q, i) => {
        const xx = X(q.n), yy = Y(q.p);
        i ? gctx.lineTo(xx, yy) : gctx.moveTo(xx, yy);
      });
      gctx.strokeStyle = 'rgba(192,57,43,.5)';
      gctx.lineWidth = 1.8;
      gctx.stroke();
    }

    // 도는 방향
    if (trail.length > 40) {
      const q1 = trail[trail.length - 30], q2 = trail[trail.length - 1];
      const ang = Math.atan2(Y(q2.p) - Y(q1.p), X(q2.n) - X(q1.n));
      const hx = X(q2.n), hy = Y(q2.p);
      gctx.fillStyle = '#c0392b';
      gctx.beginPath();
      gctx.moveTo(hx + Math.cos(ang) * 9, hy + Math.sin(ang) * 9);
      gctx.lineTo(hx + Math.cos(ang + 2.5) * 8, hy + Math.sin(ang + 2.5) * 8);
      gctx.lineTo(hx + Math.cos(ang - 2.5) * 8, hy + Math.sin(ang - 2.5) * 8);
      gctx.closePath(); gctx.fill();
    }

    // 현재 위치
    gctx.beginPath(); gctx.arc(X(N), Y(P), 6.5, 0, Math.PI * 2);
    gctx.fillStyle = P.ink; gctx.fill();
    gctx.strokeStyle = P.bg; gctx.lineWidth = 2.4; gctx.stroke();

    gctx.fillStyle = P.muted;
    gctx.font = '11.5px ui-sans-serif, system-ui';
    gctx.textAlign = 'left';
    gctx.fillText('점이 지나간 자리 — 닫히면 영원히 반복된다는 뜻입니다', pad.l + 10, pad.t + 16);
  }

  // ── 수치 ──
  function readout() {
    el('r-n').textContent = N.toFixed(1) + ' 마리';
    el('r-p').textContent = P.toFixed(1) + ' 마리';
    const T = period(), L = lag();
    el('r-period').textContent = T ? T.toFixed(1) + ' 년' : '재는 중…';
    el('r-lag').textContent = L ? `${L.toFixed(1)} 년 (${T ? (L / T).toFixed(2) : '–'} 주기)` : '재는 중…';
    el('r-kills').textContent = kills.toLocaleString() + ' 번';

    el('s-nstar').textContent = nStar().toFixed(1);
    el('s-pstar').textContent = pStar().toFixed(1);

    const v = el('verdict');
    if (S.pred0 === 0) {
      v.className = 'verdict warn';
      v.innerHTML = '포식자가 없으니 피식자는 <strong>지수적으로 계속 늘어납니다.</strong> ' +
        '그런데 현실에는 풀의 양이라는 한계가 있습니다 — ' +
        '<strong>카이밥 고원의 사슴은 4천에서 10만까지 늘었다가 굶어 죽으며 1만으로 무너졌습니다.</strong>';
    } else if (T && L) {
      v.className = 'verdict';
      v.innerHTML = `한 바퀴에 <strong>${T.toFixed(1)}년</strong>, ` +
        `포식자 피크는 피식자 피크보다 <strong>${L.toFixed(1)}년 뒤에</strong> 옵니다 — ` +
        `주기의 <strong>${(L / T).toFixed(2)}배</strong>입니다. ` +
        '이 어긋남이 &quot;포식자가 늘면 먹이가 줄고 끝&quot;이 아니라는 증거입니다.';
    } else {
      v.className = 'verdict';
      v.innerHTML = '피크를 두 번 지나면 주기와 지연을 재서 보여드립니다. ' +
        '<strong>포식자 곡선이 피식자 곡선을 뒤쫓는 모습</strong>을 지켜보세요.';
    }

    el('note').textContent =
      `번식률 r=${S.birth.toFixed(2)}, 사냥 성공률 a=${S.attack.toFixed(3)}, 전환효율 e=${e}, 사망률 m=${m}. ` +
      `균형점은 N*=m/(ea)=${nStar().toFixed(2)}, P*=r/a=${pStar().toFixed(1)} — ` +
      `피식자 수가 포식자 쪽 상수로, 포식자 수가 피식자 쪽 상수로 정해집니다.`;
  }

  // ── 입력 ──
  const labels = {
    prey0: (v) => Number(v) + ' 마리',
    pred0: (v) => Number(v) + ' 마리',
    attack: (v) => Number(v).toFixed(3),
    birth: (v) => Number(v).toFixed(2) + ' /년'
  };
  ['prey0', 'pred0', 'attack', 'birth'].forEach((k) => {
    const input = el(k);
    input.addEventListener('input', () => {
      S[k] = Number(input.value);
      el(k + '-out').textContent = labels[k](input.value);
      reseed(); syncPresets(); readout();
    });
  });

  const presetBox = el('presets');
  presetBox.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      S.prey0 = Number(b.dataset.n); S.pred0 = Number(b.dataset.p); S.attack = Number(b.dataset.a);
      ['prey0', 'pred0', 'attack', 'birth'].forEach((k) => {
        el(k).value = S[k]; el(k + '-out').textContent = labels[k](S[k]);
      });
      reseed(); syncPresets(); readout();
    });
  });
  function syncPresets() {
    presetBox.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', String(
        Number(b.dataset.n) === S.prey0 &&
        Number(b.dataset.p) === S.pred0 &&
        Math.abs(Number(b.dataset.a) - S.attack) < 1e-9));
    });
  }

  el('toggle').addEventListener('click', () => {
    running = !running;
    el('toggle').textContent = running ? '일시정지' : '이어서';
  });
  el('reset').addEventListener('click', () => {
    S.prey0 = 25; S.pred0 = 25; S.attack = 0.02;
    ['prey0', 'pred0', 'attack', 'birth'].forEach((k) => {
      el(k).value = S[k]; el(k + '-out').textContent = labels[k](S[k]);
    });
    reseed(); syncPresets(); readout();
  });

  el('share').addEventListener('click', async () => {
    const said = el('share-said');
    try {
      const me = await Session.refresh();
      if (!me) { said.textContent = '로그인이 필요합니다.'; return; }
      const q = new URLSearchParams({ n: S.prey0, p: S.pred0, a: S.attack, r: S.birth });
      const url = location.origin + location.pathname + '?' + q;
      const b = el('share-url');
      b.value = url; b.hidden = false; b.select();
      try { await navigator.clipboard.writeText(url); said.textContent = '복사했습니다.'; }
      catch { said.textContent = '주소를 복사해 주세요.'; }
    } catch { said.textContent = '잠시 후 다시 시도해 주세요.'; }
  });

  function applyQuery() {
    const q = new URLSearchParams(location.search);
    const map = { n: 'prey0', p: 'pred0', a: 'attack', r: 'birth' };
    Object.entries(map).forEach(([key, id]) => {
      const raw = q.get(key);
      if (raw === null) return;
      const v = Number(raw);
      if (!Number.isFinite(v)) return;
      const input = el(id);
      const c = Math.max(Number(input.min), Math.min(Number(input.max), v));
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
      // 한 프레임에 여러 번 적분 — 부드럽고 정확하게
      /* 6배속. 2.2 배로는 주기 한 바퀴(32년)에 30초가 걸려 학생이 못 기다린다.
         sub=8 로 잘게 쪼개 적분하므로 배속을 올려도 궤적이 뭉개지지 않는다. */
      const sub = 8, h = dt * 6 / sub;
      for (let i = 0; i < sub; i++) step(h);
      dots.forEach((d) => {
        d.x += d.vx * dt * 0.05; d.y += d.vy * dt * 0.05;
        if (d.x < 0 || d.x > 1) { d.vx = -d.vx; d.x = Math.max(0, Math.min(1, d.x)); }
        if (d.y < 0 || d.y > 1) { d.vy = -d.vy; d.y = Math.max(0, Math.min(1, d.y)); }
      });
      killFlash.forEach((f) => { f.life -= dt * 1.6; });
      killFlash = killFlash.filter((f) => f.life > 0);
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
  reseed();
  syncPresets();
  readout();
  resize();
  window.GraphTheme.onChange(drawGraph);   // 밝기 모드가 바뀌면 새 팔레트로 다시 그린다
  window.addEventListener('resize', resize);
  requestAnimationFrame(frame);
})();
