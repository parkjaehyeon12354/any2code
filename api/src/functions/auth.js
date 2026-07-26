const { app } = require('@azure/functions');
const session = require('../lib/session');
const { PROVIDERS, credentials, exchangeCode, fetchProfile } = require('../lib/providers');

/** 콜백 주소는 요청 자신의 오리진에서 만든다 — 스테이징 환경마다 도메인이 달라서
    하드코딩하면 프리뷰 배포에서 깨진다. */
const redirectUri = (request, provider) =>
  `${new URL(request.url).origin}/api/auth/${provider}/callback`;

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
        headers: { Location: '/Index.html' },
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
        role: user.role
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
