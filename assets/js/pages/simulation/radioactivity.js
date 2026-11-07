(function () {
  const el = (id) => document.getElementById(id);

  /* ── 방사능: 반감기는 예언이 아니라 통계다 ──

     "반감기가 두 번 지나면 다 없어진다" 와
     "개별 원자는 수명이 정해져 있다" 를 함께 겨냥한다.

     핵심은 원자마다 '남은 수명 바' 를 절대 그리지 않는 것이다(Solar 지적).
     그걸 그리는 순간 "원자에 시계가 있다" 는 오개념이 오히려 굳는다.
     대신 매 순간 같은 확률로 독립 판정한다 — 원자는 나이를 먹지 않는다.

     그래프도 화학 반응의 시간-농도 곡선과 겹치지 않게
     '개별 원자 붕괴 시점(무작위 점)' 과 '집단 비율(반감기 횟수 축)' 을 나눠 그린다.

     검증(직접 계산): (1/2)^n → 1회 50%, 2회 25%, 3회 12.5%, 10회 0.098%.
     통계 요동 √(Np(1−p))/Np: N=20 → 22.4%, N=2000 → 2.2%. */

  const ISO = {
    c14:  { name: '탄소-14',    half: 5730,  unit: '년', note: '연대 측정에 씁니다' },
    i131: { name: '요오드-131', half: 8.02,  unit: '일', note: '갑상선 치료에 씁니다' },
    cs137:{ name: '세슘-137',   half: 30.17, unit: '년', note: '원전 사고 때 문제가 됩니다' }
  };

  const S = { natoms: 400, half: 6, speed: 1, iso: 'c14' };
  let running = true;
  let t = 0;                    // 화면 시간 (초)
  let atoms = [];               // {x, y, alive, deadAt, flash}
  let tracked = [];             // 개별 추적용 원자 8개의 index
  let samples = [];             // {n(반감기 횟수), frac}

  const canvas = el('canvas');
  const ctx = canvas.getContext('2d');
  const graph = el('decay-graph');
  const gctx = graph.getContext('2d');
  let DPR = 1;

  const halves = () => t / S.half;                    // 지난 반감기 횟수
  const theory = () => Math.pow(0.5, halves());
  const aliveCount = () => atoms.filter((a) => a.alive).length;
  const actualFrac = () => atoms.length ? aliveCount() / atoms.length : 0;

  function seed() {
    atoms = [];
    for (let i = 0; i < S.natoms; i++) {
      atoms.push({ x: Math.random(), y: Math.random(), alive: true, deadAt: null, flash: 0 });
    }
    // 개별 추적 8개 — 골고루 흩어진 것으로
    tracked = [];
    const step = Math.max(1, Math.floor(S.natoms / 8));
    for (let i = 0; i < 8 && i * step < S.natoms; i++) tracked.push(i * step);
    t = 0;
    samples = [{ n: 0, frac: 1 }];
  }

  /* 붕괴 판정 — 원자는 나이를 먹지 않는다.
     dt 동안 붕괴할 확률은 1 − (1/2)^(dt/T½) 로, 지금까지 얼마나 살았든 똑같다.
     이게 "메모리가 없다" 는 뜻이고, 반감기가 통계인 이유다. */
  function decayStep(dt) {
    const pDecay = 1 - Math.pow(0.5, dt / S.half);
    atoms.forEach((a) => {
      if (!a.alive) { if (a.flash > 0) a.flash = Math.max(0, a.flash - dt * 2.4); return; }
      if (Math.random() < pDecay) {
        a.alive = false;
        a.deadAt = t;
        a.flash = 1;
      }
    });
  }

  // ── 무대 ──
  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const w = canvas.width / DPR, h = canvas.height / DPR;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0f141c';
    ctx.fillRect(0, 0, w, h);

    const pad = 14, top = 44;
    const iw = w - pad * 2, ih = h - top - pad - 22;

    // 원자 — 크기는 개수에 맞춰 조절
    const r = Math.max(1.8, Math.min(7, 90 / Math.sqrt(S.natoms)));
    atoms.forEach((a) => {
      const px = pad + a.x * iw, py = top + a.y * ih;
      if (a.alive) {
        ctx.fillStyle = '#7bdff2';
        ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
      } else {
        if (a.flash > 0) {
          ctx.strokeStyle = `rgba(255,209,102,${a.flash})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(px, py, r + (1 - a.flash) * 16, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = `rgba(255,209,102,${a.flash * 0.9})`;
          ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.fillStyle = 'rgba(74,84,100,.55)';
          ctx.beginPath(); ctx.arc(px, py, r * 0.72, 0, Math.PI * 2); ctx.fill();
        }
      }
    });

    // 상단 진행 막대
    const barY = 16, barH = 16;
    const frac = actualFrac();
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.fillRect(pad, barY, iw, barH);
    ctx.fillStyle = '#7bdff2';
    ctx.fillRect(pad, barY, iw * frac, barH);
    // 반감기 눈금
    for (let k = 1; k <= 4; k++) {
      const x = pad + iw * Math.pow(0.5, k);
      ctx.strokeStyle = 'rgba(255,255,255,.45)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, barY); ctx.lineTo(x, barY + barH); ctx.stroke();
      ctx.font = '9.5px ui-sans-serif, system-ui';
      ctx.fillStyle = 'rgba(255,255,255,.5)';
      ctx.textAlign = 'center';
      ctx.fillText(k + '회', x, barY - 3);
    }
    ctx.font = '700 12px ui-sans-serif, system-ui';
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.textAlign = 'left';
    ctx.fillText(`${aliveCount()} / ${atoms.length} 남음`, pad + 5, barY + 12);

    // 하단
    const iso = ISO[S.iso];
    ctx.textAlign = 'center';
    ctx.font = '600 12px ui-sans-serif, system-ui';
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.fillText(
      `${iso.name} · 반감기 ${iso.half.toLocaleString()}${iso.unit} · ` +
      `지금 ${halves().toFixed(2)} 번 지남`,
      w / 2, h - 8
    );
  }

  // ── 그래프: 개별 vs 집단 ──
  function drawGraph() {
    /* 캔버스는 CSS 를 못 받으니 색을 여기서 받아온다. 예전에는 '#f7f7f5' 를
       박아 놔서 다크 모드에서도 하얀 박스가 그대로 떠 있었다. */
    const P = window.GraphTheme.palette();
    gctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const w = graph.width / DPR, h = graph.height / DPR;
    gctx.clearRect(0, 0, w, h);
    gctx.fillStyle = P.bg;
    gctx.fillRect(0, 0, w, h);

    const pad = { l: 58, r: 20, t: 18, b: 36 };
    const NMAX = 5;                                  // 반감기 5회까지
    const gw = w - pad.l - pad.r;
    const topH = h * 0.30, botH = h - pad.t - pad.b - topH - 16;
    const X = (n) => pad.l + Math.min(1, n / NMAX) * gw;

    // ── 위: 개별 원자 8개가 언제 터졌나 ──
    gctx.font = '600 11.5px ui-sans-serif, system-ui';
    gctx.fillStyle = '#5a6472';
    gctx.textAlign = 'left';
    gctx.fillText('원자 여덟 개를 따라가 보면 — 아무 규칙이 없습니다', pad.l, pad.t + 10);

    tracked.forEach((idx, row) => {
      const y = pad.t + 20 + row * (topH - 20) / 8;
      const a = atoms[idx];
      // 살아있는 구간
      const endN = a && !a.alive ? a.deadAt / S.half : Math.min(NMAX, halves());
      gctx.strokeStyle = 'rgba(123,223,242,.85)';
      gctx.lineWidth = 2.4;
      gctx.beginPath();
      gctx.moveTo(X(0), y);
      gctx.lineTo(X(Math.min(NMAX, endN)), y);
      gctx.stroke();
      // 붕괴 시점
      if (a && !a.alive && a.deadAt / S.half <= NMAX) {
        const bx = X(a.deadAt / S.half);
        gctx.fillStyle = '#e0a03a';
        gctx.beginPath(); gctx.arc(bx, y, 4, 0, Math.PI * 2); gctx.fill();
      }
    });

    // ── 아래: 집단 비율 (반감기 횟수 축) ──
    const by0 = pad.t + topH + 16;
    const Y = (f) => by0 + botH - f * botH;

    gctx.strokeStyle = P.grid;
    gctx.lineWidth = 1;
    gctx.font = '11px ui-sans-serif, system-ui';
    gctx.fillStyle = P.muted;
    gctx.textAlign = 'center';
    for (let n = 0; n <= NMAX; n++) {
      gctx.beginPath(); gctx.moveTo(X(n), by0); gctx.lineTo(X(n), by0 + botH); gctx.stroke();
      gctx.fillText(n + '회', X(n), h - 16);
    }
    gctx.fillText('지나간 반감기 횟수', pad.l + gw / 2, h - 3);
    gctx.textAlign = 'right';
    [[1, '100%'], [0.5, '50%'], [0.25, '25%'], [0.125, '12.5%'], [0, '0']].forEach(([f, lab]) => {
      gctx.beginPath(); gctx.moveTo(pad.l, Y(f)); gctx.lineTo(pad.l + gw, Y(f)); gctx.stroke();
      gctx.fillText(lab, pad.l - 8, Y(f) + 4);
    });

    // 이론 곡선 (1/2)^n
    gctx.beginPath();
    for (let i = 0; i <= 150; i++) {
      const n = i / 150 * NMAX;
      const xx = X(n), yy = Y(Math.pow(0.5, n));
      i ? gctx.lineTo(xx, yy) : gctx.moveTo(xx, yy);
    }
    gctx.strokeStyle = P.muted;
    gctx.lineWidth = 2;
    gctx.setLineDash([6, 4]); gctx.stroke(); gctx.setLineDash([]);

    // 실제 관측점
    gctx.beginPath();
    let started = false;
    samples.forEach((s) => {
      if (s.n > NMAX) return;
      const xx = X(s.n), yy = Y(s.frac);
      started ? gctx.lineTo(xx, yy) : gctx.moveTo(xx, yy);
      started = true;
    });
    gctx.strokeStyle = '#2a9d8f'; gctx.lineWidth = 2.6; gctx.stroke();

    // 반감기 지점 표시
    for (let n = 1; n <= 3; n++) {
      const yy = Y(Math.pow(0.5, n));
      gctx.fillStyle = P.muted;
      gctx.textAlign = 'left';
      gctx.font = '11px ui-sans-serif, system-ui';
      gctx.fillText(`${n}회 → ${(Math.pow(0.5, n) * 100).toFixed(n > 2 ? 1 : 0)}%`, X(n) + 5, yy - 5);
    }

    gctx.fillStyle = '#1d7870';
    gctx.textAlign = 'left';
    gctx.font = '600 11.5px ui-sans-serif, system-ui';
    gctx.fillText('집단 전체 — 원자가 많을수록 회색 이론선에 붙습니다', pad.l + 6, by0 + 14);
  }

  // ── 수치 ──
  function readout() {
    const n = halves();
    const th = theory(), ac = actualFrac();
    const iso = ISO[S.iso];

    el('r-alive').textContent = aliveCount().toLocaleString() + ' / ' + atoms.length.toLocaleString() + '개';
    el('r-halves').textContent = n.toFixed(2) + '회 (' +
      (n * iso.half).toLocaleString(undefined, { maximumFractionDigits: 1 }) + iso.unit + ')';
    el('r-theory').textContent = (th * 100).toFixed(2) + '%';
    el('r-actual').textContent = (ac * 100).toFixed(2) + '%';
    const gap = Math.abs(ac - th) * 100;
    el('r-gap').textContent = gap.toFixed(2) + '%p';

    // 통계 요동의 이론적 크기 √(Np(1−p))/N
    const sd = atoms.length ? Math.sqrt(atoms.length * th * (1 - th)) / atoms.length * 100 : 0;

    const v = el('verdict');
    if (n < 0.1) {
      v.className = 'verdict';
      v.innerHTML = `${iso.name} 원자 <strong>${atoms.length.toLocaleString()}개</strong>로 시작합니다. ` +
        `반감기는 <strong>${iso.half.toLocaleString()}${iso.unit}</strong> 입니다. 재생을 눌러 보세요.`;
    } else if (atoms.length <= 60) {
      v.className = 'verdict warn';
      v.innerHTML = `원자가 <strong>${atoms.length}개</strong>뿐이라 실제값이 이론에서 ` +
        `<strong>${gap.toFixed(1)}%p</strong> 벗어나 있습니다(예상 흔들림 ${sd.toFixed(1)}%p). ` +
        '개별 원자가 언제 터질지는 <strong>정말로 무작위</strong>이기 때문입니다. ' +
        '원자 수를 늘리면 이 흔들림이 사라집니다.';
    } else if (n >= 1.9) {
      v.className = 'verdict warn';
      v.innerHTML = `반감기가 <strong>${Math.floor(n)}번</strong> 지났는데도 ` +
        `<strong>${(ac * 100).toFixed(1)}%</strong> 가 남아 있습니다. ` +
        '절반씩 <strong>빼는</strong> 게 아니라 <strong>곱하는</strong> 것이라 ' +
        '두 번이면 1/4, 세 번이면 1/8 입니다. 0 이 되지는 않습니다.';
    } else {
      v.className = 'verdict';
      v.innerHTML = `반감기 <strong>${n.toFixed(2)}번</strong> 경과. ` +
        `이론 ${(th * 100).toFixed(1)}% 대비 실제 <strong>${(ac * 100).toFixed(1)}%</strong> ` +
        `(차이 ${gap.toFixed(2)}%p). 원자가 많을수록 이론에 딱 붙습니다.`;
    }

    el('note').textContent =
      `원자 ${atoms.length.toLocaleString()}개일 때 통계적으로 예상되는 흔들림은 약 ${sd.toFixed(2)}%p 입니다. ` +
      `원자 수를 100배 늘리면 흔들림은 1/10 로 줄어듭니다 — 큰 수의 법칙입니다.`;
  }

  // ── 입력 ──
  const labels = {
    natoms: (v) => Number(v).toLocaleString() + '개',
    half: (v) => Number(v).toFixed(1) + '초',
    speed: (v) => Number(v).toFixed(2) + '배'
  };

  ['natoms', 'half', 'speed'].forEach((k) => {
    const input = el(k);
    input.addEventListener('input', () => {
      S[k] = Number(input.value);
      el(k + '-out').textContent = labels[k](input.value);
      if (k !== 'speed') seed();
      syncPresets();
      readout();
    });
  });

  /* ISO 테이블이 코드에는 있었는데 고를 수단이 없었다. 실제 반감기 범위가
     8일~5730년으로 얼마나 다른지는 숫자를 나란히 봐야 와닿는다. */
  const chipBox = el('iso-chips');
  Object.keys(ISO).forEach((key) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.iso = key;
    b.innerHTML = ISO[key].name + ' <small>' + ISO[key].half.toLocaleString() + ISO[key].unit + '</small>';
    b.addEventListener('click', () => {
      S.iso = key;
      // 시간 축은 S.half 슬라이더가 맡는다. 시드는 그대로 두고 표시만 바꾼다
      syncIsoChips(); readout();
    });
    chipBox.appendChild(b);
  });

  function syncIsoChips() {
    chipBox.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.iso === S.iso));
    });
  }
  syncIsoChips();

  const presetBox = el('presets');
  presetBox.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      S.natoms = Number(b.dataset.n);
      S.half = Number(b.dataset.h);
      S.iso = b.dataset.iso;
      ['natoms', 'half'].forEach((k) => {
        el(k).value = S[k];
        el(k + '-out').textContent = labels[k](S[k]);
      });
      seed(); syncPresets(); readout();
    });
  });

  function syncPresets() {
    presetBox.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', String(
        Number(b.dataset.n) === S.natoms && b.dataset.iso === S.iso
      ));
    });
  }

  el('toggle').addEventListener('click', () => {
    running = !running;
    el('toggle').textContent = running ? '일시정지' : '이어서';
  });
  el('reset').addEventListener('click', () => {
    S.natoms = 400; S.half = 6; S.speed = 1; S.iso = 'c14';
    ['natoms', 'half', 'speed'].forEach((k) => {
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
      const q = new URLSearchParams({ n: S.natoms, h: S.half, iso: S.iso });
      const url = location.origin + location.pathname + '?' + q;
      const b = el('share-url');
      b.value = url; b.hidden = false; b.select();
      try { await navigator.clipboard.writeText(url); said.textContent = '복사했습니다.'; }
      catch { said.textContent = '주소를 복사해 주세요.'; }
    } catch { said.textContent = '잠시 후 다시 시도해 주세요.'; }
  });

  function applyQuery() {
    const q = new URLSearchParams(location.search);
    [['n', 'natoms'], ['h', 'half']].forEach(([key, id]) => {
      const v = Number(q.get(key));
      if (q.get(key) === null || !Number.isFinite(v)) return;
      const input = el(id);
      const c = Math.max(Number(input.min), Math.min(Number(input.max), v));
      S[id] = c; input.value = c;
      el(id + '-out').textContent = labels[id](c);
    });
    if (ISO[q.get('iso')]) S.iso = q.get('iso');
    syncIsoChips();   // 복원값을 버튼 눌림 상태에도 반영
    syncPresets();
  }

  // ── 루프 ──
  let last = 0;
  let sampleAt = 0;
  function frame(ts) {
    const now = ts / 1000;
    if (!last) last = now;
    const dt = Math.min(0.1, now - last) * S.speed;
    last = now;

    if (running && halves() < 5.2) {
      t += dt;
      decayStep(dt);
      // 관측점 기록 — 반감기 0.05 회마다
      if (halves() - sampleAt > 0.05) {
        samples.push({ n: halves(), frac: actualFrac() });
        sampleAt = halves();
        if (samples.length > 400) samples.shift();
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
    graph.height = 400 * DPR;
  }

  applyQuery();
  seed();
  readout();
  resize();
  window.GraphTheme.onChange(drawGraph);   // 밝기 모드가 바뀌면 새 팔레트로 다시 그린다
  window.addEventListener('resize', resize);
  requestAnimationFrame(frame);
})();
