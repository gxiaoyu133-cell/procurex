import test from 'node:test';
import assert from 'node:assert/strict';
import {quotationForAgent,reviewForAgent} from '../lib/agent-payload.mjs';
import {extractQuoteItems,selectQuoteItem} from '../lib/item-matching.mjs';
import {getQuotationFacts} from '../lib/quotation-facts.mjs';
import {demoQuotes} from '../lib/engine.mjs';
test('AI payload preserves selected quotation facts while removing unselected candidates',()=>{
 const q=demoQuotes()[0];const parsed=selectQuoteItem({...q,candidates:extractQuoteItems(q.text,{quantity:1000})},'A4 copy paper 80gsm, ream of 500 sheets',undefined,1000);
 const compact=quotationForAgent(parsed);
 assert.deepEqual(getQuotationFacts(compact,1000).selected,getQuotationFacts(parsed,1000).selected);
 assert.equal(compact.text,parsed.text);assert.ok(compact.candidates.length<=1);
});
test('AI request avoids duplicating review audit snapshots and stays within the three-source limit',()=>{
 const reviewed={status:'approved',approvedQuoteId:0,contextVersion:'test',revision:2,needsRefresh:false,events:Array.from({length:20},()=>({source:'duplicate'.repeat(2000)}))};
 const compact=reviewForAgent(reviewed);
 assert.equal(compact.status,'approved');assert.equal(compact.revision,2);assert.equal(compact.events,undefined);
 assert.ok(JSON.stringify({quotes:demoQuotes().map(quotationForAgent),review:compact}).length<100000);
});
