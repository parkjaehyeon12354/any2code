const messagesEl = document.getElementById('messages');
const qEl = document.getElementById('q');
const askBtn = document.getElementById('ask');
const subjEl = document.getElementById('subject');

function append(kind, text) {
  const d = document.createElement('div');
  d.className = 'msg ' + (kind === 'user' ? 'user' : 'bot');
  d.textContent = text;
  messagesEl.appendChild(d);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

askBtn.addEventListener('click', async () => {
  const q = qEl.value.trim();
  if (!q) return;
  append('user', q);
  qEl.value = '';
  append('bot', '생성 중...');
  try {
    const res = await fetch('/api/llm/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, subject: subjEl.value })
    });
    const data = await res.json();
    messagesEl.lastChild.textContent = data.answer || data.error || '응답이 없습니다.';
  } catch (e) {
    messagesEl.lastChild.textContent = '오류가 발생했습니다.';
  }
});

qEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') askBtn.click(); });
