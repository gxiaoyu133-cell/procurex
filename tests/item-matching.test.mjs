import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractQuoteItems, selectQuoteItem, itemMatches} from '../lib/item-matching.mjs';
import {comparePreview} from '../lib/comparison-preview.mjs';
import {compare} from '../lib/engine.mjs';

const header='Supplier: Acme Office\nCurrency: SGD\nCost basis: pre-tax\nDelivery charge: 80\nOther charges: 0\nArrival date: 2026-11-09\nUnits per quoted price: 1\nOrder pack multiple: 10\nMinimum order: 100\n';
const text=header+'Item,Price\nA4 copy paper 70gsm,5\nA4 copy paper 80gsm,9.5\nA3 copy paper 80gsm,12';
const req={item:'A4 paper 80 gsm',quantity:1000,stock:0,deadline:'2026-11-10'};
const quote=(source=text,item=req.item)=>selectQuoteItem({id:0,text:source,candidates:extractQuoteItems(source)},item);

test('matching keeps the correct middle-row price and shared terms, never the first or cheapest',()=>{
 const q=quote();assert.equal(q.candidates.length,3);assert.equal(q.values.price,'9.5');assert.equal(q.values.item,'A4 copy paper 80gsm');assert.equal(q.values.delivery,'80');assert.equal(q.match.filtered,2);assert.equal(q.reviewed,false);assert.match(q.match.source,/80gsm,9.5/);assert.equal(comparePreview([q],req).winner.total,9580);assert.equal(compare([q],req).winner,null);
});
test('ambiguous item rows never select the cheapest; explicit selection resolves the price',()=>{
 const q=quote(text,'A4 paper');assert.equal(q.match.status,'ambiguous');assert.equal(q.values.price,null);assert.equal(q.match.matches,2);const selected=selectQuoteItem(q,'A4 paper','row-1');assert.equal(selected.values.price,'9.5');assert.equal(selected.match.status,'selected');assert.equal(comparePreview([q],{...req,item:'A4 paper'}).winner,null);
});
test('no requirement or no match clears unrelated prices and stale approvals',()=>{
 assert.equal(quote(text,'').match.status,'waiting');assert.equal(quote(text,'A5 paper').values.price,null);const before={...quote(),reviewed:true,equivalent:true};const after=selectQuoteItem(before,'A3 paper 80gsm');assert.equal(after.values.price,'12');assert.equal(after.reviewed,false);assert.equal(after.equivalent,false);assert.equal(comparePreview([after],req).winner,null);
});
test('repeated labelled email blocks keep per-item prices and do not blend item terms',()=>{
 const source=header+'Item: A4 copy paper 80gsm\nPrice: S$9.50 per ream\nDelivery charge: unknown\n\nItem: A3 copy paper 80gsm\nPrice: S$12 per ream\nDelivery charge: 200';const q=quote(source);assert.equal(q.values.price,'9.50');assert.equal(q.values.delivery,null);assert.equal(q.match.location,'Item 1');assert.equal(comparePreview([q],req).winner,null);
});
test('TSV description and specification columns are combined, with row-level unknown preserved',()=>{
 const source=header+'Product\tSpecification\tPrice\tDelivery charge\nA4 paper\t70gsm\t5\t0\nA4 paper\t80gsm\t9.5\tunknown';const q=quote(source);assert.equal(q.values.item,'A4 paper 80gsm');assert.equal(q.values.delivery,null);assert.equal(q.values.price,'9.5');
});
test('Chinese labels and full-width punctuation support deterministic same-language matching',()=>{
 const source='供应商：测试办公用品\n币种：SGD\n计价基础：未税\n商品,规格,单价\nA4复印纸,70gsm,5\nA4复印纸,80gsm,9.5';const q=quote(source,'A4复印纸 80gsm');assert.equal(q.values.supplier,'测试办公用品');assert.equal(q.values.price,'9.5');assert.equal(q.values.basis,'pre-tax');
});
test('numeric attributes and product identities never use approximate substring matches',()=>{
 assert.equal(itemMatches('A4 paper 80gsm','A4 paper 180gsm'),false);assert.equal(itemMatches('M10 bolt','M100 bolt'),false);assert.equal(itemMatches('A4 paper 80gsm','A3 paper 80gsm'),false);assert.equal(itemMatches('A4 paper 80gsm','Copy paper A4 80 gsm'),true);
});
test('manual selection of a mismatched row requires specification review before ranking',()=>{
 const q=selectQuoteItem(quote(),req.item,'row-0');assert.equal(q.match.status,'manual');assert.equal(q.values.price,'5');assert.equal(comparePreview([q],req).winner,null);q.reviewed=true;q.equivalent=true;assert.equal(compare([q],req).winner.total,5080);
});

test('short spreadsheet rows retain the item price while missing trailing terms remain unknown',()=>{const q=quote('Supplier: Acme\nItem\tPrice\tArrival date\nA4 paper 80gsm\t9.5');assert.equal(q.values.price,'9.5');assert.equal(q.values.arrival,null)});

test('unsupported free-text multi-price layouts cannot leak the last price into a matched item',()=>{const q=quote('A4 copy paper 80gsm\nS$9.50 per ream\nAnother offer\nS$3.50 per ream');assert.equal(q.values.price,null);assert.equal(comparePreview([q],req).winner,null)});
test('extra product attributes do not silently resolve multiple matching rows',()=>{const q=quote(header+'Item,Price\nA4 paper,5\nPremium A4 paper,8','A4 paper');assert.equal(q.match.status,'ambiguous');assert.equal(q.values.price,null)});

test('inch spellings and the bounded Chinese product vocabulary retain exact size and material checks',()=>{
 for(const item of ['18-inch Halloween foil balloons','Halloween foil balloon 18 inches','Halloween foil balloons 18\"','18英寸万圣节铝膜气球']){
  assert.equal(itemMatches('18 inch Halloween foil balloon',item),true,item);
 }
 assert.equal(itemMatches('18英寸万圣节铝膜气球','18-inch Halloween foil balloons'),true);
 assert.equal(itemMatches('18 inch Halloween foil balloon','118-inch Halloween foil balloons'),false);
 assert.equal(itemMatches('18 inch Halloween foil balloon','18-inch Halloween latex balloons'),false);
});

test('MOQ raises a net999 requirement to the quoted1000 tier without borrowing a lower or higher break',()=>{
 const text='Supplier: Example\nProduct: 18-inch Halloween foil balloons\nMOQ: 1,000 pcs\nQuantity Tier\tUnit Price (USD/pc)\n1,000 pcs\t0.08\n3,000 pcs\t0.075\n5,000 pcs\t0.07';
 const q=selectQuoteItem({text,candidates:extractQuoteItems(text)},'18 inch Halloween foil balloon',undefined,999);
 assert.equal(q.match.status,'matched');assert.equal(q.values.price,'0.08');assert.equal(q.tier.quantity,1000);
 assert.equal(q.match.requestedQuantity,999);assert.equal(q.match.pricingQuantity,1000);assert.equal(q.match.quantityBasis,'minimum-order');
 const next=selectQuoteItem(q,'18 inch Halloween foil balloon',undefined,3000);
 assert.equal(next.values.price,'0.075');assert.equal(next.tier.quantity,3000);
});

test('known pack rounding selects a tier using actual purchase quantity',()=>{
 const text='Supplier: Example\nOrder pack multiple: 100\nProduct\tQty Tier\tUnit Price (SGD/pc)\tMOQ (pcs)\nFoil balloon\t500-999\t0.18\t50\nFoil balloon\t1000-2999\t0.12\t50';
 const q=selectQuoteItem({text,candidates:extractQuoteItems(text)},'Foil balloon',undefined,999);
 assert.equal(q.values.price,'0.12');assert.equal(q.tier.quantity,1000);assert.equal(q.match.quantityBasis,'pack-multiple');
});

test('an exact narrative quote at1000 is retained as a visible alternative, never priced as a999 order',()=>{
 const text='For our 18-inch Halloween foil balloons, our wholesale price is SGD 0.18 per piece for an order of 1,000 pieces.\nOur wholesale MOQ is 100 pieces per SKU.';
 const q=selectQuoteItem({text,candidates:extractQuoteItems(text)},'18 inch Halloween foil balloon',undefined,999);
 assert.equal(q.match.status,'unmatched');assert.equal(q.values.price,null);
 assert.equal(q.candidates[0].values.price,'0.18');assert.equal(q.candidates[0].suggestedOrderQuantity,1000);assert.equal(q.candidates[0].pricingQuantity,999);
 const changed=selectQuoteItem(q,'18 inch Halloween foil balloon',undefined,1000);
 assert.equal(changed.values.price,'0.18');assert.equal(changed.candidates[0].suggestedOrderQuantity,null);
});
