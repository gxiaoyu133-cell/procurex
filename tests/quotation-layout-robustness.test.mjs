import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractQuoteItems,selectQuoteItem} from '../lib/item-matching.mjs';
import {getQuotationFacts} from '../lib/quotation-facts.mjs';

const select=(text,item='18 inch Halloween foil balloon',quantity=1000)=>selectQuoteItem({id:'layout',text,candidates:extractQuoteItems(text)},item,undefined,quantity);

test('Chinese reordered headers retain tax, currency, price and quantities without mistaking totals for products',()=>{
 const text='供应商\t明月贸易\n币种\tSGD\n税率\t含税单价 (SGD/件)\t物料名称\t最低起订量\t订购倍数\t交期\n9% GST included\t0.24\t18 inch Halloween foil balloon\t500\t100\t5–7 working days\n9% GST included\t0.45\tLatex balloon\t200\t100\t10–12 working days\n税额\t21.60\t合计\t1000\t100\t';
 const q=select(text);
 assert.equal(q.candidates.length,2);
 assert.equal(q.values.price,'0.24'); assert.equal(q.values.priceUnit,'1'); assert.equal(q.values.currency,'SGD');
 assert.equal(q.values.moq,'500'); assert.equal(q.values.packSize,'100'); assert.equal(q.values.basis,'tax-inclusive');
 const facts=getQuotationFacts(q,1000).selected;
 assert.equal(facts.goodsSubtotal,240); assert.equal(facts.tax.rate,9); assert.equal(facts.leadTime,'5–7 working days');
});

test('transposed product columns keep their own prices, MOQ, freight and dates',()=>{
 const text='Supplier\tPaper House\nCurrency\tSGD\nProduct\tA4 paper 80gsm\tA3 paper 80gsm\nUnit Price (SGD/ream)\t4.50\t8.10\nMOQ\t100\t50\nOrder pack multiple\t5\t10\nFreight Cost\t30\t60\nTax basis\tpre-tax\ttax-inclusive\nArrival date\t2026-12-01\t2026-12-03';
 const a4=select(text,'A4 paper 80gsm',120),a3=select(text,'A3 paper 80gsm',120);
 assert.equal(a4.candidates.length,2); assert.equal(a4.structureType,'transposed-items');
 assert.equal(a4.values.price,'4.50'); assert.equal(a4.values.delivery,'30'); assert.equal(a4.values.moq,'100'); assert.equal(a4.values.arrival,'2026-12-01'); assert.equal(a4.values.basis,'pre-tax');
 assert.equal(a3.values.price,'8.10'); assert.equal(a3.values.delivery,'60'); assert.equal(a3.values.basis,'tax-inclusive');
});

test('unknown or formula prices stay unknown while later valid rows remain readable',()=>{
 const text='Currency\tSGD\nProduct\tUnit Price (SGD/pc)\tMOQ\nFoil balloon\tTBC (estimate 0.15)\t100\nLatex balloon\tUnresolved formula (A12*B12)\t100\nTable runner\t0.75\t50\nTax\t9%\t0\nGrand total\t750\t1000';
 const rows=extractQuoteItems(text);
 assert.equal(rows.length,3); assert.equal(rows[0].values.price,null); assert.equal(rows[1].values.price,null);
 assert.equal(select(text,'Table runner',100).values.price,'0.75');
});

test('row tax and freight from another item cannot leak into selected facts',()=>{
 const text='Supplier\tMixed Products\nCurrency\tSGD\nProduct\tUnit Price (SGD/pc)\tTax\tLead Time\tFreight Cost\nFoil balloon\t0.20\tUnknown\t5 days\tUnknown\nTable runner\t1.00\t20% VAT included\t40 days\t0';
 const q=select(text,'Foil balloon',1000),facts=getQuotationFacts(q,1000).selected;
 assert.equal(q.values.basis,null); assert.equal(facts.tax.rate,null); assert.equal(facts.tax.basis,null);
 assert.equal(facts.freight.amount,null); assert.equal(facts.leadTime,'5 days');
});

test('semicolon rows support decimal commas, preserved quoted commas and reordered fields',()=>{
 const text='Supplier;Euro Supplies\nCurrency;EUR\nMOQ;Product;Unit Price (EUR/pc);Tax basis\n1000;"18 inch Halloween foil balloon, silver";0,24;pre-tax\n500;Table runner;1,50;pre-tax';
 const q=select(text);
 assert.equal(q.values.price,'0.24'); assert.equal(q.values.currency,'EUR'); assert.equal(q.values.moq,'1000');
 assert.equal(q.candidates[1].values.price,'1.50');
});

test('bare dollar narrative does not invent USD when currency is absent',()=>{
 const q=select('We can offer foil balloons at $0.20 per piece, with a minimum order of 100 pieces.','foil balloons',100);
 assert.equal(q.values.price,'0.20'); assert.equal(q.values.currency,null);
});

test('explicit unknown row quantity does not inherit the unrelated common MOQ',()=>{
 const text='MOQ: 500\nProduct\tUnit Price (SGD/pc)\tMOQ\nFoil balloon\t0.20\tTBC (normally 100)\nTable runner\t1.00\t200';
 assert.equal(select(text,'Foil balloon',100).values.moq,null);
});

test('blank leading codes and short trailing fields do not shift or drop product prices',()=>{
 const text='Item No.\tProduct\tUnit Price (SGD/pc)\tMOQ\tFreight Cost\nB1\tFoil balloon\t0.20\t100\t20\n\tLatex balloon\t0.10\t50\nR1\tTable runner\t0.80';
 const rows=extractQuoteItems(text);
 assert.equal(rows.length,3); assert.equal(rows[1].values.price,'0.10'); assert.equal(rows[1].values.moq,'50'); assert.equal(rows[1].values.delivery,null);
 assert.equal(rows[2].values.price,'0.80'); assert.equal(rows[2].values.moq,null);
});

test('a carton-priced header cannot become per-piece without an explicit conversion',()=>{
 const text='Product\tUnit Price (SGD/carton)\nFoil balloon\t24';
 const q=select(text,'Foil balloon',100);
 assert.equal(q.values.price,'24'); assert.equal(q.values.priceUnit,null); assert.equal(getQuotationFacts(q,100).selected.unitPrice,null);
});

test('explicit row-level unknowns override common currency, tax and free-delivery terms',()=>{
 const text='Currency: SGD\nCost basis: pre-tax\nFree local delivery included\nProduct\tUnit Price\tCurrency\tTax\tFreight Cost\nFoil balloon\t0.20\tTBC\tUnknown\tTBC\nTable runner\t1.00\tSGD\tGST excluded\t0';
 const q=select(text,'Foil balloon',100),facts=getQuotationFacts(q,100).selected;
 assert.equal(q.values.currency,null); assert.equal(q.values.basis,null); assert.equal(facts.freight.amount,null);
});

test('an explicit order lot is shared by parsing and comparison while ordinary packaging is not an order multiple',()=>{
 const text='Supplier: Export House\nProduct: Foil balloon\nCurrency: USD\nPacking: 100 pcs/bag, 1,000 pcs/carton\nMOQ: 1,000 pcs (1 lot = 1,000 pcs)\nQuantity Tier\tUnit Price (USD/pc)\n1,000 pcs\t0.08\n3,000 pcs\t0.07';
 const q=select(text,'Foil balloon',1500),facts=getQuotationFacts(q,1500).selected;
 assert.equal(q.values.packSize,'1000'); assert.equal(q.match.pricingQuantity,2000); assert.equal(q.values.price,'0.08');
 assert.equal(facts.packSize,1000); assert.equal(facts.orderQuantity,2000); assert.equal(facts.goodsSubtotal,160);
 assert.equal(q.evidence.packSize,'1 lot = 1,000 pcs');
 assert.equal(select(text.replace(' (1 lot = 1,000 pcs)',''),'Foil balloon',1500).values.packSize,null);
 assert.equal(select(text+'\nAlternative: 1 lot = 500 pcs','Foil balloon',1500).values.packSize,null);
});

test('an explicit lot in one item block cannot propagate to a different product',()=>{
 const text='Supplier: Mixed Lots\nCurrency: SGD\nItem: Foil balloon\nUnit Price: 0.20\nUnits per quoted price: 1\nMOQ: 100 (1 lot = 100 pcs)\nItem: Table runner\nUnit Price: 0.50\nUnits per quoted price: 1\nMOQ: 20';
 const foil=select(text,'Foil balloon',150),runner=select(text,'Table runner',150);
 assert.equal(foil.values.packSize,'100'); assert.equal(runner.values.packSize,null);
 const unknown=select('Item: Foil balloon\nUnit Price: 0.20\nOrder pack multiple: Unknown\nMOQ: 100 (1 lot = 100 pcs)','Foil balloon',150);
 assert.equal(unknown.values.packSize,null);
});
