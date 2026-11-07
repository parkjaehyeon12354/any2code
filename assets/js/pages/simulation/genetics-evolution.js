(function () {
  const el = (id) => document.getElementById(id);

  /* ── 유전과 진화 ──

     교배(멘델)와 집단 변화(진화)를 한 화면에서 잇는다. 둘을 따로 배우면
     "유전이 변이를 만들고 환경이 고른다" 는 연결이 안 보인다.

     대립유전자는 B(검정, 우성)와 b(흰색, 열성) 하나뿐이다. 형질을 여러 개
     두면 표가 커지기만 하고 원리는 그대로다. */
  const GENOTYPES = ['BB', 'Bb', 'bb'];
  const COLOR = { BB: '#3a3a3a', Bb: '#5a5a5a', bb: '#e8e8e8' };

  const S = {
    mode: 'cross',          // cross(교배) | evolve(진화)
    parents: ['Bb', 'Bb'],  // 교과서의 대표 사례 — 3:1 이 나오는 조합
    pressure: 50,           // 검은 개체 생존율(%)
    popSize: 200,
    mut: 0                  // 돌연변이율 (0~50 → 0~5%)
  };

  let pop = [];             // 개체들의 유전자형
  let gen = 0;
  let history = [];         // 세대별 B 빈도
  let running = false;
  let acc = 0;

  const canvas = el('canvas');
  const ctx = canvas.getContext('2d');
  let DPR = 1;
  const W = () => canvas.width / DPR;
  const H = () => canvas.height / DPR;

  // ── 집단 만들기 ──
  function seed() {
    pop = [];
    // 교배 결과 비율대로 집단을 만든다 — 교배 화면과 진화 화면이 이어진다
    const kids = punnettCells();
    for (let i = 0; i < S.popSize; i++) {
      pop.push(kids[i % kids.length]);
    }
    // 순서가 규칙적이면 그림이 줄무늬가 된다
    for (let i = pop.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pop[i], pop[j]] = [pop[j], pop[i]];
    }
    gen = 0;
    history = [freqB()];
  }

  /* 퍼넷 사각형 — 부모 각각에서 대립유전자 하나씩 받는다 */
  function punnettCells() {
    const a = S.parents[0], b = S.parents[1];
    const out = [];
    for (const x of a) for (const y of b) {
      // 'bB' 는 'Bb' 와 같다. 대문자를 앞으로 모아 표기를 통일한다.
      out.push([x, y].sort().reverse().join('') === 'Bb' ? 'Bb' : (x === 'B' && y === 'B' ? 'BB' : (x === 'b' && y === 'b' ? 'bb' : 'Bb')));
    }
    return out;
  }

  const freqB = () => {
    if (!pop.length) return 0;
    let n = 0;
    for (const g of pop) n += (g === 'BB' ? 2 : g === 'Bb' ? 1 : 0);
    return n / (pop.length * 2);
  };

  const counts = () => {
    const c = { BB: 0, Bb: 0, bb: 0 };
    for (const g of pop) c[g]++;
    return c;
  };

  /* 한 세대 — 생존 → 무작위 교배 → 자손 */
  function step() {
    if (!pop.length) return;

    // ① 생존. 검은 개체(BB, Bb)와 흰 개체(bb)의 생존율이 다르다.
    const pB = S.pressure / 100;
    const survivors = pop.filter((g) => {
      const black = g !== 'bb';
      return Math.random() < (black ? pB : 1 - pB);
    });

    /* 전멸하면 볼 것이 없다.

     ⚠ 예전에는 pop.slice(0, 2) 로 원래 집단에서 아무나 둘을 꺼냈는데,
     그러면 방금 일어난 선택이 통째로 무시된다. 살아남은 개체가 하나라도
     있으면 그것만으로 다음 세대를 채운다 — 선택 결과가 유지된다. */
    const parents = survivors.length ? survivors : pop.slice(0, 1);

    // ② 무작위 교배로 다음 세대를 채운다
    const next = [];
    for (let i = 0; i < S.popSize; i++) {
      const m = parents[Math.floor(Math.random() * parents.length)];
      const f = parents[Math.floor(Math.random() * parents.length)];
      let a = m[Math.floor(Math.random() * 2)];
      let b = f[Math.floor(Math.random() * 2)];

      // ③ 돌연변이 — 사라진 대립유전자를 되살린다
      const rate = S.mut / 1000;   // 0~50 → 0~5%
      if (Math.random() < rate) a = a === 'B' ? 'b' : 'B';
      if (Math.random() < rate) b = b === 'B' ? 'b' : 'B';

      next.push(a === 'B' && b === 'B' ? 'BB' : (a === 'b' && b === 'b' ? 'bb' : 'Bb'));
    }
    pop = next;
    gen++;
    history.push(freqB());
    if (history.length > 400) history.shift();
  }

  // ── 무대: 개체를 격자로 ──
  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W(), H());
    if (!pop.length) return;

    /* 격자 배치. 범례 자리(아래 28px)를 뺀 영역을 꽉 채운다.

       ⚠ cols 만 구하고 rows 를 나눗셈으로 얻으면 아래가 크게 남는다.
       cols 를 구한 뒤 rows 에 맞춰 칸 높이를 다시 계산해야 한다. */
    const pad = 18, legend = 28;
    const availW = W() - pad * 2;
    const availH = H() - pad * 2 - legend;
    const cols = Math.max(1, Math.round(Math.sqrt(pop.length * availW / availH)));
    const rows = Math.ceil(pop.length / cols);
    const cw = availW / cols;
    const ch = availH / rows;
    const r = Math.max(2.2, Math.min(cw, ch) * 0.36);

    pop.forEach((g, i) => {
      const x = pad + (i % cols) * cw + cw / 2;
      const y = pad + Math.floor(i / cols) * ch + ch / 2;
      ctx.fillStyle = COLOR[g];
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      // 흰 개체는 어두운 무대에서 테두리가 없으면 배경과 붙어 보인다
      if (g === 'bb') { ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1; ctx.stroke(); }
      // 이형접합(Bb)은 겉은 검지만 b 를 갖고 있다 — 점으로 표시
      if (g === 'Bb' && r > 4) {
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        ctx.beginPath(); ctx.arc(x, y, r * 0.3, 0, Math.PI * 2); ctx.fill();
      }
    });

    // 범례
    const items = [['BB', '검정(순종)'], ['Bb', '검정(잡종)'], ['bb', '흰색']];
    ctx.font = '12px system-ui'; ctx.textAlign = 'left';
    items.forEach(([g, label], i) => {
      const x = 16 + i * 118, y = H() - 14;
      ctx.fillStyle = COLOR[g];
      ctx.beginPath(); ctx.arc(x, y - 4, 5, 0, Math.PI * 2); ctx.fill();
      if (g === 'bb') { ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.fillText(label, x + 11, y);
    });
  }

  // ── 그래프: 세대별 빈도 ──
  const graph = el('eco-graph');
  const g2 = graph.getContext('2d');

  function drawGraph() {
    /* 캔버스는 CSS 를 못 받으니 색을 여기서 받아온다. 예전에는 '#f7f7f5' 를
       박아 놔서 다크 모드에서도 하얀 박스가 그대로 떠 있었다. */
    const P = window.GraphTheme.palette();
    const gw = graph.width / DPR, gh = graph.height / DPR;
    g2.setTransform(DPR, 0, 0, DPR, 0, 0);
    g2.clearRect(0, 0, gw, gh);

    const pad = { l: 56, r: 20, t: 26, b: 42 };
    const x = pad.l, y = pad.t, w = gw - pad.l - pad.r, h = gh - pad.t - pad.b;

    // 눈금
    g2.strokeStyle = P.grid; g2.lineWidth = 1;
    g2.font = '12px system-ui'; g2.fillStyle = P.muted; g2.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const py = y + h * i / 4;
      g2.beginPath(); g2.moveTo(x, py); g2.lineTo(x + w, py); g2.stroke();
      g2.fillText((1 - i / 4).toFixed(2), x - 9, py + 4);
    }

    // 0.5 기준선 — 평형 여부를 한눈에
    g2.strokeStyle = P.grid; g2.setLineDash([5, 4]);
    g2.beginPath(); g2.moveTo(x, y + h / 2); g2.lineTo(x + w, y + h / 2); g2.stroke();
    g2.setLineDash([]);

    const n = Math.max(2, history.length);
    const sx = (i) => x + (n === 1 ? 0 : i / (n - 1) * w);

    // B 와 b 두 선
    [[history, '#7cc4ff', 'B (검정)'], [history.map((v) => 1 - v), '#ffb35c', 'b (흰색)']]
      .forEach(([data, color, label], k) => {
        g2.strokeStyle = color; g2.lineWidth = 2.4;
        g2.beginPath();
        data.forEach((v, i) => {
          const px = sx(i), py = y + h - v * h;
          i ? g2.lineTo(px, py) : g2.moveTo(px, py);
        });
        g2.stroke();
        if (data.length) {
          const last = data[data.length - 1];
          g2.fillStyle = color;
          g2.beginPath(); g2.arc(sx(data.length - 1), y + h - last * h, 5, 0, Math.PI * 2); g2.fill();
          /* 범례는 각 선이 자기 자리에만 쓴다.
             ⚠ 전에는 두 번째 선이 왼쪽에도 써서 첫 번째(B) 라벨을 덮었다.
             그래서 파란선인데 "b (흰색)" 으로 보였다. */
          g2.font = '600 13px system-ui';
          g2.textAlign = k === 0 ? 'left' : 'right';
          g2.fillText(`${label}  ${last.toFixed(3)}`, k === 0 ? x + 8 : x + w - 4, y - 8);
        }
      });

    // 축
    g2.strokeStyle = P.muted; g2.lineWidth = 1;
    g2.beginPath(); g2.moveTo(x, y); g2.lineTo(x, y + h); g2.lineTo(x + w, y + h); g2.stroke();
    g2.fillStyle = P.ink; g2.textAlign = 'center';
    g2.fillText(`세대 (지금 ${gen}세대)`, x + w / 2, gh - 10);
    g2.save(); g2.translate(15, y + h / 2); g2.rotate(-Math.PI / 2);
    g2.fillText('대립유전자 빈도', 0, 0); g2.restore();
  }

  // ── 퍼넷 사각형 ──
  function renderPunnett() {
    const box = el('punnett');
    const a = S.parents[0], b = S.parents[1];
    const cells = punnettCells();
    let html = '<div class="hd"></div>';
    html += `<div class="hd">${b[0]}</div><div class="hd">${b[1]}</div>`;
    for (let i = 0; i < 2; i++) {
      html += `<div class="hd">${a[i]}</div>`;
      for (let j = 0; j < 2; j++) {
        const gt = cells[i * 2 + j];
        html += `<div class="cell${gt !== 'bb' ? ' dom' : ''}">${gt}</div>`;
      }
    }
    box.innerHTML = html;

    const c = { BB: 0, Bb: 0, bb: 0 };
    cells.forEach((g) => c[g]++);
    const black = c.BB + c.Bb;
    el('cross-note').textContent =
      `자손 유전자형 ${c.BB}:${c.Bb}:${c.bb} (BB:Bb:bb), 겉모습은 검정 ${black} : 흰색 ${c.bb}. ` +
      (black === 3 && c.bb === 1 ? '교과서에 나오는 3:1 입니다.' : '');
  }

  // ── 측정값 ──
  function readout() {
    const c = counts();
    const p = freqB();
    el('r-gen').textContent = gen + '세대';
    el('r-freq').textContent = p.toFixed(3);
    el('r-geno').textContent = `${c.BB} : ${c.Bb} : ${c.bb}`;
    const black = c.BB + c.Bb;
    el('r-pheno').textContent = pop.length
      ? `검정 ${(black / pop.length * 100).toFixed(0)}% / 흰색 ${(c.bb / pop.length * 100).toFixed(0)}%`
      : '—';

    let state, note;
    if (p >= 0.999) {
      state = 'B 고정';
      note = 'b 가 사라졌습니다. 돌연변이가 없으면 다시 나타나지 않습니다.';
    } else if (p <= 0.001) {
      state = 'b 고정';
      note = 'B 가 사라졌습니다.';
    } else if (S.mode === 'cross') {
      state = '교배 결과';
      note = '부모를 바꿔 보세요. 아래 "환경 압력" 으로 넘어가면 이 집단이 세대를 거칩니다.';
    } else if (Math.abs(S.pressure - 50) < 3) {
      state = '평형에 가까움';
      note = '어느 쪽도 유리하지 않으면 빈도가 거의 변하지 않습니다(하디–바인베르크). ' +
             '집단을 작게 하면 우연만으로 흔들리는 것을 볼 수 있습니다.';
    } else if (S.pressure > 50) {
      state = '검정 유리';
      note = 'B 가 늘고 있습니다. 다만 Bb 인 개체가 겉으로는 검은색이라 b 를 숨긴 채 물려주기 때문에, b 는 좀처럼 완전히 사라지지 않습니다.';
    } else {
      state = '흰색 유리';
      note = 'bb 만 살아남기 유리해 b 가 빠르게 늘어납니다. 열성 형질은 겉으로 드러나므로 선택이 곧바로 작용합니다.';
    }
    el('r-state').textContent = state;
    el('note').textContent = note;
  }

  // ── 모드 ──
  const modeBox = el('mode');
  [['cross', '교배 (멘델)'], ['evolve', '세대 변화 (진화)']].forEach(([id, label]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label;
    b.setAttribute('aria-pressed', String(S.mode === id));
    b.addEventListener('click', () => {
      S.mode = id;
      [...modeBox.children].forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
      el('cross-panel').hidden = id !== 'cross';
      el('evo-panel').hidden = id !== 'evolve';
      running = false;
      el('toggle').textContent = '세대 진행';
      if (id === 'evolve') { seed(); }
      updateModeNote();
      readout();
    });
    modeBox.appendChild(b);
  });

  function updateModeNote() {
    el('mode-note').textContent = S.mode === 'cross'
      ? '부모 유전자형을 고르면 자손이 어떤 비율로 나오는지 보여줍니다.'
      : '교배로 만든 집단이 세대를 거칩니다. 환경을 바꿔 무엇이 달라지는지 보세요.';
  }

  // ── 부모 고르기 ──
  document.querySelectorAll('.gt-row').forEach((row) => {
    const idx = Number(row.dataset.parent);
    GENOTYPES.forEach((gt) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = gt;
      b.setAttribute('aria-pressed', String(S.parents[idx] === gt));
      b.addEventListener('click', () => {
        S.parents[idx] = gt;
        [...row.children].forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
        renderPunnett(); seed(); readout();
      });
      row.appendChild(b);
    });
  });

  // ── 슬라이더 ──
  const labels = {
    pressure: (v) => v + '%',
    popsize: (v) => v + '마리',
    mut: (v) => (v / 10).toFixed(1) + '%'
  };
  ['pressure', 'popsize', 'mut'].forEach((k) => {
    const input = el(k);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      el(k + '-out').textContent = labels[k](v);
      if (k === 'pressure') S.pressure = v;
      if (k === 'mut') S.mut = v;
      if (k === 'popsize') { S.popSize = v; seed(); }
      readout();
    });
  });

  el('toggle').addEventListener('click', () => {
    if (S.mode === 'cross') {
      // 교배 화면에서 눌렀으면 진화 화면으로 넘겨준다 — 둘이 이어져 있다는 뜻
      modeBox.children[1].click();
      return;
    }
    running = !running;
    el('toggle').textContent = running ? '멈춤' : '세대 진행';
  });
  el('reset').addEventListener('click', () => { seed(); running = false; el('toggle').textContent = '세대 진행'; readout(); });

  // ── 공유 ──
  el('share').addEventListener('click', async () => {
    const said = el('share-said');
    try {
      const me = await Session.refresh();
      if (!me) { said.textContent = '로그인이 필요합니다.'; return; }
      const q = new URLSearchParams({
        mode: S.mode, p1: S.parents[0], p2: S.parents[1],
        pressure: S.pressure, pop: S.popSize, mut: S.mut
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
    ['p1', 'p2'].forEach((k, i) => {
      const v = q.get(k);
      if (GENOTYPES.includes(v)) {
        S.parents[i] = v;
        const row = document.querySelector(`.gt-row[data-parent="${i}"]`);
        [...row.children].forEach((c) => c.setAttribute('aria-pressed', String(c.textContent === v)));
      }
    });
    [['pressure', 'pressure'], ['pop', 'popsize'], ['mut', 'mut']].forEach(([qk, id]) => {
      const v = Number(q.get(qk));
      if (!Number.isFinite(v) || q.get(qk) === null) return;
      const input = el(id);
      const c = Math.max(Number(input.min), Math.min(Number(input.max), v));
      input.value = c;
      el(id + '-out').textContent = labels[id](c);
      if (id === 'pressure') S.pressure = c;
      if (id === 'popsize') S.popSize = c;
      if (id === 'mut') S.mut = c;
    });
    if (q.get('mode') === 'evolve') modeBox.children[1].click();
  }

  // ── 루프 ──
  let last = 0;
  const GEN_INTERVAL = 0.45;   // 세대 간격(초). 너무 빠르면 변화를 못 따라간다
  function frame(ts) {
    const now = ts / 1000;
    if (!last) last = now;
    // 탭을 숨겼다 돌아오면 밀린 시간이 한꺼번에 들어온다
    acc += Math.min(0.25, now - last);
    last = now;
    if (running && S.mode === 'evolve') {
      while (acc >= GEN_INTERVAL) { step(); acc -= GEN_INTERVAL; readout(); }
    } else {
      acc = 0;
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

  renderPunnett();
  seed();
  applyQuery();
  updateModeNote();
  readout();
  resize();
  window.GraphTheme.onChange(drawGraph);   // 밝기 모드가 바뀌면 새 팔레트로 다시 그린다
  window.addEventListener('resize', resize);
  requestAnimationFrame(frame);
})();
