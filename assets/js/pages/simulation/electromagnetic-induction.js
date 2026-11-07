(function(){
  const el=id=>document.getElementById(id);
  const canvas=el('canvas'),ctx=canvas.getContext('2d'),graphCanvas=el('graph-canvas'),graphCtx=graphCanvas.getContext('2d');
  const params={strength:.6,speed:1,turns:100,pole:1,area:20};
  const state={running:true,t:0,x:0,prevX:0,velocity:0,flux:0,prevFlux:0,fluxRate:0,emf:0,lastMovedAt:0};
  const history={time:[],fluxRate:[],emf:[]};
  let last=performance.now(),lastSample=0;

  function resize(){
    const w=canvas.clientWidth,h=Math.round(w*.62),dpr=window.devicePixelRatio||1;
    canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);canvas.style.height=h+'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const gw=graphCanvas.clientWidth,gh=400;
    graphCanvas.width=Math.round(gw*dpr);graphCanvas.height=Math.round(gh*dpr);graphCanvas.style.height=gh+'px';
    graphCtx.setTransform(dpr,0,0,dpr,0,0);
  }
  // 자석이 코일 앞에서 멈추지 않고 중심을 지나 반대편까지 통과할 수 있게 한다.
  function bounds(){const w=canvas.clientWidth;return{left:w*.10,right:w*.80,coil:w*.55};}
  function autoPosition(){const b=bounds();return b.left+(b.right-b.left)*(.5-.5*Math.cos(state.t*params.speed*1.7));}
  function magneticFlux(x){
    // 코일 중심에서 선속이 가장 크고, 어느 쪽으로 멀어져도 대칭으로 감소한다.
    // 따라서 접근할 때와 통과해 나갈 때 dΦ/dt의 부호가 바뀐다.
    const b=bounds(),distance=b.coil-x,spread=canvas.clientWidth*.14;
    /* Φ = B·A — 면적 배율(params.area/20)을 곱한다.
       면적을 두 배로 하면 같은 자석·같은 거리에서 자기선속도 두 배. */
    return params.pole*params.strength*(params.area/20)*Math.exp(-Math.pow(distance/spread,2));
  }
  function update(dt){
    state.t+=dt;
    state.prevX=state.x;state.x=autoPosition();
    state.prevFlux=state.flux;state.flux=magneticFlux(state.x);
    const dx=state.x-state.prevX,deltaFlux=state.flux-state.prevFlux;
    state.fluxRate=deltaFlux/Math.max(dt,.001);
    if(Math.abs(deltaFlux)>1e-7){
      const raw=-params.turns*state.fluxRate*.0022;
      state.emf=raw;
      state.velocity=dx;state.lastMovedAt=performance.now();
    }else{
      state.fluxRate=0;
      if(performance.now()-state.lastMovedAt>80){state.emf=0;state.velocity=0;}
    }
    state.prevX=state.x;
  }
  function roundedRect(x,y,w,h,r,fill){ctx.fillStyle=fill;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}
  function drawArrow(x1,y1,x2,color){ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y1);ctx.stroke();const s=x2>x1?1:-1;ctx.beginPath();ctx.moveTo(x2,y1);ctx.lineTo(x2-8*s,y1-5);ctx.lineTo(x2-8*s,y1+5);ctx.fill();}
  function draw(){
    const w=canvas.clientWidth,h=canvas.height/(window.devicePixelRatio||1),b=bounds();
    ctx.clearRect(0,0,w,h);const floor=h*.65,magW=Math.max(88,w*.14),magH=48;
    ctx.strokeStyle='rgba(255,255,255,.12)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(w*.06,floor+35);ctx.lineTo(w*.94,floor+35);ctx.stroke();
    // magnetic field lines
    const alpha=.08+Math.abs(state.flux)*.28;ctx.strokeStyle=`rgba(113,174,255,${alpha})`;ctx.lineWidth=1.3;
    for(let i=-2;i<=2;i++){ctx.beginPath();ctx.ellipse((state.x+b.coil)/2,floor+i*13,Math.max(2,Math.abs(b.coil-state.x)/2),42+Math.abs(i)*10,0,Math.PI,0);ctx.stroke();}
    // bar magnet: the leading half changes with pole
    const mx=state.x-magW/2,my=floor-magH/2,leftColor=params.pole===1?'#4386e6':'#dc4c64',rightColor=params.pole===1?'#dc4c64':'#4386e6';
    roundedRect(mx,my,magW/2+5,magH,7,leftColor);roundedRect(mx+magW/2-5,my,magW/2+5,magH,7,rightColor);
    ctx.fillStyle='#fff';ctx.font='700 17px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(params.pole===1?'S':'N',mx+magW*.25,floor);ctx.fillText(params.pole===1?'N':'S',mx+magW*.75,floor);
    // coil
    ctx.strokeStyle='#d7a04b';ctx.lineWidth=3;const rings=Math.max(6,Math.round(params.turns/20));
    const coilR=Math.sqrt(params.area/20);
    for(let i=0;i<rings;i++){const ox=(i-(rings-1)/2)*4;ctx.beginPath();ctx.ellipse(b.coil+ox,floor,17*coilR,66*coilR,0,0,Math.PI*2);ctx.stroke();}
    ctx.strokeStyle='#d7a04b';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(b.coil-rings*2,floor+66);ctx.lineTo(b.coil-rings*2,floor+92);ctx.lineTo(w*.89,floor+92);ctx.lineTo(w*.89,floor+42);ctx.stroke();
    // galvanometer
    ctx.fillStyle='rgba(255,255,255,.07)';ctx.beginPath();ctx.arc(w*.89,floor,40,Math.PI,0);ctx.fill();ctx.strokeStyle='rgba(255,255,255,.35)';ctx.stroke();
    const needle=Math.max(-1,Math.min(1,state.emf/2.5));ctx.save();ctx.translate(w*.89,floor);ctx.rotate(needle*.85);ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(0,-31);ctx.stroke();ctx.restore();
    ctx.fillStyle='rgba(255,255,255,.65)';ctx.font='11px system-ui';ctx.fillText('검류계',w*.89,floor+18);
    const moving=state.velocity;if(Math.abs(moving)>.05)drawArrow(state.x,floor-55,state.x+(moving>0?32:-32),'rgba(255,255,255,.65)');
  }
  function drawGraph(){
    /* 캔버스는 CSS 를 못 받으니 색을 여기서 받아온다. */
    const P = window.GraphTheme.palette();
    const g=graphCtx,cw=graphCanvas.clientWidth,ch=graphCanvas.height/(window.devicePixelRatio||1),x=72,w=cw-96,plotH=125;
    g.clearRect(0,0,cw,ch);g.font='12px system-ui';g.textBaseline='middle';
    const minT=Math.max(0,state.t-6),maxT=Math.max(minT+.001,state.t);
    const chart=(values,top,color,title,unit,scale)=>{
      g.fillStyle=P.panel;g.fillRect(x,top,w,plotH);
      g.strokeStyle=P.grid;g.lineWidth=1;
      for(let j=0;j<=4;j++){const py=top+j/4*plotH,value=scale*(1-j/2);g.beginPath();g.moveTo(x,py);g.lineTo(x+w,py);g.stroke();g.fillStyle=P.muted;g.textAlign='right';g.fillText(value.toFixed(2),x-9,py);}
      for(let j=0;j<=6;j++){const px=x+j/6*w,tick=minT+(maxT-minT)*j/6;g.beginPath();g.moveTo(px,top);g.lineTo(px,top+plotH);g.stroke();if(top>180){g.fillStyle=P.muted;g.textAlign='center';g.fillText(tick.toFixed(1),px,top+plotH+16);}}
      g.strokeStyle=P.muted;g.beginPath();g.moveTo(x,top);g.lineTo(x,top+plotH);g.lineTo(x+w,top+plotH);g.stroke();
      g.fillStyle=color;g.font='600 13px system-ui';g.textAlign='left';g.fillText(`${title}  현재 ${values.length?values[values.length-1].toFixed(4):'0.0000'} ${unit}`,x,top-14);g.font='12px system-ui';
      if(values.length>1){
        g.save();g.beginPath();g.rect(x+1,top+1,w-2,plotH-2);g.clip();
        g.strokeStyle=color;g.lineWidth=2;g.beginPath();values.forEach((v,i)=>{const px=x+(history.time[i]-minT)/(maxT-minT)*w,py=top+plotH/2-v/scale*plotH*.48;i?g.lineTo(px,py):g.moveTo(px,py)});g.stroke();
        const value=values[values.length-1],py=top+plotH/2-value/scale*plotH*.48;g.fillStyle=color;g.beginPath();g.arc(x+w-4,py,4,0,Math.PI*2);g.fill();g.restore();
      }
    };
    chart(history.fluxRate,34,'#d7a04b','자기선속 변화율 dΦ/dt','/s',8);
    chart(history.emf,225,'#69c6ac','유도 기전력 ε','V',4);
    g.fillStyle='rgba(255,255,255,.8)';g.textAlign='center';g.fillText('시간 t (s)',x+w/2,386);
  }
  function pushSample(){history.time.push(state.t);history.fluxRate.push(state.fluxRate);history.emf.push(state.emf);if(history.fluxRate.length>120){history.time.shift();history.fluxRate.shift();history.emf.shift();}}
  function sample(now){if(now-lastSample<50)return;lastSample=now;pushSample();}
  function numbers(){
    const velocity=state.velocity,near=velocity>0.03?'가까워지는 중':velocity<-.03?'멀어지는 중':'멈춤';
    // 위치 변화가 없으면 자기선속도 변하지 않는다. 잔류 보간값까지 제거해
    // 솔레노이드 바로 앞에서 멈춘 경우에도 전류가 흐르는 것처럼 보이지 않게 한다.
    if(near==='멈춤'){state.fluxRate=0;state.emf=0;}
    el('r-motion').textContent=near;el('r-flux').textContent=(state.fluxRate>0?'+':'')+state.fluxRate.toFixed(3)+' Wb/s';
    const emf=state.emf;el('r-emf').textContent=Math.abs(emf)<.0005?'0.000 V':(emf>0?'+':'')+emf.toFixed(3)+' V';
    const current=Math.abs(emf)<.0005?'흐르지 않음':emf>0?'반시계 방향':'시계 방향';el('r-direction').textContent=current;
    el('r-direction').className=Math.abs(emf)<.0005?'zero':emf>0?'positive':'negative';
    el('note').textContent=Math.abs(emf)<.0005?'dΦ/dt = 0이므로 유도 기전력과 전류가 0입니다.':state.fluxRate>0?'자기선속이 증가하여 이를 방해하는 방향으로 유도 전류가 흐릅니다.':'자기선속이 감소하여 변화를 막는 반대 방향으로 유도 전류가 흐릅니다.';
  }
  function frame(now){let dt=Math.min((now-last)/1000,.05);last=now;if(state.running)update(dt);else{state.prevX=state.x;state.prevFlux=state.flux;state.velocity=0;state.fluxRate=0;state.emf=0;}numbers();draw();sample(now);drawGraph();requestAnimationFrame(frame);}
  function reset(){state.t=0;state.x=bounds().left;state.prevX=state.x;state.velocity=0;state.flux=magneticFlux(state.x);state.prevFlux=state.flux;state.fluxRate=0;state.emf=0;state.lastMovedAt=0;history.time=[];history.fluxRate=[];history.emf=[];}
  el('strength').addEventListener('input',function(){params.strength=Number(this.value)/100;el('strength-out').textContent=this.value+'%';});
  el('speed').addEventListener('input',function(){params.speed=Number(this.value);el('speed-out').textContent=params.speed.toFixed(1)+'×';});
  el('turns').addEventListener('input',function(){params.turns=Number(this.value);el('turns-out').textContent=this.value+'회';});
  el('area').addEventListener('input',function(){params.area=Number(this.value);el('area-out').textContent=this.value+' cm²';});
  function setPole(p){params.pole=p;el('pole-out').textContent=p===1?'N극':'S극';el('pole-n').classList.toggle('active',p===1);el('pole-s').classList.toggle('active',p===-1);el('pole-n').setAttribute('aria-pressed',p===1);el('pole-s').setAttribute('aria-pressed',p===-1);state.prevFlux=state.flux=magneticFlux(state.x);state.fluxRate=0;state.emf=0;}
  el('pole-n').addEventListener('click',()=>setPole(1));el('pole-s').addEventListener('click',()=>setPole(-1));
  el('toggle').addEventListener('click',function(){state.running=!state.running;if(!state.running){state.prevX=state.x;state.prevFlux=state.flux;state.velocity=0;state.fluxRate=0;state.emf=0;pushSample();}this.textContent=state.running?'일시정지':'이어서';});
  el('reset').addEventListener('click',()=>{reset();state.running=true;el('toggle').textContent='일시정지';});
  resize();reset();window.addEventListener('resize',()=>{resize();reset();});
  window.GraphTheme.onChange(drawGraph);   // 밝기 모드가 바뀌면 새 팔레트로 다시 그린다
  requestAnimationFrame(frame);
})();
