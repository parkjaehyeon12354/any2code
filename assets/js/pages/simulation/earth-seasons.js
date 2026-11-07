(function () {
  const el = (id) => document.getElementById(id);

  /* ── 외권과 천체: 계절이 왜 생기는가 ──

     "여름에 태양과 가까워서 덥다" 는 흔한 오해다. 실제로는 1월에 더 가깝다.
     그래서 이 화면은 자전축 기울기를 직접 바꿔 보게 한다 — 0도로 두면
     거리와 상관없이 계절이 사라지는 것을 눈으로 확인할 수 있다.

     계산은 실제 천문 공식을 쓴다. 서울 하지 76도, 동지 29도가 그대로 나온다. */
  const CITIES = [
    { id: 'seoul', name: '서울', lat: 37.5 },
    { id: 'singapore', name: '싱가포르', lat: 1.3 },
    { id: 'sydney', name: '시드니', lat: -33.9 },
    { id: 'reykjavik', name: '레이캬비크', lat: 64.1 }
  ];

  const S = { tilt: 23.5, ecc: 0.017, speed: 1, city: 'seoul', peri: 4 };
  let running = true;
  let dayOfYear = 80;      // 춘분 언저리에서 시작

  const canvas = el('canvas');
  const ctx = canvas.getContext('2d');
  let DPR = 1;
  const W = () => canvas.width / DPR;
  const H = () => canvas.height / DPR;

  const city = () => CITIES.find((c) => c.id === S.city);
  const rad = (d) => d * Math.PI / 180;
  const deg = (r) => r * 180 / Math.PI;

  /* 태양 적위 — 태양이 천구 적도에서 얼마나 벗어났는가.
     기울기가 0이면 항상 0이 되어 계절이 사라진다. 이게 이 화면의 핵심이다.

     춘분(3/20, 79일)을 0 으로 두고 사인파로 근사한다. */
  function declination(day) {
    return S.tilt * Math.sin(2 * Math.PI * (day - 79) / 365.24);
  }

  /* 남중 고도 = 90 − |위도 − 적위|.
     교과서의 "90 − 위도 + 적위" 는 북반구 기준이라 절댓값으로 일반화한다. */
  function noonAltitude(day) {
    const d = declination(day);
    return 90 - Math.abs(city().lat - d);
  }

  /* 낮 길이 — 시간각으로 구한다.
        cos(H) = −tan(위도)·tan(적위)
     |cos| > 1 이면 해가 지지 않거나(백야) 뜨지 않는다(극야). */
  function dayLength(day) {
    const d = rad(declination(day));
    const lat = rad(city().lat);
    const c = -Math.tan(lat) * Math.tan(d);
    if (c <= -1) return 24;      // 백야
    if (c >= 1) return 0;        // 극야
    return 2 * deg(Math.acos(c)) / 15;
  }

  /* 태양까지 거리 — 케플러 궤도. 근일점은 1월 초(4일)다.
     "여름에 가깝다" 가 틀렸다는 것을 숫자로 보여주는 부분. */
  function sunDistance(day) {
    const a = 149.6;             // 백만 km
    const theta = 2 * Math.PI * (day - S.peri) / 365.24;
    return a * (1 - S.ecc * S.ecc) / (1 + S.ecc * Math.cos(theta));
  }

  /* 지표가 받는 햇빛 세기 — 고도의 사인에 비례하고 거리 제곱에 반비례한다.
     계절을 만드는 것이 거리가 아니라 고도라는 것을 대조해 보여준다. */
  function insolation(day) {
    const alt = noonAltitude(day);
    if (alt <= 0) return 0;
    const r = sunDistance(day) / 149.6;
    const hours = dayLength(day) / 12;    // 낮 길이도 함께 반영
    return Math.sin(rad(Math.min(90, alt))) * hours / (r * r);
  }

  function seasonName(day) {
    const d = declination(day);
    const north = city().lat >= 0;
    // 남반구는 계절이 반대다 — 시드니를 넣은 이유
    const v = north ? d : -d;
    if (v > S.tilt * 0.7) return '여름';
    if (v < -S.tilt * 0.7) return '겨울';
    // 적위가 커지는 중이면 봄, 줄어드는 중이면 가을
    const rising = Math.cos(2 * Math.PI * (day - 79) / 365.24) > 0;
    return (north ? rising : !rising) ? '봄' : '가을';
  }

  function dateLabel(day) {
    const d = new Date(2026, 0, 1);
    d.setDate(Math.floor(day));
    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  }

  // ── 무대: 공전 궤도 ──
  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W(), H());

    const cx = W() * 0.42, cy = H() * 0.5;
    const a = Math.min(W(), H()) * 0.34;       // 긴반지름
    const bAxis = a * Math.sqrt(1 - S.ecc * S.ecc);
    const focus = a * S.ecc;                   // 태양은 초점에 있다

    // 궤도
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.ellipse(cx, cy, a, bAxis, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 태양
    const sx = cx + focus, sy = cy;
    const glow = ctx.createRadialGradient(sx, sy, 2, sx, sy, 34);
    glow.addColorStop(0, 'rgba(255,220,120,.95)');
    glow.addColorStop(1, 'rgba(255,180,60,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(sx, sy, 34, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd166';
    ctx.beginPath(); ctx.arc(sx, sy, 13, 0, Math.PI * 2); ctx.fill();

    // 지구 위치 — 근일점(1/4)에서 시작해 반시계로 돈다
    const th = 2 * Math.PI * (dayOfYear - S.peri) / 365.24;
    const ex = cx + a * Math.cos(th), ey = cy + bAxis * Math.sin(th);

    // 계절 표시점 — 춘분·하지·추분·동지
    [[79, '춘분'], [172, '하지'], [265, '추분'], [355, '동지']].forEach(([d, label]) => {
      const t2 = 2 * Math.PI * (d - S.peri) / 365.24;
      const px = cx + a * Math.cos(t2), py = cy + bAxis * Math.sin(t2);
      ctx.fillStyle = 'rgba(255,255,255,.3)';
      ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
      /* 이름표를 궤도 바깥으로 민다. 점 바로 위에 두면 그 자리에 지구가
         왔을 때 글자와 겹쳐 둘 다 안 읽힌다. */
      const ux = (px - cx) / a, uy = (py - cy) / bAxis;
      const ulen = Math.hypot(ux, uy) || 1;
      ctx.font = '11px system-ui'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,.45)';
      ctx.fillText(label, px + ux / ulen * 22, py + uy / ulen * 22 + 4);
    });

    drawEarth(ex, ey, sx, sy);

    // 오른쪽에 확대한 지구 — 기울기와 밝은 면을 자세히
    drawDetail(W() * 0.845, H() * 0.5, Math.min(W(), H()) * 0.15);

    ctx.font = '12px system-ui'; ctx.textAlign = 'left';
    ctx.fillStyle = '#9a9a9a';
    ctx.fillText(`${dateLabel(dayOfYear)} · ${city().name} ${seasonName(dayOfYear)}`, 14, H() - 14);
  }

  function drawEarth(ex, ey, sx, sy) {
    const r = 11;
    // 밤낮 — 태양 반대쪽이 어둡다
    const ang = Math.atan2(ey - sy, ex - sx);
    ctx.save();
    ctx.translate(ex, ey);
    ctx.fillStyle = '#4a7fb5';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.beginPath(); ctx.arc(0, 0, r, ang - Math.PI / 2, ang + Math.PI / 2); ctx.fill();
    // 자전축 — 공전하는 동안 방향이 바뀌지 않는다. 이게 계절의 원인이다.
    ctx.rotate(rad(-S.tilt));
    ctx.strokeStyle = '#ff9d6b'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -r * 1.7); ctx.lineTo(0, r * 1.7); ctx.stroke();
    ctx.restore();
  }

  /* 확대한 지구 — 자전축, 적도, 지금 고른 도시, 밝은 면 */
  function drawDetail(cx, cy, r) {
    const d = declination(dayOfYear);

    ctx.save();
    ctx.translate(cx, cy);

    // 지구
    ctx.fillStyle = '#3f6f9f';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();

    /* 밤 그림자 — 태양이 왼쪽에 있으므로 오른쪽 절반이 어둡다.

       ⚠ 적위만큼 경계를 기울인다. 적위가 +(북반구 여름)면 북극 쪽이 더 밝아
       그림자가 남쪽으로 밀린다. 회전을 먼저 걸고 x>0 을 칠하면 밝은 쪽과
       어두운 쪽이 뒤바뀌므로, 그림자 사각형만 기울여 그린다. */
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
    ctx.rotate(rad(-d));            // 적위가 +면 그림자가 남쪽으로 기운다
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(0, -r * 2, r * 2, r * 4);
    ctx.restore();

    ctx.save();
    ctx.rotate(rad(-S.tilt));

    // 적도
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.22, 0, 0, Math.PI * 2); ctx.stroke();

    // 자전축
    ctx.strokeStyle = '#ff9d6b'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(0, -r * 1.35); ctx.lineTo(0, r * 1.35); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.font = '10px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('N', 0, -r * 1.45);

    // 고른 도시 위치
    const la = rad(city().lat);
    const px = 0, py = -Math.sin(la) * r;
    const rr = Math.cos(la) * r;
    ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(px, py, rr, rr * 0.22, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ffd166';
    ctx.beginPath(); ctx.arc(-rr * 0.5, py, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.restore();

    // 라벨
    ctx.font = '11.5px system-ui'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.fillText(`기울기 ${S.tilt.toFixed(1)}°`, cx, cy + r * 1.75);
    ctx.fillStyle = '#ffd166';
    ctx.fillText(city().name, cx, cy + r * 1.75 + 16);
  }

  // ── 그래프: 1년간 낮 길이와 고도 ──
  const graph = el('daylight-graph');
  const g2 = graph.getContext('2d');

  function drawGraph() {
    /* 캔버스는 CSS 를 못 받으니 색을 여기서 받아온다. 예전에는 '#f7f7f5' 를
       박아 놔서 다크 모드에서도 하얀 박스가 그대로 떠 있었다. */
    const P = window.GraphTheme.palette();
    const gw = graph.width / DPR, gh = graph.height / DPR;
    g2.setTransform(DPR, 0, 0, DPR, 0, 0);
    g2.clearRect(0, 0, gw, gh);

    const pad = { l: 58, r: 58, t: 30, b: 44 };
    const x = pad.l, y = pad.t, w = gw - pad.l - pad.r, h = gh - pad.t - pad.b;

    // 눈금 — 왼쪽 낮 길이(0~24h), 오른쪽 고도(0~90도)
    g2.strokeStyle = P.grid; g2.lineWidth = 1;
    g2.font = '12px system-ui';
    for (let i = 0; i <= 4; i++) {
      const py = y + h * i / 4;
      g2.beginPath(); g2.moveTo(x, py); g2.lineTo(x + w, py); g2.stroke();
      g2.fillStyle = '#7cc4ff'; g2.textAlign = 'right';
      g2.fillText(Math.round(24 * (1 - i / 4)) + 'h', x - 9, py + 4);
      g2.fillStyle = '#ffb35c'; g2.textAlign = 'left';
      g2.fillText(Math.round(90 * (1 - i / 4)) + '°', x + w + 9, py + 4);
    }

    // 월 구분
    g2.fillStyle = P.muted; g2.textAlign = 'center';
    for (let m = 0; m < 12; m += 2) {
      const day = m * 30.4 + 1;
      const px = x + w * day / 365;
      g2.strokeStyle = P.grid;
      g2.beginPath(); g2.moveTo(px, y); g2.lineTo(px, y + h); g2.stroke();
      g2.fillText((m + 1) + '월', px, y + h + 18);
    }

    // 두 곡선
    const plot = (fn, max, color) => {
      g2.strokeStyle = color; g2.lineWidth = 2.4;
      g2.beginPath();
      for (let d = 1; d <= 365; d += 2) {
        const px = x + w * d / 365;
        const py = y + h - Math.max(0, Math.min(max, fn(d))) / max * h;
        d === 1 ? g2.moveTo(px, py) : g2.lineTo(px, py);
      }
      g2.stroke();
    };
    plot(dayLength, 24, '#7cc4ff');
    plot(noonAltitude, 90, '#ffb35c');

    // 지금 위치
    const nx = x + w * dayOfYear / 365;
    g2.strokeStyle = P.muted; g2.setLineDash([5, 4]); g2.lineWidth = 1.5;
    g2.beginPath(); g2.moveTo(nx, y); g2.lineTo(nx, y + h); g2.stroke();
    g2.setLineDash([]);
    [[dayLength(dayOfYear), 24, '#7cc4ff'], [noonAltitude(dayOfYear), 90, '#ffb35c']]
      .forEach(([v, max, c]) => {
        g2.fillStyle = c;
        g2.beginPath();
        g2.arc(nx, y + h - Math.max(0, Math.min(max, v)) / max * h, 5, 0, Math.PI * 2);
        g2.fill();
      });

    // 범례
    g2.font = '600 13px system-ui';
    g2.fillStyle = '#7cc4ff'; g2.textAlign = 'left';
    g2.fillText(`낮 길이  ${dayLength(dayOfYear).toFixed(1)} h`, x + 6, y - 10);
    g2.fillStyle = '#ffb35c'; g2.textAlign = 'right';
    g2.fillText(`남중 고도  ${noonAltitude(dayOfYear).toFixed(1)}°`, x + w - 6, y - 10);

    // 기울기 0이면 계절이 없다는 것을 글로도 알려준다
    if (S.tilt < 0.6) {
      g2.fillStyle = P.ink; g2.textAlign = 'center';
      g2.font = '600 14px system-ui';
      g2.fillText('기울기가 0이라 1년 내내 같습니다 — 계절이 없습니다', x + w / 2, y + h / 2);
    }

    g2.strokeStyle = P.muted; g2.lineWidth = 1;
    g2.beginPath(); g2.moveTo(x, y); g2.lineTo(x, y + h); g2.lineTo(x + w, y + h); g2.stroke();
  }

  // ── 측정값 ──
  function readout() {
    const dist = sunDistance(dayOfYear);
    const alt = noonAltitude(dayOfYear);
    const len = dayLength(dayOfYear);
    const sun = insolation(dayOfYear);

    el('r-date').textContent = dateLabel(dayOfYear);
    el('r-dist').textContent = (dist * 1e6 / 1e4).toFixed(0) + '만 km';
    el('r-alt').textContent = alt.toFixed(1) + '°';
    el('r-day').textContent = len === 24 ? '24시간 (백야)' : len === 0 ? '0시간 (극야)' : len.toFixed(1) + '시간';
    el('r-energy').textContent = (sun * 100).toFixed(0) + '%';

    const season = seasonName(dayOfYear);
    el('season-now').innerHTML =
      `<strong>${city().name} (위도 ${city().lat}°) — 지금은 ${season}</strong>` +
      `<span class="sub">남중 고도 ${alt.toFixed(1)}°, 낮 ${len.toFixed(1)}시간</span>`;

    // 이 화면에서 가장 중요한 안내 — 상황마다 다른 설명을 준다
    let note;
    if (S.tilt < 0.6) {
      note = '기울기를 0으로 두면 남중 고도와 낮 길이가 1년 내내 같습니다. ' +
             '거리가 변해도 계절은 생기지 않습니다 — 계절을 만드는 것은 기울기입니다.';
    } else if (S.tilt > 60) {
      note = '천왕성처럼 크게 기울면 극단적입니다. 한쪽 반구가 오랫동안 낮이고 반대쪽은 계속 밤입니다.';
    } else if (dist < 148 && season === '겨울') {
      note = `지금 태양과의 거리는 ${(dist * 100).toFixed(0)}만 km 로 1년 중 가까운 편인데도 겨울입니다. ` +
             '"여름에 태양과 가까워서 덥다" 가 틀렸다는 증거입니다.';
    } else if (dist > 151 && season === '여름') {
      note = `지금 태양과 가장 먼 쪽(${(dist * 100).toFixed(0)}만 km)인데도 여름입니다. ` +
             '태양이 높이 뜨고 낮이 길기 때문입니다.';
    } else if (Math.abs(city().lat) < 10) {
      note = '적도 근처는 1년 내내 태양이 높고 낮 길이도 거의 같습니다. 그래서 계절 변화가 작습니다.';
    } else if (len === 24) {
      note = '해가 지지 않는 백야입니다. 위도가 높으면 여름에 이런 일이 생깁니다.';
    } else if (len === 0) {
      note = '해가 뜨지 않는 극야입니다.';
    } else if (city().lat < 0) {
      note = '남반구라 북반구와 계절이 반대입니다. 같은 날짜에 서울과 비교해 보세요.';
    } else {
      note = '태양이 높이 뜰수록, 낮이 길수록 더 많은 에너지를 받습니다. 이 둘이 겹쳐 계절이 됩니다.';
    }
    el('note').textContent = note;
  }

  // ── 도시 ──
  const cityBox = el('cities');
  CITIES.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(S.city === c.id));
    b.innerHTML = `<span>${c.name}</span><span class="lat">위도 ${c.lat}°</span>`;
    b.addEventListener('click', () => {
      S.city = c.id;
      [...cityBox.children].forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      readout();
    });
    cityBox.appendChild(b);
  });

  // ── 슬라이더 ──
  const labels = {
    tilt: (v) => Number(v).toFixed(1) + '°',
    ecc: (v) => Number(v).toFixed(3),
    speed: (v) => Number(v).toFixed(1) + '×',
    /* 155일 이라고만 쓰면 언제인지 감이 안 온다. 월/일로 환산한다(윤년 무시). */
    peri: (v) => {
      const md = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      let d = Number(v), m = 0;
      while (d > md[m]) { d -= md[m]; m++; }
      return (m + 1) + '월 ' + d + '일';
    }
  };
  ['tilt', 'ecc', 'speed', 'peri'].forEach((k) => {
    const input = el(k);
    input.addEventListener('input', () => {
      S[k] = Number(input.value);
      el(k + '-out').textContent = labels[k](input.value);
      readout();
    });
  });

  // 기울기 빠른 선택 — 0도를 눌러보게 유도하는 게 목적이다
  document.querySelectorAll('.preset-row button').forEach((b) => {
    b.addEventListener('click', () => {
      const v = Number(b.dataset.tilt);
      S.tilt = v;
      el('tilt').value = v;
      el('tilt-out').textContent = labels.tilt(v);
      readout();
    });
  });

  el('toggle').addEventListener('click', () => {
    running = !running;
    el('toggle').textContent = running ? '일시정지' : '이어서';
  });
  el('reset').addEventListener('click', () => { dayOfYear = 80; readout(); });

  // ── 공유 ──
  el('share').addEventListener('click', async () => {
    const said = el('share-said');
    try {
      const me = await Session.refresh();
      if (!me) { said.textContent = '로그인이 필요합니다.'; return; }
      /* speed 도 함께 싣는다. 날짜만 넘기면 링크를 연 순간부터 시간이 흘러
         내가 보여주려던 날이 아니게 된다. */
      const q = new URLSearchParams({
        tilt: S.tilt, ecc: S.ecc, city: S.city,
        day: Math.round(dayOfYear), speed: S.speed, peri: S.peri
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
    ['tilt', 'ecc', 'speed', 'peri'].forEach((k) => {
      const v = Number(q.get(k));
      if (q.get(k) === null || !Number.isFinite(v)) return;
      const input = el(k);
      const c = Math.max(Number(input.min), Math.min(Number(input.max), v));
      S[k] = c; input.value = c;
      el(k + '-out').textContent = labels[k](c);
    });
    const c = q.get('city');
    if (CITIES.some((x) => x.id === c)) {
      S.city = c;
      [...cityBox.children].forEach((b, i) => b.setAttribute('aria-pressed', String(CITIES[i].id === c)));
    }
    const d = Number(q.get('day'));
    if (Number.isFinite(d) && d >= 1 && d <= 365) dayOfYear = d;
    // 속도가 0이면 멈춘 상태로 연다. 버튼 표시도 맞춰준다.
    if (S.speed === 0) { running = false; el('toggle').textContent = '이어서'; }
  }

  // ── 루프 ──
  let last = 0;
  function frame(ts) {
    const now = ts / 1000;
    if (!last) last = now;
    // 탭을 숨겼다 돌아오면 밀린 시간이 한꺼번에 들어온다
    const dt = Math.min(0.25, now - last);
    last = now;
    if (running) {
      // 한 바퀴에 약 18초 — 계절 변화를 따라갈 수 있는 속도
      dayOfYear += dt * 20 * S.speed;
      if (dayOfYear > 365) dayOfYear -= 365;
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
