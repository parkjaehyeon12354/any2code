(function(){
  const topic=document.querySelector('a[href="#topic-search"]');
  const hypothesis=document.querySelector('a[href="#hypothesis"]');
  const experiment=document.querySelector('a[href="#experiment"]');
  const record=document.querySelector('a[href="#record"]');
  const report=document.querySelector('a[href="#report"]');
  const examples=document.querySelector('a[href="#examples"]');
  if(topic){topic.href='/research/topics';topic.textContent='주제 찾기 →';}
  if(hypothesis){hypothesis.href='/research/hypothesis';hypothesis.textContent='가설 연습하기 →';}
  if(experiment){experiment.href='/research/experiment';experiment.textContent='실험 설계하기 →';}
  if(record){record.href='/research/record';record.textContent='핵심 메모 정리하기 →';}
  if(report){report.href='/research/report';report.textContent='보고서 작성하기 →';}
  if(examples){examples.href='/research/examples';examples.textContent='사례 살펴보기 →';}
})();
