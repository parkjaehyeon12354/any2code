/* 파티클 구 — Index/로그인 공용.
   <canvas data-sphere> 를 두면 그 부모 요소를 무대로 삼는다.
   조절 값(전부 선택): data-count, data-alpha, data-scale, data-clear */
(function () {
  const cvs = document.querySelector('canvas[data-sphere]');
  if (!cvs) return;

  const stage = cvs.parentElement;
  const ctx = cvs.getContext('2d');

  const COUNT = +cvs.dataset.count || 1400;
  const ALPHA = +cvs.dataset.alpha || 1;      // 전체 농도 배율
  const CLEAR = +cvs.dataset.clear || 0.38;   // 중앙 몇 %를 비울지 (글자 가독성)

  let w, h, R;
  // 마우스는 -1~1로 정규화해서 구를 살짝 기울이는 데만 쓴다 (끌고 다니지 않음)
  let pointerX = 0, pointerY = 0, tiltX = 0, tiltY = 0, spin = 0;
  // 마우스가 떠날 때 tiltX를 흡수해 두는 영구 기울기. 이게 없으면 원위치로 튕긴다
  let tiltKeep = 0;

  // 가중 팔레트. 균등 배분하면 색종이가 된다 — 어두운 질량 69%가 구조를 잡고
  // 브랜드 악센트 28%가 드물게 튄다. 숫자는 전체 중 비율(%).
  const WEIGHTS = [
    ['#1b2340', 40],  // 딥 네이비 — 기본 질량
    ['#232c52', 16],  // 네이비 라이트
    ['#3d3d3a', 13],  // 웜 그레이 — 크림 팔레트로 이어주는 다리
    ['#2f4bd6',  9],  // 블루
    ['#cc785c',  8],  // 코랄 — 브랜드 프라이머리, CTA와 같은 색
    ['#5db8a6',  6],  // 틸 — 로고 플라스크와 같은 색
    ['#e8a55a',  5],  // 앰버
    ['#8a93b8',  3],  // 라이트 블루그레이 — 가장 먼 안개
  ];
  const PALETTE = WEIGHTS.flatMap(([c, n]) => Array(n).fill(c));
  // 채도 있는 색은 크림 배경에서 묻히므로 알파를 올려줘야 색으로 읽힌다
  const ACCENTS = new Set(['#2f4bd6', '#cc785c', '#5db8a6', '#e8a55a']);
  const FOV = 2.8;       // 원근 강도. 낮을수록 앞뒤 크기차가 커진다
  const TILT = -0.32;    // 구를 살짝 위에서 내려다보는 기본 기울기
  const points = [];

  function resize() {
    const r = stage.getBoundingClientRect();
    w = r.width;
    h = r.height;
    cvs.width = w * devicePixelRatio;
    cvs.height = h * devicePixelRatio;
    cvs.style.width = w + 'px';
    cvs.style.height = h + 'px';
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    // 투영 반지름은 약 1.07R. 폭 기준으로는 림이 보이고, 높이 기준으로는
    // 위아래로 흘러넘치게 — 원형이 읽히면서 화면은 꽉 찬다
    R = Math.min(w * 0.42, h * 0.72);
  }

  function init() {
    points.length = 0;
    // 피보나치 구면 — 표면에 균등 분포. '껍데기'라서 2D로 투영하면
    // 림(가장자리)이 촘촘하고 중앙이 성기다. 글자 자리가 저절로 비는 구조.
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < COUNT; i++) {
      const y = 1 - (i / (COUNT - 1)) * 2;
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      const th = golden * i;
      const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
      points.push({
        x: Math.cos(th) * ring,
        y: y,
        z: Math.sin(th) * ring,
        size: Math.random() * 1.2 + 0.9,
        color: color,
        alpha: Math.min(0.85, (Math.random() * 0.35 + 0.25) * (ACCENTS.has(color) ? 1.35 : 1)) * ALPHA
      });
    }
    resize();
  }

  function paint() {
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;

    tiltY += (pointerX * 0.28 - tiltY) * 0.05;
    tiltX += (pointerY * 0.18 - tiltX) * 0.05;

    const cosS = Math.cos(spin + tiltY), sinS = Math.sin(spin + tiltY);
    const cosT = Math.cos(TILT + tiltKeep + tiltX), sinT = Math.sin(TILT + tiltKeep + tiltX);

    for (const p of points) {
      // Y축 회전 → X축 기울임
      const x1 = p.x * cosS - p.z * sinS;
      const z1 = p.x * sinS + p.z * cosS;
      const y2 = p.y * cosT - z1 * sinT;
      const z2 = p.y * sinT + z1 * cosT;

      const persp = FOV / (FOV + z2);
      const sx = cx + x1 * R * persp;
      const sy = cy + y2 * R * persp;

      // 뒤쪽(z2<0)일수록 어둡고 작게 — 이게 구로 읽히게 만든다
      const depth = (z2 + 1) / 2;
      // 중앙은 추가로 페이드. 글자 가독성 확보용
      const clear = Math.min(1, Math.hypot(sx - cx, sy - cy) / (R * CLEAR));

      ctx.globalAlpha = p.alpha * (0.25 + depth * 0.75) * clear;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(sx, sy, p.size * persp, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    spin += 0.0009;   // 한 바퀴 약 2분
    paint();
    requestAnimationFrame(draw);
  }

  stage.addEventListener('mousemove', function (e) {
    const r = stage.getBoundingClientRect();
    pointerX = (e.clientX - r.left) / r.width * 2 - 1;
    pointerY = (e.clientY - r.top) / r.height * 2 - 1;
  });

  stage.addEventListener('mouseleave', function () {
    // 지금 기울어진 만큼을 영구 상태로 흡수한다. spin+tiltY 와 TILT+tiltKeep+tiltX 의
    // 합이 그대로 보존되므로 튀지 않고, 그 자리에서 자동 회전만 이어진다.
    spin += tiltY;
    tiltKeep = Math.max(-0.45, Math.min(0.45, tiltKeep + tiltX));  // 뒤집히지 않게 제한
    tiltX = tiltY = 0;
    pointerX = pointerY = 0;
  });

  const still = matchMedia('(prefers-reduced-motion: reduce)');

  window.addEventListener('resize', function () {
    resize();
    if (still.matches) paint();
  });

  init();
  // 모션 최소화 설정이면 정지된 한 프레임만 그린다
  if (still.matches) paint(); else draw();
})();
