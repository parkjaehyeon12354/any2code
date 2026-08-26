/* 답변 수정·삭제 화면 회귀 검사.

   API 동작은 posts.test.js 가 본다. 여기서는 화면(post.html)이 그 API 를
   제대로 쓰는지, 그리고 화면을 만들면서 실제로 밟았던 함정들이 되살아나지
   않는지 확인한다.

   화면 코드를 문자열로 검사하는 이유 — 이 저장소에는 jsdom 이 없고, 의존성을
   늘리지 않는 것이 이 프로젝트의 규칙이다. 대신 "무엇이 잘못되면 사용자가
   무엇을 겪는가" 를 주석에 남겨, 검사가 형태만 보는 것으로 굳지 않게 한다. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOTS = ['', 'assets/js', 'assets/css', 'assets', 'pages'];

function readRoot(name) {
  for (const r of ROOTS) {
    const full = path.join(__dirname, '../..', r, name);
    if (fs.existsSync(full)) return fs.readFileSync(full, 'utf8');
  }
  const base = path.basename(name);
  if (base !== name) {
    for (const r of ROOTS) {
      const full = path.join(__dirname, '../..', r, base);
      if (fs.existsSync(full)) return fs.readFileSync(full, 'utf8');
    }
  }
  throw new Error(`${name} 를 찾을 수 없습니다. 찾아본 곳: ` + ROOTS.map((r) => r || '(루트)').join(', '));
}

const postHtml = readRoot('post.html');

test('수정·삭제 버튼은 내 답변에만 붙는다', () => {
  /* mine 을 안 보고 전부 붙이면 남의 답변에 수정 버튼이 보인다.
     서버가 403 을 주므로 데이터는 안전하지만, 반드시 실패할 버튼을
     보여주는 것 자체가 버그다. */
  assert.match(postHtml, /if \(c\.mine\)/,
    '답변 액션을 c.mine 으로 가르지 않는다 — 남의 답변에 수정·삭제가 보인다');
  assert.match(postHtml, /data-edit=/, '수정 버튼이 없다');
  assert.match(postHtml, /data-delete=/, '삭제 버튼이 없다');
});

test('수정 폼은 render() 안에서 그린다 — 리스너가 쌓이지 않는다', () => {
  /* 폼을 render() 밖에서 만들고 거기에 addEventListener 를 직접 붙이면,
     수정 버튼을 누를 때마다 새 폼에 리스너가 다시 붙는다. 두 번째 수정부터
     저장 한 번에 PATCH 가 여러 번 나간다.

     그래서 폼도 answersHtml() 이 그리고, 리스너는 box 하나에만 위임으로 붙인다. */
  assert.match(postHtml, /c\.id === editing/,
    '수정 폼을 render() 가 그리지 않는다 — 리스너 중복과 입력 유실이 생긴다');

  // 폼 요소에 직접 리스너를 붙이는 흔적이 없어야 한다
  assert.ok(!/form\.addEventListener/.test(postHtml),
    'form 에 리스너를 직접 붙이고 있다 — render() 마다 중복 등록된다');

  // 제출은 위임으로 받는다
  assert.match(postHtml, /closest\('\.answer-edit-form'\)/,
    '수정 폼 제출을 위임으로 받지 않는다');
});

test('답변 작성 폼과 수정 폼의 제출이 서로 섞이지 않는다', () => {
  /* 두 폼이 같은 box 안에 있다. 작성 핸들러가 수정 폼 제출까지 받으면
     수정하려는데 새 답변이 하나 더 달린다. */
  assert.match(postHtml, /closest\('#answer-form'\)/,
    '작성 핸들러가 id 로 좁히지 않는다 — 수정 제출까지 가로챈다');
});

test('삭제하면 목록에서 실제로 빼낸다 — 새로고침 전후가 같아야 한다', () => {
  /* 서버의 댓글 목록 쿼리는 status='public' 만 준다. 삭제된 답변은
     새로고침하면 아예 사라진다.

     화면에 "(삭제된 답변입니다)" 를 남겨두면 새로고침하는 순간 그 줄이
     사라져, 사용자는 화면이 제멋대로 바뀐다고 느낀다. */
  const commentsQuery = fs.readFileSync(
    path.join(__dirname, '../src/functions/posts.js'), 'utf8');
  assert.match(commentsQuery, /c\.type = 'comment' AND c\.pk = @p AND c\.status = 'public'/,
    '댓글 목록이 공개 상태만 주는 전제가 깨졌다 — 화면 처리도 함께 바꿔야 한다');

  assert.match(postHtml, /comments = comments\.filter\(function \(x\) \{ return x\.id !== commentId; \}\)/,
    '삭제 후 목록에서 빼지 않는다 — 새로고침하면 화면이 달라진다');
});

test('수정 실패 시 폼을 닫지 않는다 — 쓴 내용이 날아가면 안 된다', () => {
  assert.match(postHtml, /폼을 닫지 않는다/,
    '수정 실패 처리에서 폼을 닫고 있다 — 사용자가 쓴 내용이 사라진다');
});

test('내용이 그대로면 요청을 보내지 않는다', () => {
  /* 안 바꾸고 저장을 누르면 updatedAt 만 갱신되어 "수정됨" 이 붙는다.
     고치지 않았는데 고쳤다고 표시되는 건 거짓말이다. */
  assert.match(postHtml, /if \(text === comment\.body\)/,
    '변경 없음을 걸러내지 않는다 — 안 고쳤는데 "수정됨" 이 붙는다');
});

test('수정된 답변에는 표시가 남는다', () => {
  assert.match(postHtml, /c\.updatedAt \? .*수정됨/,
    '수정 표시가 없다 — 읽는 사람이 내용이 바뀐 걸 알 수 없다');
});

test('수정 폼 입력칸에 이름표가 있다', () => {
  /* 스크린리더 사용자는 라벨 없는 textarea 를 "편집" 으로만 듣는다.
     .sr-only 는 이 저장소 CSS 에 없어서 <label> 을 쓰면 글자가 그대로 보인다. */
  assert.match(postHtml, /<textarea aria-label="답변 수정"/,
    '수정 입력칸에 aria-label 이 없다');

  const css = readRoot('styles.css');
  if (/answer-edit-form/.test(postHtml)) {
    assert.ok(!/class="sr-only"/.test(postHtml) || /\.sr-only/.test(css),
      'sr-only 를 쓰는데 CSS 에 정의가 없다 — 숨겨야 할 글자가 화면에 보인다');
  }
});
