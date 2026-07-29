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

          if (q.includes("c.type = 'post'")) out = out.filter((d) => d.type === 'post');
          if (q.includes("c.type = 'vote'")) out = out.filter((d) => d.type === 'vote');
          if (q.includes("c.type = 'comment'")) out = out.filter((d) => d.type === 'comment');
          if (q.includes("c.type IN ('post', 'comment')")) {
            out = out.filter((d) => d.type === 'post' || d.type === 'comment');
          }
          if (q.includes("c.status = 'public'")) out = out.filter((d) => d.status === 'public');
          if (q.includes("c.status IN ('held', 'blocked')")) {
            out = out.filter((d) => d.status === 'held' || d.status === 'blocked');
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
        ops.forEach((o) => {
          const key = o.path.slice(1);
          if (o.op === 'incr') d[key] = (d[key] || 0) + o.value;
          if (o.op === 'set') d[key] = o.value;
        });
        return { resource: d };
      }
    })
  };

  // state 를 그대로 넘긴다 — 테스트가 state.docs 로 읽고 비운다
  return { fake, state };
}

module.exports = { createFake };
