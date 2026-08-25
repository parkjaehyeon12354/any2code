(function(){
  'use strict';
  const ids=['motive','activity','problem','result','learning','next'];
  const fields=Object.fromEntries(ids.map(id=>[id,document.getElementById(id)]));
  function organize(){ids.forEach(id=>{document.getElementById('out-'+id).textContent=fields[id].value.trim()||'작성하지 않음';});}
  document.getElementById('organize-button').addEventListener('click',organize);
  document.getElementById('clear-button').addEventListener('click',()=>{ids.forEach(id=>fields[id].value='');organize();fields.motive.focus();});
})();
