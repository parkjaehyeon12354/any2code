/* 메모리 가짜 Cosmos 컨테이너.
   posts / admin 테스트가 함께 쓴다.

   실제 SQL 을 해석하지 않고 쿼리 문자열에 어떤 조건이 들어있는지로 흉내 낸다.
   프로덕션 쿼리를 고치면 여기 필터도 같이 손봐야 한다 — 안 그러면 테스트가
   통과하는데 실서버는 틀린 결과를 낸다. */

function createFake() {
  const state = { docs: [] };

  const fake = {
    items: {
      create: async (d) => { state.docs.push(d); return { resource: d }; },
      upsert: async (d) => {
        state.docs = state.docs.filter((x) => x.id !== d.id);
        state.docs.push(d);
        return { resource: d };
      },
      query: (spec) => ({
        fetchAll: async () => {
          const p = (n) => (spec.parameters || []).find((x) => x.name === n)?.value;
          const q = spec.query;
          let out = state.docs;

          /* c.<필드> = '<값>' 과 c.<필드> IN ('a', 'b') 를 일반적으로 처리한다.
             종류를 하나씩 나열하면 새 문서 타입이 생길 때마다 여기를 잊고,
             필터가 통째로 빠져 엉뚱한 문서가 섞인다 (실제로 그랬다). */
          for (const [, field, value] of q.matchAll(/c\.(\w+)\s*=\s*'([^']*)'/g)) {
            out = out.filter((d) => d[field] === value);
          }
          for (const [, field, list] of q.matchAll(/c\.(\w+)\s+IN\s*\(([^)]*)\)/g)) {
            const values = [...list.matchAll(/'([^']*)'/g)].map((m) => m[1]);
            out = out.filter((d) => values.includes(d[field]));
          }
          if (q.includes('c.pk = @p')) out = out.filter((d) => d.pk === p('@p'));
          if (q.includes('c.pk = @s')) out = out.filter((d) => d.pk === p('@s'));
          if (q.includes('c.id = @id')) out = out.filter((d) => d.id === p('@id'));
          if (q.includes('c.userSub = @u')) out = out.filter((d) => d.userSub === p('@u'));
          if (q.includes('c.authorSub = @u')) out = out.filter((d) => d.authorSub === p('@u'));
          if (q.includes('c.createdAt > @since')) out = out.filter((d) => d.createdAt > p('@since'));

          if (q.includes('VALUE COUNT')) return { resources: [out.length] };
          return { resources: out };
        }
      })
    },
    item: (id, pk) => ({
      read: async () => ({ resource: state.docs.find((d) => d.id === id && d.pk === pk) }),
      delete: async () => { state.docs = state.docs.filter((d) => d.id !== id); },
      patch: async (ops) => {
        const d = state.docs.find((x) => x.id === id && x.pk === pk);
        /* 연산별 규칙을 실제 Cosmos 와 맞춘다.

           전부 대입으로 처리했더니 없는 필드에 replace/remove 를 거는 코드가
           테스트를 통과하고 라이브에서만 503 이 났다. 답변 수정·삭제가 실제로
           그렇게 터졌다 — updatedAt/deletedAt 은 처음엔 문서에 없는 필드다.

             set     있으면 바꾸고 없으면 만든다 (upsert)
             replace 이미 있는 필드에만 — 없으면 실패
             add     새 필드를 만든다
             remove  있는 필드만 지운다 — 없으면 실패
             incr    숫자를 더한다 */
        ops.forEach((o) => {
          const key = o.path.slice(1);
          if (o.op === 'incr') { d[key] = (d[key] || 0) + o.value; return; }
          if (o.op === 'set') { d[key] = o.value; return; }
          if (o.op === 'add') { d[key] = o.value; return; }
          if (o.op === 'replace') {
            if (d[key] === undefined) {
              const e = new Error(`replace 대상이 없습니다: ${o.path} — Cosmos 는 없는 필드를 replace 하지 못합니다. set 을 쓰세요.`);
              e.code = 400;
              throw e;
            }
            d[key] = o.value;
            return;
          }
          if (o.op === 'remove') {
            if (d[key] === undefined) {
              const e = new Error(`remove 대상이 없습니다: ${o.path} — Cosmos 는 없는 필드를 remove 하지 못합니다.`);
              e.code = 400;
              throw e;
            }
            delete d[key];
            return;
          }
          throw new Error(`알 수 없는 patch 연산: ${o.op}`);
        });
        return { resource: d };
      }
    })
  };

  // state 를 그대로 넘긴다 — 테스트가 state.docs 로 읽고 비운다
  return { fake, state };
}

module.exports = { createFake };
