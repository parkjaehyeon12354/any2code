(function(){
  'use strict';
  const ids=['question','hypothesis','independent','dependent','controlled','measurement'];
  const fields=Object.fromEntries(ids.map(id=>[id,document.getElementById(id)]));
  const fallback={question:'아직 작성하지 않았습니다.',hypothesis:'아직 작성하지 않았습니다.',independent:'—',dependent:'—',controlled:'—',measurement:'—'};
  function updatePreview(){ids.forEach(id=>{document.getElementById('preview-'+id).textContent=fields[id].value.trim()||fallback[id];});}
  ids.forEach(id=>fields[id].addEventListener('input',updatePreview));
  document.getElementById('example-button').addEventListener('click',()=>{fields.question.value='진자의 길이는 왕복 주기에 어떤 영향을 줄까?';fields.hypothesis.value='진자의 길이가 길어지면 왕복 주기가 길어질 것이다. 진자의 주기는 길이의 제곱근에 비례하기 때문이다.';fields.independent.value='진자의 길이(m)';fields.dependent.value='진자의 왕복 주기(s)';fields.controlled.value='추의 질량, 초기 각도, 놓는 방법, 측정 장소';fields.measurement.value='길이별로 10회 왕복 시간을 초시계로 3회 측정한 뒤, 평균을 10으로 나눈다.';updatePreview();});
  document.getElementById('clear-button').addEventListener('click',()=>{ids.forEach(id=>fields[id].value='');document.querySelectorAll('.check-item input').forEach(x=>x.checked=false);updatePreview();updateChecks();fields.question.focus();});
  const checks=[...document.querySelectorAll('.check-item input')],result=document.getElementById('check-result');
  function updateChecks(){const n=checks.filter(x=>x.checked).length;const message=n===6?'검증 가능한 가설의 조건을 모두 확인했습니다.':n>=4?'좋습니다. 선택하지 않은 조건을 중심으로 문장을 더 구체화해 보세요.':'먼저 가설의 구체성을 점검해 보세요.';result.textContent=`${n}/6개 확인 · ${message}`;}
  checks.forEach(x=>x.addEventListener('change',updateChecks));updatePreview();updateChecks();
})();
