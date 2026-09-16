'use strict';
const $ = id => document.getElementById(id);
const data = window.COT_DATA;
if (!data?.cases?.length) throw Error('The case collection could not be loaded.');
const cases = data.cases;
const byId = new Map(cases.map(c => [c.id,c]));
let selected = cases[0], version = 'original', sample, key, state;
let filtered = cases.slice(), imageNames = [];
const drafts = new Map();
let storageWarning = false;
const storageKey = (id,v) => 'finedent-clinical-review-v2:' + data.version + ':' + id + ':' + v;
const view = (c=selected,v=version) => v === 'english' && c.english ? c.english : c;
const imageLabel = im => {
  const t = (Array.isArray(im.types)?im.types.join(' '):im.types||'').toLowerCase();
  if (/cbct|ct\b|tomograph/.test(t)) return 'CT / CBCT';
  if (/opg|panoram/.test(t)) return 'Panoramic radiograph';
  if (/rgb|clinical|photo|intraoral|extraoral/.test(t)) return 'Clinical photograph';
  if (/radiograph|x.?ray|periapical/.test(t)) return 'Radiograph';
  return 'Source image';
};
function parseReasoning(value) {
  const headings = [...value.matchAll(/^(Differential diagnosis comparison:|Diagnostic chain:|Limitations:)/gm)];
  const end = headings.length ? headings[0].index : value.length;
  const main = value.slice(0,end);
  const matches = [...main.matchAll(/^(\d+)\.\s+/gm)];
  const result = {lead:main.slice(0,matches[0]?.index ?? main.length).trim(),steps:[],differential:'',chain:'',limitations:'',tail:''};
  matches.forEach((m,i)=>{
    const raw = main.slice(m.index + m[0].length,matches[i+1]?.index ?? main.length).trim();
    const colon = raw.indexOf(':');
    const titled = colon > 0 && colon < 90 && !/[.\n]/.test(raw.slice(0,colon));
    result.steps.push({number:m[1],raw,title:titled?raw.slice(0,colon):'Clinical inference',body:titled?raw.slice(colon+1).trim():raw});
  });
  headings.forEach((h,i)=>{
    const target = h[1].startsWith('Differential')?'differential':h[1].startsWith('Diagnostic')?'chain':'limitations';
    result[target] = value.slice(h.index,headings[i+1]?.index ?? value.length).trim();
  });
  return result;
}
function makeSample(c,v) {
  const content = view(c,v);
  return {...content,id:c.id,title:c.title,...parseReasoning(content.think)};
}
function snapshot(c,v) {
  const x=view(c,v);
  return {id:c.id,title:c.title,question:x.question,caption:x.caption,think:x.think,answer:x.answer,
    images:x.images.map(im=>({src:im.src,name:im.name,sha256:im.sha256}))};
}

const rubric = [
  ['Evidence Grounding', 'Are the findings and patient details mentioned in the reasoning supported by the original materials? Is any information invented or misinterpreted?'],
  ['Stepwise Clinical Correctness', 'Is each clinical inference reasonable? Are there medical errors, contradictions, or unsupported logical jumps?'],
  ['Conclusion Support', 'Is the final diagnosis reasonable, and does the reasoning provide enough evidence to support it?'],
  ['Completeness', 'Does the reasoning include the key findings, relevant patient information, and necessary steps? Are important alternative diagnoses considered when needed?'],
  ['Informativeness', 'Does the reasoning explain how the evidence affects the diagnosis, rather than simply repeating the input or giving generic medical statements?'],
  ['Calibration and Safety', 'Does the level of certainty match the available evidence? Are limitations and the need for further information acknowledged when appropriate?'],
  ['Organization and Readability', 'Is the reasoning clearly organized, easy to follow, and expressed using accurate dental terminology?']
];
const scale = ['Fundamentally flawed', 'Major problems', 'Clear issues requiring substantial revision', 'Minor issues', 'No substantive issues'];
const flagNames = ['Original case information or report is insufficient', 'Required images are unavailable or unreadable', 'The model cites evidence that was not supplied', 'The source report may contain an error', 'The reference diagnosis may contain an error', 'The scope of the model inputs is unclear'];
const fields = ['caseInfo','report','reference','provenance','modelInputs','recommendation','overallReason','contextUse','sourceConcerns','criteriaFeedback'];
const recommendations = ['Keep','Revise','Exclude','Unable to assess'];
const text = value => typeof value === 'string' ? value : '';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => '<svg aria-hidden="true"><use href="#icon-' + name + '"/></svg>';
function normalize(raw) {
  if (!raw || typeof raw !== 'object') raw = {};
  const out = {fields:{}, scores:{}, comments:{}, issues:[], images:[], imageOverrides:[], flags:[], updatedAt:text(raw.updatedAt)};
  for (const name of fields) out.fields[name] = text(raw.fields?.[name]);
  if (!recommendations.includes(out.fields.recommendation)) out.fields.recommendation = '';
  const contextValues = ['meaningful','superficial','misused','unable','not_relevant'];
  if (out.fields.contextUse && !contextValues.includes(out.fields.contextUse)) {
    const prefixes = ['Meaningful','Superficial','Misused','Unable to assess','Not relevant'];
    const n = prefixes.findIndex(prefix => out.fields.contextUse.startsWith(prefix));
    out.fields.contextUse = n < 0 ? '' : contextValues[n];
  }
  rubric.forEach((r,i) => {
    if (['1','2','3','4','5','UA'].includes(raw.scores?.[i])) out.scores[i] = raw.scores[i];
    out.comments[i] = text(raw.comments?.[i]);
  });
  if (Array.isArray(raw.issues)) out.issues = raw.issues.filter(x=>x && typeof x==='object').map(x=>({location:text(x.location),quote:text(x.quote),problem:text(x.problem),correction:text(x.correction)}));
  if (Array.isArray(raw.images)) out.images = raw.images.slice(0,20).map(im => im && typeof im.name === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(im.data) ? {name:im.name,data:im.data} : null);
  out.imageOverrides = Array.from({length:20},(_,i)=>raw.imageOverrides?.[i]===true);
  if (Array.isArray(raw.flags)) out.flags = [...new Set(raw.flags.filter(f=>flagNames.includes(f)))];

  return out;
}
for (const c of cases) for (const v of ['original',...(c.english?['english']:[])]) {
  const k=storageKey(c.id,v);
  let saved;
  try { saved=JSON.parse(localStorage.getItem(k)); } catch { storageWarning=true; }
  drafts.set(k,normalize(saved));
}
function loadCase(c,v='original') {
  selected=c;version=v==='english'&&c.english?'english':'original';
  sample=makeSample(c,version);key=storageKey(c.id,version);state=drafts.get(key);
  $('validation').classList.add('hidden');
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());
  render();renderNavigation();
  $('saveStatus').textContent=storageWarning?'Local storage unavailable — export all drafts to save':state.updatedAt?'Local draft restored':'Your review stays on this device';
}
function renderNavigation() {
  $('caseSelect').innerHTML=filtered.map(c=>'<option value="'+c.id+'">'+String(cases.indexOf(c)+1).padStart(2,'0')+' · '+esc(c.title)+'</option>').join('');
  $('caseSelect').value=selected.id;
  const i=filtered.indexOf(selected);
  $('caseSelect').disabled=!filtered.length;
  $('prevCase').disabled=i<=0;$('nextCase').disabled=i<0||i===filtered.length-1;
  $('casePosition').textContent=filtered.length?(i+1)+' / '+filtered.length:'No matching cases';
  $('versionSelect').value=version;
  $('versionSelect').options[1].disabled=!selected.english;
  $('versionSelect').disabled=!selected.english;
}
function route(c,v='original',push=true) {
  if(push) history.pushState(null,'','#case='+c.id+(v==='english'?'&version=english':''));
  loadCase(c,v);
}
function restoreRoute() {
  const params=new URLSearchParams(location.hash.slice(1));
  if(!params.has('case') && sample)return;
  const c=byId.get(params.get('case'))||cases[0];
  if(!filtered.includes(c)){filtered=cases.slice();$('caseSearch').value='';}
  loadCase(c,params.get('version'));
}
function visibleImages() {
  const base=view().images;
  const length=Math.max(base.length,state.images.length);
  return Array.from({length},(_,i)=>state.imageOverrides[i]?state.images[i]:(base[i]?{...base[i],data:base[i].src}:null));
}

let currentTab = 'reasoning';
let toastTimer;
function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>$('toast').classList.add('hidden'),5000);
}
function updateProgress() {
  const count = rubric.filter((r,i)=>state.scores[i]).length;
  $('progress').innerHTML = count + '<span> / 7</span>';
  $('progress').setAttribute('aria-label', count + ' of 7 dimensions rated');
  $('progressTrack').innerHTML = rubric.map((r,i)=>'<span class="'+(state.scores[i]?'filled':'')+'"></span>').join('');
  $('draftBadge').textContent = errors().length ? 'In progress' : 'Ready to export';
  const ready=cases.filter(c=>!errors(drafts.get(storageKey(c.id,'original'))).length).length;
  $('collectionProgress').textContent=ready+' / '+cases.length+' cases ready';
}
function save() {
  state.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(key,JSON.stringify(state));
    $('saveStatus').textContent = 'Draft saved locally · ' + new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  } catch {
    storageWarning=true;
    $('saveStatus').textContent = 'Local storage unavailable — export all drafts to save';
  }
  drafts.set(key,state);
  updateProgress();
}
function setTab(name, focus=false) {
  currentTab = name;
  document.querySelectorAll('[data-tab]').forEach(el=>{
    const active=el.dataset.tab===name;
    el.classList.toggle('active',active);
    el.setAttribute('aria-selected',String(active));
    el.tabIndex=active?0:-1;
    $('panel-'+el.dataset.tab).classList.toggle('hidden',!active);
    if (active && focus) el.focus();
  });
  const next = name==='caption' ? 'reasoning' : name==='reasoning' ? 'answer' : 'reasoning';
  $('nextTab').innerHTML = (next==='answer'?'View final answer':'View reasoning') + ' ' + icon('arrow');
  $('nextTab').onclick=()=>setTab(next,true);
}
function render() {
  $('sampleLabel').textContent=sample.id;
  $('caseTitle').textContent=selected.title;
  $('sourceLink').href=selected.sourceUrl;
  document.title=selected.id+' · FineDent Clinical Review';
  $('questionText').textContent=sample.question;
  const marker=sample.question.match(/^(?:<image>\s*)+/);
  if(marker){const hidden=document.createElement('span');hidden.hidden=true;hidden.textContent=marker[0];$('questionText').replaceChildren(hidden,document.createTextNode(sample.question.slice(marker[0].length)));}
  for (const name of ['caption','differential','limitations','answer']) $(name).textContent=sample[name];
  $('reasoningLead').textContent=sample.lead;$('reasoningLead').hidden=!sample.lead;
  $('reasoningTail').textContent=sample.tail;$('reasoningTail').hidden=!sample.tail;
  $('differential').parentElement.hidden=!sample.differential;
  $('limitations').parentElement.hidden=!sample.limitations;
  if(!$('diagnosticChain')){
    const section=document.createElement('div');section.className='reasoning-extra';
    section.innerHTML='<div class="content-label">DIAGNOSTIC CHAIN<button class="text-button" data-annotate="chain">Flag issue '+icon('flag')+'</button></div><div id="diagnosticChain" class="modeltext"></div>';
    $('differential').parentElement.after(section);
  }
  $('diagnosticChain').textContent=sample.chain;$('diagnosticChain').parentElement.hidden=!sample.chain;
  $('stepCount').textContent=sample.steps.length+' step'+(sample.steps.length===1?'':'s');
  $('steps').innerHTML=sample.steps.map((s,i)=>'<div class="step"><span class="step-number">'+String(s.number).padStart(2,'0')+'</span><div><div class="step-title"><h3>'+esc(s.title)+'</h3><button class="icon-button flag-button" data-step="'+i+'" aria-label="Flag an issue in step '+s.number+'" title="Flag issue">'+icon('flag')+'</button></div><p class="step-body">'+esc(s.body)+'</p></div></div>').join('');
  document.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>addIssue('Think step '+sample.steps[+b.dataset.step].number,sample.steps[+b.dataset.step].raw));
  document.querySelectorAll('[data-annotate]').forEach(b=>b.onclick=()=>addIssue(({caption:'Caption',answer:'Answer',differential:'Differential diagnosis comparison',limitations:'Limitations',chain:'Diagnostic chain'})[b.dataset.annotate],sample[b.dataset.annotate]));

  document.querySelectorAll('[data-field]').forEach(el=>{
    el.value=state.fields[el.dataset.field]||'';
    el.oninput=()=>{state.fields[el.dataset.field]=el.value;save();if(['caseInfo','report','reference','provenance','modelInputs'].includes(el.dataset.field))renderSources();};
  });
  $('dimensions').innerHTML=rubric.map((r,i)=>'<div class="dimension" id="dimension'+i+'"><div class="dimension-heading"><span class="dimension-number">'+String(i+1).padStart(2,'0')+'</span><h3>'+r[0]+'</h3></div><p>'+r[1]+'</p><div class="scores" role="group" aria-label="'+r[0]+'">'+['1','2','3','4','5','UA'].map(v=>'<label class="score-choice" title="'+(v==='UA'?'Unable to assess':v+' — '+scale[+v-1])+'"><input type="radio" name="score'+i+'" value="'+v+'" aria-label="'+(v==='UA'?'Unable to assess':v+' — '+scale[+v-1])+'" '+(state.scores[i]===v?'checked':'')+'><span>'+(v==='UA'?'Unable to assess':v)+'</span></label>').join('')+'</div><details class="note-details" id="note'+i+'" '+(state.comments[i]||state.scores[i]==='UA'?'open':'')+'><summary class="note-toggle"><span id="noteLabel'+i+'">'+(state.comments[i]?'Review note':'Add a note')+'</span><span id="noteHint'+i+'" class="required-hint">'+(state.scores[i]==='UA'?'Explanation required':'Optional')+'</span></summary><textarea id="comment'+i+'" aria-label="'+r[0]+' explanation" placeholder="Cite the evidence, describe an issue, or explain what is missing.">'+esc(state.comments[i])+'</textarea></details></div>').join('');
  rubric.forEach((r,i)=>{
    document.querySelectorAll('[name=score'+i+']').forEach(el=>el.onchange=()=>{
      state.scores[i]=el.value;
      $('noteHint'+i).textContent=el.value==='UA'?'Explanation required':'Optional';
      $('comment'+i).required=el.value==='UA';
      if(el.value==='UA'){$('note'+i).open=true;$('comment'+i).focus();}
      $('dimension'+i).classList.remove('has-error');save();
    });
    $('comment'+i).required=state.scores[i]==='UA';
    $('comment'+i).oninput=e=>{state.comments[i]=e.target.value;$('noteLabel'+i).textContent=e.target.value?'Review note':'Add a note';save();};
  });
  $('recommendations').innerHTML=recommendations.map((name,i)=>'<label class="recommendation"><input type="radio" name="recommendation" value="'+name+'" '+(state.fields.recommendation===name?'checked':'')+'><span>'+name+'</span></label>').join('');
  document.querySelectorAll('[name=recommendation]').forEach(el=>el.onchange=()=>{state.fields.recommendation=el.value;save();});
  $('flags').innerHTML=flagNames.map((f,i)=>'<label class="check"><input type="checkbox" data-flag="'+i+'" '+(state.flags.includes(f)?'checked':'')+'>'+f+'</label>').join('');
  document.querySelectorAll('[data-flag]').forEach(el=>el.onchange=()=>{state.flags=Array.from(document.querySelectorAll('[data-flag]:checked')).map(e=>flagNames[e.dataset.flag]);save();});
  renderIssues();renderImages();renderSources();updateProgress();setTab(currentTab);
}
function renderSources() {
  const entries=[['caseInfo','Additional case information'],['report','Source report'],['reference','Independent reference diagnosis']];
  $('sourceStatus').innerHTML='<span class="available"><i></i>Case information: included in model input</span>'+entries.slice(1).map(([field,label])=>'<span class="'+(state.fields[field].trim()?'available':'')+'"><i></i>'+label+': '+(state.fields[field].trim()?'added for review':'not supplied separately')+'</span>').join('');
  $('sourceContent').innerHTML=[...entries,['provenance','Additional provenance'],['modelInputs','Notes on materials available to the model']].filter(([field])=>state.fields[field].trim()).map(([field,label])=>'<details class="source-entry"><summary>'+label+'</summary><pre>'+esc(state.fields[field])+'</pre></details>').join('');
  $('sourceContent').insertAdjacentHTML('beforeend','<details class="source-entry"><summary>Article attribution and image captions</summary><pre>'+esc((Array.isArray(selected.authors)?selected.authors.join(', '):selected.authors||'')+'\n'+selected.citation+'\nLicense: '+selected.license+'\n\n'+view().images.map((im,i)=>(i+1)+'. '+im.name+'\n'+(im.caption||'')).join('\n\n'))+'</pre></details>');
  $('evidenceNote').textContent=visibleImages().some(Boolean)?'Click an image to inspect it. Model-generated findings below require verification against these materials.':'No diagnostic-time images are retained for this text-only case. A report description is not confirmation of the actual image findings.';
}
function imageTile(im,i) {
  return '<div class="image-tile"><button class="image-view has-image" data-view-image="'+i+'" aria-label="Enlarge '+esc(imageNames[i])+'"><img id="img'+i+'" src="'+esc(im.data)+'" alt="'+esc(imageNames[i]+' — '+im.name)+'"></button><div class="image-caption"><b>'+String(i+1).padStart(2,'0')+'</b> '+esc(imageNames[i])+'</div></div>';
}
function renderImages() {
  const images=visibleImages();
  imageNames=Array.from({length:Math.min(20,Math.max(images.length+1,1))},(_,i)=>view().images[i]?imageLabel(view().images[i]):'Supplemental image');
  $('images').innerHTML=images.some(Boolean)?images.map((im,i)=>im?imageTile(im,i):'').join(''):'<div class="empty-issues">No source images available · Text-only case</div>';
  $('supplementalImage').innerHTML='';
  $('imageControls').innerHTML=imageNames.map((name,i)=>'<div class="image-control"><div><b>'+esc(name)+'</b><small>'+(images[i]?esc(images[i].name):'Not supplied')+'</small></div><div class="control-actions"><button class="button small" data-upload="'+i+'">'+(images[i]?'Replace':'Add image')+'</button>'+(images[i]?'<button class="text-button" data-delimg="'+i+'">Remove</button>':'')+(state.imageOverrides[i]?'<button class="text-button" data-resetimg="'+i+'">Reset</button>':'')+'</div><input type="file" hidden data-image="'+i+'" accept="image/png,image/jpeg,image/webp"></div>').join('');
  document.querySelectorAll('[data-view-image]').forEach(el=>el.onclick=()=>{
    const i=+el.dataset.viewImage;
    $('zoomImage').src=images[i].data;$('zoomImage').alt=imageNames[i];$('zoomCaption').textContent=imageNames[i]+' · '+images[i].name;$('zoom').showModal();
  });
  document.querySelectorAll('[data-upload]').forEach(el=>el.onclick=()=>document.querySelector('[data-image="'+el.dataset.upload+'"]').click());
  document.querySelectorAll('[data-image]').forEach(el=>el.onchange=async()=>{
    const f=el.files[0],targetKey=key,targetState=state,i=+el.dataset.image;if(!f)return;
    try {
      if(!['image/png','image/jpeg','image/webp'].includes(f.type))throw Error('Please select a PNG, JPEG, or WebP image.');
      if(f.size>4*1024*1024)throw Error('Choose an image smaller than 4 MB for a local draft.');
      const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('The image could not be read.'));r.readAsDataURL(f);});
      await new Promise((resolve,reject)=>{const img=new Image();img.onload=resolve;img.onerror=()=>reject(Error('This file could not be decoded as an image.'));img.src=data;});
      targetState.images[i]={name:f.name,data};targetState.imageOverrides[i]=true;
      targetState.updatedAt=new Date().toISOString();drafts.set(targetKey,targetState);
      try{localStorage.setItem(targetKey,JSON.stringify(targetState));}catch{storageWarning=true;}
      if(key===targetKey){renderImages();renderSources();save();}
      toast('Image added to the local draft. Export reviews to include it when sharing.');
    } catch(err){toast(err.message);}
  });
  document.querySelectorAll('[data-delimg]').forEach(el=>el.onclick=()=>{state.images[+el.dataset.delimg]=null;state.imageOverrides[+el.dataset.delimg]=true;renderImages();renderSources();save();});
  document.querySelectorAll('[data-resetimg]').forEach(el=>el.onclick=()=>{state.images[+el.dataset.resetimg]=null;state.imageOverrides[+el.dataset.resetimg]=false;renderImages();renderSources();save();});
}

function addIssue(location='',quote='') {
  state.issues.push({location,quote,problem:'',correction:''});renderIssues();save();
  $('issuesPanel').scrollIntoView({behavior:'smooth',block:'start'});
  const last=$('issues').lastElementChild;last.querySelector('[data-prop="'+(location?'problem':'location')+'"]').focus({preventScroll:true});
}
function renderIssues() {
  $('issueCount').textContent=state.issues.length;
  $('issues').innerHTML=state.issues.length?state.issues.map((x,i)=>'<div class="issue" id="issue'+i+'"><div class="issue-top"><span>ISSUE '+String(i+1).padStart(2,'0')+'</span><button class="text-button" data-remove="'+i+'">Remove '+icon('close')+'</button></div>'+[['location','Sentence or reasoning step','e.g. Think step 3'],['quote','Quoted text','Paste the relevant sentence.'],['problem','Issue description','Explain the clinical or evidentiary problem.'],['correction','Suggested correction','Optional — a full rewrite is not required.']].map(([k,label,placeholder])=>'<label class="field-label" for="issue'+i+'-'+k+'">'+label+(k==='correction'?'<span>Optional</span>':'')+'</label><textarea id="issue'+i+'-'+k+'" data-issue="'+i+'" data-prop="'+k+'" placeholder="'+placeholder+'">'+esc(x[k])+'</textarea>').join('')+'</div>').join(''):'<div class="empty-issues">No issues flagged yet.<br>Use the flag beside a reasoning step to add a focused comment.</div>';
  document.querySelectorAll('[data-issue]').forEach(el=>el.oninput=()=>{state.issues[+el.dataset.issue][el.dataset.prop]=el.value;save();});
  document.querySelectorAll('[data-remove]').forEach(el=>el.onclick=()=>{state.issues.splice(+el.dataset.remove,1);renderIssues();save();});
}
function errors(review=state) {
  const out=[];
  rubric.forEach((r,i)=>{
    if(!review.scores[i])out.push({id:'dimension'+i,message:'Choose a rating for '+r[0]+'.'});
    if(review.scores[i]==='UA'&&!review.comments[i].trim())out.push({id:'comment'+i,message:'Explain why '+r[0]+' is unable to be assessed.'});
  });
  if(!review.fields.recommendation)out.push({id:'recommendations',message:'Choose an overall recommendation.'});
  else if(review.fields.recommendation!=='Keep'&&!review.fields.overallReason.trim())out.push({id:'overallReason',message:'Give a reason for your overall recommendation.'});
  review.issues.forEach((x,i)=>{if(!x.location.trim()||!x.problem.trim())out.push({id:'issue'+i,message:'Add a location and issue description for issue '+(i+1)+'.'});});
  return out;
}
function showErrors(problems) {
  $('validation').innerHTML='<strong>A few details are still needed before export.</strong><ul>'+problems.map(e=>'<li><a href="#'+e.id+'">'+esc(e.message)+'</a></li>').join('')+'</ul><p>Use Export all reviews from File options to save unfinished drafts.</p>';
  $('validation').classList.remove('hidden');
  $('validation').querySelectorAll('a').forEach(link=>link.onclick=event=>{
    event.preventDefault();
    const target=$(link.getAttribute('href').slice(1));
    const detail=target.closest('details');if(detail)detail.open=true;
    target.scrollIntoView({behavior:'smooth',block:'center'});
    const focus=target.matches('input,textarea,select')?target:target.querySelector('input,textarea,select');
    if(focus)focus.focus({preventScroll:true});
  });
  rubric.forEach((r,i)=>{const hasError=problems.some(e=>e.id==='dimension'+i||e.id==='comment'+i);$('dimension'+i).classList.toggle('has-error',hasError);if(problems.some(e=>e.id==='comment'+i))$('note'+i).open=true;});
  $('validation').focus();$('validation').scrollIntoView({behavior:'smooth',block:'start'});
}
function download(data,type,name) {
  const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function safeJson(x){return JSON.stringify(x).replace(/</g,'\\u003c');}
function closeMenus(){document.querySelectorAll('.file-menu').forEach(el=>el.open=false);}
$('guideOpen').onclick=()=>$('guide').showModal();
$('materialsOpen').onclick=()=>$('materials').showModal();
document.querySelectorAll('[data-close]').forEach(el=>el.onclick=()=>$(el.dataset.close).close());
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}));
document.querySelectorAll('[data-tab]').forEach(el=>{
  el.onclick=()=>setTab(el.dataset.tab);
  el.onkeydown=e=>{const names=['caption','reasoning','answer'];let index=names.indexOf(el.dataset.tab);if(e.key==='ArrowRight')index=(index+1)%3;else if(e.key==='ArrowLeft')index=(index+2)%3;else if(e.key==='Home')index=0;else if(e.key==='End')index=2;else return;e.preventDefault();setTab(names[index],true);};
});
$('addIssue').onclick=()=>addIssue();
function reviewPayload(c,v,s) {
  return {schemaVersion:'2.0',rubricVersion:'1.0',datasetVersion:data.version,sampleId:c.id,contentVersion:v,
    exportedAt:new Date().toISOString(),status:errors(s).length?(s.updatedAt?'draft':'not_started'):'completed',sample:snapshot(c,v),
    dimensions:rubric.map((r,i)=>({dimension:r[0],score:/^[1-5]$/.test(s.scores[i])?Number(s.scores[i]):null,unableToAssess:s.scores[i]==='UA',comment:s.comments[i]})),state:normalize(s)};
}
$('export').onclick=()=>{
  const problems=errors();if(problems.length){showErrors(problems);return;}
  $('validation').classList.add('hidden');save();
  download(JSON.stringify(reviewPayload(selected,version,state),null,2),'application/json',sample.id+'-'+version+'-review.json');toast('Review exported. Return the JSON file to the study team.');
};
$('exportBottom').onclick=()=>$('export').click();
$('exportAll').onclick=()=>{
  closeMenus();
  const reviews=cases.flatMap(c=>['original',...(c.english?['english']:[])].map(v=>reviewPayload(c,v,drafts.get(storageKey(c.id,v)))));
  const payload={schemaVersion:'2.0',type:'review_collection',datasetVersion:data.version,caseCount:cases.length,exportedAt:new Date().toISOString(),reviews};
  download(JSON.stringify(payload,null,2),'application/json','finedent-47-case-reviews.json');toast('All reviews exported, including unfinished drafts.');
};
function validateImport(obj) {
  const c=byId.get(obj.sampleId),v=obj.contentVersion;
  if(obj.schemaVersion!=='2.0'||obj.datasetVersion!==data.version||!c||!['original','english'].includes(v)||(v==='english'&&!c.english)||JSON.stringify(obj.sample)!==JSON.stringify(snapshot(c,v)))throw Error('The sample or file version does not match this collection.');
  const s=obj.state;
  if(!s||!s.fields||typeof s.fields!=='object'||!s.scores||typeof s.scores!=='object'||!s.comments||typeof s.comments!=='object'||!Array.isArray(s.issues)||!Array.isArray(s.images)||!Array.isArray(s.imageOverrides)||!Array.isArray(s.flags))throw Error('The review file has an invalid structure.');
  if(Object.values(s.fields).some(v=>typeof v!=='string')||Object.values(s.comments).some(v=>typeof v!=='string')||Object.entries(s.scores).some(([k,v])=>!(/^[0-6]$/.test(k))||!['1','2','3','4','5','UA'].includes(v))||s.images.length>20||s.images.some(im=>im&&(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(im.data)||typeof im.name!=='string'))||s.issues.some(x=>!x||['location','quote','problem','correction'].some(k=>typeof x[k]!=='string')))throw Error('Some review fields have an invalid format.');
  return {c,v,k:storageKey(c.id,v),s:normalize(s)};
}
$('restoreOpen').onclick=()=>{closeMenus();$('restore').click();};
$('restore').onchange=async e=>{
  try {
    const file=e.target.files[0];if(!file)return;
    const obj=JSON.parse(await file.text());
    if(obj.type==='review_collection'&&(!Array.isArray(obj.reviews)||obj.schemaVersion!=='2.0'||obj.datasetVersion!==data.version))throw Error('The collection file does not match this dataset.');
    const entries=(obj.type==='review_collection'?obj.reviews:[obj]).map(validateImport);
    if(!entries.length||new Set(entries.map(x=>x.k)).size!==entries.length)throw Error('The review file is empty or contains duplicate entries.');
    if(!confirm('Replace the matching local drafts with this imported review file?'))return;
    for(const entry of entries){drafts.set(entry.k,entry.s);try{localStorage.setItem(entry.k,JSON.stringify(entry.s));}catch{storageWarning=true;}}
    if(entries.length===1){$('caseSearch').value='';filtered=cases.slice();route(entries[0].c,entries[0].v);}else loadCase(selected,version);
    toast('Review restored.');
  } catch(err){toast('Import failed: '+err.message);}
  e.target.value='';
};
$('caseSelect').onchange=()=>route(byId.get($('caseSelect').value));
$('versionSelect').onchange=()=>route(selected,$('versionSelect').value);
$('prevCase').onclick=()=>{const c=filtered[filtered.indexOf(selected)-1];if(c)route(c);};
$('nextCase').onclick=()=>{const c=filtered[filtered.indexOf(selected)+1];if(c)route(c);};
$('caseSearch').oninput=()=>{
  const q=$('caseSearch').value.trim().toLowerCase();
  filtered=cases.filter(c=>[c.id,c.title,c.answer].join(' ').toLowerCase().includes(q));
  if(filtered.length&&!filtered.includes(selected))route(filtered[0]);else renderNavigation();
};
window.addEventListener('hashchange',restoreRoute);
window.addEventListener('popstate',restoreRoute);

function preparePrint() {
  document.querySelectorAll('.print-only').forEach(el=>el.remove());
  document.querySelectorAll('textarea,input[type=text],select').forEach(el=>{
    if(el.closest('dialog')||['caseSearch','caseSelect','versionSelect'].includes(el.id))return;
    const p=document.createElement('div');p.className='print-only';
    p.textContent=el.tagName==='SELECT'?(el.value?el.selectedOptions[0].textContent:'Not assessed'):(el.value||'No comment');el.after(p);
  });
  document.querySelectorAll('.note-details,.additional-details,.source-entry').forEach(el=>{el.dataset.printOpen=el.open?'true':'false';el.open=true;});
}
function finishPrint(){document.querySelectorAll('[data-print-open]').forEach(el=>{el.open=el.dataset.printOpen==='true';delete el.dataset.printOpen;});document.querySelectorAll('.print-only').forEach(el=>el.remove());}
window.addEventListener('beforeprint',preparePrint);window.addEventListener('afterprint',finishPrint);
$('print').onclick=()=>{closeMenus();window.print();};
restoreRoute();
