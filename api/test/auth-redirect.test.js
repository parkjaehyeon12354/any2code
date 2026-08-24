/* 로그인 후 돌아갈 경로(`to`) 처리 —
   오픈 리다이렉트는 피싱에 그대로 쓰인다. "우리 사이트에서 로그인했는데 남의
   사이트로 튕겨나가는" 경로를 막는 것이 이 파일의 목적이다.

   safePath 는 모듈 밖으로 내보내지 않으므로 소스에서 함수를 뽑아 평가한다. */
process.env.TZ = 'UTC';
process.env.SESSION_SECRET = 'test-secret-for-unit-tests-only';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SESSION_SRC = fs.readFileSync(path.join(__dirname, '../src/lib/session.js'), 'utf8');
const AUTH_SRC = fs.readFileSync(path.join(__dirname, '../src/functions/auth.js'), 'utf8');

function loadSafePath() {
  const start = SESSION_SRC.indexOf('function safePath');
  const end = SESSION_SRC.indexOf('\n}', start) + 2;
  assert.ok(start > 0 && end > start, 'safePath 소스를 찾지 못했다');
  return new Function(SESSION_SRC.slice(start, end) + '\nreturn safePath;')();
}
const safePath = loadSafePath();

test('사이트 안의 경로는 통과한다', () => {
  assert.strictEqual(safePath('/science'), '/science');
  assert.strictEqual(safePath('/community?sort=hot'), '/community?sort=hot');
  assert.strictEqual(safePath('/simulation/pendulum'), '/simulation/pendulum');
});

test('외부로 튕기는 값은 전부 막는다', () => {
  const attacks = [
    'https://evil.com',            // 절대 URL
    'http://evil.com',
    '//evil.com',                  // 스킴 생략 — 브라우저는 절대 URL 로 읽는다
    '/\\evil.com',                 // 역슬래시를 슬래시로 정규화하는 브라우저가 있다
    'evil.com',                    // 상대 경로
    'javascript:alert(1)',
    '/science\r\nSet-Cookie: x=1'  // 헤더 인젝션
  ];
  for (const a of attacks) {
    assert.strictEqual(safePath(a), null, `막지 못했다: ${JSON.stringify(a)}`);
  }
});

test('값이 없거나 이상하면 null', () => {
  for (const v of [null, undefined, '', 123, {}, []]) {
    assert.strictEqual(safePath(v), null, `null 이어야 한다: ${JSON.stringify(v)}`);
  }
});

test('길이를 제한한다', () => {
  // 무한정 긴 Location 헤더를 만들지 않는다
  const long = '/' + 'a'.repeat(500);
  assert.ok(safePath(long).length <= 200);
});

test('돌아갈 경로는 서명된 state 안에 담는다', () => {
  // 쿼리스트링으로 그대로 받아 쓰면 위조가 가능하다
  assert.ok(/sign\(\{[^}]*to:\s*safePath\(to\)/s.test(SESSION_SRC),
    'issueState 가 to 를 safePath 로 거른 뒤 서명해야 한다');
});

test('콜백은 state 에서 꺼낸 경로로 보낸다', () => {
  /* 이동 경로를 stateTarget 으로 정해야 한다.

     ⚠ Location 에 그 값을 직접 넣는지로 검사하면 안 된다 — 가입 절차가 생기면서
     `const target = stateTarget(...)` 로 한 번 받아 두고, 미동의 사용자는
     /welcome?to=<target> 으로 감싸 보내게 바뀌었다. 그때 이 검사가 깨졌다.
     확인할 것은 "경로가 stateTarget 에서 나오는가" 이지 대입 형태가 아니다. */
  assert.ok(/session\.stateTarget\(q\.get\('state'\)\)/.test(AUTH_SRC),
    '콜백이 stateTarget 으로 이동 경로를 정해야 한다');
  // 예전처럼 '/' 로 고정돼 있으면 로그인 후 항상 메인으로 튕긴다
  assert.ok(!/headers:\s*\{\s*Location:\s*'\/'\s*\}/.test(AUTH_SRC),
    "Location 이 '/' 로 고정돼 있으면 안 된다");
  // 가입 화면으로 우회할 때도 원래 목적지를 잃지 않아야 한다
  assert.ok(/\/welcome\?to=' \+ encodeURIComponent\(target\)/.test(AUTH_SRC),
    '가입 미완료로 우회시킬 때 원래 경로를 ?to= 로 넘겨야 한다');
});

test('stateTarget 은 검증을 통과한 값만 돌려준다', () => {
  // 서명은 "우리가 발급했다"만 보장한다. 값 자체의 안전성은 별도로 확인해야 한다.
  assert.ok(/stateTarget[\s\S]{0,200}safePath\(data\.to\)/.test(SESSION_SRC),
    'stateTarget 이 safePath 를 다시 통과시켜야 한다');
  assert.ok(/\|\|\s*'\/'/.test(SESSION_SRC), '없으면 기본값 / 로 떨어져야 한다');
});
