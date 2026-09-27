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
              graph:{r:[2,30],c:[2,6],def:[5,2],what:'그래프 데이터',hint:'행 = 측정값 개수, 첫 열 = X값, 나머지 열 = Y값(계열 하나씩). 모양은 만든 뒤 고릅니다.'}};
  const KIND={text:'',table:' · 표',graph:' · 그래프'};
  // cells 의 행 수 한도 — 그래프는 첫 행(계열 이름)이 더 있다
  const rowRange=type=>{const h=type==='graph'?1:0;return[SIZE[type].r[0]+h,SIZE[type].r[1]+h];};
  let custom={title:'',sections:[]};let pending=null;
  const preset=()=>layout.dataset.preset;
  const read=key=>JSON.parse(localStorage.getItem(key)||'null');
  const str=v=>typeof v==='string'?v:'';
  // 저장본은 믿지 않는다 — 모양이 틀린 값은 버리고 표는 직사각형으로 채운다
  function normal(d){
    const block=s=>{
      const type=s.type==='table'||s.type==='graph'?s.type:'text';const b={type,name:str(s.name)};
      if(type==='text'){b.body=str(s.body);return b;}
      if(type==='graph'){b.kind=KIND_OF[s.kind]?s.kind:'line';b.x=str(s.x);b.y=str(s.y);b.trend=s.trend===true;b.err=s.err==='sd'?'sd':'range';b.title=str(s.title);b.xu=str(s.xu);b.yu=str(s.yu);}
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
     dataviz 규격: 선 2px · 점 r4 + 배경색 링 2px · 막대 ≤24px, 끝만 4px 둥글게, 막대·조각 사이 2px ·
     가는 격자 · 계열 2개 이상이면 범례 · 글자는 계열 색을 쓰지 않는다. 값은 점·막대에 마우스를 올리면(title) 보인다. */
  const NS='http://www.w3.org/2000/svg';
  const svg=(tag,attrs,text)=>{const e=document.createElementNS(NS,tag);for(const k in attrs)e.setAttribute(k,attrs[k]);if(text!=null)e.textContent=text;return e;};
  const num=v=>{const t=String(v).replace(/,/g,'').trim();const n=Number(t);return t!==''&&Number.isFinite(n)?n:null;};
  const loc=v=>v.toLocaleString('ko-KR');
  function scale(lo,hi){
    if(lo===hi){lo-=Math.abs(lo)||1;hi+=Math.abs(hi)||1;}
    const raw=(hi-lo)/5;const mag=10**Math.floor(Math.log10(raw));const f=[1,2,2.5,5,10].find(m=>m*mag>=raw);const step=f*mag;
    const dec=Math.max(0,-Math.floor(Math.log10(mag))+(f===2.5?1:0));const a=Math.floor(lo/step)*step;const b=Math.ceil(hi/step)*step;
    const ticks=[];for(let v=a;v<=b+step/2;v+=step)ticks.push(Number(v.toFixed(dec)));
    return {lo:a,hi:b,ticks,fmt:v=>v.toLocaleString('ko-KR',{maximumFractionDigits:dec})};
  }
  // [값, 선택지 이름, 읽어 주는 이름, 입력 안내]
  const KINDS=[
    ['line','꺾은선','꺾은선그래프','첫 열 X(숫자), 다른 열마다 선 하나.'],
    ['area','영역','영역그래프','꺾은선 아래를 옅게 칠합니다. 계열이 하나일 때 가장 잘 읽힙니다.'],
    ['bar','막대','막대그래프','첫 열 이름표(글자 가능), 다른 열마다 막대 하나.'],
    ['hbar','가로 막대','가로 막대그래프','이름표가 길 때 씁니다. 첫 열 이름표, 다른 열마다 막대 하나.'],
    ['stack','누적 막대','누적 막대그래프','한 이름표의 값들을 위로 쌓습니다(0보다 큰 값만).'],
    ['band','띠그래프','띠그래프','행마다 합을 100%로 보고 구성 비율을 띠로 보여 줍니다(0보다 큰 값만).'],
    ['pie','원그래프','원그래프','첫 열 조각 이름, 둘째 열 값(0보다 큰 수). 조각은 5개까지, 나머지는 기타로 묶습니다.'],
    ['scatter','산점도','산점도','첫 열 X(숫자), 다른 열마다 점 색 하나(최대 3).'],
    ['error','오차 막대','오차 막대 그래프','첫 열 조건, 나머지 열에 반복 측정값. 점은 평균, 세로 막대는 오차 범위입니다.'],
    ['hist','히스토그램','히스토그램','둘째 열에 측정값을 한 칸에 하나씩. 구간은 자동으로 나눕니다.']];
  const KIND_OF=Object.fromEntries(KINDS.map(k=>[k[0],k]));
  // Y 열 한도 — 산점도는 모든 계열 쌍이 구분돼야 해 3(팔레트 4색째 노랑↔주황이 검증 실패), 원그래프·히스토그램은 한 열만
  const MAX_Y={scatter:3,pie:1,hist:1};
  const maxCols=kind=>1+(MAX_Y[kind]||SIZE.graph.c[1]-1);
  const TOO_MANY={scatter:'산점도는 점 색이 섞이지 않게 계열 3개까지만 그립니다. 나머지는 그래프를 나눠 주세요.',pie:'원그래프는 둘째 열(첫 Y 열)만 씁니다.',hist:'히스토그램은 둘째 열(첫 Y 열)의 값만 씁니다.'};
  const TREND=['line','scatter'];   // 추세선을 켤 수 있는 모양
  const muted=t=>el('p','preview-text custom-empty',t);
  const tip=(n,t)=>{n.append(svg('title',{},t));return n;};
  // 판 — 왼쪽 여백은 가로 막대의 이름표 길이(글자 수)에 맞춰 넓힌다
  function frame(b,chars){
    const W=Math.min(640,Math.max(280,customOut.clientWidth||520));const H=Math.round(Math.min(300,W*.6));
    const m={l:Math.round(Math.min(Math.max(46,(chars||0)*11+12),W*.34)),r:24,t:26,b:40};   // 오른쪽 24 — 끝 눈금(100%, 185)이 잘리지 않게
    const g=svg('svg',{class:'graph-svg',width:W,height:H,viewBox:`0 0 ${W} ${H}`,role:'img','aria-label':`${b.title.trim()||b.name.trim()||'그래프'} — ${KIND_OF[b.kind][2]}`});
    return {g,W,H,m,pw:W-m.l-m.r,ph:H-m.t-m.b};
  }
  const text=(f,x,y,t,anchor,tone)=>{const e=svg('text',{x,y,'text-anchor':anchor||'middle','font-size':11,style:`fill:var(--${tone||'muted'})`},t);f.g.append(e);return e;};
  const rule=(f,x1,y1,x2,y2,tone)=>f.g.append(svg('line',{x1,y1,x2,y2,style:`stroke:var(--${tone||'hairline'});stroke-width:1`}));
  // 이름표가 칸보다 길면 줄이고 전체는 툴팁으로
  const cut=(f,x,y,label,room,anchor)=>tip(text(f,x,y,label.length>room?label.slice(0,Math.max(1,room-1))+'…':label,anchor),label);
  // 축 이름에 단위를 괄호로 — "길이 (m)". 값 뒤 단위는 한글(명·개)이면 붙이고 기호(m·s)면 띄운다
  const lab=(name,unit)=>{name=name.trim();unit=unit.trim();return unit?(name?`${name} (${unit})`:`(${unit})`):name;};
  const val=(v,unit)=>{unit=unit.trim();return loc(v)+(unit?(/^[가-힣]/.test(unit)?'':' ')+unit:'');};
  const titles=(f,xt,yt)=>{if(yt.trim())text(f,f.m.l-6,12,yt.trim(),'start','body');if(xt.trim())text(f,f.W-f.m.r,f.H-4,xt.trim(),'end','body');};
  // 세로 값 축(가로 격자 + 눈금) → 값을 y 로. 가로 값 축(grid 면 세로 격자) → 값을 x 로
  function vAxis(f,sy){const Y=v=>f.m.t+f.ph-(v-sy.lo)/(sy.hi-sy.lo)*f.ph;sy.ticks.forEach(v=>{rule(f,f.m.l,Y(v),f.W-f.m.r,Y(v));text(f,f.m.l-6,Y(v)+4,sy.fmt(v),'end');});rule(f,f.m.l,f.m.t,f.m.l,f.m.t+f.ph,'muted');return Y;}
  function hAxis(f,sx,grid){const X=v=>f.m.l+(v-sx.lo)/(sx.hi-sx.lo)*f.pw;sx.ticks.forEach(v=>{if(grid)rule(f,X(v),f.m.t,X(v),f.m.t+f.ph);text(f,X(v),f.m.t+f.ph+16,sx.fmt(v));});rule(f,f.m.l,f.m.t+f.ph,f.W-f.m.r,f.m.t+f.ph,'muted');return X;}
  // 막대 — 데이터 쪽 끝만 둥글고 기준선 쪽은 각지게(round 가 아니면 사각형)
  function vBar(x,w,base,y,round){const r=round?Math.min(4,w/2,Math.abs(base-y)):0;const s=y<base?1:-1;return `M${x},${base}V${y+s*r}Q${x},${y} ${x+r},${y}H${x+w-r}Q${x+w},${y} ${x+w},${y+s*r}V${base}Z`;}
  function hBar(y,h,base,x,round){const r=round?Math.min(4,h/2,Math.abs(x-base)):0;const s=x>base?1:-1;return `M${base},${y}H${x-s*r}Q${x},${y} ${x},${y+r}V${y+h-r}Q${x},${y+h} ${x-s*r},${y+h}H${base}Z`;}
  const shape=(d,color,t)=>tip(svg('path',{d,style:`fill:${color}`}),t);
  const groupW=(band,n)=>{const bw=Math.max(2,Math.min(24,(band*.7-(n-1)*2)/n));return[bw,n*bw+(n-1)*2];};
  const dot=(x,y,color,t)=>{const d=svg('g',{});d.append(svg('circle',{cx:x,cy:y,r:12,fill:'transparent'}),svg('circle',{cx:x,cy:y,r:4,style:`fill:${color};stroke:var(--canvas);stroke-width:2`}));return tip(d,t);};
  function legend(items,key){const lg=el('div','graph-legend');items.forEach(s=>{const it=el('span');const k=el('i',key);k.style.setProperty('--c',s.color);it.append(k,s.name);lg.append(it);});return lg;}
  // 최소제곱 직선 y = ax + b 와 결정계수. 점이 2개 미만이거나 X 가 모두 같으면 없음
  function fit(pts){
    const n=pts.length;if(n<2)return null;const mx=pts.reduce((s,p)=>s+p[0],0)/n;const my=pts.reduce((s,p)=>s+p[1],0)/n;
    const sxx=pts.reduce((s,p)=>s+(p[0]-mx)**2,0);if(!sxx)return null;const a=pts.reduce((s,p)=>s+(p[0]-mx)*(p[1]-my),0)/sxx;const b=my-a*mx;
    const syy=pts.reduce((s,p)=>s+(p[1]-my)**2,0);const res=pts.reduce((s,p)=>s+(p[1]-a*p[0]-b)**2,0);
    return {a,b,r2:syy?1-res/syy:1};
  }
  const sig=v=>Number(v.toPrecision(3)).toLocaleString('ko-KR',{maximumFractionDigits:10});
  const rowsOf=(b,end)=>b.cells.slice(1).map((r,i)=>({label:r[0].trim()||String(i+1),x:num(r[0]),ys:r.slice(1,end).map(num)}));

  // 꺾은선 · 영역 · 산점도 — X 도 숫자. 꺾은선·영역은 X 순으로 잇는다
  function drawXY(b,series,rows){
    const area=b.kind==='area';const dots=b.kind==='scatter';
    const data=rows.filter(d=>d.x!==null&&d.ys.some(y=>y!==null)).sort((p,q)=>p.x-q.x);
    if(!data.length)return[muted('X·Y값에 숫자를 넣으면 그래프가 그려집니다.')];
    const xs=data.map(d=>d.x);const x0=Math.min(...xs);const x1=Math.max(...xs);
    // 추세선은 끝점까지 축 범위에 넣어야 칸 밖으로 안 나간다
    const fits=b.trend&&TREND.includes(b.kind)?series.map((s,j)=>fit(data.filter(d=>d.ys[j]!=null).map(d=>[d.x,d.ys[j]]))):[];
    const ys=data.flatMap(d=>d.ys).filter(y=>y!==null).concat(...fits.map(k=>k?[k.a*x0+k.b,k.a*x1+k.b]:[]));
    const f=frame(b);const sy=area?scale(Math.min(0,...ys),Math.max(0,...ys)):scale(Math.min(...ys),Math.max(...ys));
    const Y=vAxis(f,sy);const X=hAxis(f,scale(x0,x1));titles(f,lab(b.x,b.xu),lab(b.y,b.yu));
    series.forEach((s,j)=>{
      const pts=data.filter(d=>d.ys[j]!=null).map(d=>[X(d.x),Y(d.ys[j]),d]);if(!pts.length)return;
      const line=pts.map(p=>p[0]+','+p[1]).join(' ');
      if(area){const base=Y(Math.max(sy.lo,Math.min(0,sy.hi)));f.g.append(svg('polygon',{points:`${pts[0][0]},${base} ${line} ${pts[pts.length-1][0]},${base}`,style:`fill:${s.color};fill-opacity:.1`}));}
      if(!dots)f.g.append(svg('polyline',{points:line,style:`fill:none;stroke:${s.color};stroke-width:2`,'stroke-linejoin':'round','stroke-linecap':'round'}));
      const k=fits[j];if(k)f.g.append(svg('line',{x1:X(x0),y1:Y(k.a*x0+k.b),x2:X(x1),y2:Y(k.a*x1+k.b),class:'trend',style:`stroke:${s.color};stroke-width:1.5;stroke-dasharray:6 4`}));
      pts.forEach(([x,y,d])=>f.g.append(dot(x,y,s.color,`${s.name} · X ${val(d.x,b.xu)}: ${val(d.ys[j],b.yu)}`)));
    });
    const out=[f.g];if(series.length>1)out.push(legend(series,dots?'dot':''));
    if(fits.some(Boolean))out.push(legend(series.map((s,j)=>fits[j]&&{color:s.color,name:`${series.length>1?s.name+': ':''}y = ${sig(fits[j].a)}x ${fits[j].b<0?'−':'+'} ${sig(Math.abs(fits[j].b))} (R² = ${fits[j].r2.toFixed(3)})`}).filter(Boolean),'dash'));
    return out;
  }
  // 막대 · 누적 막대 — X 는 이름표(글자 가능)
  function drawBars(b,series,rows){
    const stack=b.kind==='stack';
    const data=rows.filter(d=>d.ys.some(y=>stack?y>0:y!==null));
    if(!data.length)return[muted(stack?'값(0보다 큰 수)을 넣으면 누적 막대그래프가 그려집니다.':'Y값에 숫자를 넣으면 막대그래프가 그려집니다.')];
    const ys=stack?data.map(d=>d.ys.reduce((s,v)=>s+(v>0?v:0),0)):data.flatMap(d=>d.ys).filter(y=>y!==null);
    const f=frame(b);const sy=scale(Math.min(0,...ys),Math.max(0,...ys));const Y=vAxis(f,sy);titles(f,lab(b.x,b.xu),lab(b.y,b.yu));
    const base=Y(Math.max(sy.lo,Math.min(0,sy.hi)));const band=f.pw/data.length;const [bw,gw]=groupW(band,stack?1:series.length);
    data.forEach((d,i)=>{
      const cx=f.m.l+band*(i+.5);cut(f,cx,f.m.t+f.ph+16,d.label,Math.max(1,Math.floor(band/7)));
      if(stack){
        // 아래부터 쌓는다. 조각 사이 2px, 맨 위 조각만 끝을 둥글게
        let acc=0;const top=d.ys.reduce((t,v,j)=>v>0?j:t,-1);
        d.ys.forEach((v,j)=>{if(!(v>0))return;const y0=Y(acc)-(acc>0?2:0);acc+=v;f.g.append(shape(vBar(cx-bw/2,bw,y0,Y(acc),j===top),series[j].color,`${series[j].name} · ${d.label}: ${val(v,b.yu)}`));});
      }else d.ys.forEach((v,j)=>{if(v!==null)f.g.append(shape(vBar(cx-gw/2+j*(bw+2),bw,base,Y(v),true),series[j].color,`${series[j].name} · ${d.label}: ${val(v,b.yu)}`));});
    });
    rule(f,f.m.l,base,f.W-f.m.r,base,'muted');
    return series.length>1?[f.g,legend(series,'box')]:[f.g];
  }
  // 가로 막대 · 띠그래프 — 이름표가 왼쪽, 값이 가로. 띠그래프는 행마다 100%
  function drawHBars(b,series,rows){
    const band100=b.kind==='band';
    const data=rows.filter(d=>d.ys.some(y=>band100?y>0:y!==null));
    if(!data.length)return[muted(band100?'값(0보다 큰 수)을 넣으면 띠그래프가 그려집니다.':'값에 숫자를 넣으면 가로 막대그래프가 그려집니다.')];
    const f=frame(b,Math.max(...data.map(d=>d.label.length)));const bandH=f.ph/data.length;
    const ys=data.flatMap(d=>d.ys).filter(y=>y!==null);
    const X=hAxis(f,band100?{lo:0,hi:100,ticks:[0,25,50,75,100],fmt:v=>v+'%'}:scale(Math.min(0,...ys),Math.max(0,...ys)),true);titles(f,band100?'':lab(b.y,b.yu),lab(b.x,b.xu));
    const base=X(0);const [bh,gh]=groupW(bandH,band100?1:series.length);
    data.forEach((d,i)=>{
      const cy=f.m.t+bandH*(i+.5);cut(f,f.m.l-8,cy+4,d.label,Math.max(1,Math.floor((f.m.l-10)/11)),'end');
      if(band100){
        const total=d.ys.reduce((s,v)=>s+(v>0?v:0),0);let acc=0;const last=d.ys.reduce((t,v,j)=>v>0?j:t,-1);
        d.ys.forEach((v,j)=>{if(!(v>0))return;const x0=X(acc/total*100)+(acc>0?2:0);acc+=v;f.g.append(shape(hBar(cy-bh/2,bh,x0,X(acc/total*100),j===last),series[j].color,`${series[j].name} · ${d.label}: ${val(v,b.yu)} (${(v/total*100).toFixed(1)}%)`));});
      }else d.ys.forEach((v,j)=>{if(v!==null)f.g.append(shape(hBar(cy-gh/2+j*(bh+2),bh,base,X(v),true),series[j].color,`${series[j].name} · ${d.label}: ${val(v,b.yu)}`));});
    });
    rule(f,base,f.m.t,base,f.m.t+f.ph,'muted');
    return series.length>1?[f.g,legend(series,'box')]:[f.g];
  }
  // 원그래프 — 12시에서 시계 방향. 조각 색은 5개라 6번째부터 기타(회색)로 묶는다
  function drawPie(b,series,rows){
    let data=rows.filter(d=>d.ys[0]>0).map((d,j)=>({name:d.label,v:d.ys[0],color:`var(--series-${j+1})`}));
    if(!data.length)return[muted('조각 이름과 값(0보다 큰 수)을 넣으면 원그래프가 그려집니다.')];
    const folded=data.length>5;if(folded)data=data.slice(0,5).concat({name:'기타',v:data.slice(5).reduce((s,d)=>s+d.v,0),color:'var(--muted)'});
    const total=data.reduce((s,d)=>s+d.v,0);const f=frame(b);const cx=f.W/2;const cy=f.H/2;const R=f.H/2-12;let a0=-Math.PI/2;
    data.forEach(d=>{
      const a1=a0+d.v/total*2*Math.PI;const pt=a=>`${cx+R*Math.cos(a)},${cy+R*Math.sin(a)}`;const t=`${d.name}: ${val(d.v,b.yu)} (${(d.v/total*100).toFixed(1)}%)`;
      f.g.append(tip(data.length===1?svg('circle',{cx,cy,r:R,style:`fill:${d.color}`}):svg('path',{d:`M${cx},${cy}L${pt(a0)}A${R},${R} 0 ${a1-a0>Math.PI?1:0} 1 ${pt(a1)}Z`,style:`fill:${d.color};stroke:var(--canvas);stroke-width:2;stroke-linejoin:round`}),t));a0=a1;
    });
    const out=[f.g,legend(data.map(d=>({color:d.color,name:`${d.name} ${(d.v/total*100).toFixed(1)}%${b.yu.trim()?` (${val(d.v,b.yu)})`:''}`})),'box')];
    if(folded)out.push(muted('조각이 많아 6번째부터는 기타로 묶었습니다.'));
    return out;
  }
  // 오차 막대 — 행마다 반복 측정값의 평균(점)과 범위(세로 막대). X 가 모두 숫자면 숫자 축, 아니면 이름표
  function drawError(b,series,rows){
    const sd=b.err==='sd';
    const data=rows.map(d=>{const v=d.ys.filter(y=>y!==null);if(!v.length)return null;const mean=v.reduce((s,y)=>s+y,0)/v.length;
      const s=v.length>1?Math.sqrt(v.reduce((t,y)=>t+(y-mean)**2,0)/(v.length-1)):0;
      return {...d,n:v.length,mean,s,lo:sd?mean-s:Math.min(...v),hi:sd?mean+s:Math.max(...v)};}).filter(Boolean);
    if(!data.length)return[muted('반복 측정값을 넣으면 평균과 오차 범위가 그려집니다.')];
    const numeric=data.every(d=>d.x!==null);if(numeric)data.sort((p,q)=>p.x-q.x);
    const f=frame(b);const Y=vAxis(f,scale(Math.min(...data.map(d=>d.lo)),Math.max(...data.map(d=>d.hi))));titles(f,lab(b.x,b.xu),lab(b.y,b.yu));const band=f.pw/data.length;
    // 숫자 축은 양끝에 5% 여유 — 첫·끝 오차 막대가 세로축·가장자리에 붙지 않게
    const xs=data.map(d=>d.x);const pad=(Math.max(...xs)-Math.min(...xs))*.05||1;const X=numeric?hAxis(f,scale(Math.min(...xs)-pad,Math.max(...xs)+pad)):null;
    if(!numeric){rule(f,f.m.l,f.m.t+f.ph,f.W-f.m.r,f.m.t+f.ph,'muted');data.forEach((d,i)=>cut(f,f.m.l+band*(i+.5),f.m.t+f.ph+16,d.label,Math.max(1,Math.floor(band/7))));}
    const c='var(--series-1)';const stroke=`stroke:${c};stroke-width:2;stroke-linecap:round`;
    data.forEach((d,i)=>{
      const x=numeric?X(d.x):f.m.l+band*(i+.5);
      f.g.append(svg('line',{x1:x,x2:x,y1:Y(d.lo),y2:Y(d.hi),class:'err',style:stroke}),svg('line',{x1:x-5,x2:x+5,y1:Y(d.lo),y2:Y(d.lo),style:stroke}),svg('line',{x1:x-5,x2:x+5,y1:Y(d.hi),y2:Y(d.hi),style:stroke}));
      f.g.append(dot(x,Y(d.mean),c,`${d.label}: 평균 ${val(d.mean,b.yu)} (${sd?`표준편차 ${val(d.s,b.yu)}`:`최소 ${val(d.lo,b.yu)} ~ 최대 ${val(d.hi,b.yu)}`}, ${d.n}회)`));
    });
    return [f.g,muted(sd?'점 = 평균, 막대 = 평균 ± 표준편차':'점 = 평균, 막대 = 최소 ~ 최대')];
  }
  // 히스토그램 — 둘째 열 값의 분포. 구간 수는 스터지스(1 + log₂n, 3~12), 폭은 깔끔한 수. 마지막 구간만 끝값 포함
  function drawHist(b,series,rows){
    const v=rows.map(d=>d.ys[0]).filter(y=>y!=null);
    if(v.length<2)return[muted('측정값을 두 개 이상 넣으면 히스토그램이 그려집니다.')];
    const lo=Math.min(...v);const hi=Math.max(...v);const k=Math.min(12,Math.max(3,Math.ceil(Math.log2(v.length)+1)));
    const raw=(hi-lo||1)/k;const mag=10**Math.floor(Math.log10(raw));const m=[1,2,2.5,5,10].find(x=>x*mag>=raw);const w=m*mag;
    const dec=Math.max(0,-Math.floor(Math.log10(mag))+(m===2.5?1:0));const start=Math.floor(lo/w)*w;
    const nb=Math.max(1,Math.ceil(+((hi-start)/w).toFixed(9)));const counts=Array(nb).fill(0);
    v.forEach(x=>counts[Math.min(nb-1,Math.floor(+((x-start)/w).toFixed(9)))]++);
    const edge=i=>Number((start+i*w).toFixed(dec)).toLocaleString('ko-KR',{maximumFractionDigits:dec});
    const f=frame(b);const sy=scale(0,Math.max(...counts));sy.ticks=sy.ticks.filter(Number.isInteger);const Y=vAxis(f,sy);
    titles(f,lab(b.x.trim()?b.x:series[0].name,b.xu),lab(b.y.trim()?b.y:'도수',b.yu));
    const bw=f.pw/nb;const every=Math.ceil(36/bw);const base=Y(0);
    counts.forEach((c,i)=>{if(c)f.g.append(shape(vBar(f.m.l+i*bw+1,bw-2,base,Y(c),true),'var(--series-1)',`${edge(i)}${b.xu.trim()?' '+b.xu.trim():''} 이상 ${edge(i+1)}${b.xu.trim()?' '+b.xu.trim():''} ${i===nb-1?'이하':'미만'}: ${val(c,b.yu.trim()||'개')}`));});
    for(let i=0;i<=nb;i+=every)text(f,f.m.l+i*bw,f.m.t+f.ph+16,edge(i));
    rule(f,f.m.l,base,f.W-f.m.r,base,'muted');
    return [f.g];
  }
  const DRAW={line:drawXY,area:drawXY,scatter:drawXY,bar:drawBars,stack:drawBars,hbar:drawHBars,band:drawHBars,pie:drawPie,error:drawError,hist:drawHist};
  function drawGraph(b){
    const lim=MAX_Y[b.kind];const end=lim?1+lim:undefined;const head=b.cells[0].slice(0,end);
    const series=head.slice(1).map((h,j)=>({name:h.trim()||`Y${j+1}`,color:`var(--series-${j+1})`}));
    const out=DRAW[b.kind](b,series,rowsOf(b,end));
    if(b.title.trim())out.unshift(el('p','graph-title',b.title.trim()));
    if(b.cells[0].length>head.length)out.push(muted(TOO_MANY[b.kind]));
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
        const kind=input('select','kind');KINDS.forEach(([v,t])=>kind.append(new Option(t,v)));kind.value=s.kind;
        const opts=el('div','graph-opts');opts.append(field('모양',kind),field('그래프 제목',input('input','title','예: 진자 길이에 따른 주기')));li.append(opts);
        const axes=el('div','axis-opts');const hist=s.kind==='hist';
        if(s.kind==='pie')axes.append(field('값 단위',input('input','yu','예: 명')));
        else axes.append(field(hist?'값 이름':'X축 이름',input('input','x',hist?'예: 키':'예: 길이')),field(hist?'값 단위':'X축 단위',input('input','xu',hist?'예: cm':'예: m')),
          field('Y축 이름',input('input','y',hist?'예: 도수':'예: 주기')),field('Y축 단위',input('input','yu',hist?'예: 명':'예: s')));
        li.append(axes);const extra=el('div','graph-extra');
        if(TREND.includes(s.kind)){const c=el('input');c.type='checkbox';c.id=`c-trend-${i}`;c.checked=s.trend;c.dataset.i=i;c.dataset.key='trend';const l=el('label','check');l.htmlFor=c.id;l.append(c,'추세선(최소제곱 직선과 식) 그리기');extra.append(l);}
        if(s.kind==='error'){const e=input('select','err');e.append(new Option('최소 ~ 최대','range'),new Option('평균 ± 표준편차','sd'));e.value=s.err;extra.append(field('오차 범위',e));}
        extra.append(el('p','graph-guide',KIND_OF[s.kind][3]));li.append(extra);
      }
      const [lo,hi]=rowRange(s.type);const clo=SIZE[s.type].c[0];const chi=s.type==='graph'?maxCols(s.kind):SIZE[s.type].c[1];const cols=s.cells[0].length;const wrap=el('div','grid-wrap field');const t=el('table','grid');
      const mini=(act,text,off,label)=>{const d=el('button','grid-btn',text);d.type='button';d.dataset.act=act;d.dataset.i=i;d.disabled=off;if(label)d.setAttribute('aria-label',label);return d;};
      // 맨 위 줄 = 열마다 삭제. 그래프의 X 열은 지우지 않는다. 최소 열 수에 닿으면 꺼진다
      const top=el('tr','col-x');
      for(let ci=0;ci<cols;ci++){const td=el('td');if(!(s.type==='graph'&&ci===0)){const d=mini('col-del','×',cols<=clo,s.type==='graph'?`Y${ci} 계열 삭제`:`${ci+1}열 삭제`);d.dataset.c=ci;td.append(d);}top.append(td);}
      top.append(el('td','row-x'));t.append(top);
      s.cells.forEach((r,ri)=>{const tr=el('tr');r.forEach((v,ci)=>{const td=el('td');const f=el('input');f.value=v;f.dataset.i=i;f.dataset.r=ri;f.dataset.c=ci;
        if(s.type==='graph'){if(ri===0){f.placeholder=ci===0?(PH[s.kind]||'X'):s.kind==='error'?`${ci}회`:s.kind==='pie'?'값':s.kind==='hist'?'측정값':`Y${ci}`;f.setAttribute('aria-label',ci===0?'X 열 이름':`Y${ci} 계열 이름`);}else{f.inputMode=ci>0||!PH[s.kind]?'decimal':'text';f.setAttribute('aria-label',`${ri}번째 값 ${ci===0?'X':'Y'+ci}`);}}
        else f.setAttribute('aria-label',ri===0?`머리글 ${ci+1}열`:`${ri+1}행 ${ci+1}열`);
        td.append(f);tr.append(td);});
        // 행마다 끝에 삭제 — 머리글(이름) 행은 지우지 않는다. 최소 행 수에 닿으면 꺼진다
        const x=el('td','row-x');if(ri>0){const d=mini('row-del','×',s.cells.length<=lo,s.type==='graph'?`${ri}번째 값 행 삭제`:`${ri+1}행 삭제`);d.dataset.r=ri;x.append(d);}
        tr.append(x);t.append(tr);});
      const adds=el('div','grid-add');adds.append(mini('row-add','+ 행 추가',s.cells.length>=hi),mini('col-add','+ 열 추가',cols>=chi));
      wrap.append(t);li.append(wrap,adds);return li;
    }));
  }
  fields.forEach(field=>field.addEventListener('input',render));
  cTitle.addEventListener('input',()=>{custom.title=cTitle.value;render();});
  list.addEventListener('input',e=>{const t=e.target;if(t.dataset.i==null)return;const s=custom.sections[+t.dataset.i];if(t.dataset.r!=null)s.cells[+t.dataset.r][+t.dataset.c]=t.value;else if(t.dataset.key)s[t.dataset.key]=t.type==='checkbox'?t.checked:t.value;else return;
    // 모양이 바뀌면 열 한도·옵션·안내가 달라지니 입력칸을 다시 그린다
    if(t.dataset.key==='kind'){renderList();document.getElementById(`c-kind-${t.dataset.i}`).focus();}
    render();});
  // 첫 열 머리글 자리표시 — 숫자가 아닌 이름표를 쓰는 모양만(없으면 X, 숫자 입력)
  const PH={bar:'이름표',hbar:'이름표',stack:'이름표',band:'이름표',pie:'조각 이름',error:'조건',hist:'번호'};
  const filled=s=>[s.name,s.body,s.x,s.y,...(s.cells||[]).flat()].some(v=>v&&v.trim());
  list.addEventListener('click',e=>{
    const b=e.target.closest('button[data-act]');if(!b)return;const s=custom.sections;const i=+b.dataset.i;
    if(b.dataset.act==='row-add'){
      const cells=s[i].cells;cells.push(Array(cells[0].length).fill(''));renderList();
      list.querySelector(`input[data-i="${i}"][data-r="${cells.length-1}"][data-c="0"]`).focus();
    }else if(b.dataset.act==='row-del'){
      const cells=s[i].cells;const r=+b.dataset.r;
      if(cells[r].some(v=>v.trim())&&!window.confirm('이 행을 지울까요? 적은 값도 함께 사라집니다.'))return;
      cells.splice(r,1);renderList();
      // 같은 자리(없으면 위)의 삭제 버튼으로. 다 꺼졌으면 행 추가로
      const next=list.querySelector(`[data-i="${i}"][data-act="row-del"][data-r="${Math.min(r,cells.length-1)}"]`);
      (next&&!next.disabled?next:list.querySelector(`[data-i="${i}"][data-act="row-add"]`)).focus();
    }else if(b.dataset.act==='col-add'){
      const cells=s[i].cells;cells.forEach(r=>r.push(''));renderList();
      list.querySelector(`input[data-i="${i}"][data-r="0"][data-c="${cells[0].length-1}"]`).focus();
    }else if(b.dataset.act==='col-del'){
      const cells=s[i].cells;const c=+b.dataset.c;
      if(cells.some(r=>r[c].trim())&&!window.confirm('이 열을 지울까요? 적은 값도 함께 사라집니다.'))return;
      cells.forEach(r=>r.splice(c,1));renderList();
      const next=list.querySelector(`[data-i="${i}"][data-act="col-del"][data-c="${Math.min(c,cells[0].length-1)}"]`);
      (next&&!next.disabled?next:list.querySelector(`[data-i="${i}"][data-act="col-add"]`)).focus();
    }else if(b.dataset.act==='del'){
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
    add(pending==='graph'?{type:'graph',name:'',kind:'line',x:'',y:'',trend:false,err:'range',title:'',xu:'',yu:'',cells}:{type:'table',name:'',cells});
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
