/* Node 22+: validate the actual worker offline against Python BM25 fixtures. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {webcrypto} = require('node:crypto');

(async () => {
  const root = path.resolve(__dirname, '..');
  const pending = new Map(); let nextId = 0;
  const context = vm.createContext({
    console, TextDecoder, TextEncoder, Blob, Response, DecompressionStream,
    Uint8Array, Uint32Array, Float32Array, ArrayBuffer, performance, crypto:webcrypto,
    fetch:async url => {
      const filename = new URL(url, 'https://test.invalid/').pathname;
      return new Response(fs.readFileSync(path.join(root, filename)));
    },
    self:{postMessage:data => { pending.get(data.id)(data); pending.delete(data.id); }},
  });
  context.importScripts = filename => vm.runInContext(fs.readFileSync(path.join(root,filename),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root,'search-worker.js'),'utf8'),context);
  const call = (action,payload) => new Promise(resolve => {
    const id=++nextId; pending.set(id,resolve); context.self.onmessage({data:{id,action,payload}});
  });
  for (const expected of JSON.parse(fs.readFileSync(path.join(__dirname,'reference.json')))) {
    const response=await call('search',{query:expected.query,limit:20});
    assert(!response.error,response.error);
    const actual=JSON.parse(JSON.stringify(response.value));
    assert.deepEqual(actual.results.map(r=>r.id),expected.results.map(r=>r.id),expected.query);
    assert.equal(actual.stats.positive_score_candidates,expected.positive_score_candidates);
    assert.equal(actual.stats.high_score_total,expected.high_score_total);
    assert.equal(actual.flight_stage.stage,expected.stage);
    for (let i=0;i<actual.results.length;i++) {
      assert(Math.abs(actual.results[i].score-expected.results[i].score)<1e-4);
      assert.equal(require('node:crypto').createHash('sha256').update(actual.results[i].passage).digest('hex'),expected.results[i].passage_sha256);
      assert.equal(Object.keys(actual.results[i].record).length,23);
    }
    for(const field of ['best','minimum','mean','median','std','p90','p95','top_gap','band_cutoff']) {
      const a=actual.stats.distribution[field],b=expected.distribution[field];
      assert((a===null&&b===null)||Math.abs(a-b)<1e-4,field);
    }
    console.log('Python BM25 parity:',expected.query);
  }
  const query='During descent the crew misunderstood an altitude clearance';
  const first=(await call('search',{query,limit:10})).value;
  const next=(await call('search',{query,limit:10,offset:10})).value;
  assert(!first.results.some(r=>next.results.some(other=>other.id===r.id)));
  const band=(await call('search',{query,limit:100,band_ratio:.99,strong_only:true})).value;
  assert(band.results.every(r=>r.high_score&&r.relative_score>=.99));
  assert.equal(band.stats.available,band.stats.high_score_total);
  for(const payload of [{query,method:'minilm'},{query,limit:0},{query,offset:-1},{query,band_ratio:2},{query:' '},{query,strong_only:'true'}]) {
    assert((await call('search',payload)).error);
  }
  console.log('Pagination, high-score filtering, and input validation passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
