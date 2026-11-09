(function () {
  const el = (id) => document.getElementById(id);

  /* ── 해양과 순환: 바람과 물이 가는 방향이 다르다 ──

     "바람 부는 쪽으로 물도 흐른다" 가 흔한 오해다. 실제 표층 해수는
     전향력 때문에 90도 틀어져 흐른다(에크만 수송). 북반구는 오른쪽,
     남반구는 왼쪽, 적도에서는 틀어지지 않는다.

     이 90도가 연안 용승을 만들고, 용승이 좋은 어장을 만든다.
     엘니뇨는 그 용승이 멈추는 현상이다.

     밀도는 UNESCO 간이식을 쓴다 — 표준 해수(0도, 35psu)에서 1028.1 이
     나오는 것을 확인했다. */

  const S = { wind: 0, strength: 9, lat: 37.5, temp: 15, salt: 34 };
  let running = true;
  let t = 0;

  const canvas = el('canvas');
  const ctx = canvas.getContext('2d');
  const graph = el('ts-graph');
  const gctx = graph.getContext('2d');
  let DPR = 1;
  const W = () => canvas.width / DPR;
  const H = () => canvas.height / DPR;

  const rad = (d) => d * Math.PI / 180;

  /* 해수 밀도 (UNESCO 간이식).
     수온이 낮을수록, 염분이 높을수록 무겁다. */
  function density(T, sal) {
    const rw = 999.842594 + 6.793952e-2 * T - 9.095290e-3 * T * T
             + 1.001685e-4 * Math.pow(T, 3) - 1.120083e-6 * Math.pow(T, 4)
             + 6.536332e-9 * Math.pow(T, 5);
    const A = 0.824493 - 4.0899e-3 * T + 7.6438e-5 * T * T
            - 8.2467e-7 * Math.pow(T, 3) + 5.3875e-9 * Math.pow(T, 4);
    const B = -5.72466e-3 + 1.0227e-4 * T - 1.6546e-6 * T * T;
    const C = 4.8314e-4;
    return rw + A * sal + B * Math.pow(sal, 1.5) + C * sal * sal;
  }

  const REF = () => density(15, 34);   // 주변 표층 기준

  /* 에크만 수송 — 바람에서 90도.
     적도(위도 0)에서는 전향력이 0이라 틀어지지 않는다.
     아주 낮은 위도에서는 서서히 약해지게 둔다. */
  function deflection() {
    const f = Math.sin(rad(S.lat));           // 전향 인자
    if (Math.abs(S.lat) < 0.5) return 0;
    // 위도가 낮으면 90도에 못 미친다 — 적도에서 0으로 이어지게
    const mag = Math.min(1, Math.abs(f) / Math.sin(rad(10)));
    return Math.sign(f) * 90 * mag;
  }

  const currentDir = () => (S.wind + deflection() + 360) % 360;

  /* 연안 용승 지수.
     해안선은 화면 왼쪽(서쪽)에 있다. 표층 해류가 바다 쪽(오른쪽, 동쪽)으로
     밀려나면 그 빈자리를 아래 찬물이 채운다 = 용승.
     방위각은 '가는 방향'이며 0=북, 90=동, 180=남, 270=서 로 둔다. */
  function upwelling() {
    if (S.strength < 0.4) return 0;
    const dir = rad(currentDir());
    const east = Math.sin(dir);          // +면 동쪽(바다쪽)으로 간다
    return east * Math.min(1, S.strength / 12);
  }

  const sst = () => {
    const u = upwelling();
    // 용승하면 아래 찬물이 올라와 표층이 차가워진다
    return S.temp - u * 6;
  };

  const plankton = () => {
    const u = upwelling();
    return Math.max(0, Math.min(1, u));   // 용승할 때만 영양염이 올라온다
  };

  function dirName(deg) {
    const names = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
    return names[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
  }

  // ── 무대 ──
  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W(), H());
    const w = W(), h = H();
    const coast = w * 0.16;              // 해안선 x
    const surface = h * 0.20;            // 해수면 y

    // 하늘
    const sky = ctx.createLinearGradient(0, 0, 0, surface);
    sky.addColorStop(0, '#bcd7ef');
    sky.addColorStop(1, '#e6f0f8');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, surface);

    // 바다 — 용승하면 표층이 차가워져 색이 달라진다
    const u = upwelling();
    const cold = Math.max(0, u);
    const sea = ctx.createLinearGradient(0, surface, 0, h);
    sea.addColorStop(0, cold > 0.15 ? '#2d7d9a' : '#3aa0c9');
    sea.addColorStop(0.45, '#1c5f85');
    sea.addColorStop(1, '#0d3450');
    ctx.fillStyle = sea;
    ctx.fillRect(0, surface, w, h - surface);

    // 육지
    ctx.fillStyle = '#4a5a45';
    ctx.beginPath();
    ctx.moveTo(0, surface - 26);
    ctx.lineTo(coast, surface - 26);
    ctx.lineTo(coast, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#6b7f63';
    ctx.fillRect(0, surface - 32, coast, 8);

    ctx.font = '12px ui-sans-serif, system-ui';
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.textAlign = 'center';
    ctx.fillText('육지', coast / 2, surface + 30);

    /* 나침반 — 묵대는 항상 어둡다. 글자를 어두운 회색(rgba(60,70,80))으로
       그려서 안 보였다. 원 안쪽에 얹으면 화살표와 겹치니 바깥 네 방향 그대로 두고
       색만 밝게 한다. */
    ctx.save();
    ctx.translate(w - 58, 52);
    ctx.strokeStyle = 'rgba(255,255,255,.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.font = '600 11px ui-sans-serif, system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('북', 0, -30); ctx.fillText('남', 0, 39);
    ctx.fillText('동', 33, 4); ctx.fillText('서', -33, 4);
    ctx.restore();

    // 바람 화살표 (하늘)
    const wr = rad(S.wind);
    const wdx = Math.sin(wr), wdy = -Math.cos(wr);
    ctx.strokeStyle = '#e5b567';
    ctx.fillStyle = '#e5b567';
    ctx.lineWidth = 3;
    for (let i = 0; i < 5; i++) {
      const bx = coast + 60 + i * (w - coast - 120) / 4;
      const by = surface * 0.5;
      const shift = ((t * 40 * (S.strength / 7)) % 60) - 30;
      const ax = bx + wdx * shift, ay = by + wdy * shift;
      arrow(ax, ay, wdx, wdy, 22);
    }
    /* 바람 화살표는 밝은 앰버인데 라벨만 어두운 갈색이라 안 보였다 */
    ctx.fillStyle = 'rgba(255,224,168,.95)';
    ctx.font = '600 12px ui-sans-serif, system-ui';
    ctx.textAlign = 'left';
    ctx.fillText('바람 ' + dirName(S.wind) + '쪽으로', coast + 14, 22);

    // 표층 해류 화살표
    const cr = rad(currentDir());
    const cdx = Math.sin(cr), cdy = -Math.cos(cr);
    ctx.strokeStyle = '#63b3ed';
    ctx.fillStyle = '#63b3ed';
    ctx.lineWidth = 3.4;
    for (let i = 0; i < 6; i++) {
      const bx = coast + 50 + i * (w - coast - 100) / 5;
      const by = surface + 46;
      const shift = ((t * 46 * (S.strength / 7)) % 64) - 32;
      arrow(bx + cdx * shift, by + cdy * shift, cdx, cdy, 24);
    }
    ctx.fillStyle = 'rgba(230,245,255,.95)';
    ctx.font = '600 12px ui-sans-serif, system-ui';
    ctx.fillText('표층 해류 ' + dirName(currentDir()) + '쪽으로', coast + 14, surface + 22);

    // 용승 / 침강
    if (u > 0.12) {
      ctx.strokeStyle = 'rgba(16,185,129,.85)';
      ctx.fillStyle = 'rgba(16,185,129,.85)';
      ctx.lineWidth = 3;
      for (let i = 0; i < 4; i++) {
        const bx = coast + 26 + i * 22;
        const shift = ((t * 34) % 70);
        arrow(bx, h - 20 - shift, 0, -1, 20);
      }
      ctx.font = '600 12.5px ui-sans-serif, system-ui';
      ctx.fillText('용승 — 찬물과 영양염이 올라온다', coast + 14, h - 16);

      // 플랑크톤
      const p = plankton();
      for (let i = 0; i < Math.round(p * 40); i++) {
        const px = coast + 20 + ((i * 61) % (w * 0.5));
        const py = surface + 30 + ((i * 47 + t * 20) % (h - surface - 50));
        ctx.beginPath();
        ctx.arc(px, py, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(52,211,153,.75)';
        ctx.fill();
      }
    } else if (u < -0.12) {
      ctx.strokeStyle = 'rgba(147,197,253,.8)';
      ctx.fillStyle = 'rgba(147,197,253,.8)';
      ctx.lineWidth = 3;
      for (let i = 0; i < 4; i++) {
        const bx = coast + 26 + i * 22;
        const shift = ((t * 34) % 70);
        arrow(bx, surface + 30 + shift, 0, 1, 20);
      }
      ctx.font = '600 12.5px ui-sans-serif, system-ui';
      ctx.fillText('침강 — 표층수가 해안으로 몰려 가라앉는다', coast + 14, h - 16);
    }

    // 무거운 물 표시 — 밀도가 크면 가라앉는 덩어리를 보여준다
    const d = density(S.temp, S.salt), ref = REF();
    if (d > ref + 0.15) {
      const sink = ((t * 26) % (h - surface - 40));
      ctx.beginPath();
      ctx.arc(w * 0.72, surface + 24 + sink, 13, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(30,58,95,.9)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = 'rgba(230,240,250,.95)';
      ctx.font = '11.5px ui-sans-serif, system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('무거워 가라앉음', w * 0.72, surface + 24 + sink - 20);
    }
  }

  function arrow(x, y, dx, dy, len) {
    const ex = x + dx * len, ey = y + dy * len;
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
    const a = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - 8 * Math.cos(a - 0.4), ey - 8 * Math.sin(a - 0.4));
    ctx.lineTo(ex - 8 * Math.cos(a + 0.4), ey - 8 * Math.sin(a + 0.4));
    ctx.closePath();
    ctx.fill();
  }

  // ── 수온-염분 도표 ──
  function drawGraph() {
    /* 캔버스는 CSS 를 못 받으니 색을 여기서 받아온다. 예전에는 '#f7f7f5' 를
       박아 놔서 다크 모드에서도 하얀 박스가 그대로 떠 있었다. */
    const P = window.GraphTheme.palette();
    gctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const w = graph.width / DPR, h = graph.height / DPR;
    gctx.clearRect(0, 0, w, h);
    const pad = { l: 54, r: 18, t: 18, b: 34 };
    const gw = w - pad.l - pad.r, gh = h - pad.t - pad.b;

    const T0 = -2, T1 = 32, S0 = 30, S1 = 40;
    const X = (T) => pad.l + (T - T0) / (T1 - T0) * gw;
    const Y = (s) => pad.t + gh - (s - S0) / (S1 - S0) * gh;

    /* 예전에는 배경이 #f7f7f5 하드코딩이라 어두운 graph-wrap 위에 하얀 박스가
       떠 보였다. 랩은 밝기 모드와 무관하게 어두우니(surface-dark) 캔버스도 어둡게 —
       한 팔레트로 두 모드에서 다 맞는다. */
    gctx.fillStyle = P.bg;
    gctx.fillRect(0, 0, w, h);

    // 밀도 등고선
    gctx.font = '10.5px ui-sans-serif, system-ui';
    for (let sig = 1020; sig <= 1032; sig += 2) {
      gctx.beginPath();
      let started = false;
      for (let i = 0; i <= 160; i++) {
        const T = T0 + (T1 - T0) * i / 160;
        // 해당 수온에서 밀도가 sig 가 되는 염분을 이분법으로 찾는다
        let lo = S0, hi = S1, mid = 0, ok = false;
        for (let k = 0; k < 30; k++) {
          mid = (lo + hi) / 2;
          if (density(T, mid) < sig) lo = mid; else hi = mid;
        }
        ok = Math.abs(density(T, mid) - sig) < 0.35 && mid > S0 && mid < S1;
        if (!ok) { started = false; continue; }
        const xx = X(T), yy = Y(mid);
        started ? gctx.lineTo(xx, yy) : gctx.moveTo(xx, yy);
        started = true;
      }
      gctx.strokeStyle = 'rgba(150,170,195,.4)';
      gctx.lineWidth = 1;
      gctx.stroke();
    }

    // 축
    gctx.strokeStyle = P.grid;
    gctx.lineWidth = 1;
    gctx.textAlign = 'center';
    gctx.fillStyle = P.ink;
    for (let T = 0; T <= 30; T += 10) {
      gctx.beginPath(); gctx.moveTo(X(T), pad.t); gctx.lineTo(X(T), pad.t + gh); gctx.stroke();
      gctx.fillText(T + '°C', X(T), h - 12);
    }
    gctx.textAlign = 'right';
    for (let s = 30; s <= 40; s += 2) {
      gctx.beginPath(); gctx.moveTo(pad.l, Y(s)); gctx.lineTo(w - pad.r, Y(s)); gctx.stroke();
      gctx.fillText(s + ' psu', pad.l - 8, Y(s) + 4);
    }

    // 참고 물덩어리
    const marks = [
      { T: 2, s: 35, name: '북대서양 심층수' },
      { T: 28, s: 33, name: '열대 표층' },
      { T: 13, s: 38.5, name: '지중해' }
    ];
    gctx.textAlign = 'left';
    marks.forEach((m) => {
      gctx.beginPath(); gctx.arc(X(m.T), Y(m.s), 4, 0, Math.PI * 2);
      gctx.fillStyle = 'rgba(150,170,195,.9)'; gctx.fill();
      gctx.fillStyle = 'rgba(190,205,225,.95)';
      gctx.fillText(m.name, X(m.T) + 8, Y(m.s) + 4);
    });

    // 지금 물
    gctx.beginPath();
    gctx.arc(X(S.temp), Y(S.salt), 7, 0, Math.PI * 2);
    gctx.fillStyle = '#e06c3a'; gctx.fill();
    gctx.strokeStyle = P.bg; gctx.lineWidth = 2.5; gctx.stroke();
    gctx.fillStyle = '#ff9d6b';
    gctx.font = '600 12px ui-sans-serif, system-ui';
    gctx.fillText('지금 물 ' + density(S.temp, S.salt).toFixed(1), X(S.temp) + 11, Y(S.salt) - 9);
  }

  // ── 수치 ──
  function readout() {
    const def = deflection();
    const d = density(S.temp, S.salt), ref = REF();
    const u = upwelling();

    el('r-current').textContent = dirName(currentDir()) + '쪽 (' + Math.round(currentDir()) + '°)';
    el('r-angle').textContent = Math.abs(def) < 0.5
      ? '0° — 틀어지지 않음'
      : (def > 0 ? '오른쪽 ' : '왼쪽 ') + Math.abs(def).toFixed(0) + '°';
    el('r-density').textContent = d.toFixed(2) + ' kg/m³';

    const diff = d - ref;
    el('r-buoy').textContent = Math.abs(diff) < 0.05
      ? '같음'
      : (diff > 0 ? '무거움 (+' : '가벼움 (') + diff.toFixed(2) + ') — ' + (diff > 0 ? '가라앉음' : '떠오름');

    el('r-coast').textContent = u > 0.12 ? '용승' : (u < -0.12 ? '침강' : '거의 없음');

    el('s-sst').textContent = sst().toFixed(1) + '°C';
    const sstEl = el('s-sst');
    sstEl.className = u > 0.12 ? 'down' : (u < -0.12 ? 'up' : '');

    const p = plankton();
    el('s-plankton').textContent = p > 0.6 ? '매우 많음' : p > 0.3 ? '많음' : p > 0.08 ? '보통' : '적음';
    el('s-plankton').className = p > 0.3 ? 'down' : '';

    const v = el('verdict');
    if (S.strength < 0.4) {
      v.className = 'verdict';
      v.innerHTML = '바람이 없어 표층 해류도 생기지 않습니다. 바람 세기를 올려 보세요.';
    } else if (Math.abs(S.lat) < 0.5) {
      v.className = 'verdict warn';
      v.innerHTML = '<strong>적도입니다.</strong> 전향력이 0이라 물이 전혀 틀어지지 않고 ' +
        '바람과 같은 방향으로 흐릅니다. 위도를 올리거나 내려 차이를 확인해 보세요.';
    } else if (u > 0.12) {
      v.className = 'verdict warn';
      v.innerHTML = '표층수가 바다 쪽으로 밀려나 <strong>용승</strong>이 일어납니다. ' +
        `찬물과 영양염이 올라와 표층이 <strong>${(S.temp - sst()).toFixed(1)}°C 차가워지고</strong> ` +
        '플랑크톤이 늘어납니다. 페루 앞바다가 세계적 어장인 이유입니다. ' +
        '<strong>엘니뇨</strong> 때는 바람이 약해져 이 용승이 멈춥니다.';
    } else if (u < -0.12) {
      v.className = 'verdict';
      v.innerHTML = '표층수가 해안으로 몰려 <strong>가라앉습니다(침강)</strong>. ' +
        '아래 영양염이 올라오지 못해 플랑크톤이 적고, 표층이 상대적으로 따뜻합니다.';
    } else {
      v.className = 'verdict';
      v.innerHTML = '해류가 해안과 거의 나란해 용승도 침강도 뚜렷하지 않습니다. ' +
        '바람 방향을 돌려 보세요.';
    }

    let note;
    if (Math.abs(S.lat) < 0.5) {
      note = '적도에서는 전향력이 0입니다. 바람과 해류가 같은 방향입니다.';
    } else if (S.lat > 0) {
      note = '북반구라 표층 해류가 바람의 오른쪽 90°로 흐릅니다.';
    } else {
      note = '남반구라 표층 해류가 바람의 왼쪽 90°로 흐릅니다. 북반구와 반대입니다.';
    }
    if (d > ref + 0.15) {
      note += ' 이 물은 주변보다 무거워 가라앉습니다 — 심층 순환의 출발점입니다.';
    }
    el('note').textContent = note;
  }

  // ── 입력 ──
  const labels = {
    wind: (v) => {
      const from = dirName((Number(v) + 180) % 360);
      return from + ' → ' + dirName(Number(v));
    },
    strength: (v) => Number(v).toFixed(1) + ' m/s',
    lat: (v) => {
      const n = Number(v);
      const where = Math.abs(n) < 0.5 ? '적도' : (n > 0 ? '북반구' : '남반구');
      return n.toFixed(1) + '° (' + where + ')';
    },
    temp: (v) => Number(v).toFixed(1) + '°C',
    salt: (v) => Number(v).toFixed(1) + ' psu'
  };

  ['wind', 'strength', 'lat', 'temp', 'salt'].forEach((k) => {
    const input = el(k);
    input.addEventListener('input', () => {
      S[k] = Number(input.value);
      el(k + '-out').textContent = labels[k](input.value);
      readout();
    });
  });

  document.querySelectorAll('[data-lat]').forEach((b) => {
    b.addEventListener('click', () => {
      S.lat = Number(b.dataset.lat);
      el('lat').value = S.lat;
      el('lat-out').textContent = labels.lat(S.lat);
      readout();
    });
  });

  document.querySelectorAll('[data-t][data-s]').forEach((b) => {
    b.addEventListener('click', () => {
      S.temp = Number(b.dataset.t);
      S.salt = Number(b.dataset.s);
      ['temp', 'salt'].forEach((k) => {
        el(k).value = S[k];
        el(k + '-out').textContent = labels[k](S[k]);
      });
      readout();
    });
  });

  el('toggle').addEventListener('click', () => {
    running = !running;
    el('toggle').textContent = running ? '일시정지' : '이어서';
  });
  el('reset').addEventListener('click', () => {
    S.wind = 0; S.strength = 9; S.lat = 37.5; S.temp = 15; S.salt = 34;
    ['wind', 'strength', 'lat', 'temp', 'salt'].forEach((k) => {
      el(k).value = S[k];
      el(k + '-out').textContent = labels[k](S[k]);
    });
    readout();
  });

  el('share').addEventListener('click', async () => {
    const said = el('share-said');
    try {
      const me = await Session.refresh();
      if (!me) { said.textContent = '로그인이 필요합니다.'; return; }
      const q = new URLSearchParams({
        wind: S.wind, strength: S.strength, lat: S.lat, temp: S.temp, salt: S.salt
      });
      const url = location.origin + location.pathname + '?' + q;
      const b = el('share-url');
      b.value = url; b.hidden = false; b.select();
      try { await navigator.clipboard.writeText(url); said.textContent = '복사했습니다.'; }
      catch { said.textContent = '주소를 복사해 주세요.'; }
    } catch { said.textContent = '잠시 후 다시 시도해 주세요.'; }
  });

  function applyQuery() {
    const q = new URLSearchParams(location.search);
    ['wind', 'strength', 'lat', 'temp', 'salt'].forEach((k) => {
      const v = Number(q.get(k));
      if (q.get(k) === null || !Number.isFinite(v)) return;
      const input = el(k);
      const c = Math.max(Number(input.min), Math.min(Number(input.max), v));
      S[k] = c; input.value = c;
      el(k + '-out').textContent = labels[k](c);
    });
  }

  let last = 0;
  function frame(ts) {
    const now = ts / 1000;
    if (!last) last = now;
    const dt = Math.min(0.25, now - last);
    last = now;
    if (running) t += dt;
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
  readout();
  resize();
  window.GraphTheme.onChange(drawGraph);   // 밝기 모드가 바뀌면 새 팔레트로 다시 그린다
  window.addEventListener('resize', resize);
  requestAnimationFrame(frame);
})();
