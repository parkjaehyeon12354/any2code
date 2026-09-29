/* 창작마당 HTML 을 사이트와 격리된 칸에서 실행한다 — 이 파일이 그 기능의 보안 전부다.

   sandbox 에 allow-same-origin 을 절대 넣지 않는다. 넣으면 올린 HTML 이 ans2quest.com 으로 돌아
   보는 사람(관리자 포함)의 세션으로 API 를 부를 수 있다. 없으면 출처가 불투명(opaque)해서
   쿠키·저장소·부모 화면에 손대지 못한다. 팝업·상단 이동도 주지 않는다.
   스크립트가 어디서 올 수 있는지는 이 화면의 CSP 를 그대로 물려받는다(srcdoc) —
   staticwebapp.config.json 의 /custom 경로 규칙: 인라인 + cdnjs · jsdelivr, 외부로 보내는 연결은 막힘. */
(function () {
  const SANDBOX = 'allow-scripts allow-forms allow-modals allow-downloads';

  /* 불투명 출처에서는 localStorage 를 읽기만 해도 예외가 나서, AI 가 만든 HTML 이 첫 줄에서 멈추곤 한다.
     메모리 저장소로 대신한다(창을 닫으면 사라진다). */
  const SHIM = '<script>(function(){try{window.localStorage.length}catch(e){var m=function(){var d={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}};try{Object.defineProperty(window,"localStorage",{value:m(),configurable:true});Object.defineProperty(window,"sessionStorage",{value:m(),configurable:true})}catch(e){}}})();<\/script>';

  // doctype 앞에 끼우면 문서가 쿼크 모드로 바뀐다 — head → html → doctype 뒤 순서로 자리를 찾는다
  function withShim(html) {
    const m = /<head[^>]*>/i.exec(html) || /<html[^>]*>/i.exec(html) || /<!doctype[^>]*>/i.exec(html);
    return m ? html.slice(0, m.index + m[0].length) + SHIM + html.slice(m.index + m[0].length) : SHIM + html;
  }

  window.WorkshopFrame = {
    SANDBOX,
    create(html, title) {
      const f = document.createElement('iframe');
      f.setAttribute('sandbox', SANDBOX);
      f.setAttribute('referrerpolicy', 'no-referrer');
      f.setAttribute('allow', 'fullscreen');
      f.title = title || '올린 HTML';
      f.className = 'workshop-frame';
      f.srcdoc = withShim(html);
      return f;
    }
  };
})();
