(function(){
  'use strict';
  /* 프리셋 둘. 기본 = 정해진 양식(예전과 같은 저장 키), 커스텀 = 이름·내용을 직접 적는 항목 목록.
     둘은 따로 저장돼 오가도 지워지지 않는다. 임시 저장은 둘 다, 불러오기·초기화는 보고 있는 쪽만. */
  const KEY='ans2quest_research_report_v1';const CUSTOM_KEY='ans2quest_research_report_custom_v1';const PRESET_KEY='ans2quest_research_report_preset';
  const fields=[...document.querySelectorAll('[data-report]')];const status=document.getElementById('save-status');
  const layout=document.querySelector('.report-layout');const list=document.getElementById('custom-list');const customOut=document.getElementById('custom-out');const cTitle=document.getElementById('c-title');const addBtn=document.getElementById('add-section');
  let custom={title:'',sections:[]};
  const preset=()=>layout.dataset.preset;
  const read=key=>JSON.parse(localStorage.getItem(key)||'null');
  // 저장본은 믿지 않는다 — 모양이 틀린 값은 버린다
  const normal=d=>({title:typeof d.title==='string'?d.title:'',sections:Array.isArray(d.sections)?d.sections.filter(s=>s&&typeof s==='object').map(s=>({name:String(s.name||''),body:String(s.body||'')})):[]});
  const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
  const empty=id=>id==='title'?'과학 탐구 보고서':id.startsWith('graph-')?(id==='graph-x'?'X축: 독립변인':id==='graph-y'?'Y축: 종속변인':'그래프 설명 작성 전'):(['independent','dependent','controlled'].includes(id)?'—':'작성 전');
  function render(){
    fields.forEach(field=>{const out=document.getElementById('out-'+field.id);if(!out)return;const value=field.value.trim();out.textContent=field.id==='graph-x'?`X축: ${value||'독립변인'}`:field.id==='graph-y'?`Y축: ${value||'종속변인'}`:(value||empty(field.id));});
    customOut.replaceChildren(...(custom.sections.length?custom.sections.map((s,i)=>{const sec=el('section','preview-section');sec.append(el('h3','',`${i+1}. ${s.name.trim()||'이름 없는 항목'}`),el('p','preview-text',s.body.trim()||'작성 전'));return sec;}):[el('p','preview-text custom-empty','항목을 추가하면 여기에 보입니다.')]));
    if(preset()==='custom')document.getElementById('out-title').textContent=custom.title.trim()||'과학 탐구 보고서';
  }
  // 입력칸은 항목을 더하거나 옮기거나 지울 때만 다시 그린다 — 글자마다 그리면 커서가 튄다
  function renderList(){
    const n=custom.sections.length;
    list.replaceChildren(...custom.sections.map((s,i)=>{
      const li=el('li','custom-item');const head=el('div','custom-item-head');const acts=el('div','item-actions');
      const btn=(act,label,text,off)=>{const b=el('button','',text);b.type='button';b.dataset.act=act;b.dataset.i=i;b.setAttribute('aria-label',`항목 ${i+1} ${label}`);b.disabled=off;return b;};
      acts.append(btn('up','위로','↑',i===0),btn('down','아래로','↓',i===n-1),btn('del','삭제','삭제',false));
      head.append(el('span','',`항목 ${i+1}`),acts);
      const input=(tag,key,ph)=>{const f=el(tag);f.id=`c-${key}-${i}`;f.value=s[key];f.dataset.i=i;f.dataset.key=key;if(ph)f.placeholder=ph;return f;};
      const field=(label,f)=>{const d=el('div','field');const l=el('label','',label);l.htmlFor=f.id;d.append(l,f);return d;};
      li.append(head,field('이름',input('input','name','예: 관찰 계기')),field('내용',input('textarea','body')));
      return li;
    }));
  }
  fields.forEach(field=>field.addEventListener('input',render));
  cTitle.addEventListener('input',()=>{custom.title=cTitle.value;render();});
  list.addEventListener('input',e=>{const t=e.target;if(!t.dataset.key)return;custom.sections[+t.dataset.i][t.dataset.key]=t.value;render();});
  list.addEventListener('click',e=>{
    const b=e.target.closest('button[data-act]');if(!b)return;const s=custom.sections;const i=+b.dataset.i;
    if(b.dataset.act==='del'){
      if((s[i].name.trim()||s[i].body.trim())&&!window.confirm('이 항목을 지울까요? 적은 내용도 함께 사라집니다.'))return;
      s.splice(i,1);renderList();(s.length?document.getElementById(`c-name-${Math.min(i,s.length-1)}`):addBtn).focus();
    }else{
      const j=b.dataset.act==='up'?i-1:i+1;[s[i],s[j]]=[s[j],s[i]];renderList();
      // 옮긴 항목의 같은 버튼에 포커스를 남긴다. 맨 끝에 닿아 꺼졌으면 반대쪽 버튼으로
      const same=list.querySelector(`[data-i="${j}"][data-act="${b.dataset.act}"]`);(same.disabled?list.querySelector(`[data-i="${j}"][data-act="${b.dataset.act==='up'?'down':'up'}"]`):same).focus();
    }
    render();
  });
  addBtn.addEventListener('click',()=>{custom.sections.push({name:'',body:''});renderList();render();document.getElementById(`c-name-${custom.sections.length-1}`).focus();});
  function setPreset(value,remember){
    layout.dataset.preset=value;document.querySelector(`input[name="preset"][value="${value}"]`).checked=true;
    if(remember)try{localStorage.setItem(PRESET_KEY,value);}catch{}
    render();
  }
  document.querySelectorAll('input[name="preset"]').forEach(r=>r.addEventListener('change',()=>setPreset(r.value,true)));
  function save(){const data={};fields.forEach(field=>data[field.id]=field.value);try{localStorage.setItem(KEY,JSON.stringify(data));localStorage.setItem(CUSTOM_KEY,JSON.stringify(custom));localStorage.setItem(PRESET_KEY,preset());status.textContent=`임시 저장 완료 · ${new Date().toLocaleString('ko-KR')}`;}catch{status.textContent='브라우저 설정 때문에 임시 저장하지 못했습니다.';}}
  // ask: 버튼으로 불러올 때 — 보고 있는 프리셋만, 저장하지 않은 수정이 있으면 덮어쓰기 전에 묻는다
  function restore(ask){
    let basic,saved;
    try{basic=read(KEY);saved=read(CUSTOM_KEY);}catch{status.textContent='저장된 내용을 읽지 못했습니다.';render();return;}
    const isCustom=preset()==='custom';
    if(ask){
      if(!(isCustom?saved:basic)){status.textContent='불러올 임시 저장본이 없습니다.';return;}
      const dirty=isCustom?JSON.stringify(normal(saved))!==JSON.stringify(custom):fields.some(field=>typeof basic[field.id]==='string'&&field.value!==basic[field.id]);
      if(dirty&&!window.confirm('지금 작성 중인 내용이 임시 저장본으로 바뀝니다. 불러올까요?'))return;
    }
    if(basic&&!(ask&&isCustom))fields.forEach(field=>{if(typeof basic[field.id]==='string')field.value=basic[field.id];});
    if(saved&&!(ask&&!isCustom)){custom=normal(saved);cTitle.value=custom.title;renderList();}
    if(basic||saved)status.textContent='이 브라우저에 임시 저장된 내용을 불러왔습니다.';
    render();
  }
  document.getElementById('save-button').addEventListener('click',save);document.getElementById('load-button').addEventListener('click',()=>restore(true));document.getElementById('print-button').addEventListener('click',()=>window.print());
  document.getElementById('reset-button').addEventListener('click',()=>{
    const isCustom=preset()==='custom';
    if(!window.confirm(`${isCustom?'커스텀':'기본'} 보고서의 작성 내용과 이 브라우저의 임시 저장본을 삭제할까요? 이 작업은 되돌릴 수 없습니다.`))return;
    if(isCustom){custom={title:'',sections:[]};cTitle.value='';renderList();try{localStorage.removeItem(CUSTOM_KEY);}catch{}}
    else{fields.forEach(field=>field.value='');try{localStorage.removeItem(KEY);}catch{}}
    status.textContent='보고서 내용을 초기화했습니다.';render();(isCustom?cTitle:fields[0]).focus();
  });
  try{const p=localStorage.getItem(PRESET_KEY);if(p==='custom')setPreset(p,false);}catch{}
  restore();
})();
