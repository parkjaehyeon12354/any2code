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

/** 로그인 세션 발급.
    iat(발급 시각, ms)는 세션 강제 종료의 기준이다 — 아래 load() 참고. */
function issue(user) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  return cookie(COOKIE, sign({ ...user, iat: Date.now(), exp }), MAX_AGE);
}

const clear = () => cookie(COOKIE, '', 0);

/** 요청에서 현재 사용자 (없거나 위조면 null).
    ⚠ 서명·만료만 본다. 강제 종료된 세션도 통과하므로 핸들러에서는 load() 를 쓴다. */
const current = (request) => verify(readCookie(request, COOKIE));

/* ── 세션 강제 종료 ──
   서명 쿠키는 서버에 저장하지 않으므로, 한번 발급하면 만료(14일)까지 지울 방법이 없었다.
   쿠키를 도둑맞으면 SESSION_SECRET 을 바꿔 '전원'을 로그아웃시키는 것 말고는 끊을 수 없었다.

   그래서 사용자 문서(user:<sub>)에 sessionsValidAfter(ms)를 둔다. 이 시각보다 먼저 발급된
   쿠키는 서명이 맞아도 거부한다. '모든 기기에서 로그아웃' 과 관리자의 강제 종료가 이 값을
   지금 시각으로 올린다. iat 가 없는 옛 쿠키는 0 으로 본다 — 강제 종료가 걸리면 함께 끊긴다.

   DB 를 못 읽을 때:
     일반 요청  → 통과시킨다. DB 가 흔들린다고 전원을 로그아웃시키지 않는다(이 코드의 원칙).
     관리자     → 막는다. 탈취된 관리자 쿠키를 끊으려고 쓰는 기능이라, 여기서 열어주면 의미가 없다.
   설정 자체가 없는 경우(로컬·테스트, NO_COSMOS_CONFIG)는 확인할 대상이 없으니 둘 다 통과한다. */
const userDocId = (sub) => 'user:' + sub;

async function revokedBefore(sub) {
  // 지연 로드: db 는 Cosmos SDK 를 끌고 오므로 서명만 쓰는 곳(테스트 등)에서 부담이 없게
  const { container } = require('./db');
  const { resource } = await container().item(userDocId(sub), sub).read();
  return (resource && resource.sessionsValidAfter) || 0;
}

/** 요청에서 현재 사용자 — 서명·만료에 더해 강제 종료 여부까지 본다. 핸들러는 이걸 쓴다. */
async function load(request, { failClosed = false } = {}) {
  const user = current(request);
  if (!user) return null;
  let after;
  try {
    after = await revokedBefore(user.sub);
  } catch (e) {
    if (e && e.code === 404) return user;                 // 아직 문서가 없는 사용자
    if (e && e.code === 'NO_COSMOS_CONFIG') return user;  // DB 미설정(로컬·테스트)
    if (failClosed) { const err = new Error('세션 확인 실패'); err.code = 'SESSION_CHECK_FAILED'; throw err; }
    return user;
  }
  return (user.iat || 0) < after ? null : user;
}

/** 이 사용자의 지금까지 발급된 세션을 전부 끊는다. 문서가 없으면 아무것도 하지 않는다. */
async function revokeAll(sub) {
  const { container } = require('./db');
  await container().item(userDocId(sub), sub).patch([
    { op: 'set', path: '/sessionsValidAfter', value: Date.now() }
  ]);
}

/* ── OAuth state (CSRF 방지) ──
   기존 프론트엔드는 sessionStorage 에 state 를 뒀는데, 그건 서버가 검증할 수
   없다. 서버가 발급하고 서버가 대조해야 의미가 있다. */
/* 로그인 시작 시 발급하는 state.
   `to` 는 로그인을 마친 뒤 돌아갈 경로다. 서명된 토큰 안에 넣으므로 위조할 수 없다 —
   쿼리스트링으로 그냥 받아 쓰면 오픈 리다이렉트가 된다.

   ⚠ 저장 전에 반드시 safePath() 를 통과시킨다. 서명은 '우리가 발급했다'만 보장하지
   '안전한 값이다'를 보장하지 않는다. */
function issueState(provider, to) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const exp = Math.floor(Date.now() / 1000) + 600;   // 10분이면 충분
  const token = sign({ nonce, provider, exp, to: safePath(to) });
  return { state: token, cookie: cookie(STATE_COOKIE, token, 600) };
}

/* 돌아갈 경로로 쓸 수 있는 값만 통과시킨다.

   막아야 하는 것:
   - 'https://evil.com'      → 외부 도메인으로 튕겨보내는 오픈 리다이렉트
   - '//evil.com'            → 스킴 생략 형태. 브라우저는 절대 URL 로 읽는다
   - '/\\evil.com'           → 역슬래시를 슬래시로 정규화하는 브라우저가 있다
   허용: '/science', '/community?sort=hot' 처럼 같은 사이트 안의 경로만. */
function safePath(to) {
  if (typeof to !== 'string' || !to) return null;
  if (to[0] !== '/') return null;                 // 절대 URL·상대 경로 모두 거부
  if (to[1] === '/' || to[1] === '\\') return null;
  if (/[\r\n]/.test(to)) return null;             // 헤더 인젝션
  return to.slice(0, 200);
}

/** 콜백에서 state 안에 담아둔 돌아갈 경로를 꺼낸다. 없거나 이상하면 '/'. */
function stateTarget(stateFromQuery) {
  const data = verify(stateFromQuery);
  return (data && safePath(data.to)) || '/';
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

/* 관리자 전용 핸들러의 첫 줄에 쓴다.
   쿠키의 role 은 보지 않는다 — 로그인 시점 값이 14일 박제되므로,
   ADMIN_EMAILS 에서 뺀 사람이 만료까지 관리자로 남는다. */
async function requireAdmin(request) {
  let user;
  try {
    user = await load(request, { failClosed: true });
  } catch {
    return { error: { status: 503, jsonBody: { error: '세션을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' } } };
  }
  if (!user) return { error: { status: 401, jsonBody: { error: '로그인이 필요합니다.' } } };
  if (!isAdmin(user.email)) {
    return { error: { status: 403, jsonBody: { error: '관리자만 접근할 수 있습니다.' } } };
  }
  return { user };
}

module.exports = {
  issue, clear, current, load, revokeAll, issueState, checkState, clearState, stateTarget,
  isAdmin, requireAdmin, COOKIE, MAX_AGE
};
