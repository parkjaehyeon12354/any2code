(function(){
  const topic=document.querySelector('a[href="#topic-search"]');
  const hypothesis=document.querySelector('a[href="#hypothesis"]');
  const experiment=document.querySelector('a[href="#experiment"]');
  const record=document.querySelector('a[href="#record"]');
  if(topic){topic.href='/research/topics';topic.textContent='주제 찾기 →';}
  if(hypothesis){hypothesis.href='/research/hypothesis';hypothesis.textContent='가설 연습하기 →';}
  if(experiment){experiment.href='/research/experiment';experiment.textContent='실험 설계하기 →';}
  if(record){record.href='/research/record';record.textContent='핵심 메모 정리하기 →';}
})();
