# Ans2Quest

고등학교 과학 탐구 · 질의응답 커뮤니티. 정적 HTML + Azure Functions(`api/`).

## 배포

`main` 에 push → GitHub Actions → Azure Static Web Apps.

Actions 를 못 쓸 때는 로컬에서 직접 올린다. 저장소를 그대로 올리지 않고
`deploy-ans2quest/` 에 배포할 파일만 복사한 뒤 **한 단계 위 폴더에서** 실행한다.

```
cd /d "D:\코딩"
set SWA_CLI_DEPLOYMENT_TOKEN=<토큰>
npx -y @azure/static-web-apps-cli deploy ./deploy-ans2quest --api-location ./deploy-ans2quest/api --env production
```

두 가지를 지켜야 한다.

**현재 폴더가 배포 대상과 같으면 안 된다.** StaticSitesClient 가
`Current directory cannot be identical to or contained within artifact folders`
로 거부한다. 저장소 루트에서 루트를 배포했을 때는 `.git` 이 깨지기까지 했다.

**저장소를 통째로 올리지 않는다.** `.git`, `docs/`, `README.md`, `*.test.js`,
`local.settings.json` 이 정적 파일로 서빙되면 안 된다. `SKIP_API_BUILD` 라
서버에서 npm install 을 하지 않으므로 `api/node_modules` 는 반드시 포함한다.

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
| `PUBLIC_ORIGIN` | 공개 도메인. 없으면 OAuth 콜백이 내부 호스트로 나가 로그인이 거부된다 |
| `COSMOS_CONNECTION` | Cosmos DB 기본 연결 문자열 |
| `LOCKDOWN` | **킬 스위치.** `1` 로 설정하면 모든 API 가 503 — 로그인·글쓰기·조회·관리자 전부 멈춘다 (로그아웃만 예외). 변수를 지우면 복구. 배포 불필요, 포털에서 저장하면 수십 초 내 반영 |

## 비상시 (계정 탈취 의심 등)

1. **사이트 정지**: Azure 포털 → 환경 변수 → `LOCKDOWN=1` 추가 → 저장.
   관리자 쿠키가 탈취돼도 이 스위치는 Azure 계정으로만 조작할 수 있다.
2. **전 세션 강제 로그아웃**: `SESSION_SECRET` 을 새 값으로 교체 → 저장.
   기존 쿠키 서명이 전부 무효가 되어 모두 다시 로그인해야 한다.
3. 원인 파악 후 `LOCKDOWN` 삭제로 복구.
| `{KAKAO,GOOGLE,GITHUB,DISCORD}_CLIENT_ID` | OAuth 앱 ID |
| `{KAKAO,GOOGLE,GITHUB,DISCORD}_CLIENT_SECRET` | OAuth 앱 시크릿 |

콜백 주소는 `{사이트주소}/api/auth/{제공자}/callback`.

## 테스트

```
cd api && node --test
```

## LLM 챗 엔드포인트

LLM 은 **OpenAI 호환 엔드포인트**로 부릅니다. 현재 기본값은 Upstage Solar 입니다.
`openai` 패키지를 그대로 쓰되 `baseURL` 만 갈아끼우는 방식이라, 다른 제공자로 옮길 때도
환경 변수만 바꾸면 됩니다 (코드 수정 불필요).

| 이름 | 필수 | 기본값 | 용도 |
|---|---|---|---|
| `LLM_API_KEY` | 필수 | — | API 키(Bearer). Azure 앱 설정에 저장하세요. |
| `LLM_BASE_URL` | 선택 | `https://api.upstage.ai/v1` | OpenAI 호환 엔드포인트 |
| `LLM_MODEL` | 선택 | `solar-pro4` | 모델 이름 |

**크레딧 한도** — 로그인 사용자에게 무료 200 크레딧을 주고 실제 토큰 사용량만큼
차감합니다(30 토큰 = 1 크레딧, 평균 8회). 한국 시간 00시 기준 3시간마다 초기화되며,
값은 `api/src/lib/credit.js` 상단 상수로 모여 있습니다. 별도 환경 변수는 없습니다.

환경변수를 설정하면 사이트의 `/api/llm/chat` 엔드포인트로 질문을 보낼 수 있습니다.

**모델을 바꿀 때 반드시 확인할 것** — 코드는 `max_tokens: 800` 을 보냅니다. thinking
계열 모델(Gemini 3.x 등)은 이 예산을 **사고 토큰이 먼저 소비**해서, 답변이 빈 채로
`finish_reason: length` 가 떨어집니다. 에러가 아니라 빈 문자열이라 조용히 깨집니다.
응답의 `usage.completion_tokens_details.reasoning_tokens` 가 0 인지 먼저 확인하세요.
