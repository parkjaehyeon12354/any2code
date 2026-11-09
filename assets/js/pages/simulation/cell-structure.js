(function () {
  const el = (id) => document.getElementById(id);

  /* ── 세포의 구조 ──

     교과서 그림에 이름표만 붙이면 위치만 외우게 된다. 여기서는 소기관을
     눌러 확대하고, 각자 '일하는 모습' 을 움직임으로 보여준다.

     좌표는 0~1 비율로 둔다. 화면 크기가 달라져도 배치가 유지된다. */
  const ORGANELLES = [
    { id: 'nucleus', name: '핵', color: '#8fb8ff', x: .40, y: .44, r: .155, plant: false,
      job: 'DNA 를 보관하고, 필요한 정보만 RNA 로 복사해 내보냅니다.',
      why: '화학 반응이 활발한 세포질에서 DNA 를 떼어놓아야 손상을 줄일 수 있습니다.' },
    { id: 'mito', name: '미토콘드리아', color: '#ff8f6b', x: .70, y: .34, r: .085, plant: false,
      job: '세포 호흡으로 ATP(에너지)를 만듭니다. "세포의 발전소" 라고 부릅니다.',
      why: '이중막입니다. 안쪽 막을 사이에 둔 수소 이온의 전기화학 기울기로 ATP 를 만들기 때문입니다. 포도당을 쪼개는 첫 단계(해당 과정)는 세포질에서 일어나고, 미토콘드리아는 그 산물을 받아 씁니다.' },
    { id: 'er', name: '소포체', color: '#9ce8a0', x: .52, y: .66, r: .105, plant: false,
      job: '리보솜이 붙은 거친면소포체는 단백질을 가공·운반하고, 리보솜이 없는 매끈면소포체는 지질을 만듭니다.',
      why: '핵에서 나온 mRNA 를 리보솜이 읽어 만든 단백질을 곧바로 실어 나르려고 핵 가까이 붙어 있습니다.' },
    { id: 'golgi', name: '골지체', color: '#ffd166', x: .26, y: .68, r: .08, plant: false,
      job: '소포체가 만든 단백질을 다듬어 포장하고, 갈 곳으로 보냅니다.',
      why: '납작한 주머니가 겹쳐 있습니다. 단계마다 다른 가공을 하려면 칸이 나뉘어야 합니다.' },
    { id: 'lyso', name: '리소좀', color: '#c9a0ff', x: .80, y: .50, r: .05, plant: false,
      job: '낡은 소기관과 외부 물질을 소화합니다. 세포의 재활용 공장입니다.',
      why: '안쪽이 pH 5 의 산성입니다. 막이 없으면 효소가 세포 자신을 소화해 버립니다.' },
    { id: 'ribo', name: '리보솜', color: '#e8e8e8', x: .62, y: .50, r: .028, plant: false,
      job: 'RNA 의 정보를 읽어 단백질을 조립합니다.',
      why: '막이 없는 소기관입니다(중심체·인도 그렇습니다). 원핵세포에도 있어 모든 생물이 공유합니다.' },
    { id: 'membrane', name: '세포막', color: '#7cc4ff', x: .50, y: .50, r: .47, plant: false,
      job: '무엇을 들이고 내보낼지 고릅니다. 세포의 경계입니다.',
      why: '인지질 이중층입니다. 안쪽이 물을 밀어내는 층이라 이온과 물에 녹는 물질이 함부로 못 지나갑니다. 그래서 막단백질이 통로가 되어 무엇을 들일지 고를 수 있습니다(선택적 투과성).' },

    // 식물 세포에만 있는 셋 — 시험에 자주 나오는 부분이다
    { id: 'wall', name: '세포벽', color: '#b8d98a', x: .50, y: .50, r: .49, plant: true,
      job: '셀룰로스로 만든 단단한 껍질입니다. 모양을 유지하고 세포를 보호합니다.',
      why: '식물은 움직이지 않으니 단단해도 됩니다. 동물 세포에 있으면 움직일 수 없습니다.' },
    { id: 'chloro', name: '엽록체', color: '#5fbf6a', x: .24, y: .34, r: .075, plant: true,
      job: '빛으로 포도당을 만듭니다. 광합성이 일어나는 곳입니다.',
      why: '미토콘드리아처럼 이중막이고 자기 DNA 가 있습니다. 세포내공생설의 근거입니다.' },
    { id: 'vacuole', name: '액포', color: '#8fd0ff', x: .74, y: .72, r: .115, plant: true,
      job: '물과 양분을 저장합니다. 자란 식물 세포에서는 부피의 대부분을 차지합니다.',
      why: '물을 채워 팽압을 만듭니다. 물이 빠지면 식물이 시드는 것이 이 때문입니다.' }
  ];

  const S = { kind: 'animal', focus: null };
  let running = true;
  let t = 0;

  const canvas = el('canvas');
  const ctx = canvas.getContext('2d');
  let DPR = 1;
  const W = () => canvas.width / DPR;
  const H = () => canvas.height / DPR;

  const visible = () => ORGANELLES.filter((o) => S.kind === 'plant' || !o.plant);

  // 화면 좌표. 세포가 무대 가운데 오도록 짧은 변을 기준으로 잡는다.
  /* 세포 지름의 기준. 짧은 변을 그대로 쓰면 세포막(r=0.47, 지름 0.94)이
     무대 높이를 거의 다 먹어 위아래가 잘린다. 이름표 자리까지 남겨 0.82 로 줄인다. */
  const unit = () => Math.min(W(), H()) * 0.82;
  const cx = () => W() / 2;
  const cy = () => H() / 2;
  const pos = (o) => ({ x: cx() + (o.x - .5) * unit(), y: cy() + (o.y - .5) * unit(), r: o.r * unit() });

  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W(), H());

    const list = visible();
    // 큰 것부터 그린다. 안 그러면 세포막이 나머지를 덮는다.
    const order = [...list].sort((a, b) => b.r - a.r);

    for (const o of order) {
      const p = pos(o);
      const dim = S.focus && S.focus !== o.id;
      const on = S.focus === o.id;

      ctx.save();
      ctx.globalAlpha = dim ? 0.18 : 1;

      if (o.id === 'wall') {
        /* 세포벽 — 각진 사각형. 식물 세포가 각져 보이는 이유다.

           ⚠ 세포막(원)을 완전히 감싸야 한다. 세로를 눌러 그리면 원보다 작아져
           "벽이 막 안쪽에 있는" 잘못된 그림이 된다. 원의 반지름보다 크게 잡는다. */
        const wr = p.r * 1.02;
        ctx.strokeStyle = o.color;
        ctx.lineWidth = on ? 9 : 6;
        ctx.strokeRect(p.x - wr, p.y - wr, wr * 2, wr * 2);
      } else if (o.id === 'membrane') {
        ctx.strokeStyle = o.color;
        ctx.lineWidth = on ? 5 : 3;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.03)';
        ctx.fill();
      } else if (o.id === 'mito') {
        // 미토콘드리아 — 안쪽 막이 주름진 모양(크리스타)을 그린다
        drawMito(p, o, on);
      } else if (o.id === 'chloro') {
        drawChloro(p, o, on);
      } else if (o.id === 'er') {
        drawER(p, o, on);
      } else if (o.id === 'golgi') {
        drawGolgi(p, o, on);
      } else if (o.id === 'ribo') {
        // 리보솜 — 작은 점이 여럿. 하나만 그리면 무슨 뜻인지 모른다.
        drawRibosomes(p, o, on);
      } else {
        ctx.fillStyle = o.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        if (o.id === 'nucleus') {
          // 핵막 구멍 — 정보가 드나드는 통로
          ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = 'rgba(0,0,0,.3)';
          for (let i = 0; i < 8; i++) {
            const a = i / 8 * Math.PI * 2 + t * .1;
            ctx.beginPath();
            ctx.arc(p.x + Math.cos(a) * p.r, p.y + Math.sin(a) * p.r, 3.5, 0, Math.PI * 2);
            ctx.fill();
          }
          // 인 — 리보솜을 만드는 곳
          ctx.fillStyle = 'rgba(0,0,0,.22)';
          ctx.beginPath(); ctx.arc(p.x - p.r * .25, p.y - p.r * .15, p.r * .3, 0, Math.PI * 2); ctx.fill();
        }
      }

      // 이름표 — 확대 중이 아닐 때만. 다 붙이면 그림이 안 보인다.
      if (!S.focus || on) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = on ? '#ffffff' : 'rgba(255,255,255,.72)';
        ctx.font = on ? '600 14px system-ui' : '12px system-ui';
        ctx.textAlign = 'center';
        /* 이름표 자리. 세포벽과 세포막은 거의 같은 크기라 같은 높이에 두면 겹친다.
           벽은 바깥 위, 막은 안쪽 아래로 떼어놓는다. */
        let ly;
        if (o.id === 'wall') ly = p.y - p.r * 1.02 - 10;
        else if (o.id === 'membrane') ly = p.y + p.r - 12;   // 원 안쪽 — 밖에 두면 세포벽 선에 걸린다
        else if (o.id === 'nucleus') ly = p.y + p.r - 14;   // 핵은 커서 안쪽에 넣어도 읽힌다
        else ly = p.y + p.r + 15;
        ctx.fillText(o.name, p.x, ly);
      }
      ctx.restore();
    }

    ctx.fillStyle = '#9a9a9a';
    ctx.font = '12px system-ui'; ctx.textAlign = 'left';
    ctx.fillText(S.kind === 'plant' ? '식물 세포' : '동물 세포', 14, H() - 14);
  }

  /* 미토콘드리아 — 겉은 타원, 안은 주름(크리스타).
     ATP 를 만드는 중이라는 뜻으로 주름이 천천히 움직인다. */
  function drawMito(p, o, on) {
    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(-0.5);
    ctx.fillStyle = o.color;
    ctx.beginPath(); ctx.ellipse(0, 0, p.r * 1.5, p.r * .85, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = on ? 2.5 : 1.6;
    for (let i = -2; i <= 2; i++) {
      const wob = Math.sin(t * 1.2 + i) * p.r * .08;
      ctx.beginPath();
      ctx.moveTo(i * p.r * .5, -p.r * .78);
      ctx.quadraticCurveTo(i * p.r * .5 + wob, 0, i * p.r * .5, p.r * .78);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* 엽록체 — 안에 틸라코이드(동전 더미)가 보이게 */
  function drawChloro(p, o, on) {
    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(0.4);
    ctx.fillStyle = o.color;
    ctx.beginPath(); ctx.ellipse(0, 0, p.r * 1.5, p.r * .9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(0,60,20,.45)';
    for (let i = -1; i <= 1; i++) {
      for (let j = 0; j < 3; j++) {
        ctx.beginPath();
        ctx.ellipse(i * p.r * .62, (j - 1) * p.r * .28, p.r * .3, p.r * .09, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /* 소포체 — 접힌 막. 리보솜이 붙은 거친면을 표현한다. */
  function drawER(p, o, on) {
    ctx.save();
    ctx.strokeStyle = o.color;
    ctx.lineWidth = on ? 6 : 4;
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      const yy = p.y + (i - 1) * p.r * .42;
      ctx.moveTo(p.x - p.r, yy);
      ctx.bezierCurveTo(p.x - p.r * .3, yy - p.r * .38, p.x + p.r * .3, yy + p.r * .38, p.x + p.r, yy);
      ctx.stroke();
    }
    // 리보솜 알갱이
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(p.x + Math.cos(a) * p.r * .85, p.y + Math.sin(a) * p.r * .5, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /* 골지체 — 납작한 주머니가 겹쳐 있고, 소포가 떨어져 나간다 */
  function drawGolgi(p, o, on) {
    ctx.save();
    ctx.strokeStyle = o.color;
    ctx.lineWidth = on ? 7 : 5;
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const w = p.r * (1 - i * .13);
      ctx.beginPath();
      ctx.moveTo(p.x - w, p.y + (i - 1.5) * p.r * .34);
      ctx.quadraticCurveTo(p.x, p.y + (i - 1.5) * p.r * .34 - p.r * .22, p.x + w, p.y + (i - 1.5) * p.r * .34);
      ctx.stroke();
    }
    // 포장돼 떨어져 나가는 소포 — 골지체가 하는 일을 보여준다
    ctx.fillStyle = o.color;
    for (let i = 0; i < 3; i++) {
      const ph = (t * .5 + i / 3) % 1;
      ctx.globalAlpha = (1 - ph) * (S.focus && S.focus !== o.id ? .18 : .9);
      ctx.beginPath();
      ctx.arc(p.x + p.r * (1.1 + ph * 1.2), p.y + p.r * .6 + ph * p.r * .5, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /* 리보솜 — 세포질에 흩어진 작은 알갱이들 */
  function drawRibosomes(p, o, on) {
    ctx.fillStyle = o.color;
    for (let i = 0; i < 22; i++) {
      // 고정된 난수 — 매 프레임 위치가 바뀌면 어지럽다
      const a = (i * 2.399) % (Math.PI * 2);
      const rr = (0.18 + ((i * 37) % 100) / 100 * 0.24) * unit();
      const jx = Math.sin(t * .4 + i) * 2;
      ctx.beginPath();
      ctx.arc(cx() + Math.cos(a) * rr + jx, cy() + Math.sin(a) * rr, on ? 4 : 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── 비교 그래프 ──
  const graph = el('compare-graph');
  const g = graph.getContext('2d');

  function drawCompare() {
    /* 캔버스는 CSS 를 못 받으니 색을 여기서 받아온다. 예전에는 '#f7f7f5' 를
       박아 놔서 다크 모드에서도 하얀 박스가 그대로 떠 있었다. */
    const P = window.GraphTheme.palette();
    const gw = graph.width / DPR, gh = graph.height / DPR;
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.clearRect(0, 0, gw, gh);

    const rows = ORGANELLES.filter((o) => o.id !== 'membrane');
    const pad = { l: 130, t: 44, r: 20, b: 20 };
    const colW = (gw - pad.l - pad.r) / 2;
    const rowH = Math.min(30, (gh - pad.t - pad.b) / rows.length);

    g.font = '600 13px system-ui';
    g.fillStyle = P.ink;
    g.textAlign = 'center';
    g.fillText('동물 세포', pad.l + colW * .5, 26);
    g.fillText('식물 세포', pad.l + colW * 1.5, 26);

    rows.forEach((o, i) => {
      const y = pad.t + i * rowH + rowH / 2;
      g.font = '12.5px system-ui';
      g.textAlign = 'right';
      g.fillStyle = P.ink;
      g.fillText(o.name, pad.l - 14, y + 4);

      [false, true].forEach((isPlant, ci) => {
        const has = isPlant || !o.plant;
        const x = pad.l + colW * ci + colW / 2;
        if (has) {
          g.fillStyle = o.color;
          g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill();
        } else {
          g.strokeStyle = P.grid;
          g.lineWidth = 1.6;
          g.beginPath();
          g.moveTo(x - 5, y - 5); g.lineTo(x + 5, y + 5);
          g.moveTo(x + 5, y - 5); g.lineTo(x - 5, y + 5);
          g.stroke();
        }
      });
    });

    // 가운데 구분선
    g.strokeStyle = P.grid; g.lineWidth = 1;
    g.beginPath(); g.moveTo(pad.l + colW, pad.t - 12); g.lineTo(pad.l + colW, pad.t + rows.length * rowH); g.stroke();
  }

  // ── 소기관 목록 ──
  const box = el('organelles');
  function renderList() {
    box.innerHTML = '';
    visible().forEach((o) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(S.focus === o.id));
      b.innerHTML = '<span class="dot" style="background:' + o.color + '"></span>' +
        '<span>' + o.name + '</span>' +
        (o.plant ? '<span class="plant-only">식물만</span>' : '');
      b.addEventListener('click', () => focus(o.id));
      box.appendChild(b);
    });
  }

  function focus(id) {
    S.focus = S.focus === id ? null : id;
    renderList();
    showFact();
    el('stage-said').textContent = S.focus ? '다시 누르면 전체가 보입니다' : '소기관을 클릭해 보세요';
  }

  function showFact() {
    const o = ORGANELLES.find((x) => x.id === S.focus);
    if (!o) {
      el('fact').innerHTML = '<strong>소기관을 골라 보세요.</strong>' +
        '<span class="job">무대에서 직접 눌러도 됩니다.</span>';
      return;
    }
    el('fact').innerHTML = '<strong>' + o.name + '</strong> — ' + o.job +
      '<span class="job">왜 이런 구조일까: ' + o.why + '</span>';
  }

  // ── 세포 종류 ──
  const kindBox = el('kind');
  [['animal', '동물 세포'], ['plant', '식물 세포']].forEach(([id, label]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label;
    b.setAttribute('aria-pressed', String(S.kind === id));
    b.addEventListener('click', () => {
      S.kind = id;
      [...kindBox.children].forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
      // 식물 전용 소기관을 보다가 동물로 바꾸면 없는 것을 가리키게 된다
      const cur = ORGANELLES.find((o) => o.id === S.focus);
      if (cur && cur.plant && id === 'animal') S.focus = null;
      renderList(); showFact(); updateKindNote();
    });
    kindBox.appendChild(b);
  });

  function updateKindNote() {
    el('kind-note').textContent = S.kind === 'plant'
      ? '식물 세포에는 세포벽·엽록체·액포가 더 있습니다. 목록에서 "식물만" 표시를 확인해 보세요.'
      : '동물 세포에는 세포벽·엽록체·액포가 없습니다. 식물 세포로 바꿔 비교해 보세요.';
  }

  // 무대에서 직접 클릭 — 목록보다 이쪽이 직관적이다
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.clientWidth / rect.width);
    const my = (e.clientY - rect.top) * (canvas.clientHeight / rect.height);
    // 작은 것부터 본다. 세포막이 전체를 덮고 있어 큰 것부터 보면 항상 그것만 잡힌다.
    const hit = [...visible()].sort((a, b) => a.r - b.r)
      .find((o) => {
        const p = pos(o);
        return Math.hypot(mx - p.x, my - p.y) <= p.r * (o.id === 'ribo' ? 3 : 1.2);
      });
    if (hit) focus(hit.id);
  });

  el('toggle').addEventListener('click', () => {
    running = !running;
    el('toggle').textContent = running ? '일시정지' : '이어서';
  });
  el('reset').addEventListener('click', () => { S.focus = null; renderList(); showFact(); });

  // ── 공유 ──
  el('share').addEventListener('click', async () => {
    const said = el('share-said');
    try {
      const me = await Session.refresh();
      if (!me) { said.textContent = '로그인이 필요합니다.'; return; }
      const q = new URLSearchParams({ kind: S.kind });
      if (S.focus) q.set('focus', S.focus);
      const url = location.origin + location.pathname + '?' + q;
      const b = el('share-url');
      b.value = url; b.hidden = false; b.select();
      try { await navigator.clipboard.writeText(url); said.textContent = '복사했습니다.'; }
      catch { said.textContent = '주소를 복사해 주세요.'; }
    } catch { said.textContent = '잠시 후 다시 시도해 주세요.'; }
  });

  function applyQuery() {
    const q = new URLSearchParams(location.search);
    if (q.get('kind') === 'plant') {
      S.kind = 'plant';
      [...kindBox.children].forEach((c, i) => c.setAttribute('aria-pressed', String(i === 1)));
    }
    const f = q.get('focus');
    if (f && ORGANELLES.some((o) => o.id === f)) {
      const o = ORGANELLES.find((x) => x.id === f);
      // 동물 세포인데 식물 전용을 가리키면 자동으로 식물로 바꾼다
      if (o.plant && S.kind !== 'plant') {
        S.kind = 'plant';
        [...kindBox.children].forEach((c, i) => c.setAttribute('aria-pressed', String(i === 1)));
      }
      S.focus = f;
    }
  }

  // ── 루프 ──
  let last = 0;
  function frame(ts) {
    const now = ts / 1000;
    if (!last) last = now;
    // 탭을 숨겼다 돌아오면 밀린 시간이 한꺼번에 들어온다
    if (running) t += Math.min(0.25, now - last);
    last = now;
    draw(); drawCompare();
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
  renderList(); showFact(); updateKindNote();
  resize();
  window.GraphTheme.onChange(drawCompare);   // 밝기 모드가 바뀌면 새 팔레트로 다시 그린다
  window.addEventListener('resize', resize);
  requestAnimationFrame(frame);
})();
