# 인수인계 — Ans2Quest

마지막 갱신: 2026-08-23 · 배포된 커밋 `40ce2f0`

새 대화를 시작하는 사람이 **이 파일 하나만 읽고** 이어받을 수 있게 쓴 문서입니다.
프로젝트 전체 상태는 [progress.md](progress.md)에, 도구·환경 규칙은 저장소 밖
`D:\코딩\CLAUDE.md`에 있습니다.

---

## 지금 상태

**전부 배포됨. 커밋 안 된 변경 없음. 실패 중인 테스트 없음.**

```
https://ans2quest.com          라이브
테스트 138개 통과
```

확인 명령:

```bash
cd D:/코딩/any2code && git status --short && cd api && node --test
```

아무것도 안 나오고 `pass 138`이면 이 문서와 같은 상태입니다.

**단 하나 막혀 있는 것** — `/science`(AI 과학 도우미)는 화면도 배포도 끝났는데
`OPENAI_API_KEY`가 Azure 앱 설정에 없어서 질문을 보내면 502가 옵니다. 자세한 건
아래 '남은 일'에.

---

## 이번 라운드에 한 일

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
- **한국어 조사** — `항소`→`소명` 같은 일괄 치환은 받침이 달라져서 `소명를/가/와/는/로`가
  전부 틀립니다. 지난번에 10곳을 손봤습니다

---

## 남은 일

**0. `OPENAI_API_KEY`를 Azure에 넣기 — 지금 유일하게 막혀 있는 것**

`/science` 화면과 `llm/chat` 함수는 배포까지 끝났습니다. 키가 없어서 502를 냅니다.

```
$ curl -X POST -H "Content-Type: application/json" \
    -d '{"question":"t","subject":"physics"}' https://ans2quest.com/api/llm/chat
{"error":"OPENAI_API_KEY is not set in environment"}
```

**저장소가 아니라 Azure 쪽 설정이라 커밋으로는 해결이 안 됩니다.**

```bash
az staticwebapp appsettings set -n ans2quest-rg -g ans2quest-rg --setting-names OPENAI_API_KEY=<키>
```

포털이면 Static Web Apps → `ans2quest-rg` → 환경 변수. 재배포 없이 몇 분 안에
반영됩니다. 모델을 바꿀 거면 `OPENAI_MODEL`도 같이 (기본값 `gpt-5.6-luna`).

**비용 주의** — `llmChat`은 `authLevel: 'anonymous'`에 IP당 시간당 20회 제한입니다.
공개 사이트에 유료 키를 물리는 구조라 한 번 생각해볼 지점입니다.

나머지는 [progress.md](progress.md)의 '남은 일'에 우선순위대로 있습니다 — 카카오
로그인, 답변 수정·삭제, 시뮬레이션 추가, 심화 탐구 연결.

**기다리던 결정 두 개는 답이 나왔습니다.** 카드 미리보기 색은 그대로 두기로, 목록
페이지는 남기고 드롭다운에 링크를 넣기로. 다시 묻지 마세요.

---

## 팀

박재현 · 최윤지 (팀 투코드) — 2026년 AI·가상융합(XR) 서비스 개발자 경진대회

저장소에 둘 다 push합니다. 최윤지는 **맥북 에어**에서 작업합니다. **원격에 남의 커밋이
있을 수 있으니 push 전에 `git fetch`로 확인하고, 남의 파일을 되돌리는 변경은 먼저
물어보세요.**
