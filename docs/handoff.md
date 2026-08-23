# 인수인계 — Ans2Quest

마지막 갱신: 2026-08-24 · 배포된 커밋 `515f2a3`

새 대화를 시작하는 사람이 **이 파일 하나만 읽고** 이어받을 수 있게 쓴 문서입니다.
프로젝트 전체 상태는 [progress.md](progress.md)에, 도구·환경 규칙은 저장소 밖
`D:\코딩\CLAUDE.md`에 있습니다.

---

## 지금 상태

**전부 배포됨. 커밋 안 된 변경 없음. 실패 중인 테스트 없음.**

```
https://ans2quest.com          라이브
테스트 179개 통과
```

확인 명령:

```bash
cd D:/코딩/any2code && git status --short && cd api && node --test
```

아무것도 안 나오고 `pass 179`이면 이 문서와 같은 상태입니다.

**`/science`(AI 과학 도우미)가 이제 실제로 답합니다.** OpenAI 대신 **Upstage Solar**
(`solar-pro4`)를 쓰고, 키는 Azure 앱 설정의 `LLM_API_KEY` 에 들어가 있습니다.
막혀 있던 502 는 해소됐습니다.

---

## 이번 라운드에 한 일

### A. AI 도우미를 Upstage Solar 로 옮기고 실제로 답하게 만들었다 (`8d76dfb`)

`OPENAI_API_KEY` 가 없어 502 였다. 키를 넣는 대신 제공자를 바꿨다.

호출은 `openai` 패키지를 그대로 쓰고 `baseURL` 만 갈아끼운다. 의존성이 늘지 않고,
다음에 제공자를 옮길 때도 환경 변수만 바꾸면 된다.

| 환경 변수 | 기본값 |
|---|---|
| `LLM_API_KEY` | (필수) |
| `LLM_BASE_URL` | `https://api.upstage.ai/v1` |
| `LLM_MODEL` | `solar-pro4` |

`responses.create` 는 OpenAI 전용이라 호환 엔드포인트에 없다. `chat.completions` 로
바꾸면서 `instructions` 는 system 메시지로, `output_text` 는
`choices[0].message.content` 로 옮겼다.

**⚠ 모델을 바꿀 때 반드시 확인할 것 — thinking 모델은 답변이 통째로 빈다.**
처음에 Gemini 3.7 Flash 로 붙였다가 답변이 빈 채로 돌아왔다. thinking 계열은
`max_tokens` 예산을 **사고 토큰이 먼저** 먹어서, `finish_reason: length` 에
`completion_tokens: 0` 이 떨어진다. **에러가 아니라 빈 문자열**이라 코드는 정상
동작한 것처럼 보이고 화면에만 "AI가 빈 답변을 반환했습니다" 가 뜬다.
`solar-pro4` 는 `reasoning_tokens` 가 0 이라 해당 없지만, 모델 교체 시
응답의 `usage.completion_tokens_details.reasoning_tokens` 를 먼저 봐야 한다.

Gemini 무료 티어는 **하루 20회**(`GenerateRequestsPerDayPerProjectPerModel-FreeTier`)
라 공개 서비스에는 못 쓴다. 429 응답이 그 수치를 직접 알려준다 — 가격표보다 정확하다.

### B. 답변의 수식이 LaTeX 원문으로 노출됐다 (`9a5b1a8`, `e3340f9`)

화면에 `\(\sin\theta \approx \theta\)` 가 그대로 보였다. `llm.js` 가 답변을
`textContent` 로 꽂고 있었다.

**KaTeX 는 못 쓴다.** `staticwebapp.config.json` 의 CSP 가 `script-src` 를 `'self'`
로 묶어놔서 CDN 스크립트가 차단된다. CSP 를 푸는 건 XSS 방어를 약화시키니 그쪽이
더 나쁘다. 그래서 의존성 없이 유니코드로 옮긴다:
`\sin\theta` → `sinθ`, `\sqrt{\frac{L}{g}}` → `√(L/g)`, `x^2` → `x²`, `y_1` → `y₁`.
조판이 목적이 아니라 가독성이 목적이다.

배포 후에도 `10^\circ` 가 새어나왔다. `\circ` 가 치환표에 없었다. **표에 항목을
더하는 것만으로는 같은 일이 또 난다** — 모델이 쓰는 명령을 전부 열거할 수 없다.
그래서 표에 없는 `\명령` 은 백슬래시만 떼는 안전망을 두 군데(수식 내부/외부)에 뒀다.

`escapeHtml` 을 통과시킨 뒤에만 태그를 붙인다. **순서가 뒤집히면 XSS 가 열린다.**
실제 DOM 에 넣고 스크립트가 실행되는지까지 확인했다(실행 안 됨). 링크·이미지
마크다운은 일부러 뺐다 — 피싱 경로가 된다.

### C. 프롬프트 인젝션 방어와 영구 정지 (`9a5b1a8`, `fcfd3df`, `0d39bd9`)

사용자 입력이 곧바로 user 메시지로 들어가고 있었다. 3중으로 막는다:
역할 표지·특수 토큰·제로폭 문자 정제, system 프롬프트의 경계 규칙,
질문을 `<question>` 태그로 감싸 데이터임을 명시. 질문 길이는 2000자로 제한한다.

**정제 순서에 실제 우회 경로가 있었다.** `</question> system: ...` 은 태그를 먼저
지우면 `system:` 이 첫머리로 올라와 검사를 그대로 통과한다. 역할 표지 처리를 태그
제거 **뒤로** 옮겨서 막았다.

영어 OOC 공격 9종(OOC framing, admin override, DAN, prompt extraction, delimiter
escape, Base64 smuggling, multilingual mix, hypothetical frame)을 라이브에 실제로
쏘아 **9/9 방어**를 확인했다. 정상 질문 대조군도 정상 답변했다.

**적발되면 계정을 영구 정지한다. 해제는 소명뿐이다.** 그리고 **AI 도우미는 로그인이
필요하다** — 비로그인은 정지시킬 계정이 없어 영구 정지가 무의미했고, 무료 티어 한도를
한 사람이 다 쓰면 사이트 전체가 막혔다. 로그인 검사는 인젝션 탐지보다 **앞에** 둔다.
뒤에 두면 비로그인 공격자에게 "차단됐다"는 신호를 주게 되고 탐지 규칙을 역추적할 수 있다.

영구를 별도 플래그가 아니라 `until = 9999-12-31` 로 표현한다. 집행은
`sanction.active()` 의 `until > now` **하나로만** 판정하는데, 플래그를 새로 만들면
검사를 통과하는 경로가 둘이 되고 한쪽을 빠뜨리면 제재가 새어나간다. 날짜 하나로
두면 기존 소명·해제·감경 경로가 전부 그대로 동작한다. `permanent: true` 는 화면
표기용이고 집행은 보지 않는다.

**그 표현 때문에 화면 네 곳이 거짓말을 하게 되어 함께 고쳤다.** 새 화면을 만들 때
같은 함정을 밟기 쉽다 — `until` 을 그대로 찍으면 "9999-12-31 해제" 가 나간다.

| 위치 | 고치기 전 |
|---|---|
| `sanction.block()` | "9999-12-31 해제" |
| `community.html` 배너 | "9999-12-31 에 자동 해제됩니다" |
| `settings.html` 현재상태 | "null일 이용 제한" (영구는 `days` 가 null) |
| `settings.html` 이력 | 같은 문제 |

`/api/me` 에 `suspendedPermanent` 를 실어 화면이 구분할 수 있게 했다.
`science.html` 에는 제재 배너와 소명 모달을 붙였다(community.html 과 같은 규격).
정지가 걸리는 화면에서 바로 풀 수 있어야 한다.

**오탐 방지가 이 기능의 핵심이다.** 자동 판정이 사람을 영구 정지시키므로
서로 다른 범주 **2개 이상**이 걸려야 공격으로 본다. `ignore` 나 `무시` 한 단어로
막으면 "공기 저항은 무시하고 계산해줘" 가 걸린다. 정상 질문 10종으로 오탐이
없는지 검사한다.

### D. 카카오 로그인을 붙였다 (`a9bccd8`)

콘솔 설정(저장소 밖)과 코드 양쪽을 손봤다.

콘솔에서 한 일 — 앱 `Ans2Quest`(ID 1554449):
- 카카오 로그인 리다이렉트 URI: `https://ans2quest.com/api/auth/kakao/callback`
- 동의항목 닉네임: `사용 안 함` → `필수 동의`
- Client Secret 은 이미 발급·활성화 상태였다
- Azure 에 `KAKAO_CLIENT_ID` / `KAKAO_CLIENT_SECRET` 등록

**scope 에서 `account_email` 을 뺐다.** 콘솔에서 이메일이 "권한 없음" 이었다.
이메일은 비즈 앱으로 전환해야 권한이 생기는데, 사업자 정보 등록이나 개인 개발자
본인인증이 필요하다. **권한 없는 항목을 scope 에 넣으면 카카오가 인가 요청 자체를
거부한다** — 버튼을 눌러도 아무 일이 없는 형태로 실패한다.

이메일이 `null` 로 들어와도 안전하다. `providers.js` 의 `profile()` 이 이미 null 을
반환하고, `session.js` 의 `isAdmin()` 은 `!!email` 로 먼저 거른다. **즉 카카오 계정은
관리자가 될 수 없다 — 관리자 작업은 구글 계정으로 한다.**

비즈 앱 전환 후에는 `'account_email profile_nickname'` 으로 되돌리면 된다.

### E. 로그인 후 원래 화면으로 돌아온다 (`e608a60`)

콜백이 `Location: '/'` 로 고정돼 있어서 `/science` 에서 로그인하면 메인으로 튕겼다.

돌아갈 경로를 **서명된 state 토큰 안에** 실어 보낸다. 쿼리스트링으로 그냥 받으면
오픈 리다이렉트가 되므로 `safePath()` 로 같은 사이트 경로만 통과시킨 뒤 서명한다.
막는 것: `https://evil.com`, `//evil.com`, `/\evil.com`, `javascript:`, 개행(헤더 인젝션).

콜백에서도 **다시** 검증한다. 서명은 "우리가 발급했다" 만 보장하지 값의 안전성은
보장하지 않는다.

### F. AI 크레딧 한도 (`f0c3b80`, `8449460`)

무료 **200 크레딧**, 실제 토큰 사용량만큼 차감. **30 토큰 = 1 크레딧.**

횟수가 아니라 토큰으로 세는 이유 — 같은 과학 질문인데 답변 길이가 크게 갈렸다
(실측 394 ~ 1080 토큰). 횟수로 세면 짧게 묻는 학생이 손해를 본다.

단가는 추측하지 않고 실측해서 정했다(solar-pro4, system 프롬프트 포함):

| 질문 | 토큰 |
|---|---|
| 렌츠의 법칙 | 394 |
| 단진자 주기 유도 | 1080 |
| 광합성과 호흡 | 470 |
| 산과 염기 | 699 |
| **평균** | **661** |

→ 평균 23 크레딧/회, **200 크레딧으로 약 8회**. 짧게 물으면 14회까지.

**00시 기준 3시간마다 초기화**(00·03·06·09·12·15·18·21시, 한국 시간).
스케줄러를 두지 않고 '읽을 때 판단' 한다. 문서에 마지막 구간(`period`)을 적어두고
지금 구간과 다르면 그 자리에서 사용량을 0 으로 본다. 크론이 없어도 되고, 안 쓰는
사용자 문서를 건드리지 않아도 된다.

`balance()` 는 구간이 지났어도 **문서를 고치지 않는다**. 읽기 함수가 쓰기까지 하면
`/api/me` 호출마다 DB 쓰기가 생긴다. 실제 정리는 다음 `consume()` 이 한다.

설계에서 정한 것 두 가지:
- **잔액이 모자라도 요청을 막지 않는다.** 얼마나 들지는 답변을 받아야 안다.
  결과적으로 마지막 한 번은 초과한다(실제로 `used: 212 / granted: 200` 이 나왔다).
  답변을 받다가 잘리는 것보다 낫다고 봤다.
- **차감이 실패해도 답변은 보낸다.** 답변은 이미 만들어졌는데 예외를 던지면
  사용자가 오류 화면을 본다. 로그만 남긴다.

`grant()` 로 준 추가분은 다음 초기화에 사라진다. 3시간마다 다시 채워지는 구조라
그게 자연스럽다고 봤다. 영구 지급이 필요해지면 별도 필드를 둬야 한다.

관리자 화면(`/admin` → AI 크레딧)에서 사용자별 잔액을 보고 지급할 수 있다.
목록은 `credit` 문서가 아니라 `user` 문서를 기준으로 만든다 — `credit` 문서는 한
번이라도 쓴 사람만 갖고 있어서, 그것만 보면 정작 크레딧이 필요한 신규 사용자가
목록에서 빠진다. 지급 금액은 1~2000 으로 제한했다.

**여기서 이틀치 삽질을 했다.** 지급이 특정 계정에서만 503 이었다.

첫 진단은 틀렸다 — 옛 문서에 `period` 필드가 없어 `patch` 가 실패한다고 보고
`upsert` 로 바꿨는데 그대로였다(그건 별개로 실재하는 문제라 고친 채로 뒀다).

진짜 원인은 **문서 id 충돌**이었다. Cosmos 는 `(id, partitionKey)` 로 문서를
구분하는데, 제재 문서가 이미 `id: sub, pk: sub` 을 쓰고 있었고 크레딧 문서도
똑같이 썼다. 두 문서가 같은 자리를 다투며 서로를 덮었다.

**제재를 받은 적 있는 계정만 실패해서 원인이 늦게 드러났다.** 시연용으로 영구
정지를 걸어둔 그 계정이 마침 목록 맨 위에 있었다. `credit:` 접두사를 붙여 해결했다
(`profile.js` 가 `user:` 를 쓰는 것과 같은 규칙).

**교훈** — 사용자당 하나뿐인 문서를 새로 만들 때는 `id` 에 타입 접두사를 붙일 것.
`pk` 는 `sub` 그대로 둔다(조회가 `pk` 로 걸린다).

### G. 그 밖에 잡은 것

- **`science.html` 이 `theme.js` 를 안 읽고 있었다** — progress.md 에 적힌 그 부류다.
  사이트는 다크인데 이 페이지만 하얗게 떴다. 입력창 배경도 리터럴 `#fff` 였다.
  `session.js` / `nav-user.js` 도 없어서 함께 추가했다.
- **콘솔의 404 는 우리 코드가 아니다.** 긴 난수 경로(`/uZfB5lWnCt...`)에
  `ERR_ABORTED` 가 찍히는데, 저장소에 그런 요청을 하는 코드가 없다. 브라우저 확장이나
  보안 소프트웨어가 주입한 것이다. 자원 4개(`theme.js`·`llm.js`·`styles.css`·
  `session.js`)는 전부 200 이다.

---

## 지난 라운드에 한 일

### 0. WSL(Claude Code CLI)로 이전하면서 잡은 것 두 개 (`40ce2f0`)

**`SESSION_SECRET` 이 실제 시크릿이 아니라 생성 명령어 문자열이었습니다.** Azure 앱
설정에 이 값이 그대로 들어가 있었습니다:

```
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | clip
```

명령을 복사해 붙여넣는 과정에서 결과 대신 명령 자체가 들어간 것으로 보입니다. 값이
고정 문자열이라 이걸 아는 사람은 세션 쿠키를 위조할 수 있습니다 — progress.md 가
경고한 "SESSION_SECRET 이 공개값으로 덮이면 누구나 관리자 쿠키 위조" 와 같은 상황입니다.
64 자 난수로 교체했습니다. **그 시점의 로그인 세션은 전부 무효화됐습니다** (정상 동작).

```bash
az staticwebapp appsettings list -n ans2quest-rg -g ans2quest-rg   # 값 확인
```

**줄바꿈 전용 diff 22 개 파일.** WSL 에서 `git status --short` 에 22 개가 뜨는데
`git diff --ignore-all-space` 는 완전히 비어 있었습니다. 삽입 6460 / 삭제 6460 으로
숫자가 정확히 같은 게 신호입니다 — HEAD 는 LF 인데 작업 트리만 CRLF 였고 내용은 한
글자도 안 바뀐 상태였습니다. 그대로 커밋했으면 22 개 파일이 통째로 CRLF 로 올라가
**맥북에서 작업하는 최윤지와 다음 병합에서 전 파일 충돌**이 났을 겁니다.

`.gitattributes` 에 `* text=auto eol=lf` 를 넣어 고정하고, 작업 트리는
`git reset --hard` 로 HEAD(LF) 에 맞췄습니다.

**`git status` 에 손댄 적 없는 파일이 무더기로 뜨면 먼저 이걸 의심하세요:**

```bash
git diff --ignore-all-space --stat   # 비어 있으면 EOL 문제, 내용 변경 0
```

### 1. 드롭다운에서 시뮬레이션 목록으로 가는 길 (`af81e10`)

드롭다운을 `주제 → 시뮬레이션` 두 단계로 바꾸면서 `/simulation/`으로 가는 링크가
어디에도 안 남았습니다. 주소를 직접 쳐야 들어갈 수 있었습니다.

물리학 드롭다운 '다른 주제' 칸 맨 아래에 `모든 시뮬레이션 보기` 한 줄을 넣었습니다.
위의 준비 중 주제들과 붙여두면 또 하나의 주제로 읽히므로 hairline으로 끊고 13px
`--muted`로 톤을 낮췄습니다. 대비는 밝은 모드 5.42:1, 다크 6.76:1로 둘 다 AA.

`/simulation/`은 rewrite 규칙 없이도 이미 200이라 `staticwebapp.config.json`은 안
건드렸습니다.

**드롭다운이 5개 파일에 복제돼 있습니다** — `Index.html`, `community.html`,
`guide.html`, `post.html`, `simulation/index.html`. 링크 한 줄에 5곳을 고쳐야 했습니다.
공통 파일로 뺄 만하지만 아직 안 했습니다.

### 2. 배포가 네 번 연속 깨진 것을 고침 (`b19a826`)

**이번 라운드에서 제일 오래 걸린 일이고, 다시 밟기 쉬운 함정입니다.**

최윤지가 AI 기능(`science.html`, `llm.js`, `api/src/functions/llmChat.js`)을 올린
`9dc6242`부터 배포가 깨졌습니다. 원인은 그 커밋이 **루트에 만든 빈
`package-lock.json`**이었습니다.

```json
{ "name": "any2code", "lockfileVersion": 3, "requires": true, "packages": {} }
```

`package.json`이 없는 폴더에서 `npm install`을 한 번 돌리면 npm이 이런 껍데기를
만들어 놓습니다. **Oryx는 lock 파일만 봐도 Node 프로젝트로 판정**하므로 빌드
스크립트를 찾다가 죽습니다.

```
Could not find either 'build' or 'build:azure' node under 'scripts' in package.json
```

**함정은 이 에러 메시지 자체에 있습니다.** 메시지가 "빌드 명령을 워크플로에
추가하라"고 안내하는데, 이 프로젝트는 정적 HTML이라 빌드할 게 애초에 없습니다.
안내를 따라 `skip_app_build: true`를 넣은 게 `61804cd`인데, 앱 빌드는 건너뛰었지만
**실패가 더 안쪽으로 옮겨갔습니다.**

그 설정은 `app_location`을 가공 없이 그대로 올립니다. 그런데 배포 로그의 실행
순서를 보면 그 시점엔 API 빌드가 이미 `api/node_modules`를 작업 폴더에 만들어둔
뒤입니다.

```
Copying production dependencies ... to '/github/workspace/api/node_modules'   ← 먼저
Zipping App Artifacts                                                          ← 그 다음
```

정적 콘텐츠가 50개 파일에서 **10,870개**로 불어나면서
`Failure during content distribution`이 됐습니다.

**고친 방법은 마지막으로 성공한 커밋(`5105472`)과의 차이를 지우는 것이었습니다.**
차이가 딱 둘 — 루트 lock 파일, `skip_app_build` — 이었고 둘 다 되돌리니 통과했습니다.
`.gitignore`에 루트만 막는 `/package-lock.json`을 넣었고(`api/` 것은 계속 추적됩니다),
워크플로에는 `skip_app_build`를 켜면 안 되는 이유를 주석으로 남겼습니다.

### 3. 지워졌던 경고 주석 복구 (`9808e04`)

`9dc6242`가 `openai` 의존성을 넣으면서 `api/package.json`의 `_main주의` 주석을 같이
지웠습니다. 실제로 한 번 밟았던 함정을 적어둔 줄이라 되살렸습니다 — `src/functions`에
`*.test.js`를 두면 런타임이 그걸 진입점으로 로드해 `SESSION_SECRET`이 테스트값으로
덮어써집니다.

---

## 배포가 깨졌을 때 쓸 수 있는 방법

이번에 실제로 통한 순서입니다.

**1. 실패 지점의 소요 시간을 비교하세요.** 로그를 못 볼 때도 됩니다.

```bash
curl -s "https://api.github.com/repos/parkjaehyeon12354/any2code/actions/runs/<id>/jobs"
```

이번엔 2초·4초 → 37초·37초였습니다. **시간이 밀렸다는 건 원인이 하나가 아니라는
뜻입니다.** 앞의 벽은 넘었고 다른 데서 새로 막힌 겁니다. 이걸 놓치면 하나의 원인만
계속 파게 됩니다.

**2. 경고를 원인으로 착각하지 마세요.** Actions 화면에 뜨는 `Node.js 20 is deprecated`는
자동 생성된 액션에 붙는 경고일 뿐입니다. 이걸 쫓아 `apiRuntime`을 22로 올린 커밋이
하나 있는데(`ac24341`) 실패 지점이 1초도 안 움직였습니다.

**3. 로그 본문은 `gh` 로 받습니다.** 공개 REST API 로는 403(인증 필요)이라 예전엔
브라우저로 펼쳐 봐야 했지만, 이제 터미널에서 바로 됩니다:

```bash
gh run view <id> --log-failed    # 실패한 스텝의 로그만
gh run view <id> --log           # 전체 로그
```

**4. 마지막 성공 커밋과의 차이를 지우는 게 가장 빠릅니다.** 원인을 완전히 몰라도
복구됩니다. 추측으로 새 설정을 얹으면 `61804cd`처럼 문제가 하나 더 늘어납니다.

**5. Azure CLI로 볼 수 있는 것과 없는 것.** 설치돼 있습니다
(`C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd`, 2.89.1).

```bash
az staticwebapp appsettings list -n ans2quest-rg -g ans2quest-rg   # 환경 변수 키 목록
az staticwebapp environment list -n ans2quest-rg -g ans2quest-rg   # 배포 환경 상태
az staticwebapp hostname list -n ans2quest-rg -g ans2quest-rg      # 도메인 상태
```

리소스는 구독 `Azure for Students`(`e03b2994-…`), 리소스 그룹·앱 이름 둘 다
`ans2quest-rg`, SKU는 **Free**입니다. **다만 배포 실패 이유는 az로도 안 나옵니다** —
`status: Failed`만 보이고, SWA 콘텐츠 배포는 ARM을 안 거쳐서 활동 로그에도 안 남습니다.

`az login`이 `AADSTS50076`으로 튕기면 MFA 때문입니다. 테넌트를 지정하면 됩니다:
`az login --tenant 01401ed3-ecf6-4bcd-9ae9-95d8458cadaf`

---

## 이어서 할 때 알아야 할 것

### 배포

`main`에 push하면 GitHub Actions가 바로 배포합니다. **스테이징 없습니다.**
테스트가 게이트라 빨간 테스트는 배포를 막습니다.

- **`gh` CLI가 설치돼 있습니다.** 배포 상태는 이걸로 봅니다:

```bash
gh run list --limit 3          # 최근 배포
gh run watch <id> --exit-status # 끝날 때까지 지켜보기
```

  공개 REST API(`curl`)도 여전히 됩니다. 다만 `WebFetch`는 URL당 15분 캐시라
  폴링에 쓰면 **끝난 배포가 이전 결과로 나옵니다.** 폴링은 `gh` 나 `curl` 로 하세요.

**루트에서 `npm install`을 하지 마세요.** 의존성은 `api/` 안에서만 설치합니다.
`.gitignore`가 커밋은 막아주지만 로컬에 잔재가 남습니다.

### 검증

**화면을 보지 않으면 못 잡는 버그가 이 프로젝트의 주력 버그입니다.** 지난 라운드에
잡은 5개 전부 API는 정상 응답했고 테스트도 초록이었습니다.

로컬은 `.claude/launch.json`의 **`any2code`** 항목(`npx serve`, 5500)으로 띄웁니다.
정적 서버라 `/api/*`는 전부 404입니다 — 콘솔의 `api/me` 404는 정상이니 무시하세요.
API 동작과 rewrite 규칙은 **도메인으로** 확인합니다. 같은 파일의 `vite` 항목은 루트
React 프로젝트용이라 `any2code`를 못 띄웁니다.

측정할 때 `.mega-col a`처럼 `transition`이 걸린 요소는 테마를 바꾼 직후
`getComputedStyle`이 **전환 중간값**을 돌려줍니다. 밝은 모드 대비가 2.66:1로 나와서
한 번 속았습니다. `*{transition:none!important}`를 넣고 재세요.

숫자 검사가 헛돈 사례도 있었습니다 — `el.getClientRects().length`는 블록 요소면 항상
1이고, 다크 CSS 블록을 찾던 정규식은 닫는 `}`가 들여쓰기돼 있어 **빈 문자열을 검사**하고
있었습니다. 검사를 쓰면 **버그를 다시 넣어 빨개지는지 확인**하세요.

### 밟으면 아픈 것들

- **루트에 `package.json` / `package-lock.json`을 만들지 마세요** — Oryx가 Node 앱으로
  오인해 배포가 깨집니다. 빌드 스크립트를 넣어 "고치는" 것도 답이 아닙니다. 빌드할 게
  없는 프로젝트입니다
- **`skip_app_build: true`를 켜지 마세요** — 위 사고의 2차 원인
- **`admin/`은 Functions 예약 접두사** — 등록이 조용히 거부되고 로그에도 안 남습니다.
  이 프로젝트는 `moderation/`을 씁니다
- **Cosmos 신원은 `(pk, id)`** — 같은 쌍이면 같은 문서라 `upsert`가 남의 문서를
  조용히 지웁니다. `user`는 반드시 `user:` 접두사를 유지해야 합니다
- **혼합 타입에 `ORDER BY` 금지** — 정렬 필드가 없는 문서가 통째로 사라집니다
- **HTML에 캐시 헤더가 없습니다** — 배포 직후 "안 고쳐졌다" 싶으면 이걸 먼저 의심하고
  `?cachebust=<sha>`로 확인하세요
- **줄바꿈은 LF 고정** — `.gitattributes` 가 `* text=auto eol=lf` 로 잡아둡니다. Windows
  에디터가 CRLF 로 저장해도 커밋은 LF 로 들어갑니다. 손댄 적 없는 파일이 `git status`
  에 무더기로 뜨면 `git diff --ignore-all-space --stat` 로 먼저 확인하세요 — 비어 있으면
  내용 변경 0 입니다
- **영구 제재는 `until = 9999-12-31`** — 별도 플래그가 아니라 날짜로 표현합니다.
  제재를 화면에 그리는 코드를 새로 쓸 때 `until` 을 그대로 찍으면 "9999-12-31 해제"
  가 나갑니다. `permanent` 를 먼저 보고 분기하세요. `days` 도 null 이라
  `days + '일'` 은 "null일" 이 됩니다
- **LLM 모델 교체 시 `reasoning_tokens` 확인** — thinking 계열은 `max_tokens` 예산을
  사고 토큰이 먼저 먹어서 답변이 **빈 문자열**로 옵니다. 에러가 아니라 조용히 깨집니다
- **사용자당 하나뿐인 문서는 `id` 에 타입 접두사를 붙이세요** — Cosmos 는
  `(id, partitionKey)` 로 문서를 구분합니다. 제재 문서가 `id: sub, pk: sub` 을
  쓰므로, 새 타입이 같은 값을 쓰면 두 문서가 같은 자리를 다투며 서로를 덮습니다.
  크레딧에서 실제로 났고, **제재 이력이 있는 계정만 실패해서** 원인이 한참 늦게
  드러났습니다. `profile.js` 의 `'user:' + sub` 가 올바른 예입니다.
- **크레딧·제재 문서는 `patch` 가 아니라 `upsert`** — 기능을 붙이기 전에 만들어진
  문서에는 새 필드(`period` 등)가 없어서 `set /필드` 가 실패합니다
- **크레딧 초기화는 한국 시간 기준입니다** — Azure Functions 는 UTC 로 돕니다.
  `credit.js` 의 `currentPeriod()` 가 KST 보정을 합니다. 빼먹으면 한국 오전 9시에
  초기화됩니다.

  ⚠ **이 버그는 어설픈 테스트로 안 잡힙니다.** KST 오프셋 9시간이 초기화 주기
  3시간의 배수라, 보정을 통째로 지워도 "경계에서 값이 바뀌는가" 검사는 전부
  통과합니다. 실제로 그렇게 짰다가 역검증에서 드러났습니다. 구간 경계의 **실제
  시각**을 한국 시간으로 읽어 0·3·6·…·21시 정각인지 확인해야 합니다
- **카카오는 이메일을 못 받습니다** — 비즈 앱이 아니라 `account_email` 권한이
  없습니다. scope 에 넣으면 인가 요청 자체가 거부되어 **버튼을 눌러도 아무 반응이
  없는 것처럼** 실패합니다. 이메일이 `null` 이라 카카오 계정은 관리자가 될 수
  없습니다 — 관리자 작업은 구글 계정으로 하세요
- **`--surface` 와 `--line` 은 존재하지 않는 토큰입니다** — `styles.css` 에 정의된
  적이 없어서 `var(--surface, #fff)` 의 폴백이 항상 쓰입니다. 그래서 다크에서도
  카드가 흰색으로 남습니다. 실제 토큰은 `--surface-soft` / `--hairline` 입니다
- **다크에서 `--primary` 는 흰색(`#f2f2f2`)입니다** — 큰 면을 채우면 눈이 부십니다.
  말풍선처럼 넓은 곳은 화면 전용 변수로 덮어쓰세요(`--primary` 를 고치면 사이트
  전체 버튼이 바뀝니다). 그때 `--surface-dark-elevated` 는 쓰지 마세요 — 다크에서
  그 값(`#1b1b1b`)이 카드 배경과 **똑같아** 말풍선이 묻힙니다. `--hairline` 을 쓰세요
- **AI 답변에 KaTeX 를 붙일 수 없습니다** — CSP 가 `script-src 'self'` 라 CDN 이
  막힙니다. `llm.js` 가 유니코드로 직접 변환합니다. CSP 를 풀지 마세요
- **한국어 조사** — `항소`→`소명` 같은 일괄 치환은 받침이 달라져서 `소명를/가/와/는/로`가
  전부 틀립니다. 지난번에 10곳을 손봤습니다

---

## 남은 일

**1. AI 가 자기 모델명을 밝힌다**

prompt extraction 시도에 "저는 Upstage AI에서 만든 Solar로서" 라고 답했다. 시스템
프롬프트 유출은 아니지만, 공격자가 모델을 알면 그 모델에 맞는 우회 기법을 고를 수
있다. system 프롬프트에 모델명을 밝히지 말라는 줄을 추가하면 된다.

**2. 채팅 사용량 카운터가 메모리에 있다**

`chatAllowed` 가 `Map` 을 쓰므로 Functions 인스턴스가 재활용되면 초기화된다. 지금은
로그인 필수라 무한 우회는 아니지만, 정확한 한도 집행이 필요해지면 Cosmos 로 옮겨야
한다.

나머지는 [progress.md](progress.md)의 '남은 일'에 우선순위대로 있습니다 — 답변
수정·삭제, 시뮬레이션 추가, 심화 탐구 연결.

**카카오 로그인은 끝났습니다** — 실제 로그인까지 확인했습니다
(`provider: kakao`, `email: null` 정상 처리).

**기다리던 결정 두 개는 답이 나왔습니다.** 카드 미리보기 색은 그대로 두기로, 목록
페이지는 남기고 드롭다운에 링크를 넣기로. 다시 묻지 마세요.

---

## 팀

박재현 · 최윤지 (팀 투코드) — 2026년 AI·가상융합(XR) 서비스 개발자 경진대회

저장소에 둘 다 push합니다. 최윤지는 **맥북 에어**에서 작업합니다. **원격에 남의 커밋이
있을 수 있으니 push 전에 `git fetch`로 확인하고, 남의 파일을 되돌리는 변경은 먼저
물어보세요.**
