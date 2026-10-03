import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, requests, normalize, ContextCollector, collect } from './collect.mjs';
const brand = plan.brands[0];
const ok = body => new Response(JSON.stringify(body), { status:200 });

test('three-brand request plan stays within explicit credit, page and request limits', () => {
  const all = plan.brands.flatMap(requests);
  assert.equal(all.length,12);
  assert.equal(all.reduce((s,r)=>s+r.reserve,0),78);
  assert.ok(all.filter(r=>r.operation==='crawl').every(r=>r.body.maxPages===5 && r.body.followSubdomains===false && r.body.pdf.shouldParse===false));
  assert.ok(all.filter(r=>r.operation==='search').every(r=>r.body.numResults===10));
});
test('missing key issues no network requests or fabricated evidence', async () => {
  const c = new ContextCollector({ fetchImpl:()=>{throw new Error('must not call');} });
  const result = await collect({live:true,collector:c});
  assert.equal(result.contextRequests,0);
  assert.equal(result.downstream.qualityImprovement,'unmeasured');
  assert.ok(result.brands.every(b=>b.enhancedReferences.length===0 && b.context.every(r=>r.status==='blocked-missing-key')));
});
test('crawl ignores unsuccessful, empty, external and credential-bearing URLs', () => {
  const body={results:[
    {markdown:'usable',metadata:{success:true,url:'https://www.nike.com/about'}},
    {markdown:'failed',metadata:{success:false,url:brand.url}},
    {markdown:'',metadata:{success:true,url:brand.url}},
    {markdown:'external',metadata:{success:true,url:'https://evil.example'}},
    {markdown:'unsafe',metadata:{success:true,url:'https://a:b@nike.com'}}
  ]};
  const refs=normalize(brand,'crawl',body,'2026-10-03T12:00:00Z');
  assert.equal(refs.length,1); assert.equal(refs[0].provider,'context-dev');
  assert.equal(refs[0].trust,'untrusted-provider-observation'); assert.match(refs[0].sourceId,/context-dev:/);
});
test('brand identity mismatch produces no evidence', () => {
  assert.deepEqual(normalize(brand,'brand',{status:'ok',brand:{domain:'other.com'}},''),[]);
});
test('partial style observations preserve provenance and truncation', () => {
  const refs=normalize(brand,'styleguide',{status:'ok',domain:brand.domain,request_id:'request-1',partial:true,styleguide:{colors:{accent:'#000000'},extra:'x'.repeat(13000)}},'2026-10-03T12:00:00Z');
  assert.equal(refs.length,1); assert.equal(refs[0].partial,true); assert.equal(refs[0].requestId,'request-1');
  assert.equal(refs[0].truncated,true); assert.equal(refs[0].excerpt.length,12000);
});
test('brand no-match uses documented 400 and never persists error text',async()=>{
  const c=new ContextCollector({apiKey:'test-secret',fetchImpl:async()=>new Response(JSON.stringify({error_code:'NOT_FOUND',message:'arbitrary upstream error'}),{status:400})});
  const r=await c.call(brand,requests(brand)[0]); assert.equal(r.status,'no-match'); assert.equal(r.raw,undefined);
});
test('invalid response is counted and never retried',async()=>{
  let calls=0;
  const c=new ContextCollector({apiKey:'test-secret',fetchImpl:async()=>{calls++;return new Response('<html/>')}});
  const r=await c.call(brand,requests(brand)[0]); assert.equal(calls,1); assert.equal(c.count,1); assert.equal(r.status,'transport-or-invalid-response');
});
test('hard request/credit budget stops further dispatch',async()=>{
  let calls=0;
  const c=new ContextCollector({apiKey:'test-secret',fetchImpl:async()=>{calls++;return ok({status:'ok',brand:{domain:brand.domain},key_metadata:{credits_consumed:10}})}});
  c.reserved=70;
  await assert.rejects(c.call(brand,requests(brand)[0]),/budget/); assert.equal(calls,0);
});
test('credit usage and timing are recorded without exposing a secret',async()=>{
  const c=new ContextCollector({apiKey:'test-secret',fetchImpl:async(_url,opts)=>{assert.equal(opts.redirect,'error');assert.equal(opts.headers.Authorization,'Bearer test-secret');return ok({status:'ok',brand:{domain:brand.domain,title:'Nike'},key_metadata:{credits_consumed:10},request_id:'r1'})}});
  const r=await c.call(brand,requests(brand)[0]); assert.equal(r.credits,10); assert.equal(r.references.length,1); assert.ok(!JSON.stringify(r).includes('test-secret'));
});
test('secret-bearing success responses are rejected',async()=>{
  const c=new ContextCollector({apiKey:'test-secret',fetchImpl:async()=>ok({status:'ok',brand:{domain:brand.domain,title:'test-secret'}})});
  const r=await c.call(brand,requests(brand)[0]);assert.equal(r.status,'transport-or-invalid-response');assert.ok(!JSON.stringify(r).includes('test-secret'));
});
