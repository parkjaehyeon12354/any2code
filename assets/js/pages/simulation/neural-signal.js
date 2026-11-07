(function () {
  const el = (id) => document.getElementById(id);

  /* ── 신경과 자극전달: 세게 누르면 신호도 셀까 ──

     설계는 Solar 4 Pro, 계산 로직은 Kimi K3, 검증은 직접 했다.

     ⚠ Solar 설계는 못 썼다. 빈도 공식이 f = 1000/t_ref 라 자극 세기가
        아예 안 들어가서, 세기를 올려도 빈도가 안 변했다. 오개념을 깨야 하는
        화면인데 정작 결정적 슬라이더가 아무 일도 안 하는 셈이다.
        (검증표 2·3번도 4번과 같은 공식인데 답이 달라 내적 모순이었다.)
        표준 leaky integrate-and-fire 로 바꿨다.

     ⚠ K3 코드에서 교착 버그를 잡았다. 불응기가 끝나는 순간 refLeft 가
        정확히 0 이 아니라 3.55e-15 로 남아, 시간이 0 만큼만 흐르며
        영원히 도는 상태가 됐다(t=34.47 에서 멈춤). 임계값 비교로 고쳤다.

     확인한 값(tref=5): 61%→21.7Hz / 70%→40.9Hz / 90%→62.6Hz / 100%→70.6Hz
                        60% 이하는 0Hz. 진폭은 언제나 100mV. */

  const TAU = 10.0, ITH = 60;
  /* VTH0 는 "자극 세기 → 탈분극량" 환산의 기준값이지 역치가 아니다.
     역치(S.vth)를 이 자리에 쓰면 drive = S.vth*I/ITH 가 되어 S.vth 가 약분돼
     사라진다 — 역치를 올려도 충전 시간이 똑같은 이상한 화면이 된다.
     자극이 만드는 탈분극은 역치와 무관해야 한다. */
  const VTH0 = 15.0;
  const V_REST = -70, V_PEAK = 30;

  // ---------------------------------------------------------------
  // 역치까지 차오르는 시간(ms)
  //  - RC 막이 평형전위 drive 를 향해 지수 충전될 때, v=0 → VTH 도달 시간의 해석해
  //  - I <= ITH 이면 평형전위 자체가 역치 이하라 영원히 못 넘음 → Infinity
  //    (수식상으로도 1 - VTH/drive <= 0 이 되어 log 가 발산하므로 물리와 일치)
  // ---------------------------------------------------------------
  function chargeTime(I) {
    if (I <= ITH) return Infinity;
    var drive = VTH0 * I / ITH;              // 자극 세기에 비례하는 목표(평형) 탈분극량
    return -TAU * Math.log(1 - S.vth / drive);
  }

  // ---------------------------------------------------------------
  // 발화 빈도(Hz) = 1000 / (충전시간 + 불응기)
  //  - 이 시뮬레이션의 교육적 핵심: "세기 → 진폭"이 아니라 "세기 → 빈도" 부호화
  // ---------------------------------------------------------------
  function fireRate(I, tref) {
    var tc = chargeTime(I);
    if (!isFinite(tc)) return 0;            // 역치 미달 → 발화 없음
    return 1000 / (tc + tref);
  }

  // 구간 보간용. 끝점 전위는 명세(-70/+30/-80/-70)와 정확히 같고,
  // 중간 모양만 부드럽게 하기 위한 smoothstep. 순수 선형이 좋으면 smooth01(u) → u 로 교체.
  function smooth01(u) { return u * u * (3 - 2 * u); }

  // ---------------------------------------------------------------
  // 스파이크 파형 — 실무율(all-or-none) 시연의 핵심
  //  - 자극 세기 인자를 아예 받지 않는다: 진폭은 언제나 100mV(-70→+30)로 고정
  //  - age: 스파이크 시작 후 경과 시간(ms)
  // ---------------------------------------------------------------
  function spikeVoltage(age) {
    var V_HYPER = -80;                      // 과분극 바닥
    if (age < 0) return V_REST;
    if (age < 1) {                          // 0~1ms: 급상승 (-70 → +30)
      return V_REST + (V_PEAK - V_REST) * smooth01(age);
    }
    if (age < 3) {                          // 1~3ms: 하강 (+30 → -80)
      var u1 = smooth01((age - 1) / 2);
      return V_PEAK + (V_HYPER - V_PEAK) * u1;
    }
    if (age < 5) {                          // 3~5ms: 회복 (-80 → -70)
      var u2 = smooth01((age - 3) / 2);
      return V_HYPER + (V_REST - V_HYPER) * u2;
    }
    return V_REST;                          // 5ms 이후: 휴지전위
  }

  // ---------------------------------------------------------------
  // 시뮬레이션을 dt(ms) 만큼 진행
  //  state = { t, lastSpike, spikes, phase, v }
  //    phase: 'rest' | 'subthreshold' | 'charging' | 'refractory'
  //    v    : 충전량 = 휴지전위 대비 탈분극(mV), 0~VTH (없어도 0으로 자동 보정)
  //
  //  왜 v 를 상태로 저장하나?
  //    시뮬레이션 도중 자극 I 가 바뀌어도 "지금까지 차오른 양"을 이어서
  //    계산하기 위해. lastSpike 시각만으로는 I 변경 시 충전 진행을 표현 못 함.
  //
  //  반환: 이번 구간에 새로 발생한 스파이크 시각들의 배열
  // ---------------------------------------------------------------
  function advance(state, I, tref, dt) {
    var fired = [];
    if (!state.spikes) state.spikes = [];
    if (typeof state.v !== 'number') state.v = 0;

    var remaining = dt;
    var guard = 0;                          // 비정상 입력(tref=0 + 초강자극) 시 무한루프 방지

    while (remaining > 1e-9 && guard++ < 100000) {

      // 1) 불응기: 자극이 아무리 세도 충전 정지. 시간만 흘려 보낸다.
      //    (맨 앞에 두어야 "불응기 최우선" 규칙이 어떤 자극보다 먼저 적용됨)
      var refLeft = 0;
      if (state.lastSpike != null) {
        refLeft = tref - (state.t - state.lastSpike);
        if (refLeft < 0) refLeft = 0;
      }
      /* ⚠ refLeft > 0 만 보면 교착에 빠진다.
         불응기가 끝나는 순간 refLeft 가 정확히 0 이 아니라 3.55e-15 같은
         부동소수점 잔여값으로 남는데, 그러면 아래 분기로 들어가 시간이
         사실상 0 만큼 흐르고, remaining 은 1e-9 위라 루프가 영원히 돈다.
         실제로 t=34.47 에서 시간이 완전히 멈췄다.
         루프 탈출 임계값(1e-9)보다 큰 값일 때만 불응기로 취급한다. */
      if (refLeft > 1e-9) {
        var step = Math.min(remaining, refLeft);
        state.t += step;
        remaining -= step;
        state.v = 0;                        // 불응기 동안 충전량은 리셋 유지
        state.phase = 'refractory';
        continue;
      }

      // 2) 역치 미달: 평형전위를 향해 지수 접근할 뿐, drive <= VTH 라서
      //    절대 역치에 닿지 않음 → 발화 없음.
      //    I = ITH 일 때도 VTH 에 '점근'할 뿐이라 발화 안 함
      //    → chargeTime(ITH) = Infinity 와 정확히 대응됨
      if (I <= ITH) {
        var driveSub = (I > 0) ? VTH0 * I / ITH : 0;
        state.v = driveSub + (state.v - driveSub) * Math.exp(-remaining / TAU);
        state.t += remaining;
        remaining = 0;
        state.phase = (I > 0) ? 'subthreshold' : 'rest';
        continue;
      }

      // 3) 역치 이상: VTH 도달 시각을 해석적으로 계산 (정확하고 루프 불필요)
      var drive = VTH0 * I / ITH;
      var tToFire;
      if (state.v >= S.vth) {
        tToFire = 0;                        // 부동소수점 경계에서 이미 도달한 드문 경우
      } else {
        // v(t) = drive + (v0 - drive)·e^(-t/TAU) = VTH 를 t 에 대해 푼 식
        tToFire = -TAU * Math.log((S.vth - drive) / (state.v - drive));
      }

      if (tToFire >= remaining) {
        // 3-a) 이번 구간 내 발화 없음 → 남은 시간만큼만 충전
        state.v = drive + (state.v - drive) * Math.exp(-remaining / TAU);
        state.t += remaining;
        remaining = 0;
        state.phase = 'charging';
      } else {
        // 3-b) 구간 도중 발화 → 그 시각까지 진행, 기록 후 리셋
        state.t += tToFire;
        remaining -= tToFire;
        state.lastSpike = state.t;
        state.spikes.push(state.t);
        fired.push(state.t);
        state.v = 0;                        // 발화 후 충전량 리셋
                                            // (파형 자체는 spikeVoltage 가 담당)
        state.phase = 'refractory';
        // continue → 다음 반복에서 불응기 소진 → 재충전 → 재발화 자동 반복
      }
    }

    return fired;
  }

  // ---------------------------------------------------------------
  // (보조) 화면 표시용 막전위(mV)
  //  - 스파이크 직후 5ms: spikeVoltage 파형
  //  - 그 외: 휴지전위 + 충전량 → 역치미달 시 역치 근처까지 올라가다
  //    멈추는 모습이 여기서 그대로 드러남
  // ---------------------------------------------------------------
  function displayVoltage(state) {
    if (state.lastSpike != null) {
      var age = state.t - state.lastSpike;
      if (age < 5) return spikeVoltage(age);
    }
    return V_REST + (state.v || 0);
  }

  const S = { stim: 80, tref: 5, myelin: 1, vth: 15 };
  let running = true;
  let sim = { t: 0, lastSpike: null, spikes: [], phase: 'rest', v: 0 };
  let trace = [];                  // 화면에 흐르는 막전위 기록
  let totalSpikes = 0;
  let travellers = [];             // 축삭을 따라가는 신호

  const canvas = el('canvas');
  const ctx = canvas.getContext('2d');
  const graph = el('response-graph');
  const gctx = graph.getContext('2d');
  let DPR = 1;

  const conduction = () => (S.myelin ? 100 : 1);   // m/s

  function reset() {
    sim = { t: 0, lastSpike: null, spikes: [], phase: 'rest', v: 0 };
    trace = []; totalSpikes = 0; travellers = [];
  }

  // ── 무대: 위는 막전위 파형, 아래는 축삭 ──
  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const w = canvas.width / DPR, h = canvas.height / DPR;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#141a20';
    ctx.fillRect(0, 0, w, h);

    const pad = 16;
    const traceH = h * 0.6;
    const axonY = traceH + (h - traceH) / 2 + 6;

    // 전위 → 픽셀
    const VMIN = -90, VMAX = 40;
    const Y = (v) => pad + 14 + (VMAX - v) / (VMAX - VMIN) * (traceH - pad - 30);

    // 역치선과 휴지선
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255,209,102,.65)';
    ctx.lineWidth = 1.4;
    // 역치선은 슬라이더를 따라와야 한다. -55 로 박아 두면 역치를 올려도 선이 그대로다
    const vthMv = V_REST + S.vth;
    ctx.beginPath(); ctx.moveTo(pad, Y(vthMv)); ctx.lineTo(w - pad, Y(vthMv)); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.22)';
    ctx.beginPath(); ctx.moveTo(pad, Y(-70)); ctx.lineTo(w - pad, Y(-70)); ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = '10.5px ui-sans-serif, system-ui';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,209,102,.9)';
    ctx.fillText('역치 −55mV', pad + 4, Y(-55) - 5);
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.fillText('휴지 −70mV', pad + 4, Y(-70) + 13);
    ctx.fillText('+30mV', pad + 4, Y(30) + 4);

    // 막전위 파형
    if (trace.length > 1) {
      const tw = w - pad * 2;
      ctx.beginPath();
      trace.forEach((pt, i) => {
        const x = pad + (i / (trace.length - 1)) * tw;
        i ? ctx.lineTo(x, Y(pt.v)) : ctx.moveTo(x, Y(pt.v));
      });
      ctx.strokeStyle = '#7bdff2';
      ctx.lineWidth = 2;
      ctx.stroke();

      // 봉우리에 점 — 높이가 전부 같다는 걸 보여준다
      trace.forEach((pt, i) => {
        if (!pt.peak) return;
        const x = pad + (i / (trace.length - 1)) * tw;
        ctx.fillStyle = '#e63946';
        ctx.beginPath(); ctx.arc(x, Y(30), 3.4, 0, Math.PI * 2); ctx.fill();
      });
    }

    // 불응기 표시
    if (sim.phase === 'refractory') {
      ctx.fillStyle = 'rgba(138,143,152,.2)';
      ctx.fillRect(w - pad - 90, pad + 10, 86, 20);
      ctx.fillStyle = '#c9ccd2';
      ctx.font = '600 11px ui-sans-serif, system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('불응기 — 못 함', w - pad - 47, pad + 24);
    }

    // 축삭
    const ax0 = pad + 70, ax1 = w - pad - 20;
    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.lineWidth = 13;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(ax0, axonY); ctx.lineTo(ax1, axonY); ctx.stroke();

    if (S.myelin) {
      // 수초 — 마디 사이를 감싼 절연층
      const segs = 7;
      for (let i = 0; i < segs; i++) {
        const a = ax0 + (ax1 - ax0) * (i + 0.08) / segs;
        const b = ax0 + (ax1 - ax0) * (i + 0.92) / segs;
        ctx.strokeStyle = 'rgba(244,162,97,.4)';
        ctx.lineWidth = 19;
        ctx.beginPath(); ctx.moveTo(a, axonY); ctx.lineTo(b, axonY); ctx.stroke();
      }
    }

    // 세포체
    ctx.fillStyle = 'rgba(123,223,242,.3)';
    ctx.beginPath(); ctx.arc(ax0 - 26, axonY, 17, 0, Math.PI * 2); ctx.fill();

    // 신호
    travellers.forEach((tr) => {
      const x = ax0 + tr.pos * (ax1 - ax0);
      ctx.fillStyle = '#e63946';
      ctx.beginPath(); ctx.arc(x, axonY, 6.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(230,57,70,.28)';
      ctx.beginPath(); ctx.arc(x, axonY, 12, 0, Math.PI * 2); ctx.fill();
    });

    ctx.font = '11px ui-sans-serif, system-ui';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.fillText(S.myelin ? '수초 있음 — 마디를 건너뜀 (약 100 m/s)'
                          : '수초 없음 — 한 칸씩 (약 1 m/s)', pad, h - 8);

    ctx.textAlign = 'right';
    if (S.stim <= 60) {
      ctx.fillStyle = '#ffb4a2';
      ctx.font = '600 12px ui-sans-serif, system-ui';
      ctx.fillText('역치 미달 — 막전위만 오르다 멈춥니다', w - pad, h - 8);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,.5)';
      ctx.fillText(`${fireRate(S.stim, S.tref).toFixed(1)} Hz`, w - pad, h - 8);
    }
  }

  // ── 그래프: 세기 → 크기·빈도 ──
  function drawGraph() {
    /* 캔버스는 CSS 를 못 받으니 색을 여기서 받아온다. 예전에는 '#f7f7f5' 를
       박아 놔서 다크 모드에서도 하얀 박스가 그대로 떠 있었다. */
    const P = window.GraphTheme.palette();
    gctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const w = graph.width / DPR, h = graph.height / DPR;
    gctx.clearRect(0, 0, w, h);
    gctx.fillStyle = P.bg;
    gctx.fillRect(0, 0, w, h);

    const pad = { l: 62, r: 62, t: 26, b: 44 };
    const gw = w - pad.l - pad.r, gh = h - pad.t - pad.b;

    let maxF = 0;
    for (let I = 0; I <= 100; I++) maxF = Math.max(maxF, fireRate(I, S.tref));
    maxF = Math.max(10, maxF * 1.15);

    const X = (I) => pad.l + I / 100 * gw;
    const YA = (a) => pad.t + gh - a / 120 * gh;       // 왼쪽축: 크기 mV
    const YF = (f) => pad.t + gh - f / maxF * gh;      // 오른쪽축: 빈도 Hz

    gctx.strokeStyle = P.grid;
    gctx.lineWidth = 1;
    gctx.font = '11px ui-sans-serif, system-ui';
    gctx.fillStyle = P.muted;
    gctx.textAlign = 'center';
    for (let I = 0; I <= 100; I += 20) {
      gctx.beginPath(); gctx.moveTo(X(I), pad.t); gctx.lineTo(X(I), pad.t + gh); gctx.stroke();
      gctx.fillText(I + '%', X(I), h - 20);
    }
    gctx.fillText('자극 세기', pad.l + gw / 2, h - 5);

    gctx.textAlign = 'right';
    gctx.fillStyle = '#c0392b';
    for (let a = 0; a <= 120; a += 30) gctx.fillText(a, pad.l - 8, YA(a) + 4);
    gctx.save();
    gctx.translate(16, pad.t + gh / 2); gctx.rotate(-Math.PI / 2);
    gctx.textAlign = 'center'; gctx.fillText('봉우리 높이 (mV)', 0, 0);
    gctx.restore();

    gctx.textAlign = 'left';
    gctx.fillStyle = '#1d7870';
    for (let i = 0; i <= 4; i++) gctx.fillText((maxF * i / 4).toFixed(0), pad.l + gw + 8, YF(maxF * i / 4) + 4);
    gctx.save();
    gctx.translate(w - 14, pad.t + gh / 2); gctx.rotate(Math.PI / 2);
    gctx.textAlign = 'center'; gctx.fillText('1초당 횟수 (Hz)', 0, 0);
    gctx.restore();

    // 역치
    gctx.setLineDash([4, 4]);
    gctx.strokeStyle = 'rgba(217,119,6,.7)'; gctx.lineWidth = 1.6;
    gctx.beginPath(); gctx.moveTo(X(60), pad.t); gctx.lineTo(X(60), pad.t + gh); gctx.stroke();
    gctx.setLineDash([]);
    gctx.fillStyle = '#8a5c08';
    gctx.font = '600 11px ui-sans-serif, system-ui';
    gctx.textAlign = 'left';
    gctx.fillText('역치 60%', X(60) + 5, pad.t + 13);

    // 봉우리 높이 — 계단처럼 평평
    gctx.beginPath();
    gctx.moveTo(X(0), YA(0)); gctx.lineTo(X(60), YA(0));
    gctx.moveTo(X(60), YA(100)); gctx.lineTo(X(100), YA(100));
    gctx.strokeStyle = '#c0392b'; gctx.lineWidth = 3.4; gctx.stroke();
    gctx.setLineDash([3, 3]);
    gctx.beginPath(); gctx.moveTo(X(60), YA(0)); gctx.lineTo(X(60), YA(100));
    gctx.strokeStyle = 'rgba(192,57,43,.45)'; gctx.lineWidth = 2; gctx.stroke();
    gctx.setLineDash([]);

    // 빈도 — 계속 오름
    gctx.beginPath();
    let started = false;
    for (let I = 0; I <= 100; I += 0.5) {
      const f = fireRate(I, S.tref);
      if (f <= 0) continue;
      const xx = X(I), yy = YF(f);
      started ? gctx.lineTo(xx, yy) : (gctx.moveTo(xx, yy), started = true);
    }
    gctx.strokeStyle = '#1d7870'; gctx.lineWidth = 3; gctx.stroke();

    // 현재 위치
    if (S.stim > 60) {
      gctx.beginPath(); gctx.arc(X(S.stim), YF(fireRate(S.stim, S.tref)), 6, 0, Math.PI * 2);
      gctx.fillStyle = P.ink; gctx.fill();
      gctx.strokeStyle = P.bg; gctx.lineWidth = 2.2; gctx.stroke();
      gctx.beginPath(); gctx.arc(X(S.stim), YA(100), 6, 0, Math.PI * 2);
      gctx.fillStyle = P.ink; gctx.fill();
      gctx.strokeStyle = P.bg; gctx.lineWidth = 2.2; gctx.stroke();
    }

    /* 범례는 왼쪽 아래에 둔다. 오른쪽 위에 두면 빈도 곡선이 그쪽으로
       올라와 글자와 겹친다(좁은 화면에서 특히). */
    gctx.font = '600 11.5px ui-sans-serif, system-ui';
    gctx.textAlign = 'left';
    gctx.fillStyle = '#c0392b';
    gctx.fillText('— 봉우리 높이: 평평합니다', pad.l + 8, pad.t + gh - 26);
    gctx.fillStyle = '#1d7870';
    gctx.fillText('— 1초당 횟수: 계속 오릅니다', pad.l + 8, pad.t + gh - 9);
  }

  // ── 수치 ──
  function readout() {
    const f = fireRate(S.stim, S.tref);
    const c = chargeTime(S.stim);
    const fires = S.stim > 60;

    el('r-amp').textContent = fires ? '100 mV (−70 → +30)' : '없음';
    el('r-freq').textContent = fires ? f.toFixed(1) + ' Hz' : '0 Hz';
    el('r-charge').textContent = isFinite(c) ? c.toFixed(2) + ' ms' : '영영 못 닿음';
    el('lg-vth').textContent = (V_REST + S.vth).toString().replace('-', '−');
    el('r-speed').textContent = conduction() + ' m/s';
    el('r-count').textContent = totalSpikes.toLocaleString() + ' 번';

    el('s-amp').textContent = fires ? '100 mV' : '—';
    el('s-freq').textContent = fires ? f.toFixed(1) + ' Hz' : '0 Hz';

    const v = el('verdict');
    if (!fires) {
      v.className = 'verdict warn';
      v.innerHTML = `자극이 <strong>${S.stim}%</strong> 라 역치(60%)에 못 미칩니다. ` +
        '막전위가 <strong>역치 근처까지 오르다 멈출 뿐</strong>, 활동전위는 하나도 안 생깁니다. ' +
        '<strong>약한 자극은 작은 신호를 보내는 게 아니라, 아예 안 보냅니다.</strong>';
    } else {
      const f60 = fireRate(61, S.tref);
      v.className = 'verdict';
      v.innerHTML = `봉우리 높이는 <strong>100 mV</strong> — 세기를 아무리 올려도 ` +
        `<strong>1 mV 도 안 변합니다.</strong> 바뀌는 건 횟수뿐이라, ` +
        `겨우 역치를 넘은 61%에서 <strong>${f60.toFixed(1)}Hz</strong> 이던 것이 ` +
        `지금 <strong>${f.toFixed(1)}Hz</strong> 입니다.`;
    }

    el('note').textContent =
      `역치까지 ${isFinite(c) ? c.toFixed(2) + 'ms' : '∞'} + 불응기 ${S.tref}ms = ` +
      `한 번에 ${isFinite(c) ? (c + S.tref).toFixed(2) + 'ms' : '—'}. ` +
      `불응기가 ${S.tref}ms 이므로 이론상 1초에 ${(1000 / S.tref).toFixed(0)}번이 한계입니다.`;
  }

  // ── 입력 ──
  const labels = {
    stim: (v) => Number(v) + ' %',
    tref: (v) => Number(v) + ' ms',
    myelin: (v) => (Number(v) ? '있음' : '없음'),
    // 탈분극량만 보이면 -55mV 라는 교과서 값과 연결이 안 된다
    vth: (v) => (V_REST + Number(v)) + ' mV (탈분극 ' + Number(v) + ')'
  };
  ['stim', 'tref', 'myelin', 'vth'].forEach((k) => {
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
      S.stim = Number(b.dataset.s); S.tref = Number(b.dataset.t); S.myelin = Number(b.dataset.m);
      ['stim', 'tref', 'myelin', 'vth'].forEach((k) => {
        el(k).value = S[k]; el(k + '-out').textContent = labels[k](S[k]);
      });
      syncPresets(); readout();
    });
  });
  function syncPresets() {
    presetBox.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', String(
        Number(b.dataset.s) === S.stim &&
        Number(b.dataset.t) === S.tref &&
        Number(b.dataset.m) === S.myelin));
    });
  }

  el('toggle').addEventListener('click', () => {
    running = !running;
    el('toggle').textContent = running ? '일시정지' : '이어서';
  });
  el('reset').addEventListener('click', () => {
    S.stim = 80; S.tref = 5; S.myelin = 1;
    ['stim', 'tref', 'myelin', 'vth'].forEach((k) => {
      el(k).value = S[k]; el(k + '-out').textContent = labels[k](S[k]);
    });
    reset(); syncPresets(); readout();
  });

  el('share').addEventListener('click', async () => {
    const said = el('share-said');
    try {
      const me = await Session.refresh();
      if (!me) { said.textContent = '로그인이 필요합니다.'; return; }
      const q = new URLSearchParams({ s: S.stim, t: S.tref, m: S.myelin, v: S.vth });
      const url = location.origin + location.pathname + '?' + q;
      const b = el('share-url');
      b.value = url; b.hidden = false; b.select();
      try { await navigator.clipboard.writeText(url); said.textContent = '복사했습니다.'; }
      catch { said.textContent = '주소를 복사해 주세요.'; }
    } catch { said.textContent = '잠시 후 다시 시도해 주세요.'; }
  });

  function applyQuery() {
    const q = new URLSearchParams(location.search);
    const map = { s: 'stim', t: 'tref', m: 'myelin', v: 'vth' };
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

  const TRACE_MS = 220;      // 화면에 보이는 시간 폭
  let last = 0;
  function frame(ts) {
    const now = ts / 1000;
    if (!last) last = now;
    const dt = Math.min(0.05, now - last);
    last = now;

    if (running) {
      // 실제 ms 단위로 진행. 화면은 느리게 보여야 하니 배속을 낮춘다.
      const stepMs = dt * 1000 * 0.35;
      const fired = advance(sim, S.stim, S.tref, stepMs);
      totalSpikes += fired.length;
      fired.forEach(() => travellers.push({ pos: 0 }));

      trace.push({ v: displayVoltage(sim), peak: fired.length > 0 });
      const maxPts = Math.round(TRACE_MS / 0.6);
      if (trace.length > maxPts) trace.splice(0, trace.length - maxPts);

      const sp = S.myelin ? 1.9 : 0.34;
      travellers.forEach((t) => { t.pos += sp * dt; });
      travellers = travellers.filter((t) => t.pos <= 1);

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
  reset();
  syncPresets();
  readout();
  resize();
  window.GraphTheme.onChange(drawGraph);   // 밝기 모드가 바뀌면 새 팔레트로 다시 그린다
  window.addEventListener('resize', resize);
  requestAnimationFrame(frame);
})();
