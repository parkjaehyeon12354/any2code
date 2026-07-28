const { app } = require('@azure/functions');
const session = require('../lib/session');
const { PROVIDERS, credentials, exchangeCode, fetchProfile } = require('../lib/providers');

/** 콜백 주소.

    SWA 는 Functions 를 내부 호스트(<guid>.azurewebsites.net)로 호출한다.
    그래서 request.url 의 오리진을 쓰면 제공자에 등록해 둔 주소와 달라져
    "등록되지 않은 redirect_uri" 로 로그인이 거부된다.

    공개 도메인은 PUBLIC_ORIGIN 으로 명시한다. 어차피 OAuth 제공자는
    사전 등록된 주소만 받으므로 자동 추론해 봐야 쓸 수 있는 값이 아니다.
    로컬 개발에서는 없어도 request.url 로 맞는다. */
const redirectUri = (request, provider) => {
  const origin = process.env.PUBLIC_ORIGIN?.replace(/\/+$/, '') || new URL(request.url).origin;
  return `${origin}/api/auth/${provider}/callback`;
};

/* ── 1) 로그인 시작 ──
   프론트엔드는 <a href="/api/auth/kakao/start"> 링크 하나면 된다.
   state 를 서버가 발급하고 httpOnly 쿠키에 심는다 (프론트 sessionStorage 방식은
   서버가 대조할 수 없어서 CSRF 방어가 안 됐다). */
app.http('authStart', {
  route: 'auth/{provider}/start',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request) => {
    const provider = request.params.provider;
    if (!PROVIDERS[provider]) return { status: 404, body: '알 수 없는 로그인 제공자입니다.' };

    let creds;
    try {
      creds = credentials(provider);
    } catch (e) {
      return { status: 503, body: e.message };
    }

    const { state, cookie } = session.issueState(provider);
    const url = new URL(PROVIDERS[provider].authorizeUrl);
    url.searchParams.set('client_id', creds.id);
    url.searchParams.set('redirect_uri', redirectUri(request, provider));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    if (PROVIDERS[provider].scope) url.searchParams.set('scope', PROVIDERS[provider].scope);

    return { status: 302, headers: { Location: url.toString() }, cookies: [cookie] };
  }
});

/* ── 2) 콜백 ── */
app.http('authCallback', {
  route: 'auth/{provider}/callback',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const provider = request.params.provider;
    if (!PROVIDERS[provider]) return { status: 404, body: '알 수 없는 로그인 제공자입니다.' };

    const q = new URL(request.url).searchParams;
    const fail = (reason) => ({
      status: 302,
      headers: { Location: `/login.html?error=${encodeURIComponent(reason)}` },
      cookies: [session.clearState()]
    });

    if (q.get('error')) return fail('cancelled');                       // 사용자가 동의 거부
    const code = q.get('code');
    if (!code) return fail('no_code');

    // CSRF: 우리가 발급한 state 인지 서버가 직접 대조
    if (!session.checkState(request, q.get('state'), provider)) return fail('bad_state');

    try {
      const token = await exchangeCode(provider, code, redirectUri(request, provider));
      const profile = await fetchProfile(provider, token);

      // 관리자 판정은 서버에서만. 클라이언트가 보낸 값은 절대 신뢰하지 않는다.
      const user = {
        sub: `${profile.provider}:${profile.id}`,
        name: profile.name,
        email: profile.email,
        picture: profile.picture,
        provider: profile.provider,
        role: session.isAdmin(profile.email) ? 'admin' : 'user'
      };

      // 세션 발급과 state 쿠키 폐기를 한 응답에 함께 싣는다
      return {
        status: 302,
        headers: { Location: '/' },
        cookies: [session.issue(user), session.clearState()]
      };
    } catch (e) {
      context.error('OAuth 콜백 실패:', e.message);   // 토큰/시크릿 자체는 로그에 남기지 않는다
      return fail('exchange_failed');
    }
  }
});

/* ── 3) 현재 사용자 ──
   프론트엔드는 이 응답만 믿는다. sessionStorage 는 더 이상 권한 근거가 아니다. */
app.http('me', {
  route: 'me',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request) => {
    const user = session.current(request);
    if (!user) return { status: 401, jsonBody: { authenticated: false } };
    return {
      jsonBody: {
        authenticated: true,
        name: user.name,
        email: user.email,
        picture: user.picture,
        provider: user.provider,
        // 쿠키에 박힌 role 이 아니라 지금 기준으로 판정한다 — ADMIN_EMAILS 에서
        // 빠진 사람은 다음 새로고침부터 관리자 메뉴가 사라진다
        role: session.isAdmin(user.email) ? 'admin' : 'user'
      },
      headers: { 'Cache-Control': 'no-store' }
    };
  }
});

/* ── 4) 로그아웃 ── */
app.http('logout', {
  route: 'auth/logout',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async () => ({ status: 204, cookies: [session.clear()] })
});
