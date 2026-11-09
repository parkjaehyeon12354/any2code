(function () {
  const el = (id) => document.getElementById(id);

  /* ── 빛과 파동: 굴절은 굴절률이 아니라 속도 차이 때문이다 ──

     "굴절률이 다르면 꺾인다" 가 흔한 오개념이다. 입사각을 0도로 두면
     속도는 분명히 달라지는데도 전혀 꺾이지 않는다. 파면 전체가 동시에
     경계에 닿아 똑같이 느려지므로 회전시킬 이유가 없기 때문이다.

     설계는 Solar 4 Pro 와 함께 잡았고, 검증값 6건을 직접 계산해 확인했다:
       공기→물 30도 → 22.08도 / 공기→유리 30도 → 19.47도
       물→공기 30도 → 41.68도 / 유리→물 25도 → 28.47도
       v2(n=1.5) = 2.00e8 / 임계각(물→공기) = 48.75도 */

  const C = 3.0e8;                    // 진공에서의 광속 (m/s)
  const S = { angle: 30, n1: 1.0, n2: 1.5, wl: 34 };
  let running = true;
  let phase = 0;                      // 파면 애니메이션 위상

  const canvas = el('canvas');
  const ctx = canvas.getContext('2d');
  const graph = el('angle-graph');
  const gctx = graph.getContext('2d');
  let DPR = 1;
  const W = () => canvas.width / DPR;
  const H = () => canvas.height / DPR;

  const rad = (d) => d * Math.PI / 180;
  const deg = (r) => r * 180 / Math.PI;

  /* 스넬 법칙. sin θ2 > 1 이면 굴절광이 없다(전반사) — null 로 돌려준다.
     이 값을 그대로 asin 에 넣으면 NaN 이 되어 화면이 조용히 깨진다. */
  function refract(t1deg, n1, n2) {
    const s = n1 / n2 * Math.sin(rad(t1deg));
    if (s > 1 || s < -1) return null;
    return deg(Math.asin(s));
  }

  // 임계각 — n1 > n2 일 때만 존재한다
  function critical(n1, n2) {
    if (n1 <= n2) return null;
    return deg(Math.asin(n2 / n1));
  }

  const isTIR = () => refract(S.angle, S.n1, S.n2) === null;

  // ── 무대 ──
  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W(), H());
    const w = W(), h = H();
    const by = h * 0.5;                 // 경계면 y
    const hitX = w * 0.42;              // 빛이 경계에 닿는 지점

    // 매질 배경 — n 이 클수록 진하게(느리다는 느낌)
    const shade = (n) => {
      const t = Math.min(1, Math.max(0, (n - 1) / 1.5));
      return `rgb(${Math.round(26 + 18 * (1 - t))}, ${Math.round(38 + 30 * (1 - t))}, ${Math.round(58 + 46 * (1 - t))})`;
    };
    ctx.fillStyle = shade(S.n1); ctx.fillRect(0, 0, w, by);
    ctx.fillStyle = shade(S.n2); ctx.fillRect(0, by, w, h - by);

    // 경계면
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, by); ctx.lineTo(w, by); ctx.stroke();

    // 법선
    ctx.setLineDash([5, 6]);
    ctx.strokeStyle = 'rgba(255,255,255,.34)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(hitX, 0); ctx.lineTo(hitX, h); ctx.stroke();
    ctx.setLineDash([]);

    const t1 = S.angle;
    const t2 = refract(t1, S.n1, S.n2);
    const tir = t2 === null;

    // 파면 — 간격은 파장에 비례(λ ∝ 1/n), 각도는 스넬 법칙과 일관되게
    drawWavefronts(hitX, by, t1, t2, w, h);

    // 입사 광선 (위 → 경계). 각도는 법선 기준
    const L = Math.min(w, h) * 0.42;
    const ix = hitX - L * Math.sin(rad(t1));
    const iy = by - L * Math.cos(rad(t1));
    ray(ix, iy, hitX, by, '#ffd166', 3.2);
    arrowHead(hitX, by, hitX - ix, by - iy, '#ffd166');

    // 반사 광선 — 항상 존재. 전반사면 굵게(에너지 전부)
    const rx = hitX + L * Math.sin(rad(t1));
    const ry = by - L * Math.cos(rad(t1));
    ray(hitX, by, rx, ry, '#e07a5f', tir ? 3.4 : 1.6, tir ? 1 : 0.5);
    if (tir) arrowHead(rx, ry, rx - hitX, ry - by, '#e07a5f');

    // 굴절 광선 — 전반사면 그리지 않는다
    if (!tir) {
      const tx = hitX + L * Math.sin(rad(t2));
      const ty = by + L * Math.cos(rad(t2));
      ray(hitX, by, tx, ty, '#4cc9f0', 3.2);
      arrowHead(tx, ty, tx - hitX, ty - by, '#4cc9f0');
      angleArc(hitX, by, t2, false, '#4cc9f0', 'θ₂ ' + t2.toFixed(1) + '°');
    }

    angleArc(hitX, by, t1, true, '#ffd166', 'θ₁ ' + t1.toFixed(1) + '°');

    // 임계각 표시선 — n1 > n2 일 때만
    const tc = critical(S.n1, S.n2);
    if (tc !== null) {
      const cx = hitX - L * 1.02 * Math.sin(rad(tc));
      const cy = by - L * 1.02 * Math.cos(rad(tc));
      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = 'rgba(224,122,95,.75)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(hitX, by); ctx.lineTo(cx, cy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,196,170,.95)';
      ctx.font = '11.5px ui-sans-serif, system-ui';
      ctx.textAlign = 'right';
      ctx.fillText('임계각 ' + tc.toFixed(1) + '°', cx - 6, cy - 4);
    }

    // 매질 라벨과 속력
    ctx.font = '600 12.5px ui-sans-serif, system-ui';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.fillText(`매질 1 · n₁ = ${S.n1.toFixed(2)} · v₁ = ${(C / S.n1 / 1e8).toFixed(2)}×10⁸ m/s`, 12, 22);
    ctx.fillText(`매질 2 · n₂ = ${S.n2.toFixed(2)} · v₂ = ${(C / S.n2 / 1e8).toFixed(2)}×10⁸ m/s`, 12, h - 14);

    if (tir) {
      ctx.textAlign = 'center';
      ctx.font = '700 15px ui-sans-serif, system-ui';
      ctx.fillStyle = '#ffb4a2';
      ctx.fillText('전반사 — 굴절광이 나오지 않습니다', w * 0.5, by + 34);
    }
  }

  function ray(x1, y1, x2, y2, color, width, alpha) {
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function arrowHead(x, y, dx, dy, color) {
    const a = Math.atan2(dy, dx), s = 9;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - s * Math.cos(a - 0.42), y - s * Math.sin(a - 0.42));
    ctx.lineTo(x - s * Math.cos(a + 0.42), y - s * Math.sin(a + 0.42));
    ctx.closePath(); ctx.fill();
  }

  /* 각도 호. 위쪽(입사)은 법선 위, 아래쪽(굴절)은 법선 아래에 그린다. */
  function angleArc(cx, cy, tdeg, up, color, label) {
    const r = 46;
    const start = up ? -Math.PI / 2 : Math.PI / 2;
    const end = up ? -Math.PI / 2 - rad(tdeg) : Math.PI / 2 + rad(tdeg);
    ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.globalAlpha = .85;
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.min(start, end), Math.max(start, end));
    ctx.stroke();
    ctx.globalAlpha = 1;
    const mid = (start + end) / 2;
    ctx.fillStyle = color;
    ctx.font = '600 11.5px ui-sans-serif, system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(label, cx + (r + 22) * Math.cos(mid), cy + (r + 22) * Math.sin(mid) + 4);
  }

  /* 파면 — 광선에 수직인 직선들.
     간격은 파장에 비례하고 λ ∝ 1/n 이므로 n 이 크면 촘촘해진다.
     각도는 광선 각도에서 그대로 따오므로 스넬 법칙과 자동으로 일관된다. */
  /* 파면 — 광선에 수직인 직선들.

     ⚠ 두 매질의 파면은 경계면에서 반드시 이어져야 한다. 위아래를 따로
        그리면 경계에서 어긋나 물리적으로 틀린 그림이 된다.

        경계면 위의 점 (x, by) 에서 파동의 위상은 x 방향 성분만으로 정해진다:
          위상 ∝ x·sinθ / λ
        스넬 법칙 n₁sinθ₁ = n₂sinθ₂ 와 λ ∝ 1/n 을 넣으면
          sinθ₁/λ₁ = sinθ₂/λ₂
        즉 경계면을 따라가는 위상 변화율이 양쪽에서 같다. 이 값을 공통으로
        쓰면 파면이 저절로 이어진다. 이것이 스넬 법칙의 실제 유도이기도 하다. */
  function drawWavefronts(hitX, by, t1, t2, w, h) {
    const basePx = S.wl;                     // 매질1 파장(픽셀) — 슬라이더로 연다
    const lam1 = basePx / S.n1;
    const lam2 = basePx / S.n2;

    ctx.save();
    ctx.strokeStyle = 'rgba(200,211,224,.42)';
    ctx.lineWidth = 1.6;

    // 위쪽 — 입사 파면
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, w, by); ctx.clip();
    wavefrontSet(hitX, by, t1, lam1, -1, w, h);
    ctx.restore();

    // 아래쪽 — 굴절 파면 (전반사면 그리지 않는다)
    if (t2 !== null) {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, by, w, h - by); ctx.clip();
      wavefrontSet(hitX, by, t2, lam2, 1, w, h);
      ctx.restore();
    }
    ctx.restore();
  }

  /* side = -1 이면 경계 위(입사), +1 이면 경계 아래(굴절).
     진행 방향은 항상 아래쪽(+y)을 향한다 — 빛이 위에서 내려오기 때문이다. */
  function wavefrontSet(hitX, by, tdeg, lam, side, w, h) {
    const t = rad(tdeg);
    const ux = Math.sin(t);        // 진행 방향 x 성분
    const uy = Math.cos(t);        // 진행 방향 y 성분 (항상 +, 아래로)
    const px = -uy, py = ux;       // 파면 방향 = 진행 방향에 수직
    const span = Math.hypot(w, h) * 1.3;
    const n = Math.ceil(span / lam) + 2;

    /* 애니메이션 위상. 경계에서 이어지려면 두 매질이 같은 시간 위상을 써야
       하므로 phase 를 그대로 쓴다(파장으로 나누지 않는다). */
    const off = (phase % 1) * lam;

    for (let i = -n; i <= n; i++) {
      // 경계 원점(hitX, by)에서 진행 방향으로 d 만큼 떨어진 파면
      const d = i * lam + off;
      const cx = hitX + ux * d;
      const cy = by + uy * d;
      /* ⚠ 여기서 파면을 걸러내면 안 된다. 파면은 기울어진 '직선' 이라
         중심점 cy 가 반대편에 있어도 선의 일부는 이쪽 매질을 지나간다.
         중심점만 보고 자르면 화면 절반이 비어버린다 — 실제로 그랬다.
         잘라내는 일은 위에서 건 clip 에 맡긴다. */
      ctx.beginPath();
      ctx.moveTo(cx - px * span, cy - py * span);
      ctx.lineTo(cx + px * span, cy + py * span);
      ctx.stroke();
    }
  }

  // ── 그래프: 입사각 → 굴절각 ──
  function drawGraph() {
    /* 캔버스는 CSS 를 못 받으니 색을 여기서 받아온다. 예전에는 '#f7f7f5' 를
       박아 놔서 다크 모드에서도 하얀 박스가 그대로 떠 있었다. */
    const P = window.GraphTheme.palette();
    gctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const w = graph.width / DPR, h = graph.height / DPR;
    gctx.clearRect(0, 0, w, h);
    const pad = { l: 52, r: 18, t: 18, b: 34 };
    const gw = w - pad.l - pad.r, gh = h - pad.t - pad.b;

    const X = (t) => pad.l + t / 90 * gw;
    const Y = (t) => pad.t + gh - t / 90 * gh;

    gctx.fillStyle = P.bg;
    gctx.fillRect(0, 0, w, h);

    gctx.strokeStyle = P.grid;
    gctx.lineWidth = 1;
    gctx.font = '11px ui-sans-serif, system-ui';
    gctx.fillStyle = P.muted;
    gctx.textAlign = 'center';
    for (let t = 0; t <= 90; t += 15) {
      gctx.beginPath(); gctx.moveTo(X(t), pad.t); gctx.lineTo(X(t), pad.t + gh); gctx.stroke();
      gctx.fillText(t + '°', X(t), h - 12);
    }
    gctx.textAlign = 'right';
    for (let t = 0; t <= 90; t += 15) {
      gctx.beginPath(); gctx.moveTo(pad.l, Y(t)); gctx.lineTo(w - pad.r, Y(t)); gctx.stroke();
      gctx.fillText(t + '°', pad.l - 8, Y(t) + 4);
    }

    // 참고: 만약 비례한다면 (오개념) — 점선
    gctx.setLineDash([5, 5]);
    gctx.strokeStyle = 'rgba(190,120,120,.75)';
    gctx.lineWidth = 1.6;
    gctx.beginPath();
    const ratio = refract(45, S.n1, S.n2) !== null ? refract(45, S.n1, S.n2) / 45 : 1;
    gctx.moveTo(X(0), Y(0));
    gctx.lineTo(X(90), Y(Math.min(90, 90 * ratio)));
    gctx.stroke();
    gctx.setLineDash([]);

    // 실제 스넬 곡선
    gctx.beginPath();
    let started = false;
    for (let t = 0; t <= 90; t += 0.5) {
      const r = refract(t, S.n1, S.n2);
      if (r === null) break;
      const xx = X(t), yy = Y(r);
      started ? gctx.lineTo(xx, yy) : gctx.moveTo(xx, yy);
      started = true;
    }
    gctx.strokeStyle = '#4cc9f0';
    gctx.lineWidth = 2.6;
    gctx.stroke();

    // 임계각 세로선
    const tc = critical(S.n1, S.n2);
    if (tc !== null) {
      gctx.setLineDash([4, 5]);
      gctx.strokeStyle = 'rgba(224,122,95,.9)';
      gctx.lineWidth = 1.8;
      gctx.beginPath(); gctx.moveTo(X(tc), pad.t); gctx.lineTo(X(tc), pad.t + gh); gctx.stroke();
      gctx.setLineDash([]);
      gctx.fillStyle = '#c2410c';
      gctx.textAlign = 'left';
      gctx.fillText('임계각 ' + tc.toFixed(1) + '° — 넘으면 전반사', X(tc) + 6, pad.t + 16);
    }

    // 현재 점
    const cur = refract(S.angle, S.n1, S.n2);
    if (cur !== null) {
      gctx.beginPath(); gctx.arc(X(S.angle), Y(cur), 6, 0, Math.PI * 2);
      gctx.fillStyle = P.ink; gctx.fill();
      gctx.strokeStyle = P.bg; gctx.lineWidth = 2.5; gctx.stroke();
    }

    gctx.fillStyle = 'rgba(150,110,110,.95)';
    gctx.textAlign = 'left';
    gctx.font = '11.5px ui-sans-serif, system-ui';
    gctx.fillText('점선 = 비례한다면 (실제와 다름)', pad.l + 8, pad.t + gh - 10);
  }

  // ── 수치 ──
  function readout() {
    const t2 = refract(S.angle, S.n1, S.n2);
    const tc = critical(S.n1, S.n2);
    const v1 = C / S.n1, v2 = C / S.n2;

    el('r-t1').textContent = S.angle.toFixed(1) + '°';
    el('r-t2').textContent = t2 === null ? '없음 (전반사)' : t2.toFixed(2) + '°';
    el('r-v2').textContent = (v2 / 1e8).toFixed(2) + ' × 10⁸ m/s';
    el('r-lam').textContent = (S.n1 / S.n2).toFixed(3);
    el('r-crit').textContent = tc === null ? '없음 (n₁ ≤ n₂)' : tc.toFixed(2) + '°';

    const bend = t2 === null ? null : S.angle - t2;
    const sb = el('s-bend');
    sb.textContent = t2 === null ? '—' : (bend >= 0 ? '+' : '') + bend.toFixed(1) + '°';
    sb.className = t2 === null ? '' : (bend > 0.05 ? 'down' : (bend < -0.05 ? 'up' : ''));
    el('s-vr').textContent = (v2 / v1).toFixed(3);

    const v = el('verdict');
    if (t2 === null) {
      v.className = 'verdict warn';
      v.innerHTML = `입사각이 임계각 <strong>${tc.toFixed(1)}°</strong> 를 넘었습니다. ` +
        '굴절광이 나오지 못하고 <strong>빛이 전부 반사</strong>됩니다. ' +
        '광섬유가 빛을 수십 km 보내는 원리가 이것입니다.';
    } else if (S.angle < 0.3) {
      v.className = 'verdict warn';
      v.innerHTML = '<strong>수직으로 넣었습니다.</strong> 속도는 ' +
        `${(v1 / 1e8).toFixed(2)} → ${(v2 / 1e8).toFixed(2)} ×10⁸ m/s 로 분명히 달라졌는데도 ` +
        '<strong>전혀 꺾이지 않습니다.</strong> 파면 전체가 동시에 경계에 닿아 똑같이 느려지므로 ' +
        '회전할 이유가 없기 때문입니다. 굴절은 굴절률이 아니라 <strong>속도 차이가 만드는 회전</strong>입니다.';
    } else if (Math.abs(S.n1 - S.n2) < 0.005) {
      v.className = 'verdict';
      v.innerHTML = '두 매질의 굴절률이 같아 속도가 변하지 않습니다. 그래서 꺾이지도 않습니다.';
    } else if (S.n2 > S.n1) {
      v.className = 'verdict';
      v.innerHTML = `빛이 <strong>느려지면서</strong>(${(v1 / 1e8).toFixed(2)} → ${(v2 / 1e8).toFixed(2)}×10⁸) ` +
        `법선 쪽으로 <strong>${bend.toFixed(1)}° 꺾였습니다.</strong> ` +
        `파장도 같은 비율로 짧아져 경계 아래 파면 간격이 좁아진 것이 보입니다.`;
    } else {
      v.className = 'verdict';
      v.innerHTML = `빛이 <strong>빨라지면서</strong>(${(v1 / 1e8).toFixed(2)} → ${(v2 / 1e8).toFixed(2)}×10⁸) ` +
        `법선에서 <strong>${Math.abs(bend).toFixed(1)}° 멀어졌습니다.</strong> ` +
        (tc !== null ? `입사각을 ${tc.toFixed(1)}° 이상으로 올리면 전반사가 시작됩니다.` : '');
    }

    let note;
    if (t2 === null) {
      note = '전반사 상태에서는 굴절각이 정의되지 않습니다. 반사각은 입사각과 같습니다.';
    } else if (S.angle < 0.3) {
      note = '입사각 0°에서는 굴절률이 아무리 달라도 굴절각이 0°입니다.';
    } else {
      note = `sinθ₁/sinθ₂ = ${(Math.sin(rad(S.angle)) / Math.sin(rad(t2))).toFixed(3)} = n₂/n₁ = ${(S.n2 / S.n1).toFixed(3)} — 스넬 법칙이 성립합니다.`;
    }
    el('note').textContent = note;
  }

  // ── 입력 ──
  const labels = {
    angle: (v) => Number(v).toFixed(1) + '°',
    n1: (v) => Number(v).toFixed(2),
    n2: (v) => Number(v).toFixed(2),
    wl: (v) => Number(v) + ' px'
  };

  ['angle', 'n1', 'n2', 'wl'].forEach((k) => {
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
      S.n1 = Number(b.dataset.n1);
      S.n2 = Number(b.dataset.n2);
      S.angle = Number(b.dataset.a);
      ['angle', 'n1', 'n2', 'wl'].forEach((k) => {
        el(k).value = S[k];
        el(k + '-out').textContent = labels[k](S[k]);
      });
      syncPresets();
      readout();
    });
  });

  function syncPresets() {
    presetBox.querySelectorAll('button').forEach((b) => {
      const match = Math.abs(Number(b.dataset.n1) - S.n1) < 1e-9 &&
                    Math.abs(Number(b.dataset.n2) - S.n2) < 1e-9 &&
                    Math.abs(Number(b.dataset.a) - S.angle) < 1e-9;
      b.setAttribute('aria-pressed', String(match));
    });
  }

  el('toggle').addEventListener('click', () => {
    running = !running;
    el('toggle').textContent = running ? '일시정지' : '이어서';
  });
  el('reset').addEventListener('click', () => {
    S.angle = 30; S.n1 = 1.0; S.n2 = 1.5;
    ['angle', 'n1', 'n2', 'wl'].forEach((k) => {
      el(k).value = S[k];
      el(k + '-out').textContent = labels[k](S[k]);
    });
    syncPresets();
    readout();
  });

  el('share').addEventListener('click', async () => {
    const said = el('share-said');
    try {
      const me = await Session.refresh();
      if (!me) { said.textContent = '로그인이 필요합니다.'; return; }
      const q = new URLSearchParams({ angle: S.angle, n1: S.n1, n2: S.n2, wl: S.wl });
      const url = location.origin + location.pathname + '?' + q;
      const b = el('share-url');
      b.value = url; b.hidden = false; b.select();
      try { await navigator.clipboard.writeText(url); said.textContent = '복사했습니다.'; }
      catch { said.textContent = '주소를 복사해 주세요.'; }
    } catch { said.textContent = '잠시 후 다시 시도해 주세요.'; }
  });

  function applyQuery() {
    const q = new URLSearchParams(location.search);
    ['angle', 'n1', 'n2', 'wl'].forEach((k) => {
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
    const dt = Math.min(0.25, now - last);
    last = now;
    if (running) phase += dt * 1.2;
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
