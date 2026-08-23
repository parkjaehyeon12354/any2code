const messagesEl = document.getElementById('messages');
const qEl = document.getElementById('q');
const askBtn = document.getElementById('ask');
const subjEl = document.getElementById('subject');
const formEl = document.getElementById('chat-form');

/* ── 답변 렌더링 ──
   LLM 은 마크다운 + LaTeX 를 섞어서 돌려준다. 예전에는 textContent 로 그대로
   꽂아서 화면에 `\(\sin\theta \approx \theta\)` 같은 원문이 노출됐다.

   KaTeX 같은 라이브러리를 못 쓴다 — staticwebapp.config.json 의 CSP 가
   script-src 를 'self' 로 묶어놔서 CDN 스크립트가 차단된다. CSP 를 푸는 건
   XSS 방어를 약화시키는 거라 그쪽이 더 나쁘다. 그래서 의존성 없이 직접 그린다.

   전부 escapeHtml 을 통과한 뒤에만 태그를 붙인다. 순서가 뒤집히면 XSS 가 열린다. */

const escapeAnswerHtml = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* LaTeX 를 읽을 수 있는 유니코드로 바꾼다.
   목표는 조판이 아니라 가독성이다. \frac{L}{g} 를 (L/g) 로 보여주는 편이
   백슬래시 원문을 그대로 두는 것보다 학생에게 훨씬 낫다. */
const GREEK = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ',
  eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ',
  nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ',
  upsilon: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω'
};
const OPS = {
  times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓',
  approx: '≈', neq: '≠', leq: '≤', geq: '≥', ll: '≪', gg: '≫',
  equiv: '≡', propto: '∝', infty: '∞', partial: '∂', nabla: '∇',
  int: '∫', sum: '∑', prod: '∏', to: '→', rightarrow: '→',
  leftarrow: '←', Rightarrow: '⇒', Leftrightarrow: '⇔', in: '∈', ldots: '…', dots: '…',
  circ: '°', degree: '°', prime: '′', angle: '∠', perp: '⊥', parallel: '∥',
  Delta: 'Δ', simeq: '≃', sim: '∼', pi: 'π'
};
const SUP = { '0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','+':'⁺','-':'⁻','n':'ⁿ','i':'ⁱ' };
const SUB = { '0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉','+':'₊','-':'₋','a':'ₐ','e':'ₑ','o':'ₒ','x':'ₓ','i':'ᵢ','n':'ₙ' };
// \sin, \cos, \log ... 는 이름 그대로 쓰면 된다. 백슬래시만 떼어낸다.
const FUNCS = ['sin','cos','tan','sec','csc','cot','arcsin','arccos','arctan',
  'sinh','cosh','tanh','log','ln','exp','lim','max','min','det'];

function latexToText(src) {
  let s = src;

  // \frac{a}{b} -> (a/b). 중첩을 위해 몇 번 돌린다.
  for (let i = 0; i < 4; i++) {
    const next = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1/$2)');
    if (next === s) break;
    s = next;
  }
  // \sqrt{x} -> √(x). 이미 괄호로 감싸인 내용이면 겹치지 않게 그대로 쓴다.
  for (let i = 0; i < 3; i++) {
    const next = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, (m, inner) => {
      const t = inner.trim();
      const wrapped = t.startsWith('(') && t.endsWith(')');
      const bare = /^[A-Za-z0-9.]+$/.test(t);          // √2, √L 처럼 짧으면 괄호 불필요
      return wrapped || bare ? `√${t}` : `√(${t})`;
    });
    if (next === s) break;
    s = next;
  }
  // \text{...}, \mathrm{...} 등은 내용만 남긴다
  s = s.replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/g, '$1');
  // \sin, \log 같은 함수명은 백슬래시만 제거 (그리스 문자 치환보다 먼저)
  s = s.replace(new RegExp('\\\\(' + FUNCS.join('|') + ')\\b', 'g'), '$1');
  // 그리스 문자 · 연산자
  s = s.replace(/\\([A-Za-z]+)/g, (m, name) => GREEK[name] || OPS[name] || m);
  // 위첨자 / 아래첨자
  s = s.replace(/\^\{?\s*°\s*\}?/g, '°');          // 10^\circ -> 10° (^ 가 남지 않게)
  s = s.replace(/\^\{([^{}]+)\}/g, (m, g) => [...g].every((c) => SUP[c]) ? [...g].map((c) => SUP[c]).join('') : `^(${g})`);
  s = s.replace(/\^(\w)/g, (m, c) => SUP[c] || `^${c}`);
  s = s.replace(/_\{([^{}]+)\}/g, (m, g) => [...g].every((c) => SUB[c]) ? [...g].map((c) => SUB[c]).join('') : `_(${g})`);
  s = s.replace(/_(\w)/g, (m, c) => SUB[c] || `_${c}`);
  // 남은 정렬/간격 제어 문자 정리
  s = s.replace(/\\[,;:!qh]uad|\\[,;:!]/g, ' ').replace(/\\\\/g, ' ');
  s = s.replace(/[{}]/g, '');
  // 안전망: 표에 없는 명령이 남아 백슬래시가 화면에 노출되는 일이 없게 이름만 남긴다.
  // 이게 없으면 \circ 처럼 빠진 항목이 그대로 새어나간다(실제로 한 번 새어나갔다).
  s = s.replace(/\\([A-Za-z]+)/g, '$1');
  return s.trim();
}

function renderAnswer(el, raw) {
  const text = String(raw);

  // 1) 수식 구간을 먼저 뽑아내 자리표시자로 치환한다.
  //    이렇게 해야 escapeHtml 과 마크다운 처리가 수식 내부를 건드리지 않는다.
  const blocks = [];
  let work = text
    .replace(/\\\[([\s\S]*?)\\\]/g, (m, b) => `\u0000B${blocks.push(latexToText(b)) - 1}\u0000`)
    .replace(/\$\$([\s\S]*?)\$\$/g, (m, b) => `\u0000B${blocks.push(latexToText(b)) - 1}\u0000`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (m, b) => `\u0000I${blocks.push(latexToText(b)) - 1}\u0000`)
    .replace(/(?<!\\)\$([^$\n]+?)\$/g, (m, b) => `\u0000I${blocks.push(latexToText(b)) - 1}\u0000`);

  // 2) 이스케이프 — 반드시 태그를 붙이기 전에
  work = escapeAnswerHtml(work);

  // 3) 아주 작은 마크다운만 지원한다. 링크·이미지는 일부러 뺐다(피싱 방지).
  work = work
    .replace(/^######\s+(.*)$/gm, '<b>$1</b>')
    .replace(/^#{1,5}\s+(.*)$/gm, '<b>$1</b>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/^\s*[-*]\s+(.*)$/gm, '• $1')
    .replace(/^\s*---+\s*$/gm, '<hr>');

  // 4) 자리표시자를 실제 수식 노드로 되돌린다.
  work = work
    .replace(/\u0000B(\d+)\u0000/g, (m, i) => `<span class="math-block">${escapeAnswerHtml(blocks[+i])}</span>`)
    .replace(/\u0000I(\d+)\u0000/g, (m, i) => `<span class="math">${escapeAnswerHtml(blocks[+i])}</span>`);

  // 5) 수식 구간 밖에 떠 있는 LaTeX 잔재 정리.
  //    모델이 구분자 없이 \theta 만 툭 던지는 경우가 있는데, 그대로 두면
  //    화면에 백슬래시가 그대로 보인다. 태그는 이미 붙은 뒤라 <b>, <span>
  //    같은 마크업은 건드리지 않도록 백슬래시로 시작하는 것만 고른다.
  work = work.replace(/\\([A-Za-z]+)/g, (m, name) => GREEK[name] || OPS[name] || name);

  el.innerHTML = work;
}

function append(kind, text) {
  const message = document.createElement('div');
  message.className = 'msg ' + (kind === 'user' ? 'user' : 'bot');
  // 사용자 발화는 렌더링하지 않는다. 자기 입력이 마크다운으로 변형되면 혼란스럽다.
  message.textContent = text;
  messagesEl.appendChild(message);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return message;
}

async function askQuestion() {
  const question = qEl.value.trim();
  if (!question || askBtn.disabled) return;

  const welcome = messagesEl.querySelector('.welcome');
  if (welcome) welcome.remove();
  const userMsg = append('user', question);
  qEl.value = '';
  askBtn.disabled = true;
  askBtn.textContent = '답변 중';
  const pending = append('bot', '답변을 준비하고 있어요…');

  try {
    const response = await fetch('/api/llm/chat', {
      method: 'POST',
      credentials: 'same-origin',      // 로그인 필수 — 쿠키를 반드시 실어 보낸다
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, subject: subjEl.value })
    });
    const data = await response.json();
    if (data.answer) {
      renderAnswer(pending, data.answer);
      // 이번 대화에 쓴 크레딧과 남은 양을 화면에 반영한다
      if (data.credit && typeof updateCredit === 'function') updateCredit(data.credit);
    } else if (response.status === 402) {
      /* 크레딧 소진. 이건 오류가 아니라 정상적인 한도 도달이라, 빨간 오류처럼
         보이지 않게 안내 문구로 남긴다. */
      pending.textContent = data.error || 'AI 도우미 크레딧을 모두 사용했습니다.';
      if (data.credit && typeof updateCredit === 'function') updateCredit(data.credit);
    } else if (response.status === 401) {
      /* 비로그인. /login 으로 페이지를 넘기지 않고 그 자리에서 모달을 띄운다 —
         페이지를 옮기면 쓰던 질문이 날아가고 다시 찾아와야 한다.

         보낸 것처럼 보이던 말풍선 두 개(내 질문 + "답변을 준비하고 있어요")를
         지우고 질문을 입력칸으로 되돌린다. 남겨두면 질문은 올라갔는데 답만
         없는 모양이 되어, 로그인 후 같은 질문을 또 치게 된다.

         모달은 science.html 이 갖고 있고 전역 함수 하나로 연결한다.
         모달이 없는 페이지에서도 llm.js 가 깨지지 않도록 존재를 확인한다. */
      pending.remove();
      userMsg.remove();
      qEl.value = question;
      if (typeof window.showLoginPrompt === 'function') {
        window.showLoginPrompt(question);
      } else {
        append('bot', data.error || 'AI 도우미를 사용하려면 로그인이 필요합니다.');
      }
    } else if (response.status === 403 && data.permanent) {
      /* 인젝션으로 영구 정지된 경우. 소명 경로를 알려준다 — 화면 배너에도 나오지만
         방금 차단당한 순간에 바로 보이는 것이 낫다. */
      pending.textContent = data.error || '계정이 정지되었습니다.';
      if (typeof Session !== 'undefined' && Session.refresh) Session.refresh();
    } else {
      pending.textContent = data.error || '응답을 받지 못했어요. 잠시 후 다시 시도해 주세요.';
    }
  } catch (error) {
    pending.textContent = '연결 중 문제가 생겼어요. API 서버가 실행 중인지 확인한 뒤 다시 시도해 주세요.';
  } finally {
    askBtn.disabled = false;
    askBtn.textContent = '질문하기';
    qEl.focus();
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

formEl.addEventListener('submit', (event) => {
  event.preventDefault();
  askQuestion();
});

document.querySelectorAll('[data-question]').forEach((button) => {
  button.addEventListener('click', () => {
    qEl.value = button.dataset.question;
    qEl.focus();
  });
});
