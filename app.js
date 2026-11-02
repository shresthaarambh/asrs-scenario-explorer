/* Local search UI. All report content is inserted as text, never HTML. */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
function node(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}
const labels = {bm25:'Keyword · BM25', minilm:'Meaning · MiniLM', 'hybrid-bm25-minilm':'Combined · BM25 + MiniLM'};
const help = {bm25:'Keyword search ranks shared words, including aviation terminology.', minilm:'MiniLM compares frozen text embeddings using cosine similarity.', 'hybrid-bm25-minilm':'Reciprocal rank fusion combines keyword and MiniLM rankings. The passage is from the first contributing component, usually BM25.'};
const fieldGroups = [
  ['Accounts', [['passage','Matching passage'],['synopsis','Analyst summary'],['narrative_1','Reporter account 1'],['narrative_2','Reporter account 2'],['narrative','Combined narrative']]],
  ['What happened', [['anomaly','Event categories'],['primary_problem','Primary problem'],['contributing_factors','Contributing factors'],['human_factors','Human factors'],['comm_breakdown','Communication'],['result','Outcome / response']]],
  ['Context', [['flight_phase','Flight phase'],['aircraft','Aircraft'],['date','Report month'],['reporter_function','Reporter role'],['detector','Who detected it'],['accession_1','Related accession 1'],['accession_2','Related accession 2'],['group_id','Incident group'],['split','Dataset split'],['n_words','Narrative word count'],['focus','Focus subset'],['narrative_2_placeholder','Second account placeholder'],['all','All stored columns']]]
];
const fieldLabels = new Map(fieldGroups.flatMap(g => g[1]));
const scenarios = [
 ['pushback','During pushback from the gate, the crew lost communication with the ground team.'],
 ['queue','While waiting in the departure queue, the crew misunderstood a runway entry clearance.'],
 ['park','While the aircraft was parked at the gate, a ground-service vehicle struck the aircraft.'],
 ['taxi out','While taxiing for departure, the crew misunderstood instructions and entered the wrong runway.'],
 ['takeoff','During takeoff, the crew rejected the takeoff after an aircraft equipment warning.'],
 ['climb','During climb, the distracted crew flew above the assigned altitude.'],
 ['cruise','During cruise, the aircraft encountered unexpected severe turbulence.'],
 ['descent','During descent, the crew accepted an altitude clearance intended for another aircraft.'],
 ['hold','While in a holding pattern, the crew deviated from the assigned altitude.'],
 ['approach','During approach, the aircraft became unstabilized and the crew initiated a go-around.'],
 ['land','During landing, the aircraft departed the side of the runway.'],
 ['taxi in','While taxiing to the gate after landing, the crew became confused about the assigned taxi route.']
];
let readyMethods = [], busy = false, methodChosen = false;
let activeSearch = null, searchVersion = 0;
let lastData = null, lastRequest = null, selectedField = 'primary_problem';
let bandRatio = .8, strongOnly = false;
let stageOverride = null, stageQuery = null;
let ratings = [];
try { const saved = JSON.parse(localStorage.getItem('asrs-ratings') || '[]'); if (Array.isArray(saved)) ratings = saved; } catch {}
const motion = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('#stage').setAttribute('data-hairline-theme', theme);
  $('#stage-animation')?.contentWindow?.postMessage({type:'asrs-theme',theme},location.origin);
  const dark = theme === 'dark';
  $('#theme-toggle').setAttribute('aria-pressed', String(dark));
  $('#theme-toggle').setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  $('#theme-label').textContent = dark ? 'Light mode' : 'Dark mode';
  $('#theme-icon').textContent = dark ? '☼' : '☾';
  try { localStorage.setItem('asrs-theme', theme); } catch {}
}
setTheme(document.documentElement.dataset.theme || 'light');
$('#theme-toggle').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

function activateSearch() {
  document.body.classList.add('exploring'); $('.search-entry').setAttribute('aria-expanded','true');
  $('#nav-search').classList.add('active');
}
function returnHome() {
  // An explicit Home action resets the search; scrolling never changes it.
  searchVersion += 1;
  activeSearch?.abort(); activeSearch = null; busy = false;
  lastData = null; lastRequest = null; bandRatio = .8; strongOnly = false;
  selectedField = 'primary_problem'; methodChosen = false;
  stageOverride=null;stageQuery=null;$('#stage-preview').hidden=true;$('#stage-animation').removeAttribute('src');
  $('#query').value = ''; $('#limit').value = '10';
  $('#method').value = readyMethods.includes('hybrid-bm25-minilm') ? 'hybrid-bm25-minilm' : 'bm25';
  $('#method-help').textContent = help[$('#method').value];
  $$('#examples button').forEach(b=>b.setAttribute('aria-pressed','false'));
  $('#search-stats').replaceChildren(); $('#search-stats').hidden = true;
  $('#results').replaceChildren(); $('#result-title').textContent = 'Results';
  $('#pagination').replaceChildren(); $('#pagination').hidden = true;
  $('#error').textContent = '';
  document.body.classList.remove('exploring');
  $('.search-entry').setAttribute('aria-expanded','false');
  buildSidebar(); $('#nav-search').classList.remove('active');
  syncBusy(); window.scrollTo({top:0, behavior:motion()});
}
$('#home-link').onclick = e => { e.preventDefault(); returnHome(); };
function openSearch(){activateSearch();$('#search').scrollIntoView({block:'start',behavior:motion()});$('#query').focus({preventScroll:true});}
$('#nav-search').onclick=e=>{e.preventDefault();openSearch();};
$('.search-entry').setAttribute('aria-expanded','false');
$('.search-entry').onclick = e => { e.preventDefault();openSearch(); };
for (const [name,text] of scenarios) {
  const b = node('button','phase',name); b.type='button'; b.setAttribute('aria-pressed','false');
  b.onclick = () => { $('#query').value=text; $$('#examples button').forEach(other=>other.setAttribute('aria-pressed',String(other===b))); $('#query').focus(); };
  $('#examples').append(b);
}
$('#query').addEventListener('input',()=>$$('#examples button').forEach(b=>b.setAttribute('aria-pressed','false')));
$('#method').onchange=()=>{methodChosen=true;$('#method-help').textContent=help[$('#method').value];syncBusy();};
function syncBusy() {
  $('#submit').disabled = $('.landing-submit').disabled = busy || !readyMethods.includes($('#method').value);
  $('#submit').textContent = busy ? 'Searching…' : 'Search reports ↗';
  $$('#pagination button').forEach(b=>b.disabled=busy || b.dataset.unavailable==='true');
}
async function checkStatus() {
  try {
    const r=await asrsFetch('status'), s=await r.json(); readyMethods=s.methods;
    $('#status').textContent=s.message+(s.error?' — '+s.error:'');
    $('#count').textContent=s.reports?s.reports.toLocaleString():'Preparing';
    for(const o of $('#method').options){o.disabled=!readyMethods.includes(o.value);o.textContent=labels[o.value]+(o.disabled?' (loading)':'');}
    if(!methodChosen&&readyMethods.includes('hybrid-bm25-minilm')) $('#method').value='hybrid-bm25-minilm';
    $('#method-help').textContent=help[$('#method').value]; syncBusy();
    if(!s.complete&&!s.error)setTimeout(checkStatus,2000);
  } catch { $('#status').textContent='Browser search could not start. Reload the page to try again.'; readyMethods=[];syncBusy();setTimeout(checkStatus,4000); }
}
checkStatus();

/* Same active-dot and branch-reach calculation as the reference sidebar. */
function markBranch(container,key) {
  container.querySelectorAll('.doc-link').forEach(b=>{
    const active=b.dataset.field===key;b.classList.toggle('active',active);
    if(active)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current');
  });
  container.querySelectorAll('.rail-list').forEach(list=>{
    const current=[...list.querySelectorAll('.doc-link')].find(b=>b.dataset.field===key);
    list.querySelectorAll('li').forEach(item=>item.classList.toggle('current',Boolean(current&&item.contains(current))));
    const item=current?.closest('li');
    const reach=item?(item.offsetTop+item.offsetHeight/2-6+2)/(list.offsetHeight+2):0;
    list.style.setProperty('--reach',Math.max(0,Math.min(1,reach)).toFixed(3));
  });
}
const icons = [
  ['M7 4h11v14H7ZM4 8v13h10'],
  ['M6 4h12v16H6ZM9 10h6M9 14h4'],
  ['M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16M12 10v6M12 7h.01']
];

function icon(paths) {
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
  for(const d of paths){const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',d);svg.append(p);}return svg;
}
function buildSidebar() {
  const target=$('#report-navigation');target.replaceChildren();
  fieldGroups.forEach(([title,fields],index)=>{
    const group=node('section','rail-group'), heading=node('button','rail-title');heading.type='button';heading.append(icon(icons[index]),node('span','',title));
    heading.onclick=()=>chooseField(fields[0][0],true);group.append(heading);
    const list=node('ul','rail-list');
    fields.forEach(([key,label])=>{const item=node('li'),b=node('button','doc-link',label);b.type='button';b.dataset.field=key;b.onclick=()=>chooseField(key,true);item.append(b);list.append(item);});
    group.append(list);target.append(group);
  });
  markBranch(target,selectedField);
}
function chooseField(key,scroll=false) {
  selectedField=key;$('#nav-search').classList.remove('active');markBranch($('#report-navigation'),key);
  $$('.result-feature').forEach(section=>{
    const row=lastData?.results.find(r=>r.id===section.dataset.reportId);if(!row)return;
    section.replaceChildren(node('div','feature-label',fieldLabels.get(key)||key),fieldContent(row,key));
  });
  if(scroll&&lastData){$('#results-header').scrollIntoView({block:'start',behavior:motion()});}
}
function fieldContent(row,key) {
  const record=row.record||{};
  if(key==='all') {
    const dl=node('dl','record-table');for(const [field,value] of Object.entries(record))dl.append(node('dt','',field),node('dd','',value||'Not recorded'));return dl;
  }
  const text=key==='passage'?row.passage:key==='synopsis'?row.synopsis:record[key];
  const content=node('div','field-text',text||'Not recorded in this report.');
  if(key==='date')content.append(node('p','small','Source date is recorded by month, not an exact incident date.'));
  if(key==='narrative_2'&&record.narrative_2_placeholder==='True')content.append(node('p','small','An editorial placeholder was removed during preprocessing; no additional account was available.'));
  return content;
}
window.addEventListener('resize',()=>{if(lastData)markBranch($('#report-navigation'),selectedField);});

$('#search-form').onsubmit=e=>{e.preventDefault();stageOverride=null;stageQuery=null;bandRatio=.8;strongOnly=false;runSearch({query:$('#query').value,method:$('#method').value,limit:Number($('#limit').value),offset:0});};
async function runSearch(request) {
  if(busy)return;
  activateSearch();busy=true;syncBusy();$('#error').textContent='';
  const version=++searchVersion; activeSearch=new AbortController();
  const submitted={...request,band_ratio:bandRatio,strong_only:strongOnly};
  try {
    const r=await asrsFetch('search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(submitted),signal:activeSearch.signal});
    const data=await r.json();if(version!==searchVersion)return;if(!r.ok)throw Error(data.error||'Search failed');
    lastData=data;lastRequest={...submitted,offset:data.stats.offset};
    renderStats(data);renderResults(data);renderStage(data);buildSidebar();chooseField(selectedField);renderPagination(data);
    $('#search-stats').scrollIntoView({block:'start',behavior:motion()});
  } catch(e){if(version===searchVersion&&e.name!=='AbortError')$('#error').textContent=e.message;}finally{if(version===searchVersion){busy=false;activeSearch=null;syncBusy();}}
}
const stageLabels = {'park':'Park','pushback':'Pushback','taxi-out':'Taxi out','takeoff':'Takeoff','climb':'Climb','cruise':'Cruise','descent':'Descent','hold':'Hold','approach':'Approach','land':'Land','taxi-in':'Taxi in'};
function renderStage(data){
  if(stageQuery!==data.query){stageOverride=null;stageQuery=data.query;}
  const suggestion=data.flight_stage||{stage:'cruise',explanation:'Default cruise illustration; no phase evidence available.'};
  const panel=$('#stage-preview'),choice=$('#stage-choice'),frame=$('#stage-animation');panel.hidden=false;choice.replaceChildren();
  for(const [key,label] of Object.entries(stageLabels)){const o=node('option','',label);o.value=key;choice.append(o);}
  const manual=stageOverride!==null;
  const stage=stageOverride||suggestion.stage||'cruise';
  choice.value=stage;choice.hidden=!manual;
  $('#stage-auto').setAttribute('aria-pressed',String(!manual));
  $('#stage-manual').setAttribute('aria-pressed',String(manual));
  $('#stage-name').textContent=stageLabels[stage];
  const sourceLabels={scenario_cue:'Selected from scenario.',report_labels:'Selected from top report phases.',mixed_scenario:'Mixed stages · first stage named.',taxi_fallback:'Taxi direction unclear · outbound illustration.',illustration_fallback:'Default illustration · phase unknown.'};
  $('#stage-explanation').textContent=manual?'Manually selected illustration.':(sourceLabels[suggestion.source]||suggestion.explanation);
  panel.title=manual?'Manual override. Switch to Match search to restore the detected stage.':suggestion.explanation;
  frame.hidden=false;
  const path='./stages/'+stage+'.html';
  if(frame.dataset.stage!==stage||!frame.hasAttribute('src')){frame.dataset.stage=stage;frame.src=path+'?theme='+document.documentElement.dataset.theme;}
  frame.title=stageLabels[stage]+' flight stage illustration';
  $('#stage-auto').onclick=()=>{stageOverride=null;renderStage(data);};
  $('#stage-manual').onclick=()=>{stageOverride=stage;renderStage(data);$('#stage-choice').focus({preventScroll:true});};
  choice.onchange=()=>{stageOverride=choice.value;renderStage(data);};
}
function renderResults(data) {
  $('#results').replaceChildren();$('#result-title').textContent=data.results.length?'Ranked reports':'No positive-score results';
  if(!data.results.length){$('#results').append(node('p','','Try a broader description or lower the high-score band.'));return;}
  for(const row of data.results) {
    const card=node('article','card'),meta=node('div','meta');
    meta.append(node('span','',`#${row.rank} · REPORT ${row.id}`),node('span',row.high_score?'score-badge':'',`Score ${row.score.toFixed(4)} · ${(100*row.relative_score).toFixed(1)}% of best${row.high_score?' · high-score band':''}`));
    const title=node('h3'),button=node('button','report-title',row.synopsis);button.type='button';title.append(button);
    card.append(meta,title,node('div','small','MATCHING PASSAGE'),node('div','passage',row.passage));
    const feature=node('section','result-feature');feature.dataset.reportId=row.id;card.append(feature);
    const inspector=reportInspector(row);card.append(inspector);button.onclick=()=>{inspector.open=!inspector.open;if(inspector.open)inspector.scrollIntoView({block:'start',behavior:motion()});};
    const rating=node('div','rating');
    rating.append(node('span','assessment-label','Relevance (manual)'));
    const existing=ratings.find(x=>x.query===data.query&&x.method===data.method&&x.report_id===row.id);
    let grade=existing&&[0,1,2].includes(existing.grade)?existing.grade:null;
    const source=node('span','small assessment-source',grade!==null?'Your assessment':'');
    source.setAttribute('aria-live','polite');
    const buttons=[];
    for(const [text,value] of [['Same issue',2],['Related',1],['Different',0]]){
      const b=node('button','',text);b.type='button';
      b.setAttribute('aria-pressed',String(grade===value));
      b.title='Your judgment. Click again to clear; no grade is inferred from search scores.';
      b.onclick=()=>{
        grade=grade===value?null:value;
        buttons.forEach(item=>item.button.setAttribute('aria-pressed',String(grade===item.grade)));
        ratings=ratings.filter(x=>!(x.query===data.query&&x.method===data.method&&x.report_id===row.id));
        if(grade!==null)ratings.push({query:data.query,method:data.method,report_id:row.id,grade,source:'human',timestamp:new Date().toISOString()});
        source.textContent=grade!==null?'Your assessment':'';
        try{localStorage.setItem('asrs-ratings',JSON.stringify(ratings));}catch{$('#error').textContent='The browser could not save this assessment. Export ratings before closing.';}
      };
      buttons.push({button:b,grade:value});rating.append(b);
    }
    rating.append(source);
    card.append(rating);$('#results').append(card);
  }
}
function reportInspector(row) {
  const details=node('details','report-details');details.id='report-'+row.id;details.append(node('summary','',`Inspect report ${row.id} · accounts, categories & context`));
  const tabs=node('div','inspector-groups'),inspector=node('div','report-inspector'),nav=node('nav','field-nav'),content=node('section','field-content');
  nav.setAttribute('aria-label','Report fields');content.tabIndex=0;inspector.append(nav,content);details.append(tabs,inspector);
  function paint(key){
    const groupIndex=fieldGroups.findIndex(g=>g[1].some(f=>f[0]===key));
    tabs.querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-pressed',String(i===groupIndex)));
    nav.replaceChildren();const list=node('ul','rail-list');
    fieldGroups[groupIndex][1].forEach(([field,title])=>{const li=node('li'),b=node('button','doc-link',title);b.type='button';b.dataset.field=field;b.onclick=()=>paint(field);li.append(b);list.append(li);});nav.append(list);
    content.replaceChildren(node('div','field-column',key==='all'?'PREPARED DATA RECORD':'COLUMN / '+key),node('h4','',fieldLabels.get(key)),fieldContent(row,key));
    markBranch(nav,key);
  }
  fieldGroups.forEach(([title,fields])=>{const b=node('button','inspector-group-button',title==='Accounts'?'Read the account':title);b.type='button';b.onclick=()=>paint(fields[0][0]);tabs.append(b);});
  details.addEventListener('toggle',()=>{if(details.open&&!nav.children.length)paint('passage');});return details;
}
const fmt=n=>n===null||n===undefined?'—':Number(n).toLocaleString(undefined,{maximumFractionDigits:4});
function stat(label,value,description) {const el=node('div','stat');el.append(node('span','stat-label',label),node('strong','stat-value',value));if(description)el.append(node('div','stat-description',description));return el;}
function metricList(items) {const dl=node('dl','metric-list');for(const [label,value] of items){const row=node('div');row.append(node('dt','',label),node('dd','',value));dl.append(row);}return dl;}
function renderStats(data) {
  const s=data.stats,d=s.distribution,container=$('#search-stats');container.hidden=false;container.replaceChildren();
  const heading=node('div','stats-heading');heading.append(node('h2','','Search analysis'),node('span','',labels[data.method]));container.append(heading);
  const grid=node('div','stats-grid');
  grid.append(stat('Reports searched',fmt(s.reports_searched),'Entire report collection'),stat('Positive-score candidates',fmt(s.positive_score_candidates),s.fusion_depth?'Within the fusion pool':'Scores greater than zero'),stat('In high-score band',fmt(s.high_score_total),`Score ≥ ${Math.round(s.band_ratio*100)}% of best`),stat('High-score reports not on this page',fmt(s.high_score_not_shown),'Includes earlier and later pages'),stat('Displayed on this page',String(s.results_shown),s.available?`${s.offset+1}–${s.offset+s.results_shown} of ${fmt(s.available)}`:'No results'),stat('Response time',`${data.seconds.toFixed(3)} s`,s.cached?'Reused cached ranking':'Fresh ranking'),stat('Best score',fmt(d.best),'Not a probability'),stat('Incident groups on this page',fmt(s.distinct_incident_groups_shown),'Related report records grouped'));
  container.append(grid);
  const controls=node('div','band-controls'),label=node('label','','High-score band'),input=node('input');input.id='band-percent';input.type='number';input.min='1';input.max='100';input.step='1';input.value=String(Math.round(s.band_ratio*100));label.htmlFor=input.id;label.append(input,node('span','','% of best score'));
  const only=node('label'),checkbox=node('input');checkbox.type='checkbox';checkbox.checked=s.strong_only;checkbox.id='strong-only';only.append(checkbox,node('span','','Show this band only'));
  const apply=node('button','','Apply');apply.type='button';apply.onclick=()=>{const value=Number(input.value);if(!input.reportValidity()||!Number.isFinite(value)||value<1||value>100)return;bandRatio=value/100;strongOnly=checkbox.checked;runSearch({...lastRequest,offset:0});};controls.append(label,only,apply);container.append(controls);
  const note=`The high-score band is an adjustable relative-score rule, not a relevance probability. ${fmt(s.high_score_total)} reports meet it; ${fmt(s.high_score_shown)} are on this page and ${fmt(s.high_score_not_shown)} are not. `+(s.fusion_depth?`Both components search all reports; fusion ranks the union of their top ${fmt(s.fusion_depth)} positive-score reports (${fmt(s.ranking_pool)} unique candidates). `:'Counts use the complete report ranking. ')+`Scores ≤ 0 are excluded; raw scores are not comparable across methods. Precision, recall and true relevance percentages require judged answers and are not available for this new query.`;
  container.append(node('p','stats-note',note),node('p','stats-provenance','Counts, timings and distributions are computed from this search. The high-score band is an exploratory display rule, not a research-validated relevance classifier. No automatic relevance labels are assigned.'));
  const detail=node('details','diagnostics');detail.append(node('summary','','Score distribution, timings & ranking diagnostics'));
  const columns=node('div','diagnostic-grid'),left=node('section'),right=node('section');
  left.append(node('h3','','Positive-score distribution'),metricList([['Minimum score',fmt(d.minimum)],['Mean / standard deviation',`${fmt(d.mean)} / ${fmt(d.std)}`],['Median',fmt(d.median)],['90th / 95th percentile',`${fmt(d.p90)} / ${fmt(d.p95)}`],['Best-to-second score gap',fmt(d.top_gap)],['High-score cutoff',fmt(d.band_cutoff)]]));
  const chart=node('div','histogram');chart.setAttribute('role','img');chart.setAttribute('aria-label',`Score distribution across ${s.positive_score_candidates} positive-score candidates`);
  const max=Math.max(1,...d.histogram.map(b=>b.count));for(const bin of d.histogram){const bar=node('div');bar.style.height=(bin.count/max*100)+'%';bar.title=`${fmt(bin.low)} to ${fmt(bin.high)}: ${fmt(bin.count)} reports`;chart.append(bar);}
  const axis=node('div','hist-axis');axis.append(node('span','',fmt(d.minimum)),node('span','',fmt(d.best)));
  right.append(node('h3','','Score histogram'),chart,axis,node('p','chart-caption','12 equal-width bins. Hover a bar for its score range and report count.'),metricList([['Passages indexed',fmt(s.passages_indexed)],['Original ranking time',s.ranking_seconds.toFixed(4)+' s'],['Ranking reused',s.cached?'Yes':'No'],['Query words',String(s.query_words)],['Ranking pool',fmt(s.ranking_pool)]]));
  if(s.fusion_depth)right.append(metricList([['Component pool overlap',fmt(s.component_overlap)],...s.components.map(c=>[c.method+' ranking time',c.seconds.toFixed(4)+' s'])]));
  columns.append(left,right);detail.append(columns);
  const table=node('table','score-table'),thead=node('thead'),tr=node('tr');for(const title of ['Rank','Report','Raw score','% of best','High-score band'])tr.append(node('th','',title));thead.append(tr);table.append(thead);const tbody=node('tbody');for(const row of data.results){const tr=node('tr');for(const value of [row.rank,row.id,fmt(row.score),(row.relative_score*100).toFixed(1)+'%',row.high_score?'Yes':'No'])tr.append(node('td','',String(value)));tbody.append(tr);}table.append(tbody);detail.append(table);
  if(data.results.some(r=>r.components.length)){const section=node('section');section.append(node('h3','','Component evidence for displayed reports'));for(const row of data.results){section.append(node('p','chart-caption',`ACN ${row.id} — `+row.components.map(c=>`${c.method}: rank ${c.rank}, score ${fmt(c.score)}`).join(' · ')));}detail.append(section);}
  const categories=node('section');categories.append(node('h3','','Primary problems on this page'),metricList(Object.entries(s.primary_problems_shown).map(([name,count])=>[name,String(count)])));detail.append(categories);container.append(detail);
}
function renderPagination(data) {
  const s=data.stats,target=$('#pagination');target.hidden=false;target.replaceChildren();
  const previous=node('button','','← Previous'),next=node('button','','Next →');previous.type=next.type='button';previous.dataset.unavailable=String(!s.has_previous);next.dataset.unavailable=String(!s.has_next);
  previous.onclick=()=>runSearch({...lastRequest,offset:Math.max(0,s.offset-s.requested_limit)});next.onclick=()=>runSearch({...lastRequest,offset:s.offset+s.requested_limit});
  target.append(previous,node('span','',s.available?`Showing ${s.offset+1}–${s.offset+s.results_shown} of ${fmt(s.available)} ranked reports`:'No ranked reports'),next);
}
$('#export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(ratings,null,2)],{type:'application/json'}));const a=node('a');a.href=url;a.download='asrs-relevance-ratings.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
buildSidebar();
