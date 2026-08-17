/* OAuth 제공자 설정.
   네 곳 모두 authorization code 흐름이라 URL·스코프·프로필 파싱만 다르다.

   ⚠ clientSecret 은 절대 코드에 두지 않는다 — Azure 앱 설정(환경변수)에서만 읽는다.
   로컬 개발은 api/local.settings.json 을 쓰고, 그 파일은 .gitignore 에 있다. */

const PROVIDERS = {
  kakao: {
    label: '카카오',
    authorizeUrl: 'https://kauth.kakao.com/oauth/authorize',
    tokenUrl: 'https://kauth.kakao.com/oauth/token',
    userUrl: 'https://kapi.kakao.com/v2/user/me',
    scope: 'account_email profile_nickname',
    env: { id: 'KAKAO_CLIENT_ID', secret: 'KAKAO_CLIENT_SECRET' },
    // 카카오는 이메일이 선택 동의라 없을 수 있다 — 그 경우 email 은 null
    profile: (u) => ({
      id: String(u.id),
      email: u.kakao_account?.email ?? null,
      name: u.kakao_account?.profile?.nickname ?? '카카오 사용자',
      picture: u.kakao_account?.profile?.profile_image_url ?? null
    })
  },

  google: {
    label: 'Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    scope: 'openid email profile',
    env: { id: 'GOOGLE_CLIENT_ID', secret: 'GOOGLE_CLIENT_SECRET' },
    profile: (u) => ({ id: u.sub, email: u.email ?? null, name: u.name ?? 'Google 사용자', picture: u.picture ?? null })
  },

  github: {
    label: 'GitHub',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userUrl: 'https://api.github.com/user',
    scope: 'read:user user:email',
    env: { id: 'GITHUB_CLIENT_ID', secret: 'GITHUB_CLIENT_SECRET' },
    profile: (u) => ({
      id: String(u.id),
      email: u.email ?? null,          // 비공개면 null → extraEmail 에서 보강
      name: u.name || u.login || 'GitHub 사용자',
      picture: u.avatar_url ?? null
    }),
    // GitHub 은 프로필 이메일이 비공개면 null 이라 별도 엔드포인트를 더 본다
    extraEmail: async (accessToken) => {
      const res = await fetch('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'Ans2Quest' }
      });
      if (!res.ok) return null;
      const list = await res.json();
      const primary = list.find(e => e.primary && e.verified) || list.find(e => e.verified);
      return primary?.email ?? null;
    }
  },

  discord: {
    label: 'Discord',
    authorizeUrl: 'https://discord.com/api/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userUrl: 'https://discord.com/api/users/@me',
    scope: 'identify email',
    env: { id: 'DISCORD_CLIENT_ID', secret: 'DISCORD_CLIENT_SECRET' },
    profile: (u) => ({
      id: u.id,
      email: u.email ?? null,
      name: u.global_name || u.username || 'Discord 사용자',
      picture: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png` : null
    })
  }
};

/** 환경변수에서 자격증명을 읽는다. 없으면 명확히 실패시킨다. */
function credentials(name) {
  const p = PROVIDERS[name];
  const id = process.env[p.env.id];
  const secret = process.env[p.env.secret];
  if (!id || !secret) {
    throw new Error(`${p.label} 자격증명이 없습니다. Azure 앱 설정에 ${p.env.id}, ${p.env.secret} 를 등록하세요.`);
  }
  return { id, secret };
}

/** 인가 코드 → 액세스 토큰 */
async function exchangeCode(name, code, redirectUri) {
  const p = PROVIDERS[name];
  const { id, secret } = credentials(name);
  const res = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: id,
      client_secret: secret,
      redirect_uri: redirectUri,
      code
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    // 토큰 응답 전체를 로그로 흘리면 시크릿이 새어나갈 수 있어 최소만 남긴다
    throw new Error(`${p.label} 토큰 교환 실패 (status ${res.status})`);
  }
  return data.access_token;
}

/** 액세스 토큰 → 사용자 프로필 (정규화된 형태) */
async function fetchProfile(name, accessToken) {
  const p = PROVIDERS[name];
  const res = await fetch(p.userUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'User-Agent': 'Ans2Quest' }
  });
  if (!res.ok) throw new Error(`${p.label} 프로필 조회 실패 (status ${res.status})`);
  const raw = await res.json();

  const profile = p.profile(raw);
  if (!profile.email && p.extraEmail) profile.email = await p.extraEmail(accessToken);
  return { ...profile, provider: name };
}

module.exports = { PROVIDERS, credentials, exchangeCode, fetchProfile };
