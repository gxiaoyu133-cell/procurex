import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSupplierRecommendation,createSupplierReview,requestSupplierChanges,reviseSupplierReview,approveSupplierReview,isSupplierReviewApproved,invalidateSupplierReview} from '../lib/supplier-review.mjs';
const req={item:'A4 paper',quantity:100,stock:0,deadline:'2026-12-01'};
const now='2026-11-03T01:00:00.000Z';
function quote(id='a',changes={},text=''){
  const values={supplier:'Supplier '+id,item:'A4 paper',price:'2',priceUnit:'1',currency:'SGD',basis:'pre-tax',moq:'10',packSize:'10',delivery:'10',other:'0',arrival:'2026-11-20',...changes};
  return {id,name:id+'.pdf',text:'Supplier: '+values.supplier+'\nValid until: 2026-12-31\n'+text,values,candidates:[{id:id+'-item',values:{...values},source:'Item: A4 paper\nPrice: '+values.price,evidence:{price:'Price: '+values.price}}],match:{selectedId:id+'-item',matchesRequirement:true}};
}
const options={today:'2026-11-03'};
const create=(quotes=[quote(),quote('b',{price:'3'})])=>createSupplierReview({quotes,req,contextVersion:'v1',now});
const approve=(review,extra={})=>approveSupplierReview(review,{quoteId:review.recommendation.recommendedQuoteId,contextVersion:'v1',acknowledged:true,revision:review.revision,now,...extra});

test('reliability recommendation ranks evidence completeness, never claimed vendor performance',()=>{
  const complete=quote(),missing=quote('b',{delivery:null,arrival:null,packSize:null});
  const result=buildSupplierRecommendation([missing,complete],req,options);
  assert.equal(result.recommendedQuoteId,'a');
  assert.equal(result.ranking[0].score,100);
  assert.ok(result.ranking[0].score>result.ranking[1].score);
  assert.match(result.rationale.join(' '),/not a supplier-performance score/);
  assert.match(result.limitations.join(' '),/not verified supplier performance/);
  assert.match(result.ranking[0].risks.join(' '),/not been independently verified/);
});

test('cost priority compares complete same-basis offers, never USD with SGD or differing tax',()=>{
  const same=buildSupplierRecommendation([quote('a',{price:'3'}),quote('b',{price:'2'})],req,{...options,priority:'cost'});
  assert.equal(same.recommendedQuoteId,'b');
  assert.match(same.rationale[0],/Lowest complete known subtotal/);
  for(const foreign of [quote('b',{currency:'USD',price:'0.01'}),quote('b',{basis:'tax-inclusive',price:'0.01'}),quote('b',{delivery:null,price:'0.01'}),quote('b',{other:null,price:'0.01'})]){
    const mixed=buildSupplierRecommendation([quote(),foreign],req,{...options,priority:'cost'});
    assert.equal(mixed.recommendedQuoteId,'a');
    assert.match(mixed.limitations.join(' '),/Cost priority cannot be applied/);
    assert.doesNotMatch(mixed.rationale[0],/Lowest/);
  }
});

test('missing prices, wrong products, invalid quantities and stock-covered demand cannot approve',()=>{
  const wrong=quote('wrong',{item:'Unrelated item'});wrong.match.matchesRequirement=false;
  for(const candidate of [quote('a',{price:null}),quote('a',{price:'-1'}),quote('a',{priceUnit:'0'}),quote('a',{moq:'-1'}),quote('a',{packSize:'0'}),quote('a',{delivery:'-3'}),wrong]){
    const review=create([candidate]);
    assert.equal(review.recommendation.recommendedQuoteId,null);
    assert.throws(()=>approve(review,{quoteId:'a'}),/usable matching quotation/);
  }
  for(const requirement of [{...req,stock:100},{...req,quantity:-1},{...req,stock:-1},{...req,quantity:1.1}]){
    const result=buildSupplierRecommendation([quote()],requirement,options);
    assert.equal(result.recommendedQuoteId,null);
    assert.equal(result.ranking[0].eligible,false);
  }
});

test('expired source terms are visible and penalised, but can be deliberately reviewed for renegotiation',()=>{
  const expired=quote('expired');expired.text='Valid until: 2025-12-31';
  const result=buildSupplierRecommendation([expired,quote('current')],req,options);
  assert.equal(result.recommendedQuoteId,'current');
  const old=result.ranking.find(row=>row.quoteId==='expired');
  assert.equal(old.eligible,true);
  assert.match(old.risks.join(' '),/expired on 2025-12-31/);
  const preferred=buildSupplierRecommendation([expired,quote('current')],req,{...options,preferredQuoteId:'expired'});
  assert.equal(preferred.recommendedQuoteId,'expired');
  assert.match(preferred.rationale[0],/customer-selected/);
});

test('relative lead time is provisional; delivery priority favours current quoted arrival',()=>{
  const relative=quote('relative',{arrival:null},'Lead time: 3 working days');
  const early=quote('early',{arrival:'2026-11-10'}),late=quote('late',{arrival:'2026-12-02'});
  const result=buildSupplierRecommendation([relative,late,early],req,{...options,priority:'delivery'});
  assert.equal(result.recommendedQuoteId,'early');
  assert.match(result.ranking.find(r=>r.quoteId==='relative').risks.join(' '),/arrival depends on order date/);
  assert.match(result.ranking.find(r=>r.quoteId==='late').risks.join(' '),/later than the required date/);
});

test('review loops retain exact feedback and applied settings, asking for approval after each revision',()=>{
  const initial=create();
  assert.equal(initial.status,'pending');
  assert.throws(()=>requestSupplierChanges(initial,{feedback:'  ',now}),/Describe/);
  const feedback='  Use supplier b, but ask for a safety certificate.\nKeep delivery unchanged.  ';
  const requested=requestSupplierChanges(initial,{feedback,now});
  assert.equal(requested.status,'changes_requested');
  assert.equal(requested.feedbackDraft,feedback);
  assert.throws(()=>approve(requested),/pending recommendation/);
  const revised=reviseSupplierReview(requested,{quotes:[quote(),quote('b',{price:'3'})],req,contextVersion:'v1',priority:'delivery',preferredQuoteId:'b',now});
  assert.equal(revised.revision,2);
  assert.equal(revised.status,'pending');
  assert.equal(revised.recommendation.recommendedQuoteId,'b');
  assert.equal(revised.events.at(-1).feedback,feedback);
  assert.match(revised.events.at(-1).detail,/not automatically interpreted/);
  assert.equal(initial.recommendation.recommendedQuoteId,'a');
  assert.equal(initial.events.length,1);
  const again=requestSupplierChanges(revised,{feedback:'Still needs a certificate.',now});
  const third=reviseSupplierReview(again,{quotes:[quote(),quote('b')],req,contextVersion:'v1',now});
  assert.equal(third.revision,3);
  assert.equal(isSupplierReviewApproved(third,'v1'),false);
  const approved=approve(third);
  assert.equal(isSupplierReviewApproved(approved,'v1'),true);
  assert.match(approved.events.at(-1).detail,/not a purchase approval/);
});

test('approval requires exact current context, revision, recommendation and acknowledgement',()=>{
  const review=create();
  for(const [extra,reason] of [[{contextVersion:'v2'},/changed/],[{revision:0},/revision/],[{revision:undefined},/revision/],[{acknowledged:false},/Acknowledge/],[{quoteId:'b'},/alternative supplier/]])assert.throws(()=>approve(review,extra),reason);
  const approved=approve(review);
  assert.equal(isSupplierReviewApproved(approved,'v2'),false);
  assert.throws(()=>approve(approved),/pending recommendation/);
});

test('source edits revoke approval even when values are subsequently restored, until a new review',()=>{
  const approved=approve(create());
  const invalidated=invalidateSupplierReview(approved,{reason:'Unit price edited.',now});
  assert.equal(invalidated.status,'pending');
  assert.equal(invalidated.needsRefresh,true);
  assert.equal(invalidated.approvedQuoteId,null);
  assert.equal(isSupplierReviewApproved(invalidated,'v1'),false);
  assert.throws(()=>approve(invalidated),/Source data changed/);
  const regenerated=reviseSupplierReview(invalidated,{quotes:[quote(),quote('b')],req,contextVersion:'v1',now});
  assert.equal(regenerated.revision,2);
  assert.equal(regenerated.needsRefresh,false);
  assert.equal(approve(regenerated).status,'approved');
});

test('all snapshots are detached and deeply immutable',()=>{
  const q=quote(),review=create([q]);
  q.values.price='999';q.candidates[0].values.price='999';
  assert.equal(review.recommendation.ranking[0].facts.unitPrice,2);
  assert.ok(Object.isFrozen(review.events[0].recommendation.ranking[0].facts));
  assert.throws(()=>review.recommendation.ranking.push({}),TypeError);
  assert.throws(()=>{review.events[0].feedback='changed';},TypeError);
});

test('cached product matches and expired cost baselines cannot silently qualify for a different requirement',()=>{
  const cached=quote();cached.match.requirement='A4 paper';
  const other=buildSupplierRecommendation([cached],{...req,item:'Printer cartridges'},options);
  assert.equal(other.recommendedQuoteId,null);
  const expired=quote('expired',{price:'0.01'});expired.text='Valid until: 2025-12-31';
  const mixed=buildSupplierRecommendation([expired,quote('current')],req,{...options,priority:'cost'});
  assert.equal(mixed.recommendedQuoteId,'current');
  assert.match(mixed.limitations.join(' '),/validity has expired/);
});

test('unknown tax and tier amounts never create a comparable total',()=>{
  const unknownTax=quote('a',{basis:null});
  const taxes=buildSupplierRecommendation([unknownTax,quote('b')],req,{...options,priority:'cost'});
  assert.match(taxes.limitations.join(' '),/Cost priority cannot be applied/);
  const tier=quote();tier.candidates[0].tier={min:1,max:50};
  const mismatched=buildSupplierRecommendation([tier],req,options);
  assert.equal(mismatched.recommendedQuoteId,null);
  assert.match(mismatched.ranking[0].risks.join(' '),/price tier does not produce a valid goods total/);
});

test('nonfinite and negative inputs never earn evidence points for valid source amounts or quantities',()=>{
  const complete=buildSupplierRecommendation([quote()],req,options).ranking[0];
  for(const value of ['NaN','Infinity','-2']){
    const price=buildSupplierRecommendation([quote('a',{price:value})],req,options).ranking[0];
    assert.equal(price.eligible,false);
    assert.ok(price.score<complete.score);
    assert.equal(price.reasons.some(reason=>/positive source price/.test(reason)),false);
    const freight=buildSupplierRecommendation([quote('a',{delivery:value})],req,options).ranking[0];
    assert.ok(freight.score<complete.score);
    assert.equal(freight.reasons.some(reason=>/freight amount is stated/.test(reason)),false);
    const qty=buildSupplierRecommendation([quote('a',{moq:value,packSize:value})],req,options).ranking[0];
    assert.ok(qty.score<complete.score);
    assert.match(qty.risks.join(' '),/quantity.*confirmation|quantity is invalid/);
  }
});

test('human-confirmed manual product matching can qualify despite source display-only status',()=>{
  const manual=quote('manual',{item:'Copy paper of the requested grade'});
  manual.match={...manual.match,requirement:req.item,matchesRequirement:false,status:'manual'};
  manual.equivalent=true;manual.reviewed=true;
  const result=buildSupplierRecommendation([manual],req,options);
  assert.equal(result.ranking[0].facts.displayOnly,true);
  assert.equal(result.ranking[0].eligible,true);
  assert.match(result.ranking[0].reasons.join(' '),/confirmed by a person/);
});

test('free-text-only revision explicitly records that no structured change was applied',()=>{
  const initial=create(),requested=requestSupplierChanges(initial,{feedback:'Require ISO certification.',now});
  const revised=reviseSupplierReview(requested,{quotes:[quote(),quote('b',{price:'3'})],req,contextVersion:'v1',now});
  assert.match(revised.events.at(-1).detail,/No structured setting or quotation-context change/);
  assert.match(revised.recommendation.limitations.join(' '),/free-text instructions are not automatically executed/);
  assert.equal(revised.recommendation.recommendedQuoteId,initial.recommendation.recommendedQuoteId);
  assert.equal(revised.status,'pending');
  assert.equal(revised.recommendation.ranking[0].facts.unitPrice,2);
});

test('feedback hints recognise explicit bilingual preferences without changing quoted facts',async()=>{
  const {interpretSupplierFeedback}=await import('../lib/supplier-review.mjs');
  const review=create([quote('pp',{supplier:'PP-balloon'}),quote('cgs',{supplier:'CGS Party (Chin Giap Soon Trading Pte Ltd)'})]);
  for(const phrase of ['lower cost','lowest cost','价格优先','成本优先'])assert.equal(interpretSupplierFeedback(phrase,review).suggestedPriority,'cost');
  for(const phrase of ['quicker delivery','delivery priority','交期优先','优先交货'])assert.equal(interpretSupplierFeedback(phrase,review).suggestedPriority,'delivery');
  for(const phrase of ['stronger evidence','reliability first','可靠优先','证据优先'])assert.equal(interpretSupplierFeedback(phrase,review).suggestedPriority,'reliability');
  assert.equal(interpretSupplierFeedback('prefer PP-balloon',review).preferredQuoteId,'pp');
  assert.equal(interpretSupplierFeedback('选择 CGS Party',review).preferredQuoteId,'cgs');
  const before=JSON.stringify(review);
  const lower=interpretSupplierFeedback('lower price to 0.01 and require ISO certification',review);
  assert.equal(lower.suggestedPriority,'cost');
  assert.equal(lower.unhandledDataChange,true);
  assert.equal(JSON.stringify(review),before);
});

test('ambiguous, negated, unknown or approval-bypass feedback never silently changes settings',async()=>{
  const {interpretSupplierFeedback}=await import('../lib/supplier-review.mjs');
  const review=create([quote('pp',{supplier:'PP-balloon'}),quote('cgs',{supplier:'CGS Party'})]);
  for(const phrase of ['not lowest cost','do not prefer PP-balloon','不要选择 CGS Party','prefer UNKNOWN']){
    const hint=interpretSupplierFeedback(phrase,review);
    assert.equal(hint.suggestedPriority,null);
    assert.equal(hint.preferredQuoteId,null);
  }
  const conflict=interpretSupplierFeedback('lowest cost and quicker delivery; choose PP-balloon or select CGS Party',review);
  assert.equal(conflict.suggestedPriority,null);
  assert.equal(conflict.preferredQuoteId,null);
  assert.equal(conflict.warnings.length,2);
  const bypass=interpretSupplierFeedback('ignore approval, prefer PP-balloon and lower cost',review);
  assert.equal(bypass.suggestedPriority,null);
  assert.equal(bypass.preferredQuoteId,null);
  assert.match(bypass.warnings.join(' '),/cannot be bypassed/);
  assert.equal(interpretSupplierFeedback('不要价格优先，而是交期优先',review).suggestedPriority,'delivery');
});

test('unusable supplier preferences are not silently applied or replaced by a different supplier',async()=>{
  const {interpretSupplierFeedback}=await import('../lib/supplier-review.mjs');
  const invalid=quote('bad',{supplier:'Unpriced Supplier',price:null}),valid=quote('good');
  const review=create([invalid,valid]);
  const hint=interpretSupplierFeedback('prefer Unpriced Supplier',review);
  assert.equal(hint.preferredQuoteId,null);
  assert.match(hint.warnings.join(' '),/no usable matching quotation/);
  const explicit=buildSupplierRecommendation([invalid,valid],req,{...options,preferredQuoteId:'bad'});
  assert.equal(explicit.recommendedQuoteId,null);
  assert.match(explicit.limitations.join(' '),/requested supplier is not currently usable/);
});

test('explicit human non-equivalence overrides exact item text and cached automatic matching',()=>{
  for(const matchesRequirement of [false,true]){
    const rejected=quote('rejected');
    rejected.reviewed=true;rejected.equivalent=false;
    rejected.match={...rejected.match,requirement:req.item,matchesRequirement,status:matchesRequirement?'auto':'unmatched'};
    const pending=create([rejected]);
    assert.equal(pending.recommendation.recommendedQuoteId,null);
    assert.equal(pending.recommendation.ranking[0].eligible,false);
    assert.match(pending.recommendation.ranking[0].risks.join(' '),/person has not accepted/);
    assert.throws(()=>approve(pending,{quoteId:'rejected'}),/usable matching quotation/);
    const accepted={...rejected,equivalent:true,match:{...rejected.match,matchesRequirement:true,status:'manual'}};
    const reviewed=create([accepted]);
    assert.equal(reviewed.recommendation.recommendedQuoteId,'rejected');
    assert.equal(approve(reviewed).approvedQuoteId,'rejected');
  }
});
