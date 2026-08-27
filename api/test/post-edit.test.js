/* 글(질문) 수정·삭제 화면 회귀 검사.

   API 동작은 posts.test.js 가 본다. 여기서는 post.html 이 그 API 를 제대로
   쓰는지만 확인한다 — jsdom 없이 문자열로 검사하는 이유는 comment-edit.test.js
   첫 주석에 있다. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const postHtml = fs.readFileSync(path.join(__dirname, '../../post.html'), 'utf8');

test('글 수정·삭제 버튼은 내 글에만 붙는다', () => {
  /* post.mine 을 안 본 채 전부 붙이면 남의 글에 수정·삭제가 보인다.
     서버가 403 을 주므로 데이터는 안전하지만, 반드시 실패할 버튼을
     보여주는 것 자체가 버그다. */
  assert.match(postHtml, /post\.mine\s*\?\s*'<div class="answer-actions">/,
    '글 액션을 post.mine 으로 가르지 않는다 — 남의 글에 수정·삭제가 보인다');
  assert.match(postHtml, /data-post-edit/, '글 수정 버튼이 없다');
  assert.match(postHtml, /data-post-delete/, '글 삭제 버튼이 없다');
});

test('글 수정 폼도 render() 안에서 그린다', () => {
  /* 답변 수정 폼과 같은 이유다 — 폼을 render() 밖에서 만들고 리스너를
     직접 붙이면 등록이 중복되어 저장 한 번에 PATCH 가 여러 번 나간다. */
  assert.match(postHtml, /if \(postEditing\)/,
    '글 수정 폼을 render() 가 그리지 않는다 — 리스너 중복과 입력 유실이 생긴다');
  assert.match(postHtml, /closest\('\.post-edit-form'\)/,
    '글 수정 폼 제출을 위임으로 받지 않는다');
});

test('글 수정 폼과 답변 폼의 제출이 서로 섞이지 않는다', () => {
  /* 작성(#answer-form), 답변 수정(.answer-edit-form), 글 수정(.post-edit-form)
     세 폼이 같은 box 안에 있다. 어느 하나가 가르지 않으면
     글을 고치려는데 답변이 달리거나, 답변을 고치려는데 글이 바뀐다. */
  assert.match(postHtml, /closest\('#answer-form'\)/, '답변 작성 핸들러가 id 로 좁히지 않는다');
  assert.match(postHtml, /closest\('\.answer-edit-form'\)/, '답변 수정 핸들러가 클래스로 좁히지 않는다');
  assert.match(postHtml, /closest\('\.post-edit-form'\)/, '글 수정 핸들러가 클래스로 좁히지 않는다');
});

test('글 내용이 그대로면 요청을 보내지 않는다', () => {
  /* 안 바꾸고 저장을 누르면 updatedAt 만 갱신되어 "수정됨" 이 붙는다. */
  assert.match(postHtml, /title === post\.title && text === post\.body/,
    '변경 없음을 걸러내지 않는다 — 안 고쳤는데 "수정됨" 이 붙는다');
});

test('삭제 확인에 답변 동반 삭제를 알린다', () => {
  /* 글을 지우면 답변도 함께 지워진다. 이를 안 알리고 지우게 하면
     사용자는 남의 답변까지 사라진 것을 뒤늦게 안다. */
  assert.match(postHtml, /confirm\('이 글을 삭제하시겠습니까\? 달린 답변도 함께 삭제되며/,
    '삭제 확인이 답변 동반 삭제를 알리지 않는다');
});

test('수정된 글에는 표시가 남는다', () => {
  assert.match(postHtml, /post\.updatedAt \? .*수정됨/,
    '글 수정 표시가 없다 — 읽는 사람이 내용이 바뀐 걸 알 수 없다');
});

test('보류되거나 삭제된 글에서는 목록으로 본낸다', () => {
  /* 보류·삭제된 글은 postsGet 이 404 를 준다. 수정·삭제 후 그 자리에
     남아 있으면 다음 새로고침에서 갑자기 "없는 글" 이 된다. */
  assert.match(postHtml, /window\.location\.href = '\/community'/,
    '보류·삭제 후에도 글 화면에 남아 있다 — 다음 로드에서 갑자기 404 가 된다');
});
