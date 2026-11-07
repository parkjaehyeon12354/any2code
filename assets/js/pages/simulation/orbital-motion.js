(function () {
  const el = (id) => document.getElementById(id);

  /* ── 천체의 운동: 위성은 떠 있는 게 아니라 떨어지는 중이다 ──

     "위성은 우주에 떠 있다" 가 흔한 오개념이다. 중력을 끄면 그 자리에 멈출
     것 같지만, 실제로는 속도 방향으로 곧장 직선으로 날아간다(뉴턴 1법칙).
     궤도가 휘어 있던 건 중력이 계속 방향을 틀어주고 있었기 때문이다.

     설계는 Solar 4 Pro 와 함께 잡았고 검증값 12건을 직접 계산해 확인했다.
     Solar 가 "중력 OFF 면 각속도 0" 이라 했는데 이건 틀렸다 — 직선 운동해도
     원점 기준 각도는 계속 변한다. 지적하니 인정했고, 대신 더 좋은 걸 찾았다:
     중력을 꺼도 면적속도는 그대로다(각운동량 보존).

     수치적분 대신 케플러 궤도 해석해를 쓴다. 발산하지 않고 가볍다. */

  /* 중심 천체는 조작 변수다(S.gm) — 지구로 고정하면 달·화성 궤도를 볼 수 없다.
     슬라이더는 log10 눈금이라 S.gm 에는 실제 값을 넣는다. */
  const GM = () => S.gm;
  const R_EARTH = 6378;        // 지구 반지름 (km)

  const S = { sma: 10000, ecc: 0, speed: 1, gm: 3.986e5 };

  /* 근지점 고도를 최소 300km 로 유지한다.
     이 제한이 없으면 a=10000, e=0.4 같은 흔한 조합에서 근지점이 6000km 가 되어
     지표(6378km) 아래를 지난다 — 존재할 수 없는 궤도를 보여주게 된다.
     슬라이더는 그대로 두되 값을 걸러 물리적으로 가능한 범위만 쓴다. */
  const MIN_ALT = 300;
  const maxEcc = (a) => Math.max(0, Math.min(0.7, 1 - (R_EARTH + MIN_ALT) / a));
  const clampEcc = () => { S.ecc = Math.min(S.ecc, maxEcc(S.sma)); };
  let running = true;
  let gravityOn = true;
  let t = 0;                   // 궤도 시각 (초)

  // 중력을 끈 순간의 상태 — 직선 운동의 출발점
  let freeState = null;        // { x, y, vx, vy, t0 }
  let trail = [];              // 지나온 길
  let sweep = [];              // 면적 띠 (최근 구간)

  const canvas = el('canvas');
  const ctx = canvas.getContext('2d');
  const graph = el('orbit-graph');
  const gctx = graph.getContext('2d');
  let DPR = 1;
  const W = () => canvas.width / DPR;
  const H = () => canvas.height / DPR;

  const period = (a) => 2 * Math.PI * Math.sqrt(a * a * a / GM());
  const visViva = (r, a) => Math.sqrt(GM() * (2 / r - 1 / a));

  /* 케플러 방정식 M = E − e·sinE 를 뉴턴법으로 푼다.
     6회면 e ≤ 0.7 에서 충분히 수렴한다(배정밀도 한계까지). */
  function solveE(M, e) {
    let E = e < 0.8 ? M : Math.PI;
    for (let i = 0; i < 6; i++) {
      const f = E - e * Math.sin(E) - M;
      const fp = 1 - e * Math.cos(E);
      E -= f / fp;
    }
    return E;
  }

  /* 시각 t 에서의 위치·속도. 근지점을 +x 축에 둔다. */
  function orbitState(time) {
    const a = S.sma, e = S.ecc;
    const n = Math.sqrt(GM() / (a * a * a));       // 평균 운동
    const M = n * time;
    const E = solveE(M, e);
    const r = a * (1 - e * Math.cos(E));
    // 진근점각
    const nu = 2 * Math.atan2(
      Math.sqrt(1 + e) * Math.sin(E / 2),
      Math.sqrt(1 - e) * Math.cos(E / 2)
    );
    const x = r * Math.cos(nu), y = r * Math.sin(nu);

    // 속도 — 궤도면 극좌표에서 미분한 결과
    const h = Math.sqrt(GM() * a * (1 - e * e));    // 비각운동량
    const vr = GM() / h * e * Math.sin(nu);         // 지름 방향
    const vt = h / r;                             // 접선 방향
    const cn = Math.cos(nu), sn = Math.sin(nu);
    const vx = vr * cn - vt * sn;
    const vy = vr * sn + vt * cn;
    return { x, y, vx, vy, r, v: Math.hypot(vx, vy), nu };
  }

  // 지금 상태 — 중력이 꺼져 있으면 직선 운동
  function current() {
    if (gravityOn || !freeState) return orbitState(t);
    const dt = t - freeState.t0;
    const x = freeState.x + freeState.vx * dt;
    const y = freeState.y + freeState.vy * dt;
    const r = Math.hypot(x, y);
    return { x, y, vx: freeState.vx, vy: freeState.vy, r,
             v: Math.hypot(freeState.vx, freeState.vy), nu: Math.atan2(y, x) };
  }

  /* 면적속도 = ½|r × v|. 중력이 있든 없든 일정해야 한다 —
     이 화면의 숨은 주인공이다. */
  function areaRate(st) {
    return 0.5 * Math.abs(st.x * st.vy - st.y * st.vx);
  }

  // ── 무대 ──
  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const w = W(), h = H();
    ctx.clearRect(0, 0, w, h);

    // 배경 — 우주
    ctx.fillStyle = '#080d18';
    ctx.fillRect(0, 0, w, h);
    // 별
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    for (let i = 0; i < 60; i++) {
      const sx = (i * 137) % w, sy = (i * 79) % h;
      ctx.fillRect(sx, sy, 1.4, 1.4);
    }

    const st = current();
    /* 지구는 타원의 '초점' 이라 궤도 중심이 아니다. 지구를 화면 중앙에 두면
       궤도가 한쪽으로 쏠려 보인다. 타원 중심(초점에서 a·e 만큼 밀린 곳)을
       화면 중앙에 놓아야 궤도가 가운데 온다. 중력을 끄면 위성이 멀어지므로
       그때는 다시 지구 기준으로 돌아간다. */
    const shift = gravityOn ? S.sma * S.ecc : 0;
    const cx = w * 0.5, cy = h * 0.5;
    /* 배율 — 궤도 전체(원지점)와 이탈 궤적까지 담는다.
       지구를 실제 비율로 그리면 저궤도에서 화면을 거의 채워 궤도가 안 보인다.
       그렇다고 무시하면 "지구 속을 도는" 그림이 되므로, 궤도에 맞춰 배율을
       잡되 지구가 화면의 일정 비율을 넘지 않도록 눌러 그린다. */
    const far = Math.max(S.sma, st.r + shift) * 1.16;
    const scale = Math.min(w, h) * 0.44 / far;
    const px = (kx) => cx + (kx - shift) * scale;
    const py = (ky) => cy - ky * scale;

    /* 검사 도구가 배율을 추측하지 않도록 실제 변환을 내놓는다.
       검사 쪽에서 같은 식을 다시 짜면 조금만 달라도 엉뚱한 실패가 난다 —
       실제로 far 계산이 달라 "지구가 66px 어긋났다"는 오탐이 나왔다. */
    window.__view = { px, py, scale, shift, cx, cy };

    // 궤도 경로 (중력 켜져 있을 때만)
    if (gravityOn) {
      ctx.beginPath();
      for (let i = 0; i <= 180; i++) {
        const nu = i / 180 * Math.PI * 2;
        const r = S.sma * (1 - S.ecc * S.ecc) / (1 + S.ecc * Math.cos(nu));
        const xx = px(r * Math.cos(nu)), yy = py(r * Math.sin(nu));
        i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
      }
      ctx.closePath();
      ctx.strokeStyle = 'rgba(140,170,220,.34)';
      ctx.setLineDash([5, 6]);
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 쓸고 간 면적 — 케플러 2법칙 시각화
    ctx.fillStyle = 'rgba(120,180,255,.13)';
    sweep.forEach((s) => {
      ctx.beginPath();
      ctx.moveTo(px(0), py(0));
      ctx.lineTo(px(s.x1), py(s.y1));
      ctx.lineTo(px(s.x2), py(s.y2));
      ctx.closePath();
      ctx.fill();
    });

    // 지나온 길
    if (trail.length > 1) {
      ctx.beginPath();
      trail.forEach((p, i) => {
        const xx = px(p.x), yy = py(p.y);
        i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
      });
      ctx.strokeStyle = 'rgba(142,202,230,.75)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    /* 지구 — 반드시 px(0), py(0) 에 그린다.
       ⚠ 예전엔 cx, cy(화면 중앙)에 그렸다. 타원 중심을 화면 중앙에 두려고
          shift 를 넣은 뒤로는 지구의 실제 자리가 px(0) 으로 옮겨졌는데
          지구만 옛 좌표에 남아 a·e 만큼(이 조건에서 112px) 어긋났다.
          하필 그 자리가 근지점이라 "궤도가 지구를 뚫는" 것처럼 보였다.
          좌표계는 반드시 한 곳으로 통일할 것.

       크기는 실제 비율보다 조금 작게 그린다. 저궤도에서는 근지점/지구반지름이
       1.1 밖에 안 돼 궤도가 지구에 붙어 읽히지 않기 때문이다. 대신 그 사실을
       화면에 적어 오해를 막는다. */
    const ex = px(0), ey = py(0);
    const er = Math.max(9, Math.min(R_EARTH * scale * 0.82, Math.min(w, h) * 0.14));
    const g = ctx.createRadialGradient(ex - er * .3, ey - er * .3, er * .1, ex, ey, er);
    g.addColorStop(0, '#5aa9e6');
    g.addColorStop(1, '#14406b');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(ex, ey, er, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.font = '10.5px ui-sans-serif, system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('지구 (궤도가 보이도록 작게 그림)', ex, ey + er + 15);

    // 위성
    const sx = px(st.x), sy = py(st.y);
    ctx.fillStyle = '#f8f9fa';
    ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1.5; ctx.stroke();

    // 속도 벡터 — 항상 존재
    vector(sx, sy, st.vx, st.vy, 10 * scale * 260, '#4cc9f0', '속도');

    // 중력 벡터 — 꺼져 있으면 안 그린다
    if (gravityOn) {
      const gmag = GM() / (st.r * st.r);
      const ux = -st.x / st.r, uy = -st.y / st.r;
      vector(sx, sy, ux * gmag, uy * gmag, scale * 9.0e5, '#f6bd60', '중력');
    } else {
      ctx.fillStyle = '#ffb4a2';
      ctx.font = '700 15px ui-sans-serif, system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('중력 없음 — 직선으로 날아갑니다', w * 0.5, 30);
    }

    // 근지점·원지점 표시
    if (gravityOn && S.ecc > 0.02) {
      const rp = S.sma * (1 - S.ecc), ra = S.sma * (1 + S.ecc);
      marker(px(rp), py(0), '가장 가까움', '#8ecae6');
      marker(px(-ra), py(0), '가장 멂', '#adb5bd');
    }
  }

  function vector(x, y, vx, vy, k, color, label) {
    const m = Math.hypot(vx, vy);
    if (m < 1e-12) return;
    const len = Math.max(26, Math.min(90, m * k));
    const ex = x + vx / m * len, ey = y - vy / m * len;
    ctx.strokeStyle = color; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
    const a = Math.atan2(ey - y, ex - x);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - 9 * Math.cos(a - .4), ey - 9 * Math.sin(a - .4));
    ctx.lineTo(ex - 9 * Math.cos(a + .4), ey - 9 * Math.sin(a + .4));
    ctx.closePath(); ctx.fill();
    ctx.font = '11.5px ui-sans-serif, system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(label, ex + 6, ey - 4);
  }

  function marker(x, y, label, color) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.font = '11px ui-sans-serif, system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y - 10);
  }

  // ── 그래프 ──
  function drawGraph() {
    /* 캔버스는 CSS 를 못 받으니 색을 여기서 받아온다. 예전에는 '#f7f7f5' 를
       박아 놔서 다크 모드에서도 하얀 박스가 그대로 떠 있었다. */
    const P = window.GraphTheme.palette();
    gctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const w = graph.width / DPR, h = graph.height / DPR;
    gctx.clearRect(0, 0, w, h);
    const pad = { l: 58, r: 58, t: 20, b: 34 };
    const gw = w - pad.l - pad.r, gh = h - pad.t - pad.b;

    gctx.fillStyle = P.bg;
    gctx.fillRect(0, 0, w, h);

    const a = S.sma, e = S.ecc;
    const rp = a * (1 - e), ra = a * (1 + e);
    const vp = visViva(rp, a), va = visViva(ra, a);
    const rMax = ra * 1.05, vMax = vp * 1.1;

    const X = (frac) => pad.l + frac * gw;
    const Yv = (v) => pad.t + gh - v / vMax * gh;
    const Yr = (r) => pad.t + gh - r / rMax * gh;

    // 눈금
    gctx.strokeStyle = P.grid;
    gctx.font = '11px ui-sans-serif, system-ui';
    gctx.textAlign = 'center';
    gctx.fillStyle = P.muted;
    for (let i = 0; i <= 4; i++) {
      const xx = X(i / 4);
      gctx.beginPath(); gctx.moveTo(xx, pad.t); gctx.lineTo(xx, pad.t + gh); gctx.stroke();
      gctx.fillText(['근지점', '¼', '원지점', '¾', '근지점'][i], xx, h - 12);
    }

    // 속도 곡선 (왼쪽 축)
    gctx.beginPath();
    for (let i = 0; i <= 200; i++) {
      const M = i / 200 * Math.PI * 2;
      const E = solveE(M, e);
      const r = a * (1 - e * Math.cos(E));
      const v = visViva(r, a);
      const xx = X(i / 200), yy = Yv(v);
      i ? gctx.lineTo(xx, yy) : gctx.moveTo(xx, yy);
    }
    gctx.strokeStyle = '#4cc9f0'; gctx.lineWidth = 2.6; gctx.stroke();

    // 거리 곡선 (오른쪽 축)
    gctx.beginPath();
    for (let i = 0; i <= 200; i++) {
      const M = i / 200 * Math.PI * 2;
      const E = solveE(M, e);
      const r = a * (1 - e * Math.cos(E));
      const xx = X(i / 200), yy = Yr(r);
      i ? gctx.lineTo(xx, yy) : gctx.moveTo(xx, yy);
    }
    gctx.strokeStyle = '#e07a5f'; gctx.lineWidth = 2.6; gctx.stroke();

    // 면적속도 — 평평한 선
    const hMom = Math.sqrt(GM() * a * (1 - e * e));
    const areaY = pad.t + gh * 0.5;
    gctx.setLineDash([6, 5]);
    gctx.strokeStyle = '#2a9d8f'; gctx.lineWidth = 2.2;
    gctx.beginPath(); gctx.moveTo(X(0), areaY); gctx.lineTo(X(1), areaY); gctx.stroke();
    gctx.setLineDash([]);
    gctx.fillStyle = '#1d7870';
    gctx.textAlign = 'left';
    gctx.fillText('면적속도 ' + (hMom / 2).toFixed(0) + ' km²/s — 항상 평평합니다', X(0) + 8, areaY - 8);

    // 축 라벨
    gctx.textAlign = 'right';
    gctx.fillStyle = '#2b7fa8';
    gctx.fillText('속도 ' + vMax.toFixed(1) + ' km/s', pad.l - 8, pad.t + 12);
    gctx.fillText('0', pad.l - 8, pad.t + gh + 4);
    gctx.textAlign = 'left';
    gctx.fillStyle = '#b4552f';
    gctx.fillText('거리 ' + Math.round(rMax) + ' km', w - pad.r + 8, pad.t + 12);

    // 현재 위치
    const st = current();
    if (gravityOn) {
      const n = Math.sqrt(GM() / (a * a * a));
      const frac = ((n * t) % (Math.PI * 2)) / (Math.PI * 2);
      gctx.beginPath(); gctx.arc(X(frac), Yv(st.v), 5.5, 0, Math.PI * 2);
      gctx.fillStyle = P.ink; gctx.fill();
      gctx.strokeStyle = P.bg; gctx.lineWidth = 2.2; gctx.stroke();
    }
  }

  // ── 수치 ──
  function readout() {
    const st = current();
    const a = S.sma, e = S.ecc;
    const rp = a * (1 - e), ra = a * (1 + e);
    const vp = visViva(rp, a), va = visViva(ra, a);
    const T = period(a);

    el('r-dist').textContent = Math.round(st.r).toLocaleString() + ' km';
    el('r-vel').textContent = st.v.toFixed(3) + ' km/s';
    el('r-period').textContent = gravityOn ? (T / 60).toFixed(1) + ' 분' : '— (궤도 아님)';
    el('r-acc').textContent = gravityOn
      ? (GM() / (st.r * st.r)).toFixed(3) + ' m/s² 상당'
      : '0 (중력 꺼짐)';
    el('r-area').textContent = Math.round(areaRate(st)).toLocaleString() + ' km²/s';

    el('s-vp').textContent = vp.toFixed(3) + ' km/s';
    el('s-va').textContent = va.toFixed(3) + ' km/s';

    const v = el('verdict');
    if (!gravityOn) {
      v.className = 'verdict warn';
      v.innerHTML = '중력을 껐더니 위성이 <strong>그 자리에 멈추지 않고</strong> ' +
        '속도 방향으로 <strong>곧장 날아갑니다.</strong> 궤도가 휘어 있던 건 ' +
        '중력이 계속 방향을 틀어주고 있었기 때문입니다. ' +
        `그런데 면적속도는 <strong>${Math.round(areaRate(st)).toLocaleString()} km²/s 로 그대로</strong>입니다 — ` +
        '케플러 2법칙은 중력이 아니라 각운동량 보존의 결과이기 때문입니다.';
    } else if (e < 0.02) {
      v.className = 'verdict';
      v.innerHTML = `원궤도라 속도가 <strong>${vp.toFixed(2)} km/s 로 일정</strong>합니다. ` +
        `한 바퀴에 ${(T / 60).toFixed(1)}분 걸립니다. ` +
        '궤도 크기를 키워 보세요 — 멀수록 <strong>느려집니다.</strong>';
    } else {
      v.className = 'verdict';
      v.innerHTML = `가장 가까울 때 <strong>${vp.toFixed(2)} km/s</strong>, ` +
        `가장 멀 때 <strong>${va.toFixed(2)} km/s</strong> — ` +
        `<strong>${(vp / va).toFixed(2)}배</strong> 차이입니다. ` +
        '가까울수록 빠릅니다. 그런데도 같은 시간에 쓸고 가는 넓이는 늘 같습니다(케플러 2법칙).';
    }

    let note;
    if (!gravityOn) {
      note = '중력이 없으면 주기도 궤도도 없습니다. 등속 직선 운동만 남습니다.';
    } else if (e < 0.02) {
      note = `T = 2π√(a³/GM) — 장반경 ${a.toLocaleString()}km 이면 ${(T / 60).toFixed(1)}분입니다.`;
    } else {
      note = `근지점 ${Math.round(rp).toLocaleString()}km · 원지점 ${Math.round(ra).toLocaleString()}km. ` +
        '주기는 장반경만으로 정해져 찌그러뜨려도 변하지 않습니다.';
    }
    el('note').textContent = note;
  }

  // ── 입력 ──
  const labels = {
    sma: (v) => Number(v).toLocaleString() + ' km',
    ecc: (v) => Number(v).toFixed(2),
    speed: (v) => Number(v).toFixed(1) + '×',
    /* 숫자만 보면 42828 이 무슨 값인지 모른다. 가까운 천체 이름을 붙인다.
       인자는 실제 GM 값이다(슬라이더의 로그 값이 아니라). */
    gm: (v) => {
      const bodies = [['달', 3.690], ['화성', 4.632], ['지구', 5.600], ['목성', 8.103]];
      const hit = bodies.find(([, lg]) => Math.abs(Math.log10(v) - lg) <= 0.05);
      return Math.round(v).toLocaleString() + ' km³/s² · ' + (hit ? hit[0] : '가상');
    }
  };

  function resetMotion() {
    t = 0; trail = []; sweep = [];
    if (!gravityOn) { gravityOn = true; el('gravity').textContent = '중력 끄기'; }
    freeState = null;
  }

  ['sma', 'ecc', 'speed', 'gm'].forEach((k) => {
    const input = el(k);
    input.addEventListener('input', () => {
      // gm 슬라이더만 log10 눈금이다 — 상태에는 실제 값을 넣는다
      S[k] = k === 'gm' ? Math.pow(10, Number(input.value)) : Number(input.value);
      if (k === 'sma' || k === 'ecc') {
        clampEcc();
        el('ecc').value = S.ecc;
        el('ecc-out').textContent = labels.ecc(S.ecc);
      }
      el(k + '-out').textContent = labels[k](S[k]);
      if (k !== 'speed') resetMotion();
      syncPresets();
      readout();
    });
  });

  const presetBox = el('presets');
  presetBox.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      S.sma = Number(b.dataset.a);
      S.ecc = Number(b.dataset.e);
      clampEcc();
      ['sma', 'ecc'].forEach((k) => {
        el(k).value = S[k];
        el(k + '-out').textContent = labels[k](S[k]);
      });
      resetMotion();
      syncPresets();
      readout();
    });
  });

  function syncPresets() {
    presetBox.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', String(
        Number(b.dataset.a) === S.sma && Math.abs(Number(b.dataset.e) - S.ecc) < 1e-9
      ));
    });
  }

  el('toggle').addEventListener('click', () => {
    running = !running;
    el('toggle').textContent = running ? '일시정지' : '이어서';
  });

  /* 중력 끄기 — 이 화면의 핵심 버튼.
     끄는 순간의 위치·속도를 붙잡아 등속 직선 운동으로 넘긴다. */
  el('gravity').addEventListener('click', () => {
    if (gravityOn) {
      const st = orbitState(t);
      freeState = { x: st.x, y: st.y, vx: st.vx, vy: st.vy, t0: t };
      gravityOn = false;
      el('gravity').textContent = '중력 켜기';
    } else {
      gravityOn = true;
      freeState = null;
      trail = []; sweep = [];
      el('gravity').textContent = '중력 끄기';
    }
    readout();
  });

  el('reset').addEventListener('click', () => { resetMotion(); readout(); });

  el('share').addEventListener('click', async () => {
    const said = el('share-said');
    try {
      const me = await Session.refresh();
      if (!me) { said.textContent = '로그인이 필요합니다.'; return; }
      const q = new URLSearchParams({ sma: S.sma, ecc: S.ecc, speed: S.speed, gm: Math.log10(S.gm).toFixed(3) });
      const url = location.origin + location.pathname + '?' + q;
      const b = el('share-url');
      b.value = url; b.hidden = false; b.select();
      try { await navigator.clipboard.writeText(url); said.textContent = '복사했습니다.'; }
      catch { said.textContent = '주소를 복사해 주세요.'; }
    } catch { said.textContent = '잠시 후 다시 시도해 주세요.'; }
  });

  function applyQuery() {
    const q = new URLSearchParams(location.search);
    ['sma', 'ecc', 'speed', 'gm'].forEach((k) => {
      const v = Number(q.get(k));
      if (q.get(k) === null || !Number.isFinite(v)) return;
      const input = el(k);
      const c = Math.max(Number(input.min), Math.min(Number(input.max), v));
      input.value = c;
      // 주소의 gm 은 로그 값이다 — 상태에는 실제 값으로 넣는다
      S[k] = k === 'gm' ? Math.pow(10, c) : c;
      el(k + '-out').textContent = labels[k](S[k]);
    });
    clampEcc();
    el('ecc').value = S.ecc;
    el('ecc-out').textContent = labels.ecc(S.ecc);
    syncPresets();
  }

  // ── 루프 ──
  let last = 0;
  function frame(ts) {
    const now = ts / 1000;
    if (!last) last = now;
    const dt = Math.min(0.25, now - last);
    last = now;

    if (running) {
      // 한 바퀴를 약 14초에 돌도록 시간 배율을 잡는다
      const scaleT = period(S.sma) / 14;
      const prev = current();
      t += dt * scaleT * S.speed;
      const st = current();

      trail.push({ x: st.x, y: st.y });
      if (trail.length > 900) trail.shift();

      // 면적 띠 — 최근 구간만 남긴다
      sweep.push({ x1: prev.x, y1: prev.y, x2: st.x, y2: st.y });
      if (sweep.length > 46) sweep.shift();

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
  readout();
  resize();
  window.GraphTheme.onChange(drawGraph);   // 밝기 모드가 바뀌면 새 팔레트로 다시 그린다
  window.addEventListener('resize', resize);
  requestAnimationFrame(frame);
})();
