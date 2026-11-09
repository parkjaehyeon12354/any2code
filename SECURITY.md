# 보안 정책 (Security Policy)

Ans2Quest(ans2quest.com)는 학생들이 쓰는 서비스입니다. 보안 문제를 발견하셨다면 알려 주셔서 감사합니다.

## 지원 범위

| 대상 | 지원 |
| --- | --- |
| `main` 브랜치 (ans2quest.com 에 배포되는 코드) | ✅ |
| 그 밖의 브랜치·포크 | ❌ |

## 취약점 제보 방법

**공개 이슈(Issues)나 커뮤니티 게시판에 올리지 마세요.** 고치기 전에 공개되면 다른 사용자가 피해를 입을 수 있습니다.

GitHub 의 비공개 취약점 제보 기능을 이용해 주세요.

1. 이 저장소의 **Security** 탭으로 갑니다.
2. **Report a vulnerability** 를 누릅니다.
3. 아래 내용을 적어 주세요.
   - 어떤 문제인지, 어디에서 생기는지 (파일·API 경로·화면)
   - 재현 방법
   - 예상되는 영향 (예: 다른 사람 계정 접근, 크레딧 무단 사용)

## 처리 절차

- 제보를 받으면 **7일 안에** 받았다는 답을 드립니다.
- 확인된 문제는 심각도에 따라 순서대로 고치고, 고친 뒤에 진행 상황을 알려 드립니다.
- 원하시면 수정 내역에 제보자로 이름을 남겨 드립니다.

## 테스트할 때 지켜 주세요

선의의 보안 연구는 환영합니다. 다만 아래는 하지 말아 주세요.

- 본인 계정이 아닌 다른 사용자의 계정·데이터에 접근하거나 바꾸기
- 서비스를 느리게 하거나 멈추게 하는 공격 (대량 요청, DoS)
- 확인에 필요한 정도를 넘어 개인정보를 내려받거나 보관하기
- AI 도우미 크레딧을 일부러 대량으로 소모시키기

가능하면 직접 띄운 로컬 환경(`api/` 의 `func start`)에서 확인해 주세요.

---

## English

Please **do not** open public issues for security problems. Report them privately through this repository's **Security → Report a vulnerability** (GitHub private vulnerability reporting). We aim to acknowledge reports within 7 days. Only the `main` branch, which is deployed to ans2quest.com, is supported. Do not access other users' data, degrade the service, or burn AI credits while testing; a local instance is preferred.
