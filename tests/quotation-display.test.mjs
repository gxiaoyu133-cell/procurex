import test from 'node:test';
import assert from 'node:assert/strict';
import {extractQuoteItems, selectQuoteItem} from '../lib/item-matching.mjs';
import {getQuotationFacts} from '../lib/quotation-facts.mjs';
import {comparePreview, exportPreviewCSV} from '../lib/comparison-preview.mjs';

const spreadsheet = `Supplier\tHarbour Party Supplies
Currency\tSGD
Trade Terms\tEXW Guangzhou
Item\tSize\tMOQ (pcs)\tQty Tier (pcs)\tUnit Price (SGD/pc)\tLead Time\tFreight Option\tFreight Cost (SGD)
Halloween Foil Balloon\t18 inch\t50\t500–999\t0.18\t5–7 working days\tDHL Express\t95
Halloween Foil Balloon\t18 inch\t50\t1,000–2,999\t0.12\t5–7 working days\tDHL Express\t95
Tax\tSingapore Import GST\t0.09\ton CIF value\tborne by buyer
Note\tPrices are EXW, exclude freight and GST`;

const pdf = `Supplier: Lantern Festive Products
Product: 18-inch Halloween foil balloons
Trade Terms: FOB Ningbo
Currency: USD
Quantity Tier\tUnit Price (USD/pc)
1,000 pcs\t0.08
3,000 pcs\t0.075
MOQ: 1,000 pcs (1 lot = 1,000 pcs)
Price excludes Singapore import taxes and international freight
Singapore Import GST: 9% (on CIF value, borne by buyer)
International Freight (reference): Sea LCL to Singapore approx. USD 180/shipment
(1,000 pcs approx. 0.3 CBM), equivalent to approx. USD 0.18/pc
Freight Terms: Final rate subject to forwarder confirmation at booking
Total Door-to-Door: approx. 25-30 days`;

const request = quantity => ({item:'18 inch Halloween foil balloon', quantity, stock:0, deadline:'2026-12-01'});
const quote = (text, req, name='supplier quotation') => selectQuoteItem({id:name, name, text, candidates:extractQuoteItems(text, {quantity:req.quantity})}, req.item, undefined, req.quantity);
const csvObjects = csv => {
  const rows = csv.replace(/^\uFEFF/,'').split('\r\n').map(line => [...line.matchAll(/"((?:[^"\r\n]|"")*)"(?:,|$)/g)].map(match=>match[1].replaceAll('""','"')));
  return rows.slice(1).map(row=>Object.fromEntries(rows[0].map((header,i)=>[header,row[i]])));
};

test('CSV exposes source unit prices, native currencies, freight, taxes and useful subtotals', () => {
  const req=request(1000), quotes=[quote(spreadsheet,req,'quote.xlsx'),quote(pdf,req,'quote.pdf')];
  const [sheet,document]=csvObjects(exportPreviewCSV(quotes,req));
  assert.equal(sheet['Original currency'],'SGD');
  assert.equal(sheet['Unit price'],'0.12');
  assert.equal(sheet['Goods value'],'120');
  assert.equal(sheet.Freight,'95');
  assert.equal(sheet['Known subtotal in original currency'],'215');
  assert.match(sheet['Tax treatment'],/9%.*CIF/);
  assert.match(sheet['Subtotal basis'],/before import GST/);
  assert.equal(sheet['Lead time'],'5–7 working days');
  assert.equal(document['Original currency'],'USD');
  assert.equal(document['Unit price'],'0.08');
  assert.equal(document['Known subtotal in original currency'],'260');
  assert.match(document['Freight conditions'],/Reference freight/);
  assert.equal(document['Preliminary pre-tax total SGD'],'');
  assert.equal(document['Source file'],'quote.pdf');
});

test('a specification mismatch preserves extracted facts and cannot enter supplier ranking', () => {
  const req={...request(1000),item:'A4 copy paper'};
  const q=quote(spreadsheet,req,'quote.xlsx');
  const facts=getQuotationFacts(q,1000);
  const result=comparePreview([q],req);
  assert.equal(q.match.matchesRequirement,false);
  assert.equal(facts.displayOnly,true);
  assert.match(facts.selected.item,/Halloween Foil Balloon/);
  assert.equal(facts.selected.unitPrice,0.12);
  assert.equal(facts.selected.knownSubtotal,215);
  assert.equal(result.winner,null);
  assert.equal(result.eligible.length,0);
  const [csv]=csvObjects(exportPreviewCSV([q],req));
  assert.equal(csv.Status,'Not comparable');
  assert.equal(csv['Unit price'],'0.12');
  assert.match(csv['Source caveats'],/Specification requires confirmation/);
});

test('999 units uses the applicable spreadsheet tier while the PDF order meets its MOQ', () => {
  const req=request(999);
  const sheet=getQuotationFacts(quote(spreadsheet,req),999).selected;
  const document=getQuotationFacts(quote(pdf,req),999).selected;
  assert.equal(sheet.orderQuantity,999);
  assert.equal(sheet.unitPrice,0.18);
  assert.equal(sheet.goodsSubtotal,179.82);
  assert.equal(sheet.knownSubtotal,274.82);
  assert.equal(document.orderQuantity,1000);
  assert.equal(document.unitPrice,0.08);
  assert.equal(document.goodsSubtotal,80);
  assert.match(document.caveats.join(' '),/999.*1,000/);
});

test('a 1,000-unit freight reference is not reused for the 3,000-unit price break', () => {
  const req=request(3000), q=quote(pdf,req), facts=getQuotationFacts(q,3000).selected;
  assert.equal(facts.unitPrice,0.075);
  assert.equal(facts.goodsSubtotal,225);
  assert.equal(facts.freight.amount,null);
  assert.match(facts.freight.label,/1,000 units.*requote/);
  assert.equal(facts.knownSubtotal,225);
  assert.match(facts.subtotalLabel,/Goods only/);
  const [csv]=csvObjects(exportPreviewCSV([q],req));
  assert.equal(csv['Unit price'],'0.075');
  assert.equal(csv.Freight,'');
});
