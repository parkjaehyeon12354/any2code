/* AI 답변 화면 변환(assets/js/llm.js 의 renderAnswer) — 브라우저 파일이라 필요한 부분만 잘라 vm 에서 돌린다.
   (1) 마크다운 표를 표로 그린다(Gemini 3.7 이 비교를 표로 써서 | 기호가 그대로 보였다),
   (2) 칸 안의 글자도 이스케이프된다 — 표 변환이 이스케이프 뒤에 있어야 XSS 가 안 열린다,
   (3) 표가 아닌 | 줄은 건드리지 않는다. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '../../assets/js/llm.js'), 'utf8');
const code = src.slice(src.indexOf('const escapeAnswerHtml'), src.indexOf('function append('));
const ctx = {};
vm.runInNewContext(`${code}\nthis.render = (raw) => { const el = {}; renderAnswer(el, raw); return el.innerHTML; };`, ctx);

test('마크다운 표는 머리글·칸이 있는 표가 되고, 굵게·수식도 칸 안에서 그대로 바뀐다', () => {
  const html = ctx.render('비교\n\n| 구분 | 광합성 | 세포 호흡 |\n| :--- | :---: | ---: |\n| **장소** | 엽록체 | 미토콘드리아 |\n| 에너지 | 빛 $\\rightarrow$ 화학 | 화학 $\\rightarrow$ ATP |\n\n끝');
  assert.match(html, /<div class="md-table"><table><thead><tr><th>구분<\/th><th>광합성<\/th><th>세포 호흡<\/th><\/tr><\/thead><tbody>/);
  assert.match(html, /<tr><td><b>장소<\/b><\/td><td>엽록체<\/td><td>미토콘드리아<\/td><\/tr>/);
  assert.match(html, /<td>빛 <span class="math">→<\/span> 화학<\/td>/);
  assert.ok(!/\|/.test(html), '| 기호가 남으면 안 된다');
  assert.match(html, /^비교\n/);
  assert.match(html, /\n끝$/);
});

test('칸 안의 태그 글자는 이스케이프된다', () => {
  const html = ctx.render('| a | b |\n|---|---|\n| <img src=x onerror=alert(1)> | ok |');
  assert.ok(!html.includes('<img'), html);
  assert.match(html, /<td>&lt;img src=x onerror=alert\(1\)&gt;<\/td>/);
});

test('구분선이 없는 | 줄은 표로 만들지 않는다', () => {
  const html = ctx.render('|x| 는 절댓값이다\n| 이건 그냥 문장 |');
  assert.ok(!html.includes('<table'), html);
});
