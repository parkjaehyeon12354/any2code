(function () {
  const el = (id) => document.getElementById(id);

  /* ── 대기와 기상: 산 위는 왜 추운가 ──

     "높이 올라가면 태양에 가까우니 따뜻해야 하는 것 아닌가" 가 흔한 오해다.
     산꼭대기는 태양에 겨우 몇 km 가까울 뿐이라 거리 효과는 사실상 0 이다.
     실제 이유는 공기가 부풀며 스스로 식는 것(단열 팽창)이다.

     그래서 이 화면은 공기덩어리를 직접 산 너머로 넘겨 보게 한다.
     같은 공기가 넘기 전보다 더 덥고 건조해져서 내려오는 것 — 푄 현상 —
     을 숫자로 확인할 수 있다.

     교육과정 표준값을 쓴다:
       건조단열감률 9.8°C/km, 습윤단열감률 약 5°C/km, 이슬점 감률 2°C/km */
  const DALR = 9.8;    // 건조단열감률 (구름 생기기 전)
  const MALR = 5.0;    // 습윤단열감률 (구름 속 — 숨은열이 식는 걸 방해한다)
  const DEWL = 2.0;    // 이슬점 감률

  const S = { temp: 20, dew: 12, peak: 2, speed: 1 };
  let running = true;
  let x = 0;           // 0 → 1 : 산을 넘는 진행도

  const canvas = el('canvas');
  const ctx = canvas.getContext('2d');
  const graph = el('profile-graph');
  const gctx = graph.getContext('2d');
  let DPR = 1;
  const W = () => canvas.width / DPR;
  const H = () => canvas.height / DPR;

  /* 상승응결고도 — 기온과 이슬점이 만나는 높이.
       (T − 9.8h) = (Td − 2h)  →  h = (T − Td) / 7.8
     이슬점이 기온보다 높을 수는 없으므로 음수는 0 으로 막는다. */
  function lcl() {
    return Math.max(0, (S.temp - S.dew) / (DALR - DEWL));
  }

  /* 올라갈 때의 기온 — 구름 아래는 건조, 구름 속은 습윤 */
  function tempUp(h) {
    const c = lcl();
    if (h <= c) return S.temp - DALR * h;
    return S.temp - DALR * c - MALR * (h - c);
  }

  function dewUp(h) {
    const c = lcl();
    // 구름 속에서는 포화 상태라 이슬점 = 기온
    if (h >= c) return tempUp(h);
    return S.dew - DEWL * h;
  }

  /* 내려올 때의 기온.
     구름이 생겼다면 비로 수증기를 잃었으므로 건조단열감률로 내려온다 —
     이것이 푄 현상의 핵심이다. 구름이 없었다면 올라간 그대로 돌아온다. */
  function tempDown(h) {
    const peakT = tempUp(S.peak);
    return peakT + DALR * (S.peak - h);
  }

  function dewDown(h) {
    const c = lcl();
    // 구름이 안 생겼으면 이슬점도 그대로 되돌아온다
    if (c >= S.peak) return S.dew - DEWL * h;
    // 정상에서 포화였고, 내려오며 기온만 오르므로 이슬점은 천천히 회복
    const peakD = tempUp(S.peak);
    return peakD + DEWL * (S.peak - h);
  }

  const rained = () => lcl() < S.peak;

  // 현재 위치 → 높이 (산 모양: 0~0.5 오름, 0.5~1 내림)
  function heightAt(t) {
    const u = t < 0.5 ? t / 0.5 : (1 - t) / 0.5;
    return S.peak * u;
  }
  const going = (t) => (t < 0.5 ? 'up' : 'down');

  function tempAt(t) {
    const h = heightAt(t);
    return going(t) === 'up' ? tempUp(h) : tempDown(h);
  }
  function dewAt(t) {
    const h = heightAt(t);
    return going(t) === 'up' ? dewUp(h) : dewDown(h);
  }

  // ── 무대 그리기 ──
  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W(), H());

    const w = W(), h = H();
    const ground = h * 0.86;
    const skyTop = h * 0.06;
    const kmToPx = (ground - skyTop) / Math.max(5, S.peak * 1.35);

    // 하늘 — 위로 갈수록 어둡다
    const sky = ctx.createLinearGradient(0, skyTop, 0, ground);
    sky.addColorStop(0, '#274b73');
    sky.addColorStop(0.55, '#7fa8cd');
    sky.addColorStop(1, '#cfe0ee');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, ground);

    // 산 — 경로를 함수로 둔다. 구름·비를 산 바깥으로 잘라낼 때 같은 모양이 필요하다.
    const peakPx = ground - S.peak * kmToPx;
    const left = w * 0.22, right = w * 0.78, mid = w * 0.5;
    /* ⚠ beginPath 를 부르지 않는다. clip 을 만들 때 화면 전체 사각형과 이 산을
          '한 경로 안에' 담아야 evenodd 로 산을 빼낼 수 있는데, 여기서
          beginPath 를 부르면 앞서 그린 사각형이 통째로 지워진다.
          그러면 산만 남아 결과가 정반대가 된다 — 실제로 그렇게 당했다. */
    const addMountain = () => {
      ctx.moveTo(0, ground);
      ctx.lineTo(left, ground);
      ctx.quadraticCurveTo(mid - w * 0.10, peakPx + (ground - peakPx) * 0.16, mid, peakPx);
      ctx.quadraticCurveTo(mid + w * 0.10, peakPx + (ground - peakPx) * 0.16, right, ground);
      ctx.lineTo(w, ground);
      ctx.closePath();
    };
    ctx.beginPath();
    addMountain();
    const rock = ctx.createLinearGradient(0, peakPx, 0, ground);
    rock.addColorStop(0, '#6b7280');
    rock.addColorStop(1, '#3f4b5a');
    ctx.fillStyle = rock;
    ctx.fill();

    // 땅
    ctx.fillStyle = '#2f3b2e';
    ctx.fillRect(0, ground, w, h - ground);

    // 높이 눈금
    ctx.font = '11px ui-sans-serif, system-ui';
    ctx.textAlign = 'left';
    for (let km = 1; km <= Math.ceil(S.peak * 1.3); km++) {
      const y = ground - km * kmToPx;
      if (y < skyTop) break;
      ctx.strokeStyle = 'rgba(255,255,255,.18)';
      ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,.65)';
      ctx.fillText(km + 'km', 6, y - 4);
    }

    /* 구름과 비 — 바람받이(산 왼쪽)에만 그린다.

       ⚠ save/restore 짝을 조심할 것. 산 clip 을 건 뒤 구름용 clip 을 또 걸고
          restore 하면 바깥 clip 까지 풀린다. 그래서 비가 산 경사면 위에
          그려졌다 — 실제로 겪었다. 구름과 비를 각각 독립된 save 블록으로 둔다. */
    const c = lcl();
    if (c < S.peak) {
      const cloudBase = ground - c * kmToPx;
      const cloudTop = peakPx - 10;
      const windL = left * 0.35;
      const windR = mid - w * 0.03;              // 정상 못 미치는 곳 = 바람받이

      // 산을 뺀 영역만 남기는 clip 을 매번 새로 건다
      // 화면 전체와 산을 '한 경로' 에 담고 evenodd 로 산을 빼낸다
      const clipOutsideMountain = () => {
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
        addMountain();                           // beginPath 없이 이어 붙인다
        ctx.clip('evenodd');
      };

      // ── 구름 ──
      ctx.save();
      clipOutsideMountain();
      /* 예전에는 원을 격자로 촘촘히 찍어 뭉게구름처럼 그렸다. 그런데 원 반지름이
         14~21px 인데 맨 아랫줄 중심이 응결고도에 딱 놓여서, 반지름만큼 아래로
         삐져나가 바닥(지면)을 뚫었다. 구름이 땅에 닿은 것처럼 보였다.
         지금은 응결고도부터 구름 꼭대기까지를 '한 덩어리 윤곽'으로 그린다 —
         경계가 실선이라 어디까지가 구름인지 분명하고, 아래로 새지 않는다. */
      const span = Math.max(30, windR - windL);
      const thick = Math.max(20, cloudBase - cloudTop);
      const bumps = Math.max(4, Math.round(span / 34));   // 윗면 뭉게뭉게 개수

      ctx.beginPath();
      ctx.moveTo(windL, cloudBase);
      // 윗면 — 가운데가 높고 양 끝이 낮은 봉우리들
      for (let i = 0; i <= bumps; i++) {
        const u = i / bumps;
        const taper = Math.sin(Math.PI * u);              // 양 끝 0, 가운데 1
        const wob = 0.82 + ((i * 37) % 7) / 20;           // 봉우리마다 조금씩 다르게
        const x = windL + u * span;
        const y = cloudBase - thick * taper * wob;
        if (i === 0) ctx.lineTo(x, y);
        else {
          const px = windL + (i - 0.5) / bumps * span;
          const pTaper = Math.sin(Math.PI * ((i - 0.5) / bumps));
          ctx.quadraticCurveTo(px, cloudBase - thick * pTaper * (wob + 0.14), x, y);
        }
      }
      ctx.lineTo(windR, cloudBase);
      ctx.closePath();                                    // 밑면은 응결고도 직선 — 이 아래로 안 샌다
      ctx.fillStyle = 'rgba(246,248,251,.95)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,140,165,.9)';           // 실선 윤곽
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.restore();

      // ── 비 ── 구름 아래에서 땅까지. 산에 가려 경사면에는 안 보인다.
      ctx.save();
      clipOutsideMountain();
      ctx.strokeStyle = 'rgba(140,190,240,.8)';
      ctx.lineWidth = 1.4;
      const phase = (Date.now() / 90) % 24;
      const fall = Math.max(14, ground - cloudBase);
      for (let i = 0; i < 46; i++) {
        const u = (i * 29 % 100) / 100;
        // 구름이 옅은 가장자리에는 비도 덜 내린다
        if (Math.sin(Math.PI * u) < 0.28) continue;
        const rx = windL + u * span;
        const ry = cloudBase + ((i * 31 + phase) % fall);
        ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx - 2, ry + 9); ctx.stroke();
      }
      ctx.restore();
    }

    // 공기덩어리
    const px = left + (right - left) * x;
    const py = ground - heightAt(x) * kmToPx;
    const t = tempAt(x);
    // 따뜻하면 붉게, 차가우면 푸르게
    const warm = Math.max(0, Math.min(1, (t + 10) / 45));
    const r = Math.round(60 + warm * 180), g = Math.round(110 - warm * 40), b = Math.round(220 - warm * 150);
    ctx.beginPath();
    ctx.arc(px, py - 16, 15, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r},${g},${b},.92)`;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.stroke();

    ctx.font = '700 12.5px ui-sans-serif, system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = 3;
    ctx.strokeText(t.toFixed(1) + '°C', px, py - 38);
    ctx.fillText(t.toFixed(1) + '°C', px, py - 38);

    // 바람 방향
    ctx.textAlign = 'left';
    ctx.font = '12px ui-sans-serif, system-ui';
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.fillText('바람 →', 10, ground - 10);
  }

  // ── 그래프: 높이에 따른 기온·이슬점 ──
  function drawGraph() {
    /* 캔버스는 CSS 를 못 받으니 색을 여기서 받아온다. 예전에는 '#f7f7f5' 를
       박아 놔서 다크 모드에서도 하얀 박스가 그대로 떠 있었다. */
    const P = window.GraphTheme.palette();
    gctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const w = graph.width / DPR, h = graph.height / DPR;
    gctx.clearRect(0, 0, w, h);

    const pad = { l: 52, r: 16, t: 18, b: 34 };
    const gw = w - pad.l - pad.r, gh = h - pad.t - pad.b;
    const maxH = Math.max(1, S.peak);

    // 기온 범위
    let lo = Math.min(tempUp(maxH), dewUp(0), S.dew) - 3;
    let hi = Math.max(S.temp, tempDown(0)) + 3;
    if (hi - lo < 10) hi = lo + 10;

    const X = (temp) => pad.l + (temp - lo) / (hi - lo) * gw;
    const Y = (km) => pad.t + gh - (km / maxH) * gh;

    gctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--surface-soft') || '#f7f7f5';
    gctx.fillRect(0, 0, w, h);

    // 눈금
    gctx.strokeStyle = P.grid;
    gctx.lineWidth = 1;
    gctx.font = '11px ui-sans-serif, system-ui';
    gctx.fillStyle = P.muted;
    gctx.textAlign = 'right';
    for (let km = 0; km <= maxH + 0.001; km += Math.max(0.5, Math.round(maxH / 5 * 2) / 2)) {
      const y = Y(km);
      gctx.beginPath(); gctx.moveTo(pad.l, y); gctx.lineTo(w - pad.r, y); gctx.stroke();
      gctx.fillText(km.toFixed(1) + 'km', pad.l - 8, y + 4);
    }
    gctx.textAlign = 'center';
    const step = (hi - lo) > 40 ? 10 : 5;
    for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) {
      const xx = X(t);
      gctx.strokeStyle = P.grid;
      gctx.beginPath(); gctx.moveTo(xx, pad.t); gctx.lineTo(xx, pad.t + gh); gctx.stroke();
      gctx.fillText(t + '°', xx, h - 12);
    }

    // 구름 영역
    const c = lcl();
    if (c < maxH) {
      gctx.fillStyle = P.grid;
      gctx.fillRect(pad.l, pad.t, gw, Y(c) - pad.t);
      gctx.fillStyle = P.muted;
      gctx.textAlign = 'left';
      gctx.fillText('구름 (기온 = 이슬점)', pad.l + 8, Y(c) - 8);
    }

    const line = (fn, color, dash) => {
      gctx.beginPath();
      for (let i = 0; i <= 100; i++) {
        const km = maxH * i / 100;
        const xx = X(fn(km)), yy = Y(km);
        i ? gctx.lineTo(xx, yy) : gctx.moveTo(xx, yy);
      }
      gctx.strokeStyle = color;
      gctx.lineWidth = 2.4;
      gctx.setLineDash(dash || []);
      gctx.stroke();
      gctx.setLineDash([]);
    };

    line(tempUp, '#e06c3a');
    line(dewUp, '#3b82f6');
    if (rained()) line(tempDown, '#e06c3a', [6, 5]);

    // 현재 위치 점
    const hNow = heightAt(x);
    gctx.beginPath();
    gctx.arc(X(tempAt(x)), Y(hNow), 5, 0, Math.PI * 2);
    gctx.fillStyle = P.ink;
    gctx.fill();
    gctx.strokeStyle = P.bg; gctx.lineWidth = 2; gctx.stroke();

    gctx.textAlign = 'left';
    gctx.fillStyle = P.muted;
    gctx.fillText('실선 = 올라갈 때 · 점선 = 내려올 때(더 따뜻함)', pad.l + 8, pad.t + 14);
  }

  // ── 수치 ──
  function readout() {
    const c = lcl();
    const hNow = heightAt(x);
    const peakT = tempUp(S.peak);
    const backT = tempDown(0);
    const backD = dewDown(0);

    el('r-alt').textContent = hNow.toFixed(2) + ' km';
    el('r-temp').textContent = tempAt(x).toFixed(1) + '°C';
    el('r-lcl').textContent = c >= S.peak ? '구름 없음' : (c * 1000).toFixed(0) + ' m';
    el('r-peak').textContent = peakT.toFixed(1) + '°C';
    el('r-cloud').textContent = c >= S.peak ? '0 m' : ((S.peak - c) * 1000).toFixed(0) + ' m';

    const dT = backT - S.temp, dD = backD - S.dew;
    const sT = el('s-temp'), sD = el('s-dew');
    sT.textContent = (dT >= 0 ? '+' : '') + dT.toFixed(1) + '°C';
    sD.textContent = (dD >= 0 ? '+' : '') + dD.toFixed(1) + '°C';
    sT.className = dT > 0.05 ? 'up' : (dT < -0.05 ? 'down' : '');
    sD.className = dD < -0.05 ? 'down' : '';

    const v = el('verdict');
    if (!rained()) {
      v.className = 'verdict';
      v.innerHTML = '구름이 생기지 않아 비도 내리지 않았습니다. 올라갈 때와 내려올 때 같은 비율로 ' +
        '식고 데워지므로, 산을 넘어도 <strong>기온이 그대로</strong>입니다. ' +
        '이슬점을 올려 습한 공기로 만들어 보세요.';
    } else {
      v.className = 'verdict warn';
      v.innerHTML = `산을 넘은 공기는 <strong>${dT.toFixed(1)}°C 더 덥고</strong> ` +
        `이슬점은 <strong>${Math.abs(dD).toFixed(1)}°C 낮아져</strong> 더 건조합니다. ` +
        '올라갈 때는 구름 속에서 천천히 식었는데, 비로 수증기를 잃고 ' +
        '내려올 때는 빠르게 데워졌기 때문입니다. 이것이 <strong>푄 현상(높새바람)</strong>입니다.';
    }

    let note;
    if (S.dew >= S.temp - 0.4) {
      note = '이슬점이 기온과 거의 같습니다. 지표에서 바로 응결이 시작돼 안개가 낀 상태에 가깝습니다.';
    } else if (!rained()) {
      note = `구름이 생기려면 ${(c * 1000).toFixed(0)}m 까지 올라가야 하는데 산이 ${(S.peak * 1000).toFixed(0)}m 라 못 미칩니다.`;
    } else if (going(x) === 'up') {
      note = hNow < c
        ? '아직 구름 아래입니다. 1km에 9.8°C씩 빠르게 식습니다.'
        : '구름 속입니다. 수증기가 응결하며 숨은열을 내놓아 1km에 약 5°C만 식습니다.';
    } else {
      note = '내려오는 중입니다. 수증기를 비로 잃었기 때문에 1km에 9.8°C씩 빠르게 데워집니다.';
    }
    el('note').textContent = note;
  }

  // ── 입력 ──
  const labels = {
    temp: (v) => Number(v).toFixed(1) + '°C',
    dew: (v) => Number(v).toFixed(1) + '°C',
    peak: (v) => Number(v).toFixed(1) + ' km',
    speed: (v) => Number(v).toFixed(1) + '×'
  };

  /* 이슬점은 기온을 넘을 수 없다 — 물리적으로 불가능한 상태다.
     사용자가 밀어 올리면 조용히 기온에 맞춰 막는다. */
  function clampDew() {
    if (S.dew > S.temp) {
      S.dew = S.temp;
      el('dew').value = S.temp;
      el('dew-out').textContent = labels.dew(S.temp);
    }
  }

  ['temp', 'dew', 'peak', 'speed'].forEach((k) => {
    const input = el(k);
    input.addEventListener('input', () => {
      S[k] = Number(input.value);
      el(k + '-out').textContent = labels[k](input.value);
      clampDew();
      syncPresets();
      readout();
    });
  });

  document.querySelectorAll('.preset-row button').forEach((b) => {
    b.addEventListener('click', () => {
      const v = Number(b.dataset.peak);
      S.peak = v;
      el('peak').value = v;
      el('peak-out').textContent = labels.peak(v);
      syncPresets();
      readout();
    });
  });

  const presetBox = el('presets');
  presetBox.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      S.temp = Number(b.dataset.t);
      S.dew = Number(b.dataset.d);
      S.peak = Number(b.dataset.p);
      ['temp', 'dew', 'peak'].forEach((k) => {
        el(k).value = S[k];
        el(k + '-out').textContent = labels[k](S[k]);
      });
      x = 0;
      syncPresets();
      readout();
    });
  });

  // 슬라이더를 직접 움직이면 어떤 상황도 아니게 된다 — 표시를 맞춰준다
  function syncPresets() {
    presetBox.querySelectorAll('button').forEach((b) => {
      const match = Number(b.dataset.t) === S.temp &&
                    Number(b.dataset.d) === S.dew &&
                    Number(b.dataset.p) === S.peak;
      b.setAttribute('aria-pressed', String(match));
    });
  }

  el('toggle').addEventListener('click', () => {
    running = !running;
    el('toggle').textContent = running ? '일시정지' : '이어서';
  });
  el('reset').addEventListener('click', () => { x = 0; readout(); });

  // ── 공유 ──
  el('share').addEventListener('click', async () => {
    const said = el('share-said');
    try {
      const me = await Session.refresh();
      if (!me) { said.textContent = '로그인이 필요합니다.'; return; }
      const q = new URLSearchParams({
        temp: S.temp, dew: S.dew, peak: S.peak, speed: S.speed, x: x.toFixed(3)
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
    ['temp', 'dew', 'peak', 'speed'].forEach((k) => {
      const v = Number(q.get(k));
      if (q.get(k) === null || !Number.isFinite(v)) return;
      const input = el(k);
      const c = Math.max(Number(input.min), Math.min(Number(input.max), v));
      S[k] = c; input.value = c;
      el(k + '-out').textContent = labels[k](c);
    });
    clampDew();
    const px = Number(q.get('x'));
    if (Number.isFinite(px) && px >= 0 && px <= 1) x = px;
    if (S.speed === 0) { running = false; el('toggle').textContent = '이어서'; }
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
      x += dt * 0.12 * S.speed;
      if (x > 1) x -= 1;
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
