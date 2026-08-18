/* 운영 설정 — 금칙어와 도배 제한을 배포 없이 고친다.

   컨테이너는 하나뿐이라 type='config' 문서 하나로 둔다 (id·pk 고정).

   캐시는 두지 않는다. 이 값을 읽는 경로(글·답변 작성)는 이미 도배 확인으로
   DB 를 한 번 치므로 포인트 읽기 1 RU 가 더 붙을 뿐이다. 반면 캐시를 두면
   "저장했는데 아직 안 먹는다" 는 구간이 생긴다 — 관리자가 가장 헷갈리는
   실패고, 화면이 거짓말하는 부류다.

   문서가 없거나 DB 를 못 읽으면 DEFAULTS 로 돈다. 실패했을 때 필터가
   꺼지면 안 되므로 기본값은 항상 "원래 코드에 있던 값" 이다. */
const { container } = require('./db');

const ID = 'settings';
const PK = 'config';

const DEFAULTS = {
  /* '고아' 처럼 정상 문맥에도 쓰이는 단어가 있어 오탐이 반드시 생긴다 —
     그래서 삭제가 아니라 보류이고, 사람이 최종 판단한다. */
  bannedWords: ['씨발', '시발', '병신', '개새끼', '좆', '지랄', '새끼', '꺼져', '고아'],
  postWindowMin: 10,
  postMax: 5
};

/* 코드 고정값. 설정 화면에는 보여주되 편집은 막는다.
   투표 제한을 DB 로 옮기면 화살표 한 번에 설정 읽기가 따라붙는다. 그 경로는
   일부러 메모리만 쓰게 둔 자리라 자기모순이 된다. */
const FIXED = { voteMaxPerMin: 30 };

/* 상한은 넉넉하되 무한은 아니다. 금칙어 2000개를 넣으면 글 하나 쓸 때마다
   2000번 훑고, 기준 시간을 1년으로 잡으면 도배 확인 쿼리가 전 기간을 스캔한다. */
const WORDS_MAX = 200;
const WORD_MAX_LEN = 30;

/** 저장 전 검사·정리. 잘못된 값은 code='BAD_SETTINGS' 로 던진다 (핸들러가 400 으로 바꾼다). */
function normalize(input) {
  const bad = (m) => { const e = new Error(m); e.code = 'BAD_SETTINGS'; throw e; };
  const src = input && typeof input === 'object' ? input : {};

  // 빈 배열은 허용한다 — 필터를 끄는 것도 관리자의 판단이고, 되돌릴 수 있다.
  // 다만 형식이 틀린 건 조용히 빈 목록으로 접지 않는다. 그러면 오타 한 번에
  // 필터가 통째로 꺼진 걸 아무도 모른다.
  if (!Array.isArray(src.bannedWords)) bad('금칙어 목록 형식이 잘못됐습니다.');

  const words = [...new Set(src.bannedWords.map((w) => String(w).trim()).filter(Boolean))];
  if (words.length > WORDS_MAX) bad(`금칙어는 ${WORDS_MAX}개까지 등록할 수 있습니다.`);
  const long = words.find((w) => w.length > WORD_MAX_LEN);
  if (long) bad(`금칙어 하나는 ${WORD_MAX_LEN}자까지입니다: "${long.slice(0, 40)}"`);

  const int = (v, lo, hi, label) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < lo || n > hi) bad(`${label}은 ${lo}~${hi} 사이 정수여야 합니다.`);
    return n;
  };

  return {
    bannedWords: words,
    postWindowMin: int(src.postWindowMin, 1, 1440, '도배 기준 시간(분)'),
    postMax: int(src.postMax, 1, 100, '기준 시간 내 허용 개수')
  };
}

/** 저장된 문서를 기본값과 합쳐 돌려준다. 필드마다 확인한다 — 문서에 값이
    빠져 있을 때 undefined 가 기본값을 덮으면 제한이 사라진다. */
const merge = (doc) => ({
  bannedWords: Array.isArray(doc.bannedWords) ? doc.bannedWords : DEFAULTS.bannedWords,
  postWindowMin: Number.isInteger(doc.postWindowMin) ? doc.postWindowMin : DEFAULTS.postWindowMin,
  postMax: Number.isInteger(doc.postMax) ? doc.postMax : DEFAULTS.postMax,
  updatedBy: doc.updatedBy || null,
  updatedAt: doc.updatedAt || null
});

async function get() {
  let doc = null;
  try {
    doc = (await container().item(ID, PK).read()).resource;
  } catch {
    // 문서가 없는 첫 실행이거나 DB 가 죽은 경우. 둘 다 기본값으로 돈다 —
    // 여기서 예외를 올리면 설정을 못 읽었다는 이유로 글쓰기 전체가 멈춘다.
  }
  return doc ? merge(doc) : { ...DEFAULTS, updatedBy: null, updatedAt: null };
}

async function save(input, user) {
  const clean = normalize(input);
  const doc = {
    id: ID,
    type: 'config',
    pk: PK,
    ...clean,
    // 누가 언제 바꿨는지 남긴다. 필터가 이상해졌을 때 물어볼 사람을 알아야 한다.
    updatedBy: user.email || user.sub,
    updatedAt: new Date().toISOString()
  };
  await container().items.upsert(doc);
  return merge(doc);
}

module.exports = { get, save, DEFAULTS, FIXED, WORDS_MAX };
