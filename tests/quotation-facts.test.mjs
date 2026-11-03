import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractQuoteItems,selectQuoteItem} from '../lib/item-matching.mjs';
import {getQuotationFacts} from '../lib/quotation-facts.mjs';

// De-identified excerpts retain the structures that failed in the demo.
const email = `For our Halloween foil balloon mixed packs (ghost, pumpkin, bat, skull designs, 18-inch), our wholesale price is SGD 0.18 per piece for an order of 1,000 pieces. For the balloon arch kit (includes foil balloons, latex balloons, bat cutouts and garland strip), the price is SGD 2.50 per set.
Please note these are indicative wholesale prices and final pricing will depend on the exact quantity and mix you confirm.
Our wholesale MOQ is 100 pieces per SKU.
For local stock items, delivery is 2–3 working days within Singapore. If you require overseas factory direct sourcing, the lead time is approximately 4–6 weeks, to be confirmed separately.
All prices quoted are inclusive of 9% GST.
Local delivery is free for orders above SGD 150. For orders below SGD 150, a delivery charge of SGD 20 applies.
Supplier: Example Local Supplies Ltd.`;
const spreadsheet = `Supplier\tExample Export Supplies
Currency\tSGD
Valid Until\t2025-08-21 (15 days)
Trade Terms\tEXW Guangzhou
Item No.\tProduct\tSize\tMOQ (pcs)\tQty Tier (pcs)\tUnit Price (SGD/pc)\tLead Time\tFreight Option\tFreight Cost (SGD)
HW-18\tHalloween Foil Balloon\t18 inch\t50\t50–499\t0.26\t5–7 working days\tDHL Express\t95
HW-18\tHalloween Foil Balloon\t18 inch\t50\t500–999\t0.18\t5–7 working days\tDHL Express\t95
HW-18\tHalloween Foil Balloon\t18 inch\t50\t1,000–2,999\t0.12\t5–7 working days\tDHL Express\t95
Tax\tSingapore Import GST\t0.09\ton CIF value\tborne by buyer
Tax\tChina Export Duty\t0
Note\tPrices are EXW, exclude freight and GST`;
const pdf = `QUOTATION
Example Festive Products Co., Ltd.
Valid Until: August 20, 2025 (15 days)
Product: 18-inch Halloween foil balloons
Trade Terms: FOB Ningbo
Currency: USD
Quantity Tier\tUnit Price (USD/pc)
1,000 pcs\t0.08
3,000 pcs\t0.075
5,000 pcs\t0.07
MOQ: 1,000 pcs (1 lot = 1,000 pcs)
Price excludes Singapore import taxes and international freight
Singapore Import GST: 9% (on CIF value, borne by buyer)
International Freight (reference): Sea LCL to Singapore approx. USD 180/shipment
(1,000 pcs approx. 0.3 CBM), equivalent to approx. USD 0.18/pc
Freight Terms: Final rate subject to forwarder confirmation at booking
Production: 20 days after order confirmation
Sea Freight: 10-12 days
Total Door-to-Door: approx. 25-30 days`;
const quote = (text,quantity,requirement='18 inch Halloween foil balloon')=>selectQuoteItem({text,candidates:extractQuoteItems(text)},requirement,undefined,quantity);

test('unmatched email keeps actual quoted quantity, price and local delivery condition visible',()=>{
  const q=quote(email,999), before=JSON.stringify(q), f=getQuotationFacts(q,999);
  assert.equal(f.selected.unitPrice,0.18);
  assert.equal(f.selected.orderQuantity,1000);
  assert.equal(f.selected.quantitySuggested,true);
  assert.equal(f.selected.goodsSubtotal,180);
  assert.equal(f.selected.freight.amount,0);
  assert.equal(f.selected.freight.conditional,true);
  assert.equal(f.selected.tax.rate,9);
  assert.equal(f.selected.tax.basis,'tax-inclusive');
  assert.equal(f.selected.knownSubtotal,180);
  assert.equal(f.selected.subtotalLabel,'Goods + freight · GST included');
  assert.equal(f.products.length,2);
  assert.equal(f.products[1].unitPrice,2.5);
  assert.equal(f.displayOnly,true);
  assert.match(f.selected.leadTime,/2–3 working days.*local stock/);
  assert.match(f.selected.caveats.join(' '),/indicative/);
  assert.equal(JSON.stringify(q),before,'display cannot mutate ranking input');
});

test('spreadsheet quantity selects source tier and separates import tax from known subtotal',()=>{
  const f999=getQuotationFacts(quote(spreadsheet,999),999).selected;
  const f1000=getQuotationFacts(quote(spreadsheet,1000),1000).selected;
  assert.equal(f999.unitPrice,0.18);
  assert.equal(f999.goodsSubtotal,179.82);
  assert.equal(f999.knownSubtotal,274.82);
  assert.equal(f1000.unitPrice,0.12);
  assert.equal(f1000.knownSubtotal,215);
  assert.equal(f1000.subtotalLabel,'Goods + freight · before import GST');
  assert.equal(f1000.freight.amount,95);
  assert.equal(f1000.freight.label,'DHL Express');
  assert.equal(f1000.tax.rate,9);
  assert.equal(f1000.tax.onCif,true);
  assert.equal(f1000.taxAmount,null);
  assert.equal(f1000.incoterm,'EXW Guangzhou');
  assert.equal(f1000.leadTime,'5–7 working days');
  assert.equal(f1000.expiryDate,'2025-08-21');
});

test('PDF shows native USD, MOQ-adjusted goods and a clearly indicative freight subtotal',()=>{
  const f=getQuotationFacts(quote(pdf,999),999).selected;
  assert.equal(f.currency,'USD');
  assert.equal(f.unitPrice,0.08);
  assert.equal(f.moq,1000);
  assert.equal(f.orderQuantity,1000);
  assert.equal(f.goodsSubtotal,80);
  assert.equal(f.freight.amount,180);
  assert.equal(f.freight.indicative,true);
  assert.equal(f.knownSubtotal,260);
  assert.equal(f.subtotalLabel,'Indicative · before import GST');
  assert.equal(f.tax.onCif,true);
  assert.equal(f.taxAmount,null);
  assert.equal(f.incoterm,'FOB Ningbo');
  assert.match(f.leadTime,/25-30 days/);
  assert.equal(f.expiryDate,'2025-08-20');
});

test('a quantity-specific freight reference cannot silently price a larger shipment',()=>{
  const f=getQuotationFacts(quote(pdf,3000),3000).selected;
  assert.equal(f.goodsSubtotal,225);
  assert.equal(f.freight.amount,null);
  assert.match(f.freight.label,/1,000 units/);
  assert.equal(f.knownSubtotal,225);
  assert.equal(f.subtotalLabel,'Goods only · freight not priced');
  assert.match(f.caveats.join(' '),/Freight not included/);
});

test('unrelated requirement retains extracted facts but remains outside automatic comparison',()=>{
  const q=quote(spreadsheet,1000,'A4 printer paper'), f=getQuotationFacts(q,1000);
  assert.equal(q.values.price,null);
  assert.equal(f.selected.unitPrice,0.12);
  assert.equal(f.selected.displayOnly,true);
  assert.equal(f.selected.knownSubtotal,215);
  assert.match(f.selected.caveats.join(' '),/Specification requires confirmation/);
});

test('price per carton is normalized for per-unit display while subtotal retains quoted basis',()=>{
  const q={text:'',candidates:[{id:'carton',values:{supplier:'Carton Supplier',item:'Paper',price:'100',priceUnit:'10',packSize:'10',moq:'10',currency:'SGD',delivery:'20',basis:'pre-tax'},evidence:{price:'SGD 100 per carton of 10'}}]};
  const f=getQuotationFacts(q,25).selected;
  assert.equal(f.quotedPrice,100);
  assert.equal(f.priceUnit,10);
  assert.equal(f.unitPrice,10);
  assert.equal(f.orderQuantity,30);
  assert.equal(f.goodsSubtotal,300);
  assert.equal(f.knownSubtotal,320);
  assert.equal(getQuotationFacts(q,40).selected.goodsSubtotal,400);
});
