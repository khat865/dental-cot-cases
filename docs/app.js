'use strict';
const $=id=>document.getElementById(id),data=window.COT_DATA;
if(!data?.cases?.length)throw Error('The case data could not be loaded.');
const cases=data.cases, byId=new Map(cases.map(c=>[c.id,c]));
let selected=cases[0],version='original',filtered=cases.slice(),zoomIndex=0,presenting=false,toastTimer;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=n=>'<svg aria-hidden="true"><use href="#'+n+'"/></svg>';
const hasEnglish=c=>Boolean(c.english);
const typeText=im=>Array.isArray(im.types)?im.types.join(' '):String(im.types||'');
function modalityList(im){const t=typeText(im).toLowerCase(),out=[];if(/cbct|ct\b|tomograph/.test(t))out.push('CT / CBCT');if(/rgb|clinical|photo|intraoral|extraoral/.test(t))out.push('Clinical photograph');if(/opg|panoram|radiograph|x.?ray|periapical/.test(t))out.push('Radiograph');return out.length?out:['Source image'];}
function modality(im){return modalityList(im).join(' · ');}
function caseMatches(c,filter){if(filter==='all')return true;if(filter==='english')return hasEnglish(c);if(filter==='text')return !c.images.length;return c.images.some(im=>modalityList(im).includes(({ct:'CT / CBCT',rgb:'Clinical photograph',radiograph:'Radiograph'})[filter]));}
function view(){return version==='english'&&selected.english?selected.english:selected;}
function notify(text){$('toast').textContent=text;$('toast').classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),3500);}
function hashFor(id,v='original'){return '#'+new URLSearchParams({case:id,...(v==='english'?{version:'english'}:{})}).toString();}
function updateHash(){const next=hashFor(selected.id,version);if(location.hash!==next)history.pushState(null,'',next);}
function restoreHash(){const q=new URLSearchParams(location.hash.slice(1));const id=q.get('case');if(id&&byId.has(id)){selected=byId.get(id);version=q.get('version')==='english'&&selected.english?'english':'original';if(!filtered.includes(selected)){$('searchInput').value='';$('filterSelect').value='all';filtered=cases.slice();}render();}else if(!id){render();}}
function renderList(){
  $('resultCount').textContent=filtered.length;
  $('caseList').innerHTML=filtered.map(c=>'<a class="case-item '+(c.id===selected.id?'selected':'')+'" href="'+hashFor(c.id)+'" data-case="'+esc(c.id)+'" '+(c.id===selected.id?'aria-current="page"':'')+'><span class="list-number">'+String(cases.indexOf(c)+1).padStart(2,'0')+'</span><div><h3>'+esc(c.title)+'</h3><div class="list-meta"><span>'+esc(c.id)+'</span><span>'+c.images.length+' image'+(c.images.length===1?'':'s')+'</span>'+(hasEnglish(c)?'<span class="english-dot">EN</span>':'')+'</div></div></a>').join('');
  document.querySelectorAll('[data-case]').forEach(a=>a.onclick=e=>{e.preventDefault();selected=byId.get(a.dataset.case);version='original';updateHash();render();scrollToCase();});
}
function scrollToCase(){if(innerWidth<850)$('caseMain').scrollIntoView({behavior:'smooth',block:'start'});else window.scrollTo({top:Math.max(0,document.querySelector('.workspace').offsetTop-20),behavior:'smooth'});}
function filterCases(){const q=$('searchInput').value.trim().toLowerCase(),f=$('filterSelect').value;filtered=cases.filter(c=>caseMatches(c,f)&&(!q||[c.id,c.title,c.category,c.question,c.caption,c.think,c.answer,c.english?.question,c.english?.answer].join(' ').toLowerCase().includes(q)));if(filtered.length&&!filtered.includes(selected)){selected=filtered[0];version='original';updateHash();}render();}
function render(){
  renderList();const empty=!filtered.length;$('caseMain').classList.toggle('hidden',empty);$('noResults').classList.toggle('hidden',!empty);if(empty)return;
  const current=view(),index=filtered.indexOf(selected);
  document.title=selected.title+' · FineDent';
  $('caseNumber').textContent='CASE '+String(cases.indexOf(selected)+1).padStart(2,'0');$('position').textContent=(index+1)+' / '+filtered.length;
  $('prevCase').disabled=index<=0;$('nextCase').disabled=index>=filtered.length-1;
  $('pmcid').textContent=selected.id;$('caseTitle').textContent=selected.title;
  $('languagePill').textContent=version==='english'?'English example':'Original · Chinese';
  $('sourceLink').href=/^https?:\/\//.test(selected.sourceUrl||'')?selected.sourceUrl:'https://pmc.ncbi.nlm.nih.gov/articles/'+encodeURIComponent(selected.id)+'/';
  $('licenseLabel').textContent='License: '+(selected.license||'See original article').toUpperCase();
  $('versionSelect').options[1].disabled=!hasEnglish(selected);$('versionSelect').value=version;$('versionSelect').disabled=!hasEnglish(selected);
  $('versionNote').textContent=version==='english'?'Earlier English rewrite with its original image set.':'Diagnostic-time dataset v2 · Original text preserved.';
  const images=current.images||[];$('caseImageCount').textContent=images.length+' image'+(images.length===1?'':'s');
  $('gallery').innerHTML=images.length?images.map((im,i)=>'<figure class="image-card"><button class="image-open" data-image="'+i+'" aria-label="Enlarge '+esc(modality(im))+' '+(i+1)+'"><img src="'+esc(im.src)+'" alt="'+esc(modality(im)+' — '+selected.id+' — '+im.name)+'" loading="eager"></button><figcaption>'+String(i+1).padStart(2,'0')+' / '+esc(modality(im))+'</figcaption>'+(im.caption?'<details><summary>Original figure caption</summary><p>'+esc(im.caption)+'</p></details>':'')+'</figure>').join(''):'<div class="empty-images">'+icon('image')+'No retained diagnostic-time images in this dataset version.</div>';
  document.querySelectorAll('[data-image]').forEach(b=>b.onclick=()=>openImage(+b.dataset.image));
  $('imageNote').textContent=images.length?'Click an image to enlarge it. Images are reproduced from the source article without alteration.':'This text-only case is included in the complete 47-case collection.';
  for(const key of ['question','caption','think','answer']){const el=$(key+'Text');el.textContent=current[key]||'This section is not present in the source sample.';el.lang=version==='english'?'en':'zh';}
  const markerPrefix=(current.question||'').match(/^(?:<image>\s*)+/);
  if(markerPrefix){const hidden=document.createElement('span');hidden.hidden=true;hidden.textContent=markerPrefix[0];$('questionText').replaceChildren(hidden,document.createTextNode(current.question.slice(markerPrefix[0].length)));}
  const authors=Array.isArray(selected.authors)?selected.authors.join(', '):selected.authors;
  $('attribution').textContent=(authors?authors+'. ':'')+'Source: '+selected.title+'. See the original article for credits and licensing terms.';
}
function moveCase(delta){const i=filtered.indexOf(selected),next=filtered[i+delta];if(!next)return;selected=next;version='original';updateHash();render();scrollToCase();}
function openImage(index){zoomIndex=index;renderZoom();if(!$('zoom').open)$('zoom').showModal();}
function renderZoom(){const images=view().images,im=images[zoomIndex];if(!im)return;$('zoomImage').src=im.src;$('zoomImage').alt=modality(im)+' — '+selected.id;$('zoomTitle').textContent=im.name;$('zoomModality').textContent=modality(im);$('zoomCaption').textContent=im.caption||'';$('imagePosition').textContent=(zoomIndex+1)+' / '+images.length;$('prevImage').disabled=zoomIndex===0;$('nextImage').disabled=zoomIndex===images.length-1;}
function moveImage(delta){if(!view().images[zoomIndex+delta])return;zoomIndex+=delta;renderZoom();}
async function togglePresent(){presenting=!presenting;document.body.classList.toggle('presenting',presenting);if(presenting){try{await document.documentElement.requestFullscreen();}catch{}}else if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});window.scrollTo({top:0,behavior:'instant'});}
$('totalCount').textContent=cases.length;$('imageCount').textContent=cases.reduce((sum,c)=>sum+c.images.length,0);
$('searchInput').oninput=filterCases;$('filterSelect').onchange=filterCases;
$('clearSearch').onclick=()=>{$('searchInput').value='';$('filterSelect').value='all';filterCases();};
$('versionSelect').onchange=()=>{version=$('versionSelect').value;updateHash();render();};
$('prevCase').onclick=()=>moveCase(-1);$('nextCase').onclick=()=>moveCase(1);$('prevImage').onclick=()=>moveImage(-1);$('nextImage').onclick=()=>moveImage(1);
$('aboutButton').onclick=()=>$('about').showModal();document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
document.querySelectorAll('dialog').forEach(d=>d.onclick=e=>{if(e.target!==d)return;const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();});
$('copyLink').onclick=async()=>{const url=location.href.split('#')[0]+hashFor(selected.id,version);try{await navigator.clipboard.writeText(url);notify('Case link copied.');}catch{const input=document.createElement('textarea');input.value=url;document.body.append(input);input.select();const copied=document.execCommand('copy');input.remove();notify(copied?'Case link copied.':'Copy this page URL from the address bar.');}};
$('presentButton').onclick=togglePresent;$('printButton').onclick=()=>window.print();
document.querySelectorAll('.content-nav a').forEach(a=>a.onclick=e=>{e.preventDefault();document.querySelector(a.getAttribute('href')).scrollIntoView({behavior:'smooth',block:'start'});});
window.addEventListener('hashchange',restoreHash);window.addEventListener('popstate',restoreHash);
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&presenting){presenting=false;document.body.classList.remove('presenting');}});
document.addEventListener('keydown',e=>{if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;if($('zoom').open){if(e.key==='ArrowLeft'){e.preventDefault();moveImage(-1);}if(e.key==='ArrowRight'){e.preventDefault();moveImage(1);}return;}if($('about').open)return;if(e.key==='/'){e.preventDefault();$('searchInput').focus();}else if(presenting&&e.key==='Escape'){e.preventDefault();togglePresent();}});
restoreHash();
