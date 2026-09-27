(function(){
  'use strict';
  /* 프리셋 둘. 기본 = 정해진 양식(예전과 같은 저장 키), 커스텀 = 직접 만드는 블록 목록(글 · 표 · 그래프).
     둘은 따로 저장돼 오가도 지워지지 않는다. 임시 저장은 둘 다, 불러오기·초기화는 보고 있는 쪽만. */
  const KEY='ans2quest_research_report_v1';const CUSTOM_KEY='ans2quest_research_report_custom_v1';const PRESET_KEY='ans2quest_research_report_preset';
  const fields=[...document.querySelectorAll('[data-report]')];const status=document.getElementById('save-status');
  const layout=document.querySelector('.report-layout');const list=document.getElementById('custom-list');const customOut=document.getElementById('custom-out');const cTitle=document.getElementById('c-title');const addBtn=document.getElementById('add-section');
  const picker=document.getElementById('size-picker');const sizeR=document.getElementById('size-r');const sizeC=document.getElementById('size-c');
  // 표: 첫 행이 머리글. 그래프: 행 = 측정값 개수(+ 이름 행), 첫 열 = X, 나머지 열 = Y 계열(색이 다섯 개라 최대 5개)
  const SIZE={table:{r:[1,30],c:[1,8],def:[3,3],what:'표 크기',hint:'첫 행은 머리글(굵게)입니다.'},
              graph:{r:[2,30],c:[2,6],def:[5,2],what:'그래프 데이터',hint:'행 = 측정값 개수, 첫 열 = X값, 나머지 열 = Y값(계열 하나씩, 최대 5개).'}};
  const KIND={text:'',table:' · 표',graph:' · 그래프'};
  let custom={title:'',sections:[]};let pending=null;
  const preset=()=>layout.dataset.preset;
  const read=key=>JSON.parse(localStorage.getItem(key)||'null');
  const str=v=>typeof v==='string'?v:'';
  // 저장본은 믿지 않는다 — 모양이 틀린 값은 버리고 표는 직사각형으로 채운다
  function normal(d){
    const block=s=>{
      const type=s.type==='table'||s.type==='graph'?s.type:'text';const b={type,name:str(s.name)};
      if(type==='text'){b.body=str(s.body);return b;}
      if(type==='graph'){b.kind=s.kind==='bar'?'bar':'line';b.x=str(s.x);b.y=str(s.y);}
      const lim=SIZE[type];const rows=(Array.isArray(s.cells)?s.cells:[]).filter(Array.isArray).slice(0,lim.r[1]+(type==='graph'?1:0));
      const cols=Math.min(lim.c[1],Math.max(lim.c[0],...rows.map(r=>r.length)));
      b.cells=(rows.length?rows:[[]]).map(r=>Array.from({length:cols},(_,c)=>str(r[c])));
      return b;
    };
    return {title:str(d.title),sections:Array.isArray(d.sections)?d.sections.filter(s=>s&&typeof s==='object').map(block):[]};
  }
  const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
  const empty=id=>id==='title'?'과학 탐구 보고서':id.startsWith('graph-')?(id==='graph-x'?'X축: 독립변인':id==='graph-y'?'Y축: 종속변인':'그래프 설명 작성 전'):(['independent','dependent','controlled'].includes(id)?'—':'작성 전');

  /* ---------- 미리보기 그래프 (SVG) ----------
     dataviz 규격: 선 2px · 점 r4 + 배경색 링 2px · 막대 ≤24px, 끝만 4px 둥글게, 막대 사이 2px ·
     가는 격자 · 계열 2개 이상이면 범례 · 글자는 계열 색을 쓰지 않는다. 값은 점·막대에 마우스를 올리면(title) 보인다. */
  const NS='http://www.w3.org/2000/svg';
  const svg=(tag,attrs,text)=>{const e=document.createElementNS(NS,tag);for(const k in attrs)e.setAttribute(k,attrs[k]);if(text!=null)e.textContent=text;return e;};
  const num=v=>{const t=String(v).replace(/,/g,'').trim();const n=Number(t);return t!==''&&Number.isFinite(n)?n:null;};
  function scale(lo,hi){
    if(lo===hi){lo-=Math.abs(lo)||1;hi+=Math.abs(hi)||1;}
    const raw=(hi-lo)/5;const mag=10**Math.floor(Math.log10(raw));const f=[1,2,2.5,5,10].find(m=>m*mag>=raw);const step=f*mag;
    const dec=Math.max(0,-Math.floor(Math.log10(mag))+(f===2.5?1:0));const a=Math.floor(lo/step)*step;const b=Math.ceil(hi/step)*step;
    const ticks=[];for(let v=a;v<=b+step/2;v+=step)ticks.push(Number(v.toFixed(dec)));
    return {lo:a,hi:b,ticks,fmt:v=>v.toLocaleString('ko-KR',{maximumFractionDigits:dec})};
  }
  function drawGraph(b){
    const head=b.cells[0];const rows=b.cells.slice(1);const series=head.slice(1).map((h,j)=>({name:h.trim()||`Y${j+1}`,color:`var(--series-${j+1})`}));
    const bar=b.kind==='bar';
    // 막대: X는 이름표(글자 가능). 꺾은선: X도 숫자여야 하고 X 순으로 잇는다
    const data=rows.map(r=>({label:r[0].trim(),x:num(r[0]),ys:r.slice(1).map(num)})).filter(d=>d.ys.some(y=>y!==null)&&(bar||d.x!==null));
    if(!data.length)return[el('p','preview-text custom-empty',bar?'Y값에 숫자를 넣으면 막대그래프가 그려집니다.':'X·Y값에 숫자를 넣으면 그래프가 그려집니다.')];
    if(!bar)data.sort((p,q)=>p.x-q.x);
    const W=Math.min(640,Math.max(280,customOut.clientWidth||520));const H=Math.round(Math.min(300,W*.6));
    const m={l:46,r:14,t:26,b:40};const pw=W-m.l-m.r;const ph=H-m.t-m.b;
    const ys=data.flatMap(d=>d.ys).filter(y=>y!==null);const sy=bar?scale(Math.min(0,...ys),Math.max(0,...ys)):scale(Math.min(...ys),Math.max(...ys));
    const Y=v=>m.t+ph-(v-sy.lo)/(sy.hi-sy.lo)*ph;
    const g=svg('svg',{class:'graph-svg',width:W,height:H,viewBox:`0 0 ${W} ${H}`,role:'img','aria-label':`${b.name.trim()||'그래프'} — ${bar?'막대':'꺾은선'}그래프`});
    sy.ticks.forEach(v=>{g.append(svg('line',{x1:m.l,x2:W-m.r,y1:Y(v),y2:Y(v),style:'stroke:var(--hairline);stroke-width:1'}),svg('text',{x:m.l-6,y:Y(v)+4,'text-anchor':'end','font-size':11,style:'fill:var(--muted)'},sy.fmt(v)));});
    g.append(svg('line',{x1:m.l,x2:m.l,y1:m.t,y2:m.t+ph,style:'stroke:var(--muted);stroke-width:1'}));
    if(b.y.trim())g.append(svg('text',{x:m.l-6,y:12,'font-size':11,style:'fill:var(--body)'},b.y.trim()));
    if(b.x.trim())g.append(svg('text',{x:W-m.r,y:H-4,'text-anchor':'end','font-size':11,style:'fill:var(--body)'},b.x.trim()));
    if(bar){
      const band=pw/data.length;const n=series.length;const bw=Math.max(2,Math.min(24,(band*.7-(n-1)*2)/n));const gw=n*bw+(n-1)*2;const base=Y(Math.max(sy.lo,Math.min(0,sy.hi)));
      data.forEach((d,i)=>{
        const cx=m.l+band*(i+.5);const room=Math.max(1,Math.floor(band/7));const label=d.label||String(i+1);
        const t=svg('text',{x:cx,y:m.t+ph+16,'text-anchor':'middle','font-size':11,style:'fill:var(--muted)'},label.length>room?label.slice(0,Math.max(1,room-1))+'…':label);t.append(svg('title',{},label));g.append(t);
        d.ys.forEach((v,j)=>{if(v===null)return;const x=cx-gw/2+j*(bw+2);const y=Y(v);const r=Math.min(4,bw/2,Math.abs(base-y));const up=y<base;
          // 데이터 쪽 끝만 둥글고 기준선 쪽은 각지게
          const d0=up?`M${x},${base}V${y+r}Q${x},${y} ${x+r},${y}H${x+bw-r}Q${x+bw},${y} ${x+bw},${y+r}V${base}Z`:`M${x},${base}V${y-r}Q${x},${y} ${x+r},${y}H${x+bw-r}Q${x+bw},${y} ${x+bw},${y-r}V${base}Z`;
          const p=svg('path',{d:d0,style:`fill:${series[j].color}`});p.append(svg('title',{},`${series[j].name} · ${label}: ${v.toLocaleString('ko-KR')}`));g.append(p);});
      });
      g.append(svg('line',{x1:m.l,x2:W-m.r,y1:base,y2:base,style:'stroke:var(--muted);stroke-width:1'}));
    }else{
      const xs=data.map(d=>d.x);const sx=scale(Math.min(...xs),Math.max(...xs));const X=v=>m.l+(v-sx.lo)/(sx.hi-sx.lo)*pw;
      g.append(svg('line',{x1:m.l,x2:W-m.r,y1:m.t+ph,y2:m.t+ph,style:'stroke:var(--muted);stroke-width:1'}));
      sx.ticks.forEach(v=>g.append(svg('text',{x:X(v),y:m.t+ph+16,'text-anchor':'middle','font-size':11,style:'fill:var(--muted)'},sx.fmt(v))));
      series.forEach((s,j)=>{
        const pts=data.filter(d=>d.ys[j]!=null).map(d=>[X(d.x),Y(d.ys[j]),d]);if(!pts.length)return;
        g.append(svg('polyline',{points:pts.map(p=>p[0]+','+p[1]).join(' '),style:`fill:none;stroke:${s.color};stroke-width:2`,'stroke-linejoin':'round','stroke-linecap':'round'}));
        pts.forEach(([x,y,d])=>{const dot=svg('g',{});dot.append(svg('circle',{cx:x,cy:y,r:12,fill:'transparent'}),svg('circle',{cx:x,cy:y,r:4,style:`fill:${s.color};stroke:var(--canvas);stroke-width:2`}),svg('title',{},`${s.name} · X ${d.x.toLocaleString('ko-KR')}: ${d.ys[j].toLocaleString('ko-KR')}`));g.append(dot);});
      });
    }
    const out=[g];
    if(series.length>1){const lg=el('div','graph-legend');series.forEach(s=>{const it=el('span');const k=el('i',bar?'box':'');k.style.setProperty('--c',s.color);it.append(k,s.name);lg.append(it);});out.push(lg);}
    return out;
  }
  function drawTable(b){
    const wrap=el('div','preview-table-wrap');const t=el('table','preview-table');
    b.cells.forEach((r,i)=>{const tr=el('tr');r.forEach(v=>tr.append(el(i===0?'th':'td','',v)));(i===0?t.createTHead():t.tBodies[0]||t.createTBody()).append(tr);});
    wrap.append(t);return[wrap];
  }
  function render(){
    fields.forEach(field=>{const out=document.getElementById('out-'+field.id);if(!out)return;const value=field.value.trim();out.textContent=field.id==='graph-x'?`X축: ${value||'독립변인'}`:field.id==='graph-y'?`Y축: ${value||'종속변인'}`:(value||empty(field.id));});
    if(preset()!=='custom')return;
    customOut.replaceChildren(...(custom.sections.length?custom.sections.map((s,i)=>{
      const sec=el('section','preview-section');sec.append(el('h3','',`${i+1}. ${s.name.trim()||(s.type==='table'?'이름 없는 표':s.type==='graph'?'이름 없는 그래프':'이름 없는 항목')}`));
      sec.append(...(s.type==='table'?drawTable(s):s.type==='graph'?drawGraph(s):[el('p','preview-text',s.body.trim()||'작성 전')]));return sec;
    }):[el('p','preview-text custom-empty','항목을 추가하면 여기에 보입니다.')]));
    document.getElementById('out-title').textContent=custom.title.trim()||'과학 탐구 보고서';
  }

  /* ---------- 입력 양식 ----------
     입력칸은 블록을 더하거나 옮기거나 지울 때만 다시 그린다 — 글자마다 그리면 커서가 튄다 */
  function renderList(){
    const n=custom.sections.length;
    list.replaceChildren(...custom.sections.map((s,i)=>{
      const li=el('li','custom-item');const head=el('div','custom-item-head');const acts=el('div','item-actions');
      const btn=(act,label,text,off)=>{const b=el('button','',text);b.type='button';b.dataset.act=act;b.dataset.i=i;b.setAttribute('aria-label',`항목 ${i+1} ${label}`);b.disabled=off;return b;};
      acts.append(btn('up','위로','↑',i===0),btn('down','아래로','↓',i===n-1),btn('del','삭제','삭제',false));
      head.append(el('span','',`항목 ${i+1}${KIND[s.type]}`),acts);
      const input=(tag,key,ph)=>{const f=el(tag);f.id=`c-${key}-${i}`;f.value=s[key];f.dataset.i=i;f.dataset.key=key;if(ph)f.placeholder=ph;return f;};
      const field=(label,f)=>{const d=el('div','field');const l=el('label','',label);l.htmlFor=f.id;d.append(l,f);return d;};
      li.append(head,field('이름',input('input','name',s.type==='table'?'예: 측정 결과표':s.type==='graph'?'예: 진자 길이와 주기':'예: 관찰 계기')));
      if(s.type==='text'){li.append(field('내용',input('textarea','body')));return li;}
      if(s.type==='graph'){
        const kind=input('select','kind');kind.append(new Option('꺾은선','line'),new Option('막대','bar'));kind.value=s.kind;
        const opts=el('div','graph-opts');opts.append(field('모양',kind),field('X축 이름',input('input','x','예: 길이(m)')),field('Y축 이름',input('input','y','예: 주기(s)')));li.append(opts);
      }
      const wrap=el('div','grid-wrap field');const t=el('table','grid');
      s.cells.forEach((r,ri)=>{const tr=el('tr');r.forEach((v,ci)=>{const td=el('td');const f=el('input');f.value=v;f.dataset.i=i;f.dataset.r=ri;f.dataset.c=ci;
        if(s.type==='graph'){if(ri===0){f.placeholder=ci===0?'X':`Y${ci}`;f.setAttribute('aria-label',ci===0?'X 열 이름':`Y${ci} 계열 이름`);}else{f.inputMode='decimal';f.setAttribute('aria-label',`${ri}번째 값 ${ci===0?'X':'Y'+ci}`);}}
        else f.setAttribute('aria-label',ri===0?`머리글 ${ci+1}열`:`${ri+1}행 ${ci+1}열`);
        td.append(f);tr.append(td);});t.append(tr);});
      wrap.append(t);li.append(wrap);return li;
    }));
  }
  fields.forEach(field=>field.addEventListener('input',render));
  cTitle.addEventListener('input',()=>{custom.title=cTitle.value;render();});
  list.addEventListener('input',e=>{const t=e.target;if(t.dataset.i==null)return;const s=custom.sections[+t.dataset.i];if(t.dataset.r!=null)s.cells[+t.dataset.r][+t.dataset.c]=t.value;else if(t.dataset.key)s[t.dataset.key]=t.value;else return;render();});
  const filled=s=>[s.name,s.body,s.x,s.y,...(s.cells||[]).flat()].some(v=>v&&v.trim());
  list.addEventListener('click',e=>{
    const b=e.target.closest('button[data-act]');if(!b)return;const s=custom.sections;const i=+b.dataset.i;
    if(b.dataset.act==='del'){
      if(filled(s[i])&&!window.confirm('이 항목을 지울까요? 적은 내용도 함께 사라집니다.'))return;
      s.splice(i,1);renderList();(s.length?document.getElementById(`c-name-${Math.min(i,s.length-1)}`):addBtn).focus();
    }else{
      const j=b.dataset.act==='up'?i-1:i+1;[s[i],s[j]]=[s[j],s[i]];renderList();
      // 옮긴 항목의 같은 버튼에 포커스를 남긴다. 맨 끝에 닿아 꺼졌으면 반대쪽 버튼으로
      const same=list.querySelector(`[data-i="${j}"][data-act="${b.dataset.act}"]`);(same.disabled?list.querySelector(`[data-i="${j}"][data-act="${b.dataset.act==='up'?'down':'up'}"]`):same).focus();
    }
    render();
  });
  function add(block){picker.hidden=true;pending=null;custom.sections.push(block);renderList();render();document.getElementById(`c-name-${custom.sections.length-1}`).focus();}
  addBtn.addEventListener('click',()=>add({type:'text',name:'',body:''}));
  // 표·그래프는 행·열을 먼저 묻는다. 범위는 input 의 min/max 로 브라우저가 막는다
  ['table','graph'].forEach(type=>document.getElementById('add-'+type).addEventListener('click',()=>{
    const s=SIZE[type];pending=type;document.getElementById('size-what').textContent=s.what;document.getElementById('size-hint').textContent=s.hint;
    [[sizeR,s.r,s.def[0]],[sizeC,s.c,s.def[1]]].forEach(([f,[lo,hi],v])=>{f.min=lo;f.max=hi;f.value=v;});
    picker.hidden=false;sizeR.focus();sizeR.select();
  }));
  picker.addEventListener('submit',e=>{
    e.preventDefault();if(!pending)return;const rows=+sizeR.value;const cols=+sizeC.value;
    const cells=Array.from({length:rows+(pending==='graph'?1:0)},()=>Array(cols).fill(''));
    add(pending==='graph'?{type:'graph',name:'',kind:'line',x:'',y:'',cells}:{type:'table',name:'',cells});
  });
  document.getElementById('size-cancel').addEventListener('click',()=>{picker.hidden=true;document.getElementById('add-'+pending).focus();pending=null;});
  // 그래프 폭은 미리보기 칸 폭에 맞춰 그린다(글자가 줄어들지 않게)
  window.addEventListener('resize',()=>{if(preset()==='custom')render();});
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
      const dirty=isCustom?JSON.stringify(normal(saved))!==JSON.stringify(normal(custom)):fields.some(field=>typeof basic[field.id]==='string'&&field.value!==basic[field.id]);
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
