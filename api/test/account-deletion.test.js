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
