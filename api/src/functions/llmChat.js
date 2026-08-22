const { app } = require('@azure/functions');
const OpenAI = require('openai');
const session = require('../lib/session');
const { lockdown } = require('../lib/lockdown');

// Subjects mirror the site taxonomy — only these are allowed from clients
const SUBJECTS = ['physics', 'chem', 'bio', 'earth'];

// Simple size guard like other endpoints
const tooBig = (request) => Number(request.headers.get('content-length') || 0) > 64 * 1024;

// Per-user (or per-anon-key) rate limiting: timestamps array
const chatLog = new Map();
function chatAllowed(key, now = Date.now(), max = 20, windowMs = 60 * 60 * 1000) {
  const arr = (chatLog.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { chatLog.set(key, arr); return false; }
  arr.push(now);
  chatLog.set(key, arr);
  return true;
}

async function callLLM(prompt, subject) {
  const llmKey = process.env.LLM_API_KEY;
  if (!llmKey) {
    throw new Error('LLM_API_KEY is not set in environment');
  }

  // Upstage Solar 를 OpenAI 호환 엔드포인트로 부른다. openai 패키지를 그대로 쓰되
  // baseURL 만 갈아끼우는 방식이라 의존성이 늘지 않는다.
  // 주의: responses.create 는 OpenAI 전용이라 이 엔드포인트에 없다. chat.completions 를 쓴다.
  const openai = new OpenAI({
    apiKey: llmKey,
    baseURL: process.env.LLM_BASE_URL || 'https://api.upstage.ai/v1'
  });
  const model = process.env.LLM_MODEL || 'solar-pro4';

  const subjectNames = {
    physics: '물리학',
    chem: '화학',
    bio: '생명과학',
    earth: '지구과학'
  };
  const subjectName = subjectNames[subject] || '과학';

  const response = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: `
너는 Ans2Quest의 중·고등학생용 과학 학습 도우미다.

현재 과목은 ${subjectName}이다.

다음 원칙을 지켜라.
- 항상 한국어로 답한다.
- 학생이 이해할 수 있도록 쉬운 말부터 설명한다.
- 필요한 경우 수식과 예시를 함께 제시한다.
- 확실하지 않은 내용은 추측하지 않는다.
- 질문이 불분명하면 먼저 확인 질문을 한다.
- 답변을 지나치게 길게 작성하지 않는다.
        `.trim()
      },
      { role: 'user', content: prompt }
    ],
    // solar-pro4 는 reasoning_tokens 가 0 이라 이 예산을 사고에 뺏기지 않는다.
    // (Gemini 3.x thinking 계열은 여기서 사고 토큰이 먼저 예산을 먹어 답변이 빈 채로
    //  finish_reason: length 가 떨어졌다. 모델을 바꿀 때 이 값을 반드시 재확인할 것.)
    max_tokens: 800
  });

  const answer = response.choices?.[0]?.message?.content?.trim();
  if (!answer) {
    throw new Error('AI가 빈 답변을 반환했습니다.');
  }

  return answer;
}

app.http('llmChat', {
  route: 'llm/chat',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const locked = lockdown(); if (locked) return locked;
    if (tooBig(request)) return { status: 413, jsonBody: { error: '요청이 너무 큽니다.' } };

    let body;
    try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: '요청 형식이 잘못됐습니다.' } }; }

    const question = String(body.question || '').trim();
    const subject = String(body.subject || '').trim();
    if (!question) return { status: 400, jsonBody: { error: '질문을 입력해 주세요.' } };
    if (subject && !SUBJECTS.includes(subject)) return { status: 400, jsonBody: { error: '유효하지 않은 과목입니다.' } };

    const user = session.current(request);
    const key = user ? `u:${user.sub}` : `anon:${request.headers.get('x-forwarded-for') || 'unknown'}`;
    if (!chatAllowed(key)) return { status: 429, jsonBody: { error: '너무 자주 요청하고 있습니다. 잠시 후 다시 시도해 주세요.' } };

    try {
      const answer = await callLLM(question, subject);
      return { jsonBody: { answer } };
    } catch (e) {
      context.error('LLM 요청 실패:', e.message);
      const msg = e.status && e.status >= 500 ? '외부 서비스 오류입니다. 잠시 후 다시 시도해 주세요.' : e.message;
      return { status: 502, jsonBody: { error: msg } };
    }
  }
});
