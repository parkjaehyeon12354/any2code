/* Cosmos DB 접근.

   컨테이너는 하나(`data`)뿐이고 문서 종류를 `type` 으로 구분한다.
   무료 계층은 계정 전체 1000 RU/s 라, 컨테이너를 나누면 각각 최소 400 RU/s 를
   잡아먹어 금방 한도를 넘는다. 이 규모에서는 나눌 이유도 없다.

   파티션 키는 `pk`:
     post    → pk = 과목(physics/chem/...)   같은 과목 글을 한 파티션에서 훑는다
     vote    → pk = 글 id                    한 글의 투표를 한 번에 읽는다

   클라이언트는 모듈 스코프에 한 번만 만든다. Functions 는 인스턴스를 재사용하므로
   요청마다 새로 만들면 연결이 계속 쌓인다. */
const { CosmosClient } = require('@azure/cosmos');

const DB = 'ans2quest';
const CONTAINER = 'data';

let cached = null;

function container() {
  if (cached) return cached;
  const conn = process.env.COSMOS_CONNECTION;
  if (!conn) {
    // 조용히 빈 목록을 돌려주면 "글이 하나도 없네" 로 오해한다. 크게 실패시킨다.
    // code 를 붙여야 핸들러가 "설정 누락" 과 "쿼리 실패" 를 구분해 안내할 수 있다 —
    // 관리형 Functions 는 로그를 보기 번거로워서, 응답만 보고 원인을 알아야 한다.
    const e = new Error('COSMOS_CONNECTION 이 없습니다. Azure 앱 설정에 등록하세요.');
    e.code = 'NO_COSMOS_CONFIG';
    throw e;
  }
  cached = new CosmosClient(conn).database(DB).container(CONTAINER);
  return cached;
}

/** 테스트에서 가짜 컨테이너를 끼워넣기 위한 통로 */
function _setContainer(c) { cached = c; }

const query = async (spec) => (await container().items.query(spec).fetchAll()).resources;

/* DB 실패 응답. 설정 누락은 따로 알려준다 — 값이 아니라 "무엇을 등록해야
   하는지"만 말하므로 비밀이 새지 않고, 배포 후 원인을 응답만 보고 알 수 있다. */
const dbFail = (e, message = '처리하지 못했습니다.') => ({
  status: 503,
  jsonBody: {
    error: e && e.code === 'NO_COSMOS_CONFIG'
      ? '서버에 데이터베이스가 연결되지 않았습니다. (COSMOS_CONNECTION 미설정)'
      : message
  }
});

module.exports = { container, query, dbFail, _setContainer };
