/* 서명 세션 쿠키.
   JWT 라이브러리를 넣지 않고 crypto(내장)로 처리한다 — 필요한 건
   "payload + HMAC 서명" 뿐이고, 그건 20줄이면 된다.

   보안 요건 (하나도 빼면 안 됨):
   - 서명 비교는 timingSafeEqual (===는 타이밍 공격에 노출)
   - httpOnly: JS 가 쿠키를 못 읽게 → XSS 로 세션 탈취 불가
   - Secure: HTTPS 에서만 전송
   - SameSite=Lax: 크로스사이트 요청에 쿠키가 안 실림 (CSRF 완화)
   - exp: 만료 없는 토큰은 영구 열쇠가 된다 */
const crypto = require('node:crypto');

const COOKIE = 'a2q_session';
const STATE_COOKIE = 'a2q_oauth';
const MAX_AGE = 60 * 60 * 24 * 14;   // 14일

function secret() {
  const s = process.env.SESSION_SECRET;
  // 비밀키 없이 조용히 약한 기본값으로 돌아가면 안 된다 — 즉시 실패시킨다
  if (!s || s.length < 32) {
    throw new Error('SESSION_SECRET 이 없거나 32자 미만입니다. Azure 앱 설정에 등록하세요.');
  }
  return s;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(payloadObj) {
  const payload = b64url(JSON.stringify(payloadObj));
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return payload + '.' + sig;
}

function verify(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;

  const expected = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  // 길이가 다르면 timingSafeEqual 이 던지므로 먼저 거른다
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data.exp || Date.now() / 1000 > data.exp) return null;   // 만료
  return data;
}

/** 요청 헤더에서 쿠키 하나를 꺼낸다 */
function readCookie(request, name) {
  const raw = request.headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

/* Azure Functions v4 의 response.cookies 배열이 받는 형태.
   문자열 Set-Cookie 를 직접 쓰면 쿠키 두 개를 한 응답에 못 싣는다. */
const cookie = (name, value, maxAge) =>
  ({ name, value, maxAge, path: '/', httpOnly: true, secure: true, sameSite: 'Lax' });

/** 로그인 세션 발급 */
function issue(user) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  return cookie(COOKIE, sign({ ...user, exp }), MAX_AGE);
}

const clear = () => cookie(COOKIE, '', 0);

/** 요청에서 현재 사용자 (없거나 위조면 null) */
const current = (request) => verify(readCookie(request, COOKIE));

/* ── OAuth state (CSRF 방지) ──
   기존 프론트엔드는 sessionStorage 에 state 를 뒀는데, 그건 서버가 검증할 수
   없다. 서버가 발급하고 서버가 대조해야 의미가 있다. */
function issueState(provider) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const exp = Math.floor(Date.now() / 1000) + 600;   // 10분이면 충분
  const token = sign({ nonce, provider, exp });
  return { state: token, cookie: cookie(STATE_COOKIE, token, 600) };
}

/** 콜백에서 온 state 가 우리가 발급한 것인지, 같은 제공자인지 확인 */
function checkState(request, stateFromQuery, provider) {
  const fromCookie = readCookie(request, STATE_COOKIE);
  if (!fromCookie || !stateFromQuery || fromCookie !== stateFromQuery) return false;
  const data = verify(stateFromQuery);
  return !!data && data.provider === provider;
}

const clearState = () => cookie(STATE_COOKIE, '', 0);

/** 관리자 판정 — 반드시 서버에서만. 클라이언트 값은 신뢰하지 않는다. */
function isAdmin(email) {
  const list = (process.env.ADMIN_EMAILS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return !!email && list.includes(email.toLowerCase());
}

module.exports = { issue, clear, current, issueState, checkState, clearState, isAdmin, COOKIE };
