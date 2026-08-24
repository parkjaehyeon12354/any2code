(function(){
  'use strict';
  const KEY='ans2quest_research_report_v1';const fields=[...document.querySelectorAll('[data-report]')];const status=document.getElementById('save-status');
  const empty=id=>id==='title'?'과학 탐구 보고서':id.startsWith('graph-')?(id==='graph-x'?'X축: 독립변인':id==='graph-y'?'Y축: 종속변인':'그래프 설명 작성 전'):(['independent','dependent','controlled'].includes(id)?'—':'작성 전');
  function render(){fields.forEach(field=>{const out=document.getElementById('out-'+field.id);if(!out)return;const value=field.value.trim();out.textContent=field.id==='graph-x'?`X축: ${value||'독립변인'}`:field.id==='graph-y'?`Y축: ${value||'종속변인'}`:(value||empty(field.id));});}
  fields.forEach(field=>field.addEventListener('input',render));
  function save(){const data={};fields.forEach(field=>data[field.id]=field.value);try{localStorage.setItem(KEY,JSON.stringify(data));status.textContent=`임시 저장 완료 · ${new Date().toLocaleString('ko-KR')}`;}catch{status.textContent='브라우저 설정 때문에 임시 저장하지 못했습니다.';}}
  function restore(){try{const data=JSON.parse(localStorage.getItem(KEY)||'null');if(!data)return;fields.forEach(field=>{if(typeof data[field.id]==='string')field.value=data[field.id];});status.textContent='이 브라우저에 임시 저장된 내용을 불러왔습니다.';}catch{status.textContent='저장된 내용을 읽지 못했습니다.';}render();}
  document.getElementById('save-button').addEventListener('click',save);document.getElementById('print-button').addEventListener('click',()=>window.print());
  document.getElementById('reset-button').addEventListener('click',()=>{if(!window.confirm('작성 중인 내용과 이 브라우저의 임시 저장본을 모두 삭제할까요? 이 작업은 되돌릴 수 없습니다.'))return;fields.forEach(field=>field.value='');try{localStorage.removeItem(KEY);}catch{}status.textContent='보고서 내용을 초기화했습니다.';render();fields[0].focus();});
  restore();
})();
