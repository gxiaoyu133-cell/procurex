import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractQuoteItems,selectQuoteItem} from '../lib/item-matching.mjs';
import {parseQuantityTier} from '../lib/quotation-structure.mjs';

test('quantity tier syntax preserves explicit bounds instead of treating a range as one number',()=>{
 assert.deepEqual(parseQuantityTier('1,000–2,999'),{label:'1,000–2,999',min:1000,max:2999,quantity:null,applicable:null});
 assert.deepEqual(parseQuantityTier('3,000+'),{label:'3,000+',min:3000,max:null,quantity:null,applicable:null});
});

test('changing purchase quantity recalculates cached candidates and moves to the applicable tier',()=>{
 const text='Product\tQty Tier (pcs)\tUnit Price (SGD/pc)\tMOQ (pcs)\nHalloween foil balloon\t500-999\t0.32\t500\nHalloween foil balloon\t1000-1999\t0.24\t500\nHalloween foil balloon\t2000+\t0.18\t500';
 const quote={text,candidates:extractQuoteItems(text,{quantity:750})};
 const first=selectQuoteItem(quote,'Halloween foil balloon',undefined,750);
 assert.equal(first.values.price,'0.32');
 assert.equal(first.tier.quantity,750);
 const changed=selectQuoteItem(first,'Halloween foil balloon',undefined,1500);
 assert.equal(changed.values.price,'0.24');
 assert.equal(changed.tier.quantity,1500);
 assert.equal(changed.tier.applicable,true);
});

test('an explicit product choice is retained while quantity changes choose a new tier in that product group',()=>{
 const text='Product\tQty Tier\tUnit Price (SGD/pc)\nFoil balloon\t500-999\t0.32\nFoil balloon\t1000+\t0.24\nTable runner\t500-999\t0.80\nTable runner\t1000+\t0.70';
 const candidates=extractQuoteItems(text,{quantity:750});
 const runner=candidates.find(candidate=>candidate.values.item==='Table runner'&&candidate.tier.min===500);
 const selected=selectQuoteItem({text,candidates},'Table',runner.id,750);
 assert.equal(selected.values.price,'0.80');
 const changed=selectQuoteItem(selected,'Table',undefined,1500);
 assert.equal(changed.values.item,'Table runner');
 assert.equal(changed.values.price,'0.70');
 assert.equal(changed.match.manualProductKey,runner.productKey);
});
