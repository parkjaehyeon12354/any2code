(function () {
  const el = (id) => document.getElementById(id);

  /* ── 산과 염기: 희석해도 pH 7 을 넘지 못한다 ──

     "산을 계속 희석하면 pH 가 7을 넘어 염기성이 된다" 가 흔한 오개념이다.
     흔히 쓰는 pH = −log C 는 H⁺ 가 전부 산에서 왔다고 가정하는데,
     농도가 10⁻⁷ 근처로 내려가면 물이 스스로 내놓는 H⁺ 와 비슷해진다.
     그때부터는 [H⁺]² − C[H⁺] − Kw = 0 을 풀어야 한다.

     ⚠ 설계 단계에서 Solar 는 희석 상한을 10⁴배로 제안했는데,
        직접 계산해 보니 그 범위에서는 근사식과 정확식이 소수 4자리까지
        똑같아 오개념이 전혀 안 깨졌다. 지적 후 10⁸배로 열었다.
        10⁷배에서 근사 pH 8.00 vs 실제 6.98 로 확실히 갈라진다.

     Kw 온도 의존성은 문헌 pKw 표를 보간해 쓴다.
     25°C pKw=13.995(중성 6.997), 60°C pKw=13.017(중성 6.508). */

  const S = { dil: 0, conc: -1, temp: 25 };   // dil/conc 는 로그 지수
  let weak = false;                            // 약산 모드인가
  S.pKa = 4.76;                                // 아세트산
  let showNaive = false;

  const canvas = el('canvas');
  const ctx = canvas.getContext('2d');
  const graph = el('ph-graph');
  const gctx = graph.getContext('2d');
  let DPR = 1;
  let anim = 0;

  // 문헌 pKw 표 (CRC 계열). 사이는 선형 보간.
  const PKW = [[0,14.943],[10,14.535],[20,14.167],[25,13.995],[30,13.833],
               [40,13.535],[50,13.262],[60,13.017],[70,12.80],[80,12.60],[100,12.26]];

  function pKw(T) {
    if (T <= PKW[0][0]) return PKW[0][1];
    if (T >= PKW[PKW.length-1][0]) return PKW[PKW.length-1][1];
    for (let i = 0; i < PKW.length - 1; i++) {
      const [t1, p1] = PKW[i], [t2, p2] = PKW[i+1];
      if (T >= t1 && T <= t2) return p1 + (p2 - p1) * (T - t1) / (t2 - t1);
    }
    return 13.995;
  }
  const Kw = () => Math.pow(10, -pKw(S.temp));
  const neutralPH = () => pKw(S.temp) / 2;

  const acidConc = () => Math.pow(10, S.conc);            // 원래 농도
  const dilution = () => Math.pow(10, S.dil);             // 희석 배율
  const Ca = () => acidConc() / dilution();               // 희석 후 농도

  /* 정확식 — 물의 자동 이온화 포함.
     [H⁺]² − C[H⁺] − Kw = 0  →  [H⁺] = (C + √(C² + 4Kw)) / 2 */
  function hExact(c) {
    return (c + Math.sqrt(c * c + 4 * Kw())) / 2;
  }

  /* 약산 — 전하 균형 [H⁺] = [A⁻] + [OH⁻],  [A⁻] = Ka·C/([H⁺]+Ka).
     h − Ka·C/(h+Ka) − Kw/h = 0 을 이분법으로 푼다.
     C=0.1, Ka=1e-5 이면 h≈9.95e-4 (근사 √(Ka·C)=1e-3 과 일치). */
  function hSolve(c) {
    if (!weak) return hExact(c);
    const ka = Math.pow(10, -S.pKa), kw = Kw();
    const f = (x) => x - ka * c / (x + ka) - kw / x;
    let lo = 1e-14, hi = Math.max(1, c + 1);
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (f(mid) > 0) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  }
  // 이온화도 α = [A⁻]/C ≈ ([H⁺]−[OH⁻])/C
  const alpha = () => weak ? Math.max(0, Math.min(1, (hSolve(Ca()) - Kw() / hSolve(Ca())) / Ca())) : 1;
  const phExact = () => -Math.log10(hSolve(Ca()));
  const phNaive = () => -Math.log10(Ca());                // 물 무시 (틀린 식)
  const phNow = () => showNaive ? phNaive() : phExact();

  // ── 무대 ──
  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const w = canvas.width / DPR, h = canvas.height / DPR;
    ctx.clearRect(0, 0, w, h);

    const ph = phNow();
    const neu = neutralPH();

    // 배경 — pH 에 따른 용액 색 (산성 붉게, 중성 옅게)
    const acidity = Math.max(0, Math.min(1, (neu - ph) / neu));
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, `rgb(${Math.round(30 + 42*acidity)}, ${Math.round(34 - 6*acidity)}, ${Math.round(44 - 8*acidity)})`);
    bg.addColorStop(1, `rgb(${Math.round(22 + 30*acidity)}, ${Math.round(26 - 4*acidity)}, ${Math.round(34 - 6*acidity)})`);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // 물 분자 배경
    ctx.fillStyle = 'rgba(141,153,174,.22)';
    for (let i = 0; i < 90; i++) {
      const x = ((i * 137.5) % w), y = ((i * 71.3) % (h - 70)) + 58;
      ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill();
    }

    /* 이온 개수 — 로그 눈금으로 표현한다.
       실제 개수 비는 10¹² 배까지 벌어져 선형으로는 그릴 수 없다. */
    const hConc = showNaive ? Ca() : hSolve(Ca());
    const ohConc = Kw() / hSolve(Ca());
    const dots = (c) => Math.max(0, Math.min(70, Math.round((Math.log10(c) + 14) * 5)));
    const nH = dots(hConc), nOH = dots(ohConc);

    const top = 58, bot = h - 40;
    function ions(count, color, seed) {
      ctx.fillStyle = color;
      for (let i = 0; i < count; i++) {
        const a = (i * 2.399 + seed) % (Math.PI * 2);
        const r = ((i * 37 + seed * 13) % 100) / 100;
        const x = w * 0.5 + Math.cos(a) * r * (w * 0.42);
        const y = (top + bot) / 2 + Math.sin(a) * r * ((bot - top) * 0.42)
                  + Math.sin(anim * 1.2 + i) * 3;
        ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
      }
    }
    ions(nH, '#e8615d', 0);
    ions(nOH, '#5b8def', 1.7);

    // 상단 pH 눈금자
    const barY = 18, barH = 20, barX = 20, barW = w - 40;
    for (let i = 0; i < barW; i++) {
      const p = i / barW * 14;
      const t = Math.max(0, Math.min(1, p / 14));
      ctx.fillStyle = `rgb(${Math.round(226 - 150*t)}, ${Math.round(90 + 60*t)}, ${Math.round(70 + 150*t)})`;
      ctx.fillRect(barX + i, barY, 1, barH);
    }
    ctx.strokeStyle = 'rgba(255,255,255,.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barW, barH);

    // 중성 지점
    const nx = barX + neu / 14 * barW;
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(nx, barY - 5); ctx.lineTo(nx, barY + barH + 5); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '10.5px ui-sans-serif, system-ui';
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.textAlign = 'center';
    ctx.fillText(`중성 ${neu.toFixed(2)}`, nx, barY - 8);

    // 현재 pH 바늘
    const px = barX + Math.max(0, Math.min(14, ph)) / 14 * barW;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(px, barY + barH + 3);
    ctx.lineTo(px - 6, barY + barH + 13);
    ctx.lineTo(px + 6, barY + barH + 13);
    ctx.closePath(); ctx.fill();
    ctx.font = '700 12.5px ui-sans-serif, system-ui';
    ctx.fillText('pH ' + ph.toFixed(2), px, barY + barH + 26);

    // 하단 안내
    ctx.textAlign = 'center';
    ctx.font = '600 12.5px ui-sans-serif, system-ui';
    if (showNaive && ph > neu) {
      ctx.fillStyle = '#ffb4a2';
      ctx.fillText('산을 넣었는데 염기성? — 물을 무시하면 이런 답이 나옵니다', w / 2, h - 12);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,.6)';
      ctx.fillText(
        `${dilution() >= 1000 ? Math.round(dilution()).toLocaleString() : dilution().toFixed(0)}배 희석 · ` +
        `H⁺ ${hConc.toExponential(1)} · OH⁻ ${ohConc.toExponential(1)} mol/L`,
        w / 2, h - 12
      );
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

    const pad = { l: 52, r: 24, t: 20, b: 40 };
    const gw = w - pad.l - pad.r, gh = h - pad.t - pad.b;
    const X = (logd) => pad.l + logd / 8 * gw;
    const Y = (ph) => pad.t + gh - Math.max(0, Math.min(14, ph)) / 14 * gh;

    gctx.strokeStyle = P.grid;
    gctx.lineWidth = 1;
    gctx.font = '11px ui-sans-serif, system-ui';
    gctx.fillStyle = P.muted;
    gctx.textAlign = 'center';
    for (let d = 0; d <= 8; d++) {
      gctx.beginPath(); gctx.moveTo(X(d), pad.t); gctx.lineTo(X(d), pad.t + gh); gctx.stroke();
      gctx.fillText(d === 0 ? '1배' : '10^' + d, X(d), h - 16);
    }
    gctx.fillText('희석 배율', pad.l + gw / 2, h - 3);
    gctx.textAlign = 'right';
    for (let p = 0; p <= 14; p += 2) {
      gctx.beginPath(); gctx.moveTo(pad.l, Y(p)); gctx.lineTo(pad.l + gw, Y(p)); gctx.stroke();
      gctx.fillText('pH ' + p, pad.l - 8, Y(p) + 4);
    }

    // 중성 기준선
    const neu = neutralPH();
    gctx.setLineDash([6, 5]);
    gctx.strokeStyle = 'rgba(40,140,120,.85)'; gctx.lineWidth = 2;
    gctx.beginPath(); gctx.moveTo(pad.l, Y(neu)); gctx.lineTo(pad.l + gw, Y(neu)); gctx.stroke();
    gctx.setLineDash([]);
    gctx.fillStyle = '#1d7870'; gctx.textAlign = 'left';
    gctx.font = '600 11.5px ui-sans-serif, system-ui';
    gctx.fillText(`중성 pH ${neu.toFixed(3)} (${S.temp}°C) — 넘을 수 없는 선`, pad.l + 8, Y(neu) - 7);

    // 물 무시 근사 (틀린 곡선)
    gctx.beginPath();
    for (let i = 0; i <= 160; i++) {
      const d = i / 160 * 8;
      const c = acidConc() / Math.pow(10, d);
      const xx = X(d), yy = Y(-Math.log10(c));
      i ? gctx.lineTo(xx, yy) : gctx.moveTo(xx, yy);
    }
    gctx.strokeStyle = P.muted; gctx.lineWidth = 2;
    gctx.setLineDash([7, 5]); gctx.stroke(); gctx.setLineDash([]);

    // 실제 곡선
    gctx.beginPath();
    for (let i = 0; i <= 160; i++) {
      const d = i / 160 * 8;
      const c = acidConc() / Math.pow(10, d);
      const xx = X(d), yy = Y(-Math.log10(hSolve(c)));
      i ? gctx.lineTo(xx, yy) : gctx.moveTo(xx, yy);
    }
    gctx.strokeStyle = '#e8615d'; gctx.lineWidth = 3; gctx.stroke();

    // 범례
    gctx.font = '600 11.5px ui-sans-serif, system-ui';
    gctx.fillStyle = '#c0392b'; gctx.textAlign = 'left';
    gctx.fillText('실제 (물의 이온화 포함)', pad.l + 10, pad.t + 16);
    gctx.fillStyle = '#6b6b76';
    gctx.fillText('물을 무시한 계산 — 7을 넘어버립니다', pad.l + 10, pad.t + 32);

    // 현재 위치
    gctx.beginPath();
    gctx.arc(X(S.dil), Y(phNow()), 6, 0, Math.PI * 2);
    gctx.fillStyle = P.ink; gctx.fill();
    gctx.strokeStyle = P.bg; gctx.lineWidth = 2.4; gctx.stroke();
  }

  // ── 수치 ──
  function readout() {
    const c = Ca();
    const h = hSolve(c), oh = Kw() / h;
    const real = phExact(), naive = phNaive(), neu = neutralPH();

    el('r-ca').textContent = c.toExponential(3) + ' mol/L';
    el('r-h').textContent = h.toExponential(3) + ' mol/L';
    el('r-oh').textContent = oh.toExponential(3) + ' mol/L';
    el('r-ph').textContent = real.toFixed(3);
    el('r-alpha').textContent = weak ? (alpha() * 100).toFixed(1) + ' %' : '100 % (강산)';
    el('r-neutral').textContent = neu.toFixed(3) + (Math.abs(S.temp - 25) < 0.5 ? ' (25°C)' : ` (${S.temp}°C)`);

    el('s-real').textContent = real.toFixed(3);
    const sn = el('s-naive');
    sn.textContent = naive.toFixed(3);
    sn.className = naive > neu + 0.02 ? 'up' : '';

    const gap = naive - real;
    const v = el('verdict');
    if (weak) {
      /* 이 화면에서 약산의 존재 이유 — 같은 농도·같은 희석인데 pH 가 다르다 */
      const strongPH = -Math.log10(hExact(c));
      v.className = 'verdict';
      v.innerHTML = `농도는 강산일 때와 똑같이 <strong>${c.toExponential(1)}</strong> mol/L 인데 ` +
        `pH 는 강산이면 <strong>${strongPH.toFixed(2)}</strong>, 이 약산(pK<sub>a</sub> ${S.pKa.toFixed(2)})은 ` +
        `<strong>${real.toFixed(2)}</strong> 입니다. 이온화도가 <strong>${(alpha() * 100).toFixed(1)}%</strong> 라 ` +
        '대부분 분자 상태로 남아 있기 때문입니다. <strong>농도가 같아도 산의 세기가 다르면 pH 도 다릅니다.</strong>';
    } else if (naive > neu + 0.05) {
      v.className = 'verdict warn';
      v.innerHTML = `물을 무시하면 pH <strong>${naive.toFixed(2)}</strong> — ` +
        `<strong>산을 넣었는데 염기성</strong>이라는 말이 됩니다. 있을 수 없는 답입니다. ` +
        `실제로는 <strong>${real.toFixed(3)}</strong> 로 중성 ${neu.toFixed(2)} 바로 아래에 멈춥니다. ` +
        '물이 스스로 내놓는 H⁺ 가 바닥을 받치고 있기 때문입니다.';
    } else if (gap > 0.02) {
      v.className = 'verdict';
      v.innerHTML = `이 지점부터 두 계산이 <strong>${gap.toFixed(3)}</strong> 만큼 갈라지기 시작합니다. ` +
        '산이 묽어져 물이 내놓는 H⁺ 를 더 이상 무시할 수 없게 된 것입니다. ' +
        '더 희석해 보세요.';
    } else if (Math.abs(S.temp - 25) > 3) {
      v.className = 'verdict';
      v.innerHTML = `${S.temp}°C 에서 중성은 pH <strong>${neu.toFixed(3)}</strong> 입니다. ` +
        'pH 7 이 중성이라는 말은 25°C 에서만 맞습니다. ' +
        `이 온도의 순수한 물은 pH ${neu.toFixed(2)} 이지만 여전히 <strong>완벽한 중성</strong>입니다.`;
    } else {
      v.className = 'verdict';
      v.innerHTML = `아직은 산이 진해서 물의 기여를 무시해도 됩니다 ` +
        `(두 계산 차이 ${gap.toFixed(4)}). 희석 슬라이더를 더 밀어 보세요.`;
    }

    el('note').textContent =
      `Kw = ${Kw().toExponential(3)} (${S.temp}°C). ` +
      `[H⁺]×[OH⁻] = ${(h * oh).toExponential(3)} 로 항상 Kw 와 같습니다 — ` +
      `산성 용액에도 OH⁻ 는 반드시 존재합니다.`;
  }

  // ── 입력 ──
  const labels = {
    dil: (v) => {
      const d = Math.pow(10, Number(v));
      return d < 1000 ? Math.round(d) + '배' : Math.round(d).toLocaleString() + '배';
    },
    conc: (v) => Math.pow(10, Number(v)).toPrecision(3) + ' mol/L',
    temp: (v) => Number(v) + ' °C'
  };

  ['dil', 'conc', 'temp'].forEach((k) => {
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
      S.dil = Number(b.dataset.d);
      S.conc = Number(b.dataset.c);
      S.temp = Number(b.dataset.t);
      ['dil', 'conc', 'temp'].forEach((k) => {
        el(k).value = S[k];
        el(k + '-out').textContent = labels[k](S[k]);
      });
      syncPresets(); readout();
    });
  });

  function syncPresets() {
    presetBox.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', String(
        Math.abs(Number(b.dataset.d) - S.dil) < 1e-9 &&
        Math.abs(Number(b.dataset.c) - S.conc) < 1e-9 &&
        Math.abs(Number(b.dataset.t) - S.temp) < 1e-9
      ));
    });
  }

  function setKind(w) {
    weak = w;
    el('kind-out').textContent = w ? '약산' : '강산';
    el('kind-strong').setAttribute('aria-pressed', String(!w));
    el('kind-weak').setAttribute('aria-pressed', String(w));
    el('pka-ctrl').hidden = !w;
    readout();
  }
  el('kind-strong').addEventListener('click', () => setKind(false));
  el('kind-weak').addEventListener('click', () => setKind(true));
  el('pka').addEventListener('input', function () {
    S.pKa = Number(this.value);
    el('pka-out').textContent = S.pKa.toFixed(2);
    readout();
  });

  el('naive').addEventListener('click', () => {
    showNaive = !showNaive;
    el('naive').textContent = showNaive ? '실제 계산으로 돌아가기' : '물의 이온화 무시해 보기';
    readout();
  });

  el('reset').addEventListener('click', () => {
    S.dil = 0; S.conc = -1; S.temp = 25;
    showNaive = false;
    el('naive').textContent = '물의 이온화 무시해 보기';
    ['dil', 'conc', 'temp'].forEach((k) => {
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
      const q = new URLSearchParams({ dil: S.dil, conc: S.conc, temp: S.temp, ...(weak ? { weak: 1, pka: S.pKa } : {}) });
      const url = location.origin + location.pathname + '?' + q;
      const b = el('share-url');
      b.value = url; b.hidden = false; b.select();
      try { await navigator.clipboard.writeText(url); said.textContent = '복사했습니다.'; }
      catch { said.textContent = '주소를 복사해 주세요.'; }
    } catch { said.textContent = '잠시 후 다시 시도해 주세요.'; }
  });

  function applyQuery() {
    const q = new URLSearchParams(location.search);
    ['dil', 'conc', 'temp'].forEach((k) => {
      const v = Number(q.get(k));
      if (q.get(k) === null || !Number.isFinite(v)) return;
      const input = el(k);
      const c = Math.max(Number(input.min), Math.min(Number(input.max), v));
      S[k] = c; input.value = c;
      el(k + '-out').textContent = labels[k](c);
    });
    if (q.get('weak') === '1') {
      const pv = Number(q.get('pka'));
      if (Number.isFinite(pv) && pv >= 2 && pv <= 8) {
        S.pKa = pv;
        el('pka').value = pv;
        el('pka-out').textContent = pv.toFixed(2);
      }
      setKind(true);
    }
    syncPresets();
  }

  function frame(ts) {
    anim = ts / 1000;
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
