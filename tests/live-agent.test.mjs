import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveAgentService} from '../lib/live-agent.mjs';
import {extractQuoteItems,selectQuoteItem} from '../lib/item-matching.mjs';
const env={ANTHROPIC_API_KEY:'test-only-noncredential',ANTHROPIC_MODEL:'test-model'};
const req={item:'18 inch Halloween foil balloon',quantity:1000,stock:0,deadline:'2026-12-01'};
const quotationText=`Supplier: CGS\nItem: ${req.item}\nCurrency: SGD\nCost basis: tax-inclusive\nPrice: SGD 0.18 per piece\nUnits per quoted price: 1\nMOQ: 100\nOrder pack multiple: 100\nDelivery charge: 0\nOther charges: 0\nLead time: 2-3 working days\nGST: 9% included`;
function input(options={}){const quote=selectQuoteItem({id:'cgs',name:'supplier.txt',text:quotationText,candidates:extractQuoteItems(quotationText,{quantity:1000})},req.item,undefined,1000);return {quote,quotes:[quote],req,goal:'price',target:10,contextVersion:'review-1',review:{status:'approved',approvedQuoteId:'cgs',contextVersion:'review-1',revision:1},...options};}
const tool=(name,input={})=>({type:'tool_use',id:crypto.randomUUID(),name,input});
function mockProvider({commitEarly=false,failFirst=false,failRevision=false}={}){
 const requests=[];let next=0;
 const fetchImpl=async(url,options)=>{
  const body=JSON.parse(options.body);requests.push(body);next++;
  if(failFirst&&next===1)return new Response('{}',{status:429,headers:{'request-id':'retry-id'}});
  const last=body.messages.at(-1);let content;
  if(last.role==='user'&&typeof last.content==='string'){
   const task=JSON.parse(last.content);
   if(task.approval) content=[tool('commit_approved_draft',{draftVersion:task.approval.version,draftFingerprint:task.approval.fingerprint})];
   else if(failRevision&&task.nextDraftVersion) return new Response('{}',{status:401});
   else content=[tool('read_quote_evidence')];
  } else {
   const result=last.content?.find(v=>v.type==='tool_result');
   const prior=body.messages.at(-2).content.find(v=>v.type==='tool_use');
   if(prior.name==='read_quote_evidence')content=[tool('calculate_offer')];
   else if(prior.name==='calculate_offer')content=[tool('create_negotiation_draft',{message:'Dear CGS, could you quote SGD 0.162 per unit for 1,000 identical balloons? Please preserve the specification and confirm all freight, tax, packing and delivery conditions in writing.',risks:['Delivery terms need written confirmation.'],assumptions:[]}),...(commitEarly?[tool('commit_approved_draft',{draftVersion:1,draftFingerprint:'fake'})]:[])];
   else content=[{type:'text',text:'The tool result has been received.'}];
   assert.ok(result);
  }
  return Response.json({id:'msg-'+next,model:'test-model',content},{headers:{'request-id':'req-'+next}});
 };
 return {fetchImpl,requests};
}
function service(options={}){const mock=mockProvider(options);const saved=[];const agent=createLiveAgentService({fetchImpl:mock.fetchImpl,now:()=>new Date('2026-11-03T00:00:00Z'),persistence:artifact=>saved.push(artifact)});return {agent,saved,...mock};}
const decision=(session,action,extra={})=>({sessionId:session.id,decision:action,draftVersion:session.draft.version,currentContextVersion:session.contextVersion,...extra});

test('real provider protocol uses automatic tool selection and returns actual results to the model',async()=>{
 const {agent,requests,saved}=service();const result=await agent.start(input(),env);
 assert.equal(result.simulation,false);assert.equal(result.status,'awaiting_approval');assert.equal(result.artifact,null);assert.equal(saved.length,0);
 assert.deepEqual(result.toolCalls.map(c=>c.name),['read_quote_evidence','calculate_offer','create_negotiation_draft']);
 assert.ok(requests.every(body=>body.tool_choice.type==='auto'));
 assert.ok(requests.at(-1).messages.at(-1).content[0].type==='tool_result');
 assert.equal(result.calculation.targetValue,0.162);assert.equal(result.calculation.goodsSavings,18);assert.equal(result.calculation.confirmedSavings,false);
 assert.equal(result.requestIds.length,4);assert.ok(result.inputFingerprint.length===64);
 assert.ok(result.draft.assumptions.some(v=>v.includes('No verified industry price')));
 assert.ok(!JSON.stringify(result).includes(env.ANTHROPIC_API_KEY));
});

test('early model commit is denied and only exact human approval releases one local document',async()=>{
 const {agent,saved}=service({commitEarly:true});const result=await agent.start(input(),env);
 assert.equal(saved.length,0);assert.equal(result.toolCalls.at(-1).isError,true);
 const done=await agent.decide(decision(result,'approve'),env);
 assert.equal(done.status,'completed');assert.equal(saved.length,1);
 assert.equal(done.artifact.draft.message,result.draft.message);assert.equal(done.artifact.draft.fingerprint,result.draft.fingerprint);
 assert.equal(done.artifact.deliveryStatus,'local_only_not_sent');assert.equal(done.artifact.vendorAgreement,false);
 assert.ok(done.audit.findIndex(e=>e.type==='human_approved')<done.audit.findIndex(e=>e.type==='local_artifact_saved'));
 await assert.rejects(()=>agent.decide(decision(result,'approve'),env),/no pending draft/);assert.equal(saved.length,1);
});

test('revisions call the model again and require a fresh version; previous approval is refused',async()=>{
 const {agent,requests,saved}=service();const first=await agent.start(input(),env);const count=requests.length;
 const second=await agent.decide(decision(first,'revise',{feedback:'Ask for recycled packaging and do not claim a vendor agreement.'}),env);
 assert.ok(requests.length>count);assert.equal(second.version,2);assert.equal(second.draft.version,2);assert.notEqual(second.draft.fingerprint,first.draft.fingerprint);assert.equal(saved.length,0);
 assert.match(JSON.stringify(requests.at(-1).messages),/recycled packaging/);
 await assert.rejects(()=>agent.decide(decision(first,'approve'),env),/quote or draft changed/);
 const done=await agent.decide(decision(second,'approve'),env);assert.equal(done.status,'completed');assert.equal(saved[0].draft.version,2);
});

test('changed quotation context, approval note changes and mismatched supplier review are blocked',async()=>{
 const {agent,saved}=service();await assert.rejects(()=>agent.start(input({review:{status:'approved',approvedQuoteId:'other',contextVersion:'review-1'}}),env),/Approve this supplier/);
 const session=await agent.start(input(),env);
 await assert.rejects(()=>agent.decide(decision(session,'approve',{currentContextVersion:'review-2'}),env),/quote or draft changed/);
 await assert.rejects(()=>agent.decide(decision(session,'approve',{feedback:'Only if free shipping.'}),env),/Request changes/);assert.equal(saved.length,0);
});

test('stop preserves the audit and never produces a local artifact',async()=>{
 const {agent,saved}=service();const session=await agent.start(input(),env);const stopped=await agent.decide(decision(session,'reject',{feedback:'The price is not competitive.'}),env);
 assert.equal(stopped.status,'stopped');assert.equal(stopped.artifact,null);assert.equal(saved.length,0);assert.equal(stopped.audit.at(-1).type,'human_rejected');
});

test('transient provider failure is retried and request IDs remain available',async()=>{
 const {agent,requests}=service({failFirst:true});const session=await agent.start(input(),env);
 assert.equal(requests.length,5);assert.ok(session.requestIds.includes('retry-id'));assert.equal(session.audit.find(e=>e.type==='provider_response').status,429);
});

test('failed revision leaves the previous pending draft intact',async()=>{
 const {agent}=service({failRevision:true});const session=await agent.start(input(),env);
 await assert.rejects(()=>agent.decide(decision(session,'revise',{feedback:'Please ask for a revised price.'}),env),/rejected the configured credential/);
 assert.equal(agent.status(session.id).draft.version,1);
});

test('unknown freight and other charges remain unknown; no fabricated landed savings',async()=>{
 const {agent}=service();const source=input();source.quote.values.delivery=null;source.quote.values.other=null;source.quote.candidates.forEach(c=>{c.values.delivery=null;c.values.other=null;});source.quote.text=source.quote.text.replace('Delivery charge: 0','Delivery charge: TBC').replace('Other charges: 0','Other charges: TBC');
 const session=await agent.start(source,env);assert.equal(session.calculation.deliveryAmount,null);assert.equal(session.calculation.otherCharges,null);assert.equal(session.calculation.goodsSavings,18);assert.ok(session.draft.risks.some(v=>/Freight/.test(v)));
});

test('session snapshots cannot be changed from returned client objects',async()=>{
 const {agent}=service();const session=await agent.start(input(),env);session.draft.message='Changed';session.calculation.targetValue=0;
 const original=agent.status(session.id);assert.notEqual(original.draft.message,'Changed');assert.equal(original.calculation.targetValue,0.162);
});

test('routes reject cross-origin requests and malformed payloads without provider access',async()=>{
 const {agent,requests}=service();const a=await agent.handle(new Request('http://localhost/api/agent/start',{method:'POST',headers:{origin:'https://example.com'},body:'{}'}),env);assert.equal(a.status,403);
 const b=await agent.handle(new Request('http://localhost/api/agent/start',{method:'POST',headers:{origin:'http://localhost'},body:'invalid'}),env);assert.equal(b.status,400);assert.equal(requests.length,0);
 const status=await agent.handle(new Request('http://localhost/api/agent/status'),env);assert.equal((await status.json()).configured,true);
});

test('no credential means no draft, and invalid target is rejected before provider access',async()=>{
 const {agent,requests}=service();await assert.rejects(()=>agent.start(input(),{}),/not configured/);
 await assert.rejects(()=>agent.start(input({target:100}),env),/valid positive target/);
 await assert.rejects(()=>agent.start(input({goal:'moq',target:100}),env),/below the quoted MOQ/);assert.equal(requests.length,0);
});

test('only one concurrent approval may commit a session',async()=>{
 const {agent,saved}=service();const session=await agent.start(input(),env);
 const outcomes=await Promise.allSettled([agent.decide(decision(session,'approve'),env),agent.decide(decision(session,'approve'),env)]);
 assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);assert.equal(saved.length,1);
});

test('no-demand orders, invalid stock and price targets rounded to zero are rejected before AI',async()=>{
 const {agent,requests}=service();
 for(const stock of [1000,1001])await assert.rejects(()=>agent.start(input({req:{...req,stock}}),env),/no net purchase demand/);
 for(const stock of [Infinity,'Infinity','not a number',-1])await assert.rejects(()=>agent.start(input({req:{...req,stock}}),env),/finite non-negative stock/);
 await assert.rejects(()=>agent.start(input({target:99.9999999}),env),/positive lower unit price/);
 assert.equal(requests.length,0);
});

test('faster-delivery requests must improve a parsable source lead time',async()=>{
 const {agent,requests}=service();
 for(const target of [3,30])await assert.rejects(()=>agent.start(input({goal:'delivery',target}),env),/shorter than the quoted lead time/);
 assert.equal(requests.length,0);
 const session=await agent.start(input({goal:'delivery',target:2}),env);assert.equal(session.calculation.targetValue,2);assert.equal(session.calculation.goodsSavings,null);
});
