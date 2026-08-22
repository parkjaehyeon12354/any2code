const messagesEl = document.getElementById('messages');
const qEl = document.getElementById('q');
const askBtn = document.getElementById('ask');
const subjEl = document.getElementById('subject');
const formEl = document.getElementById('chat-form');

function append(kind, text) {
  const message = document.createElement('div');
  message.className = 'msg ' + (kind === 'user' ? 'user' : 'bot');
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
  append('user', question);
  qEl.value = '';
  askBtn.disabled = true;
  askBtn.textContent = '답변 중';
  const pending = append('bot', '답변을 준비하고 있어요…');

  try {
    const response = await fetch('/api/llm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, subject: subjEl.value })
    });
    const data = await response.json();
    pending.textContent = data.answer || data.error || '응답을 받지 못했어요. 잠시 후 다시 시도해 주세요.';
  } catch (error) {
    pending.textContent = '연결 중 문제가 생겼어요. API 서버가 실행 중인지 확인한 뒤 다시 시도해 주세요.';
  } finally {
    askBtn.disabled = false;
    askBtn.textContent = '질문하기';
    qEl.focus();
  }
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
