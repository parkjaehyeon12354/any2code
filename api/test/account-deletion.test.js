/* 계정 삭제 — 7일 유예, 재로그인으로 취소, 유예 종료 시 완전 삭제.

   실행: cd api && node --test */
const { test } = require('node:test');
const assert = require('node:assert');

process.env.SESSION_SECRET = 'p'.repeat(48);
process.env.ADMIN_EMAILS = 'boss@example.com';

const db = require('../src/lib/db');
const profile = require('../src/lib/profile');

const { createFake } = require('./fake-container');
const { fake, state } = createFake();
db._setContainer(fake);

const ME = { sub: 'google:1', name: '박재현', email: 'me@example.com', provider: 'google' };

test.beforeEach(() => { state.docs = []; });

test('예약하면 deletionScheduledAt 이 채워진다', async () => {
  await profile.ensure(ME);
  await profile.scheduleDeletion(ME.sub);
  const doc = await profile.read(ME.sub);
  assert.ok(doc.deletionScheduledAt, '예약 시각이 있어야 한다');
});

test('취소하면 deletionScheduledAt 이 비워진다', async () => {
  await profile.ensure(ME);
  await profile.scheduleDeletion(ME.sub);
  await profile.cancelDeletion(ME.sub);
  const doc = await profile.read(ME.sub);
  assert.strictEqual(doc.deletionScheduledAt, null, '취소하면 null 이어야 한다');
});

test('7일이 안 지났으면 purgeIfExpired 가 아무것도 안 지운다', async () => {
  await profile.ensure(ME);
  await profile.scheduleDeletion(ME.sub); // 방금 예약 — 유예 안
  const purged = await profile.purgeIfExpired(ME);
  assert.strictEqual(purged, false);
  assert.ok(await profile.read(ME.sub), '문서가 그대로 남아 있어야 한다');
});

test('7일이 지나면 purgeIfExpired 가 완전히 지운다', async () => {
  await profile.ensure(ME);
  await profile.scheduleDeletion(ME.sub);
  // 8일 전으로 시각을 되돌려 유예를 넘긴 것처럼 만든다
  const doc = state.docs.find((d) => d.id === 'user:' + ME.sub);
  doc.deletionScheduledAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

  const purged = await profile.purgeIfExpired(ME);
  assert.strictEqual(purged, true);
  assert.strictEqual(await profile.read(ME.sub), null, '사용자 문서가 지워져야 한다');
});

test('checkDeletionOnLogin: 예약이 없으면 아무 일도 안 한다', async () => {
  await profile.ensure(ME);
  const r = await profile.checkDeletionOnLogin(ME);
  assert.deepStrictEqual(r, { purged: false, cancelled: false });
});

test('checkDeletionOnLogin: 유예 안이면 자동 취소한다', async () => {
  await profile.ensure(ME);
  await profile.scheduleDeletion(ME.sub);
  const r = await profile.checkDeletionOnLogin(ME);
  assert.deepStrictEqual(r, { purged: false, cancelled: true });
  const doc = await profile.read(ME.sub);
  assert.strictEqual(doc.deletionScheduledAt, null, '재로그인으로 취소되어야 한다');
});

test('checkDeletionOnLogin: 유예를 넘겼으면 완전 삭제한다', async () => {
  await profile.ensure(ME);
  await profile.scheduleDeletion(ME.sub);
  const doc = state.docs.find((d) => d.id === 'user:' + ME.sub);
  doc.deletionScheduledAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

  const r = await profile.checkDeletionOnLogin(ME);
  assert.deepStrictEqual(r, { purged: true, cancelled: false });
  assert.strictEqual(await profile.read(ME.sub), null);
});

test('완전 삭제는 크레딧·제재 문서도 함께 지운다', async () => {
  await profile.ensure(ME);
  state.docs.push({ id: 'credit:' + ME.sub, type: 'credit', pk: ME.sub, balance: 5 });
  state.docs.push({ id: ME.sub, type: 'sanction', pk: ME.sub, active: false });

  await profile.purge(ME.sub);

  assert.strictEqual(state.docs.find((d) => d.type === 'credit' && d.pk === ME.sub), undefined);
  assert.strictEqual(state.docs.find((d) => d.type === 'sanction' && d.pk === ME.sub), undefined);
});

test('완전 삭제는 글을 지우지 않고 소프트 삭제로 비운다', async () => {
  /* 하드 삭제하면 다른 사람이 단 답변까지 맥락이 깨진다.
     posts.js 의 글 삭제와 같은 패턴(status: deleted)을 따른다. */
  await profile.ensure(ME);
  state.docs.push({
    id: 'post:1', type: 'post', pk: 'physics',
    authorSub: ME.sub, authorName: '박재현', body: '원래 내용', status: 'active'
  });

  await profile.purge(ME.sub);

  const post = state.docs.find((d) => d.id === 'post:1');
  assert.ok(post, '글 문서 자체는 남아 있어야 한다 — 하드 삭제 대상이 아니다');
  assert.strictEqual(post.status, 'deleted');
  assert.strictEqual(post.authorName, '탈퇴한 사용자');
  assert.notStrictEqual(post.body, '원래 내용', '본문이 비워져야 한다');
});

test('이미 삭제된 글은 다시 건드리지 않는다', async () => {
  await profile.ensure(ME);
  state.docs.push({
    id: 'post:2', type: 'post', pk: 'physics',
    authorSub: ME.sub, authorName: '이미 지운 사람', body: '(삭제된 글입니다.)', status: 'deleted'
  });

  await profile.purge(ME.sub);

  const post = state.docs.find((d) => d.id === 'post:2');
  assert.strictEqual(post.authorName, '이미 지운 사람', '이미 삭제된 글은 건드리지 않아야 한다');
});

/* ── 라우트/로그인 배선 — 소스 정적 검사 ──
   실제 HTTP 핸들러를 fake-container 로 실행하려면 @azure/functions 목킹이
   또 필요하다. profile.test.js 가 이미 그 패턴을 쓰지만, 이 파일은 lib
   단위 테스트로 남기고 배선 확인만 소스에서 본다 — 중복 인프라를 새로
   만들 이유가 없다. */
const fs = require('node:fs');
const path = require('node:path');
const PROFILE_FN_SRC = fs.readFileSync(path.join(__dirname, '../src/functions/profile.js'), 'utf8');
const AUTH_SRC = fs.readFileSync(path.join(__dirname, '../src/functions/auth.js'), 'utf8');

test('삭제 예약 응답이 세션 쿠키를 지운다(강제 로그아웃)', () => {
  /* 사용자가 요청한 것: "삭제하면 강제 로그아웃". 세션 쿠키가 14일 살아있는데
     응답에서 안 지우면, 삭제를 예약해 놓고도 그 세션으로 계속 로그인 상태로
     남는다. */
  const start = PROFILE_FN_SRC.indexOf("app.http('profileScheduleDeletion'");
  const end = PROFILE_FN_SRC.indexOf("app.http('profileCancelDeletion'", start);
  const body = PROFILE_FN_SRC.slice(start, end);
  assert.ok(/cookies:\s*\[session\.clear\(\)\]/.test(body),
    '삭제 예약 응답에 session.clear() 쿠키가 없다 — 로그아웃되지 않는다');
});

test('로그인 콜백이 재로그인을 삭제 취소로 처리한다', () => {
  /* 사용자가 요청한 것: "로그인했다 자동으로 계정삭제 취소로 바꿔".
     버튼으로 취소하게 하면 사용자가 그 존재를 몰라 그냥 로그인해서 쓰다가
     7일 뒤 계정이 사라지는 사고가 난다 — 로그인 자체가 취소 행위여야 한다. */
  assert.ok(/checkDeletionOnLogin/.test(AUTH_SRC),
    'auth 콜백이 checkDeletionOnLogin 을 호출하지 않는다');
  // 삭제 취소 버튼 흐름(profileCancelDeletion)이 남아있는지는 안 본다 —
  // 로그인 배선이 있으면 버튼 없이도 취소되므로 없어도 정상이다.
});

