/* Real BM25 over exported float32 passage weights. All scoring stays here. */
importScripts('./vendor/snowball-stemmers.js');
const stemmer = snowballFactory.newStemmer('english');
const state = {methods:[], reports:0, message:'Downloading browser keyword index…', error:null, complete:false};
let manifest, metadata, weights, indices, indptr, vocabulary, stopwords;
const rankingCache = new Map(), reportCache = new Map();

async function gzipFile(name) {
  const info = manifest.files[name];
  if (!info) throw Error('Missing search data: ' + name);
  const response = await fetch('./data/' + name + '?v=' + info.sha256.slice(0,12));
  if (!response.ok) throw Error('Could not download search data. Please reload.');
  const bytes = await response.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join('');
  if (hex !== info.sha256) throw Error('Search data verification failed. Please reload.');
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
async function jsonFile(name) { return JSON.parse(new TextDecoder().decode(await gzipFile(name))); }

const initialization = (async () => {
  try {
    if (typeof DecompressionStream === 'undefined') throw Error('Please use a current browser with gzip decompression support.');
    const response = await fetch('./data/manifest.json', {cache:'no-cache'});
    if (!response.ok) throw Error('Could not load the search manifest. Please reload.');
    manifest = await response.json();
    if (manifest.format !== 1) throw Error('Unsupported search index version. Please reload.');
    state.reports = manifest.reports;
    let completed = 0;
    const names = ['metadata.json.gz', 'weights.f32.gz', 'indices.u32.gz', 'indptr.u32.gz'];
    const size = names.reduce((n,name)=>n+manifest.files[name].bytes,0);
    state.message = `Downloading ${(size/1e6).toFixed(1)} MB keyword index · first visit may take a moment…`;
    const parts = await Promise.all(names.map(async name => {
      const value = await gzipFile(name);
      completed += 1;
      state.message = `Preparing keyword search · ${completed} of 4 index files ready…`;
      return value;
    }));
    metadata = JSON.parse(new TextDecoder().decode(parts[0]));
    weights = new Float32Array(parts[1]);
    indices = new Uint32Array(parts[2]);
    indptr = new Uint32Array(parts[3]);
    vocabulary = new Map(Object.entries(metadata.vocabulary));
    stopwords = new Set(metadata.stopwords);
    if (weights.length !== indices.length || indptr[indptr.length-1] !== weights.length || metadata.doc_ids.length !== manifest.reports) {
      throw Error('The search index is inconsistent. Please reload.');
    }
    state.methods = ['bm25']; state.complete = true;
    state.message = 'Browser keyword search ready · MiniLM and hybrid are available in the Python app.';
  } catch (error) {
    state.error = error.message; state.message = 'Browser search unavailable'; state.complete = true;
  }
})();

function rank(query) {
  const started = performance.now();
  if (rankingCache.has(query)) {
    const value = rankingCache.get(query); rankingCache.delete(query); rankingCache.set(query,value);
    return {...value,cached:true};
  }
  const terms = new Map();
  for (const token of query.toLowerCase().match(/[a-z0-9]+/g) || []) {
    if (stopwords.has(token)) continue;
    const term = vocabulary.get(stemmer.stem(token));
    if (term !== undefined) terms.set(term,(terms.get(term)||0)+1);
  }
  const scores = new Float32Array(manifest.passages);
  for (const [term, frequency] of [...terms].sort((a,b)=>a[0]-b[0])) {
    for (let i=indptr[term];i<indptr[term+1];i++) {
      scores[indices[i]] += Math.fround(weights[i] * frequency);
    }
  }
  const ranking = [];
  for (let doc=0;doc<manifest.reports;doc++) {
    const start=metadata.doc_starts[doc], end=metadata.doc_starts[doc+1]??manifest.passages;
    let score=0, best=start;
    for(let i=start;i<end;i++) if(scores[i]>score){score=scores[i];best=i;}
    if(score>0)ranking.push({doc,score,best});
  }
  ranking.sort((a,b)=>b.score-a.score||a.doc-b.doc);
  const value={ranking,seconds:(performance.now()-started)/1000,cached:false};
  rankingCache.set(query,value);
  while(rankingCache.size>3)rankingCache.delete(rankingCache.keys().next().value);
  return value;
}

function distribution(ranking,ratio) {
  if(!ranking.length)return {best:null,minimum:null,mean:null,median:null,std:null,p90:null,p95:null,top_gap:null,band_cutoff:null,band_count:0,histogram:[]};
  const values=ranking.map(r=>r.score).reverse(),n=values.length,min=values[0],max=values[n-1];
  const quantile=p=>{const at=(n-1)*p,lo=Math.floor(at),hi=Math.ceil(at);return values[lo]+(values[hi]-values[lo])*(at-lo);};
  const mean=values.reduce((a,b)=>a+b,0)/n;
  const std=Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/n),cutoff=max*ratio;
  const low=min===max?min-.5:min,high=min===max?max+.5:max,width=(high-low)/12;
  const histogram=Array.from({length:12},(_,i)=>({low:low+i*width,high:low+(i+1)*width,count:0}));
  for(const v of values)histogram[Math.min(11,Math.floor((v-low)/width))].count++;
  return {best:max,minimum:min,mean,median:quantile(.5),std,p90:quantile(.9),p95:quantile(.95),
    top_gap:n>1?ranking[0].score-ranking[1].score:null,band_cutoff:cutoff,
    band_count:ranking.filter(r=>r.score>=cutoff).length,histogram};
}

async function record(doc) {
  const shard=Math.floor(doc/manifest.shard_size),name=`reports/${String(shard).padStart(4,'0')}.json.gz`;
  if(!reportCache.has(shard)) {
    const promise=jsonFile(name).catch(error=>{reportCache.delete(shard);throw error;});
    reportCache.set(shard,promise);
  }
  const promise=reportCache.get(shard);
  reportCache.delete(shard);reportCache.set(shard,promise);
  while(reportCache.size>24)reportCache.delete(reportCache.keys().next().value);
  return (await promise)[doc%manifest.shard_size];
}

function classifyStage(query, phases) {
  const stages=metadata.stages,patterns=metadata.stage_patterns;
  const exact=query.trim().toLowerCase().replaceAll(' ','-');
  const result=(stage,source,candidates,uncertain,explanation)=>({stage,source,candidates,uncertain,explanation});
  if(stages.includes(exact))return result(exact,'scenario_cue',[exact],false,'Suggested from the stage named in your scenario. You can change it.');
  let matches=stages.filter(stage=>new RegExp(patterns[stage],'i').test(query));
  const specific=matches.filter(s=>['taxi-in','taxi-out','pushback'].includes(s));
  if(specific.length===1){const contextual={'taxi-in':['land','park'],'taxi-out':['takeoff','park'],pushback:['park']}[specific[0]];matches=matches.filter(s=>!contextual.includes(s));}
  if(matches.length===1)return result(matches[0],'scenario_cue',matches,false,'Suggested from wording in your scenario. You can change it.');
  const votes={},weighted={};let genericTaxi=false;
  phases.slice(0,10).forEach((raw,index)=>{
    const mapped=new Set();
    for(const value of (raw||'').toLowerCase().split(';')){
      const p=value.trim();let s;
      if(['parked','park'].includes(p))s='park';
      else if(['takeoff / launch','takeoff'].includes(p))s='takeoff';
      else if(['climb','initial climb'].includes(p))s='climb';
      else if(p==='cruise')s='cruise';else if(p==='descent')s='descent';
      else if(['initial approach','final approach','approach'].includes(p))s='approach';
      else if(p==='landing')s='land';else if(p.includes('holding pattern'))s='hold';
      else if(p.includes('pushback')||p.includes('push-back'))s='pushback';
      else if(p==='taxi'){genericTaxi=true;s='taxi-out';}
      if(s)mapped.add(s);
    }
    for(const s of mapped){votes[s]=(votes[s]||0)+1;weighted[s]=(weighted[s]||0)+1/(index+1);}
  });
  const candidates=matches.length?matches:Object.keys(votes),supported=candidates.filter(s=>votes[s]);
  if(supported.length){
    supported.sort((a,b)=>votes[b]-votes[a]||weighted[b]-weighted[a]||stages.indexOf(a)-stages.indexOf(b));
    const chosen=supported[0],tied=supported.filter(s=>votes[s]===votes[chosen]).length>1;
    if(chosen==='taxi-out'&&genericTaxi)return result(chosen,'taxi_fallback',['taxi-out','taxi-in'],true,`Taxi appears in ${votes[chosen]} of the top ${phases.length} report phase labels, but direction is unclear. Using the taxi-out illustration; change it to taxi-in if appropriate.`);
    return result(chosen,'report_labels',candidates,matches.length>1||tied||votes[chosen]<3,`Selected using flight-phase labels in ${votes[chosen]} of the top ${phases.length} reports. Mixed or tied evidence is resolved by report rank; this is an illustration, not a verified incident classification.`);
  }
  if(matches.length){matches.sort((a,b)=>query.search(new RegExp(patterns[a],'i'))-query.search(new RegExp(patterns[b],'i')));return result(matches[0],'mixed_scenario',matches,true,'Multiple stages mentioned; illustrating the first stage named because report labels do not resolve them. You can change it.');}
  if(genericTaxi||/\btaxi(?:ing|ed)?\b|\bhold short\b/i.test(query))return result('taxi-out','taxi_fallback',['taxi-out','taxi-in'],true,'Taxi is indicated, but direction is unclear. Using the taxi-out illustration; change it to taxi-in if appropriate.');
  return result('cruise','illustration_fallback',['cruise'],true,'No clear flight-phase evidence. Cruise is the default illustration, not a factual classification of this scenario.');
}

async function search(body) {
  await initialization;
  if(state.error)throw Error(state.error);
  const started=performance.now();
  let {query,method='bm25',limit=10,offset=0,band_ratio:ratio=.8,strong_only:strongOnly=false}=body;
  if(typeof query!=='string'||!query.trim()||query.length>2000)throw Error('Enter a scenario between 1 and 2,000 characters.');
  if(method!=='bm25')throw Error('This free website supports BM25 keyword search. MiniLM and hybrid require the Python app.');
  if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Result count must be between 1 and 100.');
  if(!Number.isInteger(offset)||offset<0||offset>manifest.reports)throw Error('Invalid page offset.');
  if(typeof ratio!=='number'||!Number.isFinite(ratio)||ratio<=0||ratio>1)throw Error('Invalid high-score band.');
  if(typeof strongOnly!=='boolean')throw Error('Invalid band selection.');
  query=query.trim();
  const ranked=rank(query),d=distribution(ranked.ranking,ratio),available=strongOnly?d.band_count:ranked.ranking.length;
  offset=Math.min(offset,Math.max(0,Math.floor((available-1)/limit)*limit));
  const chosen=ranked.ranking.slice(offset,Math.min(offset+limit,available));
  const rows=await Promise.all(chosen.map(async (hit,i)=>{
    const source=await record(hit.doc),{_passages,...value}=source;
    return {rank:offset+i+1,id:metadata.doc_ids[hit.doc],score:hit.score,relative_score:hit.score/d.best,
      high_score:offset+i<d.band_count,components:[],synopsis:value.synopsis,record:value,
      passage:_passages[hit.best-metadata.doc_starts[hit.doc]],narrative:value.narrative};
  }));
  const categories={};for(const row of rows){const key=row.record.primary_problem||'Not recorded';categories[key]=(categories[key]||0)+1;}
  const highShown=rows.filter(r=>r.high_score).length;
  return {query,method,results:rows,
    flight_stage:classifyStage(query,ranked.ranking.slice(0,10).map(r=>metadata.flight_phases[r.doc])),
    seconds:(performance.now()-started)/1000,
    stats:{reports_searched:manifest.reports,passages_indexed:manifest.passages,ranking_pool:manifest.reports,
      positive_score_candidates:ranked.ranking.length,available,results_shown:rows.length,requested_limit:limit,offset,
      has_next:offset+rows.length<available,has_previous:offset>0,band_ratio:ratio,strong_only:strongOnly,
      high_score_total:d.band_count,high_score_shown:highShown,high_score_not_shown:d.band_count-highShown,
      fusion_depth:null,component_overlap:null,components:[],distribution:d,cached:ranked.cached,
      ranking_seconds:ranked.seconds,query_words:query.split(/\s+/).length,
      distinct_incident_groups_shown:new Set(rows.map(r=>r.record.group_id)).size,
      primary_problems_shown:categories,relevance_probability_available:false}};
}

self.onmessage = async ({data:{id,action,payload}}) => {
  try {
    if(action==='status')self.postMessage({id,value:{...state}});
    else if(action==='search')self.postMessage({id,value:await search(payload)});
    else throw Error('Unknown action.');
  } catch(error) { self.postMessage({id,error:error.message}); }
};
