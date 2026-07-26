# Ans2Quest

고등학교 과학 탐구 · 질의응답 커뮤니티. 정적 HTML + Azure Functions(`api/`).

## 배포

`main` 에 push → GitHub Actions → Azure Static Web Apps.

Actions 를 못 쓸 때는 로컬에서 직접 올린다:

```
npx -y @azure/static-web-apps-cli deploy ./ --api-location api --env production --deployment-token <토큰>
```

## staticwebapp.config.json 을 고칠 때

**`allowedRoles` 를 넣지 말 것.** 이 사이트는 SWA 내장 인증(`/.auth`)을 쓰지 않는다.
Free 플랜이 커스텀 OIDC 를 지원하지 않아 카카오를 붙일 수 없어서, OAuth 를 `api/` 에
직접 구현했다. 그래서 SWA 입장에서는 로그인한 사용자도 전부 `anonymous` 다 —
`allowedRoles: ["authenticated"]` 규칙을 두면 **아무도** 그 경로에 못 들어간다.

권한 판정은 전부 `/api` 의 세션 쿠키가 한다. `admin.html` 은 누구나 열 수 있지만
데이터는 API 가 내주지 않는다.

또 이 파일은 스키마에 정의된 키만 허용한다. `"//주석"` 같은 임의 키를 넣으면
배포가 실패한다 (JSON 이라 주석도 못 쓴다).

## 환경 변수 (Azure 앱 설정)

| 이름 | 용도 |
|---|---|
| `SESSION_SECRET` | 세션 쿠키 서명 키. 32자 이상, 로컬과 다른 값 |
| `ADMIN_EMAILS` | 관리자 이메일. 쉼표로 구분 |
| `{KAKAO,GOOGLE,GITHUB,DISCORD}_CLIENT_ID` | OAuth 앱 ID |
| `{KAKAO,GOOGLE,GITHUB,DISCORD}_CLIENT_SECRET` | OAuth 앱 시크릿 |

콜백 주소는 `{사이트주소}/api/auth/{제공자}/callback`.

## 테스트

```
cd api && node --test
```
