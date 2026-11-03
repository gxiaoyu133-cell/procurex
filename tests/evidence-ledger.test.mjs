import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEvidenceBenchmark,createSupplierEvidence,emptyEvidenceLedger,exportEvidenceCSV,exportEvidenceJSON,finishEvidencePhase,readEvidenceLedger,saveEvidenceLedger,scoreEvidenceAnswers,startAssistedEvidencePhase,startEvidenceTrial,summariseEvidence,validateEvidenceTrial,validateSupplierEvidence} from '../lib/evidence-ledger.mjs';

// Synthetic fixtures stay in tests. The product never inserts trial or order samples.
const now='2026-11-03T02:00:00.000Z';
const req={item:'A4 paper',quantity:100,stock:0};
function quote(extra={}){
 const values={supplier:'Test supplier',item:'A4 paper',price:'2',priceUnit:'1',currency:'SGD',basis:'pre-tax',moq:'10',packSize:'10',delivery:'10',other:'0',arrival:'2026-11-20',...extra};
 const text='Supplier: Test supplier\nItem: A4 paper\nUnit price: SGD 2\nDelivery charge: SGD 10\nMOQ: 10\nTax excluded';
 return {id:'test-quote',name:'fixture.txt',text,values,candidates:[{id:'test-item',values,source:text,evidence:{price:'Unit price: SGD 2',delivery:'Delivery charge: SGD 10'}}],match:{selectedId:'test-item',matchesRequirement:true}};
}
const benchmark=()=>buildEvidenceBenchmark([quote()],req);
const answers=()=>({unitPrice:'2',currency:'sgd',deliveryStatus:'stated'});
function pairedTrial({role='sme_buyer',synthetic=false,manualAnswers=answers(),assistedAnswers=answers()}={}){
 let trial=startEvidenceTrial({participantAlias:'Test participant',participantRole:role,consent:true,synthetic,benchmark:benchmark(),now:'2026-11-03T01:00:00.000Z'});
 trial=finishEvidencePhase(trial,{answers:manualAnswers,now:'2026-11-03T01:01:00.000Z'});
 trial=startAssistedEvidencePhase(trial,'2026-11-03T01:02:00.000Z');
 return finishEvidencePhase(trial,{answers:assistedAnswers,now:'2026-11-03T01:02:30.000Z'});
}
const orderInput=(extra={})=>({supplierId:'test-quote',supplier:'Test supplier',orderRef:'TEST-001',promisedDate:'2026-10-20',actualDate:'2026-10-19',orderedUnits:'100',deliveredUnits:'100',rejectedUnits:'2',sourceReference:'TEST fixture delivery note and inspection record',attestedBy:'Test reviewer',provenance:'documented',verified:true,verificationNote:'TEST fixture dates and quantities checked',synthetic:false,...extra});
const order=(extra={})=>createSupplierEvidence(orderInput(extra),now);

test('empty ledger has no outcome evidence or reliability rates',()=>{
 const summary=summariseEvidence(emptyEvidenceLedger(),now);
 assert.equal(summary.trialCount,0);assert.equal(summary.comparableTrialCount,0);assert.equal(summary.averages,null);assert.deepEqual(summary.suppliers,[]);
 assert.match(summary.limitations.join(' '),/do not establish causal/);
});
test('benchmark uses extracted source facts and preserves currency, conditions and provenance',()=>{
 const task=benchmark();assert.equal(task.unitPrice,2);assert.equal(task.currency,'SGD');assert.equal(task.deliveryStatus,'stated');assert.equal(task.sourceName,'fixture.txt');assert.match(task.sourceText,/Delivery charge/);assert.match(task.answerKeyBasis,/source review/);
 const textOnly=quote({delivery:null});textOnly.text+='\nDelivery: unknown';assert.equal(buildEvidenceBenchmark([textOnly],req).deliveryStatus,'unpriced');
 const conditional=quote({delivery:null});conditional.text+='\nFree delivery for orders above SGD 150';assert.equal(buildEvidenceBenchmark([conditional],req).deliveryStatus,'conditional');
 assert.equal(buildEvidenceBenchmark([quote({price:null})],req),null);assert.equal(buildEvidenceBenchmark([{...quote(),text:''}],req),null);
 assert.notEqual(task.id,buildEvidenceBenchmark([quote({price:'3'})],req).id);
});
test('trial requires participant role, consent and usable source evidence',()=>{
 const base={participantAlias:'Test user',participantRole:'sme_buyer',consent:true,benchmark:benchmark(),now};
 for(const patch of [{participantAlias:'  '},{participantRole:'unknown'},{consent:false},{benchmark:null},{now:'invalid'}])assert.throws(()=>startEvidenceTrial({...base,...patch}));
 const trial=startEvidenceTrial(base);base.benchmark.expected.unitPrice=999;assert.equal(trial.benchmark.expected.unitPrice,2);
});
test('trial state machine requires both phases, complete answers and ordered timestamps',()=>{
 let trial=startEvidenceTrial({participantAlias:'Test user',participantRole:'team_member',consent:true,benchmark:benchmark(),now:'2026-11-03T01:00:00.000Z'});
 assert.throws(()=>startAssistedEvidencePhase(trial,now),/manual task first/);
 assert.throws(()=>finishEvidencePhase(trial,{answers:{},now}),/all three/);
 assert.throws(()=>finishEvidencePhase(trial,{answers:answers(),now:trial.manual.startedAt}),/follow the start/);
 trial=finishEvidencePhase(trial,{answers:answers(),now:'2026-11-03T01:01:00.000Z'});assert.equal(trial.status,'manual_complete');assert.equal(trial.manual.durationMs,60000);
 assert.throws(()=>finishEvidencePhase(trial,{answers:answers(),now}),/Start a task/);
 assert.throws(()=>startAssistedEvidencePhase(trial,'2026-11-03T00:00:00.000Z'),/cannot start before/);
 assert.equal(validateEvidenceTrial(trial,now).valid,false);
});
test('scoring requires explicit values and reports incorrect complete answers',()=>{
 assert.equal(scoreEvidenceAnswers(benchmark(),answers()).count,3);
 assert.equal(scoreEvidenceAnswers(benchmark(),{unitPrice:'2',currency:'USD',deliveryStatus:'unpriced'}).count,1);
 for(const unitPrice of ['',null,undefined,0,-1,'no price'])assert.equal(scoreEvidenceAnswers(benchmark(),{...answers(),unitPrice}).complete,false);
 assert.equal(scoreEvidenceAnswers(benchmark(),{...answers(),currency:'$',deliveryStatus:'invented'}).complete,false);
});
test('paired measurement reports individual timings and counts only equally accurate pairs for average',()=>{
 const right=pairedTrial(),wrong=pairedTrial({manualAnswers:{...answers(),unitPrice:'9'}});
 const summary=summariseEvidence({...emptyEvidenceLedger(),trials:[right,wrong]},now);
 assert.equal(summary.trialCount,2);assert.equal(summary.smeBuyerTrials,2);assert.equal(summary.comparableTrialCount,1);assert.deepEqual(summary.averages,{manualMs:60000,assistedMs:30000,timeDifferencePercent:50});
 assert.equal(summary.trials[1].valid,true);assert.equal(summary.trials[1].comparable,false);
});
test('synthetic trials are excluded and internal participants are labelled separately',()=>{
 const summary=summariseEvidence({...emptyEvidenceLedger(),trials:[pairedTrial({synthetic:true}),pairedTrial({role:'team_member'})]},now);
 assert.equal(summary.trialCount,1);assert.equal(summary.smeBuyerTrials,0);assert.equal(summary.internalTrials,1);assert.equal(summary.excludedTrialCount,1);assert.equal(summary.comparableTrialCount,1);
});
test('tampered durations, future records and overlapping phases do not qualify',()=>{
 const trial=pairedTrial();
 assert.equal(validateEvidenceTrial(trial,'2026-11-03T00:00:00.000Z').valid,false);
 assert.equal(validateEvidenceTrial({...trial,manual:{...trial.manual,durationMs:1}},now).valid,false);
 const overlap={...trial,assisted:{...trial.assisted,startedAt:'2026-11-03T01:00:30.000Z',durationMs:120000}};assert.equal(validateEvidenceTrial(overlap,now).valid,false);
 assert.equal(validateEvidenceTrial({...trial,createdAt:'2026-10-01T00:00:00.000Z'},now).valid,false);
 assert.equal(validateEvidenceTrial({...trial,consent:false},now).valid,false);
});
test('completed-order evidence requires real date-shaped values and explicit whole unit counts',()=>{
 for(const patch of [{supplier:''},{orderRef:''},{attestedBy:''},{sourceReference:''},{promisedDate:''},{actualDate:'2026-02-30'},{actualDate:'2026-99-99'},{actualDate:'2026-11-04'},{orderedUnits:0},{orderedUnits:2.5},{deliveredUnits:''},{rejectedUnits:''},{deliveredUnits:101},{deliveredUnits:-1},{rejectedUnits:101},{rejectedUnits:-1},{provenance:'unknown'}])assert.throws(()=>order(patch),JSON.stringify(patch));
 assert.equal(validateSupplierEvidence(order(),now).eligible,true);
});
test('early completed delivery may precede a future promised deadline',()=>{
 const early=order({actualDate:'2026-11-03',promisedDate:'2026-11-06'});assert.equal(validateSupplierEvidence(early,now).eligible,true);
 assert.equal(summariseEvidence({...emptyEvidenceLedger(),orders:[early]},now).suppliers[0].onTimeRate,1);
});
test('self-reported, unchecked and synthetic records cannot establish supplier performance',()=>{
 const self=order({provenance:'self_reported',verified:false}),unchecked=order({orderRef:'TEST-002',verified:false}),synthetic=order({orderRef:'TEST-003',synthetic:true});
 assert.throws(()=>order({provenance:'self_reported',verified:true}),/document-linked/);
 assert.throws(()=>order({verificationNote:''}),/documents checked/);
 const summary=summariseEvidence({...emptyEvidenceLedger(),orders:[self,unchecked,synthetic]},now),supplier=summary.suppliers[0];
 assert.equal(supplier.records,3);assert.equal(supplier.eligibleOrders,0);assert.equal(supplier.canSupportRecordedPerformance,false);assert.equal(supplier.onTimeRate,null);assert.equal(supplier.acceptedUnitRate,null);
});
test('supplier rates use explicit order and unit denominators; late and partial deliveries count correctly',()=>{
 const first=order(),second=order({orderRef:'TEST-002',actualDate:'2026-10-22',orderedUnits:100,deliveredUnits:80,rejectedUnits:8});
 const supplier=summariseEvidence({...emptyEvidenceLedger(),orders:[first,second]},now).suppliers[0];
 assert.equal(supplier.eligibleOrders,2);assert.equal(supplier.onTimeOrders,1);assert.equal(supplier.onTimeRate,.5);assert.equal(supplier.acceptedUnits,170);assert.equal(supplier.deliveredUnits,180);assert.equal(supplier.acceptedUnitRate,170/180);assert.equal(supplier.fulfilmentRate,.9);assert.match(supplier.provenance,/not independently audited/);
});
test('zero delivery yields no acceptance rate and cannot be on-time success',()=>{
 const supplier=summariseEvidence({...emptyEvidenceLedger(),orders:[order({deliveredUnits:0,rejectedUnits:0})]},now).suppliers[0];
 assert.equal(supplier.onTimeOrders,0);assert.equal(supplier.onTimeRate,0);assert.equal(supplier.acceptedUnitRate,null);assert.equal(supplier.fulfilmentRate,0);
});
test('duplicate supplier/order records are excluded rather than doubling performance',()=>{
 const summary=summariseEvidence({...emptyEvidenceLedger(),orders:[order(),order({supplier:'TEST SUPPLIER',orderRef:'test-001'})]},now);
 assert.equal(summary.suppliers.length,1);assert.equal(summary.suppliers[0].eligibleOrders,0);assert.match(summary.orders[0].errors.join(' '),/Duplicate/);
});
test('exports retain provenance, consent, answer snapshots and exclude formula execution in CSV',()=>{
 const ledger={...emptyEvidenceLedger(),trials:[pairedTrial()],orders:[order({supplier:'=FORMULA()',sourceReference:'@unsafe reference'})]};
 const json=JSON.parse(exportEvidenceJSON(ledger,now));assert.equal(json.ledger.trials[0].consent,true);assert.equal(json.ledger.trials[0].benchmark.expected.unitPrice,2);assert.equal(json.exportedAt,now);assert.match(json.storage,/local entries can be edited/);
 const csv=exportEvidenceCSV(ledger,now);assert.match(csv,/'=FORMULA\(\)/);assert.match(csv,/'@unsafe reference/);assert.match(csv,/manual_seconds/);assert.match(csv,/TEST fixture dates and quantities checked/);
});
test('storage handles absence, corruption, denied writes and unfinished task persistence',()=>{
 const map=new Map(),storage={getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value)};
 assert.deepEqual(readEvidenceLedger(storage).ledger,emptyEvidenceLedger());
 const ledger={...emptyEvidenceLedger(),trials:[pairedTrial()]};assert.equal(saveEvidenceLedger(storage,ledger),null);assert.deepEqual(readEvidenceLedger(storage).ledger,ledger);
 const denied={getItem(){throw new Error();},setItem(){throw new Error();}};assert.match(readEvidenceLedger(denied).error,/could not be loaded/);assert.match(saveEvidenceLedger(denied,ledger),/could not be saved/);
 for(const raw of ['broken',JSON.stringify({version:1,trials:[null],orders:[]}),JSON.stringify({version:1,trials:[],orders:[],activeTrial:{status:'fake'}})])assert.ok(readEvidenceLedger({getItem:()=>raw}).error);
 const draft=startEvidenceTrial({participantAlias:'Test user',participantRole:'team_member',consent:true,benchmark:benchmark(),now});assert.equal(saveEvidenceLedger(storage,{...ledger,activeTrial:draft}),null);assert.equal(readEvidenceLedger(storage).ledger.activeTrial.status,'manual_running');
});
