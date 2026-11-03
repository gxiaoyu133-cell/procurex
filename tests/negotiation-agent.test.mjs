import test from 'node:test';
import assert from 'node:assert/strict';
import {createNegotiationSession,advanceNegotiation} from '../lib/negotiation-agent.mjs';
import {extractQuoteItems,selectQuoteItem} from '../lib/item-matching.mjs';

const req={item:'18 inch Halloween foil balloon',quantity:1000,stock:0,deadline:'2026-12-01'};
const now='2026-11-03T01:00:00.000Z';
function quotation(id='vendor-a',price='0.12',currency='SGD',basis='pre-tax',item=req.item) {
  const text=`Supplier: ${id}\nItem: ${item}\nCurrency: ${currency}\nCost basis: ${basis}\nPrice: ${currency} ${price} per piece\nUnits per quoted price: 1\nMOQ: 1000\nOrder pack multiple: 100\nDelivery charge: 95\nOther charges: 0\nLead time: 5-7 working days`;
  return selectQuoteItem({id,name:id+'.txt',text,candidates:extractQuoteItems(text,{quantity:1000})},req.item,undefined,1000);
}
function session(options={}) { const quote=quotation(); return createNegotiationSession({id:'session-a',quote,quotes:[quote],req,goal:'price',now,contextVersion:'context-one',...options}); }

test('price proposal uses source unit price and pauses before supplier acceptance',()=>{
  const state=session();
  assert.equal(state.context.baseline.unitPrice,0.12);
  assert.equal(state.pendingOffer.after,0.108);
  assert.equal(state.pendingOffer.improvementPercent,10);
  assert.equal(state.pendingOffer.goodsSavings,12);
  assert.equal(state.status,'awaiting_approval');
  assert.equal(state.outcome,null);
  assert.equal(state.events.at(-1).label,'Customer approval required');
  assert.ok(state.events.filter(e=>e.role==='vendor').every(e=>e.simulation && e.source==='Simulated supplier'));
  assert.equal(state.events.some(e=>e.label==='Simulated supplier confirmation'),false);
});

test('customer approval precedes agent continuation and vendor confirmation; double or stale approval cannot proceed',()=>{
  const initial=session();
  assert.equal(advanceNegotiation(initial,{type:'approve',offerId:'obsolete',now}),initial);
  assert.equal(advanceNegotiation(initial,{type:'approve',currentContextVersion:'changed-quote',now}),initial);
  const completed=advanceNegotiation(initial,{type:'approve',offerId:initial.pendingOffer.id,currentContextVersion:'context-one',now});
  assert.equal(completed.status,'completed');
  assert.equal(completed.pendingOffer,null);
  assert.equal(completed.outcome.after,0.108);
  assert.deepEqual(completed.events.slice(-4).map(e=>e.role),['customer','agent','vendor','system']);
  assert.equal(advanceNegotiation(completed,{type:'approve',now}),completed);
  assert.equal(initial.status,'awaiting_approval');
  assert.equal(initial.events.length,6);
});

test('counteroffer asks again for approval and rejected sessions never record agreement',()=>{
  const initial=session();
  const counter=advanceNegotiation(initial,{type:'counter',offerId:initial.pendingOffer.id,note:'Please preserve the same material.',now});
  assert.equal(counter.status,'awaiting_approval');
  assert.equal(counter.pendingOffer.after,0.1056);
  assert.notEqual(counter.pendingOffer.id,initial.pendingOffer.id);
  assert.equal(counter.outcome,null);
  assert.match(counter.events.map(e=>e.text).join('\n'),/same material/);
  assert.equal(advanceNegotiation(counter,{type:'approve',offerId:initial.pendingOffer.id,now}),counter);
  const stopped=advanceNegotiation(counter,{type:'reject',now});
  assert.equal(stopped.status,'stopped');
  assert.equal(stopped.outcome,null);
  assert.equal(stopped.lastOffer.id,counter.pendingOffer.id);
  assert.equal(stopped.lastOffer.after,0.1056);
  assert.equal(stopped.events.some(e=>e.label==='Simulated supplier confirmation'),false);
});

test('benchmark excludes other products, currencies and tax bases; industry reference is explicitly synthetic',()=>{
  const quote=quotation();
  const state=session({quote,quotes:[quote,quotation('peer',0.11),quotation('usd',0.01,'USD'),quotation('taxed',0.02,'SGD','tax-inclusive'),quotation('wrong-item',0.03,'SGD','pre-tax','A4 copy paper')]});
  assert.equal(state.context.vendorBenchmark.supplier,'peer');
  assert.equal(state.context.vendorBenchmark.unitPrice,0.11);
  assert.equal(state.context.industryBenchmark.kind,'assumption');
  assert.equal(state.context.industryBenchmark.unitPrice,0.114);
  assert.match(state.context.industryBenchmark.detail,/not an observed market price/);
  assert.ok(state.context.assumptions.some(a=>a.id==='industry-reference'));
});

test('MOQ proposal preserves pack multiples and states when the original tier needs a simulated concession',()=>{
  const state=session({goal:'moq',target:750,req:{...req,quantity:650}});
  assert.equal(state.pendingOffer.before,1000);
  assert.equal(state.pendingOffer.after,750);
  assert.equal(state.pendingOffer.orderQuantity,800);
  assert.equal(state.pendingOffer.goodsSavings,null);
  assert.match(state.pendingOffer.conditions.join(' '),/pack multiple remains 100/);
  assert.match(state.pendingOffer.conditions.join(' '),/supplier confirmation is simulated/);
});

test('delivery keeps working-day units and clearly identifies missing-data assumptions',()=>{
  const state=session({goal:'delivery'});
  assert.equal(state.context.baseline.deliveryDays,7);
  assert.equal(state.context.baseline.deliveryUnit,'working days');
  assert.equal(state.target,5);
  assert.equal(state.pendingOffer.after,5);
  const minimal={id:'minimal',name:'partial.pdf',text:'Supplier: Minimal\nItem: balloon',values:{supplier:'Minimal',item:'balloon',price:'2',priceUnit:'1',currency:'USD',basis:'pre-tax'}};
  const assumed=session({quote:minimal,quotes:[minimal],goal:'delivery'});
  assert.equal(assumed.context.baseline.deliveryDaysAssumed,true);
  assert.equal(assumed.context.baseline.deliveryDays,7);
  assert.ok(assumed.context.assumptions.some(a=>a.id==='lead-time'));
  assert.ok(assumed.context.assumptions.some(a=>a.id==='pack'));
});

test('snapshots are immutable and suppliers never share pending offers or decisions',()=>{
  const quote=quotation();
  const state=session({quote});
  quote.values.price='999';
  assert.equal(state.context.quotation.unitPrice,0.12);
  assert.ok(Object.isFrozen(state));
  assert.ok(Object.isFrozen(state.context.quotation));
  assert.throws(()=>state.events.push({}),TypeError);
  const second=session({id:'session-b',quote:quotation('vendor-b',0.2)});
  assert.equal(advanceNegotiation(second,{type:'approve',offerId:state.pendingOffer.id,now}),second);
  const completed=advanceNegotiation(state,{type:'approve',now});
  assert.equal(second.status,'awaiting_approval');
  assert.equal(completed.supplier,'vendor-a');
});

test('fractional unit prices retain precision and only goods savings are computed',()=>{
  const state=session({quote:quotation('vendor-usd',0.075,'USD'),target:10});
  assert.equal(state.pendingOffer.after,0.0675);
  assert.equal(state.pendingOffer.goodsSavings,7.5);
  assert.equal(state.pendingOffer.currency,'USD');
  assert.throws(()=>session({target:100}),/less than 100/);
  assert.throws(()=>session({goal:'moq',target:1000}),/lower than/);
  assert.throws(()=>session({goal:'delivery',target:0}),/positive whole/);
});

test('expired source validity, original caveats and customer notes remain visible throughout the discussion',()=>{
  const quote=quotation();
  quote.text+='\nValid until: 2025-12-31';
  const state=session({quote,notes:'Keep all four balloon designs.'});
  assert.equal(state.context.quotation.expiryDate,'2025-12-31');
  assert.ok(state.context.assumptions.some(a=>a.id==='quote-validity' && /expired/.test(a.detail)));
  assert.match(state.pendingOffer.conditions.join(' '),/expired.*refreshed supplier quotation/);
  assert.match(state.events.find(e=>e.label==='Opening request').text,/Keep all four balloon designs/);
  const approved=advanceNegotiation(state,{type:'approve',note:'Please retain the printed packaging.',now});
  const continuation=approved.events.find(e=>e.label==='Continue after customer approval').text;
  assert.match(continuation,/Keep all four balloon designs/);
  assert.match(continuation,/retain the printed packaging/);
  assert.equal(approved.outcome.conditions.includes(state.pendingOffer.conditions.at(-1)),true);
});

test('tax-inclusive savings retain the original tax basis and an explicit zero MOQ is not replaced by an assumption',()=>{
  const taxed=session({quote:quotation('taxed',0.18,'SGD','tax-inclusive')});
  assert.equal(taxed.pendingOffer.goodsSavings,18);
  assert.match(taxed.pendingOffer.conditions.join(' '),/original quoted tax basis/);
  const quote=quotation();
  quote.values.moq=0;
  const noMinimum=session({quote});
  assert.equal(noMinimum.context.baseline.moq,0);
  assert.equal(noMinimum.context.baseline.moqAssumed,false);
  assert.throws(()=>session({quote,goal:'moq'}),/lower than/);
});

test('an explicit order lot is respected when the parser omitted pack size, while packaging alone is not an order rule',()=>{
  const quote=quotation();
  quote.values.packSize=null;
  quote.candidates.forEach(candidate=>{candidate.values.packSize=null;delete candidate.evidence.packSize;});
  quote.text=quote.text.replace('Order pack multiple: 100','Packing: 100 pcs/bag, 1000 pcs/carton')+'\nMOQ: 1,000 pcs (1 lot = 1,000 pcs)';
  const state=session({quote,goal:'moq',target:800,req:{...req,quantity:600}});
  assert.equal(state.context.baseline.packSize,1000);
  assert.equal(state.context.baseline.packSizeAssumed,false);
  assert.equal(state.pendingOffer.orderQuantity,1000);
  assert.ok(state.context.evidence.some(row=>row.label==='Explicit order lot' && row.detail==='1 lot = 1,000 pcs'));
  assert.equal(state.context.assumptions.some(row=>row.id==='pack'),false);
  const packagingOnly={...quote,text:quote.text.replace(' (1 lot = 1,000 pcs)','')};
  const assumed=session({quote:packagingOnly,goal:'moq',target:800});
  assert.equal(assumed.context.baseline.packSize,1);
  assert.equal(assumed.context.baseline.packSizeAssumed,true);
});

test('approval notes reach the simulated supplier but additional unparsed conditions are not accepted',()=>{
  const state=session({notes:'Maintain four designs.'});
  const completed=advanceNegotiation(state,{type:'approve',note:'Only if free express delivery is added.',now});
  const continuation=completed.events.find(event=>event.label==='Continue after customer approval');
  assert.match(continuation.text,/Only if free express delivery is added/);
  const confirmation=completed.events.find(event=>event.label==='Simulated supplier confirmation');
  assert.match(confirmation.text,/no agreement to additional conditions/);
  assert.deepEqual(completed.outcome.unresolvedNotes,[{source:'initial',text:'Maintain four designs.'},{source:'approval',text:'Only if free express delivery is added.'}]);
  assert.match(completed.outcome.conditions.at(-1),/additional terms remain unconfirmed/);
});
