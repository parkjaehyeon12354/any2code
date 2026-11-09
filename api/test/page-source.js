/* 화면 파일을 테스트가 읽는 통로.

   CSP 에서 script-src 'unsafe-inline' 을 빼면서 각 화면의 인라인 <script> 를
   assets/js/pages/ 아래 파일로 옮겼다. 화면 로직을 검사하던 테스트들은 HTML 안의
   코드를 정규식으로 찾았는데, 코드가 밖으로 나가자 전부 "없다" 로 깨졌다.

   테스트가 확인할 것은 "코드가 HTML 안에 있는가" 가 아니라 "그 화면이 실행하는 코드가
   맞는가" 다. 그래서 HTML 을 읽을 때 /assets/js/pages/ 스크립트를 제자리에 다시 끼워
   넣어, 브라우저가 실행하는 순서 그대로의 소스를 돌려준다. HTML 이 아니면 그대로 읽는다. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const PAGE_SCRIPT = /<script src="(\/assets\/js\/pages\/[^"]+\.js)"><\/script>/g;

function readPage(file, enc = 'utf8') {
  const raw = fs.readFileSync(file, enc);
  if (!String(file).endsWith('.html')) return raw;
  return raw.replace(PAGE_SCRIPT, (_, src) =>
    '<script>\n' + fs.readFileSync(path.join(ROOT, src), 'utf8') + '</script>');
}

module.exports = { readPage };
