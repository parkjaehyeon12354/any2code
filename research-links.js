(function(){
  const topic=document.querySelector('a[href="#topic-search"]');
  const hypothesis=document.querySelector('a[href="#hypothesis"]');
  if(topic){topic.href='/research/topics';topic.textContent='주제 찾기 →';}
  if(hypothesis){hypothesis.href='/research/hypothesis';hypothesis.textContent='가설 연습하기 →';}
})();
