    /* 미리보기는 각 카드가 품고 있는 <svg> 를 그대로 보여준다.

       예전에는 여기서 canvas 에 그렸는데, 코드가
         if (단진자) {...} else {전자기 유도}
       였다. 시뮬레이션이 두 개일 때는 맞았지만 여덟 개로 늘자
       단진자를 뺀 일곱 장이 전부 '전자기 유도' 그림이 됐다.
       카드마다 SVG 를 이미 갖고 있으니 그것을 쓰는 편이 맞다 —
       새 시뮬레이션을 추가할 때 여기를 고칠 일도 없어진다. */
    const subjectFilters = document.querySelectorAll('.subject-filter');
    const detailFilters = document.querySelectorAll('.detail-filter');
    const cards = document.querySelectorAll('.simulation-card');
    const resultCount = document.getElementById('result-count');
    const emptyState = document.getElementById('empty-state');
    const searchInput = document.getElementById('simulation-search');

    function updateSimulations() {
      const selected = [...detailFilters].filter(filter => filter.checked).map(filter => filter.value);
      const query = searchInput.value.trim().toLocaleLowerCase('ko-KR').replace(/\s+/g, ' ');
      let visibleCount = 0;
      cards.forEach(card => {
        const searchableText = `${card.textContent} ${card.dataset.topic || ''}`.toLocaleLowerCase('ko-KR').replace(/\s+/g, ' ');
        const visible = selected.includes(card.dataset.topic) && (!query || searchableText.includes(query));
        card.hidden = !visible;
        if (visible) visibleCount += 1;
      });
      resultCount.textContent = `${visibleCount}개 표시 중`;
      emptyState.hidden = visibleCount !== 0;
      emptyState.textContent = query
        ? `“${searchInput.value.trim()}”에 해당하는 시뮬레이션이 없습니다.`
        : '선택한 과목의 시뮬레이션이 없습니다.';
    }
    searchInput.addEventListener('input', updateSimulations);
    subjectFilters.forEach(parent => parent.addEventListener('change', () => {
      detailFilters.forEach(detail => { if (detail.dataset.subject === parent.dataset.subject) detail.checked = parent.checked; });
      updateSimulations();
    }));
       detailFilters.forEach(detail => detail.addEventListener('change', () => {
      const siblings = [...detailFilters].filter(item => item.dataset.subject === detail.dataset.subject);
      const parent = [...subjectFilters].find(item => item.dataset.subject === detail.dataset.subject);

      parent.checked = siblings.every(item => item.checked);
      parent.indeterminate = siblings.some(item => item.checked) && !parent.checked;

      updateSimulations();
    }));

    const params = new URLSearchParams(window.location.search);
const subject = params.get('subject');
const topic = params.get('topic');

if (subject) {
  subjectFilters.forEach(filter => {
    filter.checked = filter.dataset.subject === subject;
    filter.indeterminate = false;
  });

  detailFilters.forEach(filter => {
    if (topic) {
      filter.checked =
        filter.dataset.subject === subject &&
        filter.value === topic;
    } else {
      filter.checked =
        filter.dataset.subject === subject;
    }
  });
}

updateSimulations();
  
