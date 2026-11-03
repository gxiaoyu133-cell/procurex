import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildSync} from 'esbuild';
import JSZip from '../lib/vendor/jszip.cjs';
import {normalizeQuote} from '../lib/rules.mjs';
import {extractQuoteItems,selectQuoteItem} from '../lib/item-matching.mjs';
const built=buildSync({entryPoints:[new URL('../lib/source-reader.ts',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'esm',target:'node22'});
const {readQuotationFile,pdfQuotationText}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const fixture=name=>new File([fs.readFileSync(new URL('./fixtures/'+name,import.meta.url))],name);
test('XLSX cells and Excel dates become quote fields with source evidence',async()=>{const r=await readQuotationFile(fixture('Beacon-quotation.xlsx'));assert.equal(r.format,'spreadsheet');assert.match(r.text,/2026-11-10/);const q=normalizeQuote(r.text);assert.equal(q.values.supplier,'Beacon Office');assert.equal(q.values.price,'100');assert.equal(q.values.priceUnit,'10');assert.equal(q.values.delivery,'0');assert.equal(q.values.arrival,'2026-11-10')});
test('multiple worksheets require explicit selection instead of merging suppliers',async()=>{const r=await readQuotationFile(fixture('Two-supplier-worksheets.xlsx'));assert.equal(r.text,'');assert.equal(r.sheets.length,2);assert.match(r.sheets[0].text,/Beacon Office/);assert.match(r.sheets[1].text,/Cedar Trading/);assert.doesNotMatch(r.sheets[0].text,/Cedar Trading/)});
test('line breaks inside an XLSX product cell do not split it into unrelated rows',async()=>{
 const zip=await JSZip.loadAsync(await fixture('Beacon-quotation.xlsx').arrayBuffer());
 const sheet=await zip.file('xl/worksheets/sheet1.xml').async('string');
 zip.file('xl/worksheets/sheet1.xml',sheet.replace('A4 copy paper 80gsm, ream of 500 sheets','A4 copy paper&#10;80gsm, ream of 500 sheets'));
 const r=await readQuotationFile(new File([await zip.generateAsync({type:'uint8array'})],'wrapped-product.xlsx'));
 const q=selectQuoteItem({text:r.text,candidates:extractQuoteItems(r.text)},'A4 copy paper 80gsm',undefined,100);
 assert.equal(q.match.status,'matched'); assert.equal(q.values.price,'100'); assert.equal(q.values.priceUnit,'10'); assert.equal(q.values.arrival,'2026-11-10');
});
test('formulas with no saved value cannot turn cell references into prices',async()=>{const r=await readQuotationFile(fixture('No-cached-formula.xlsx'));assert.match(r.text,/Unresolved formula/);assert.equal(normalizeQuote(r.text).values.price,null)});
test('EML reads body and ignores attachments; base64 and HTML remain inert text',async()=>{const r=await readQuotationFile(fixture('Atlas-quotation.eml'));assert.equal(normalizeQuote(r.text).values.delivery,'800');assert.doesNotMatch(r.text,/supplier@example.com/);const raw='Content-Type: multipart/mixed; boundary="q"\n\n--q\nContent-Type: text/plain\nContent-Transfer-Encoding: base64\n\n'+Buffer.from('Supplier: Test Office\nDelivery charge: S$50').toString('base64')+'\n--q\nContent-Disposition: attachment\nContent-Type: text/plain\n\nDelivery charge: S$999\n--q--';const multipart=await readQuotationFile(new File([raw],'offer.eml'));assert.match(multipart.text,/S\$50/);assert.doesNotMatch(multipart.text,/999/);const html=await readQuotationFile(new File(['Content-Type: text/html\n\n<script>alert(1)</script><p>Supplier: Acme &amp; Sons</p><p>Delivery charge: S$20</p>'],'html.eml'));assert.match(html.text,/Acme & Sons/);assert.doesNotMatch(html.text,/script|alert/)});
test('CSV preserves unknowns and unsupported, empty or oversized inputs fail clearly',async()=>{const r=await readQuotationFile(new File(['Supplier,Price,Delivery charge\nAcme,99,unknown'],'quote.csv'));assert.equal(normalizeQuote(r.text).values.delivery,null);await assert.rejects(()=>readQuotationFile(new File(['legacy'],'quote.xls')),/Legacy XLS/);await assert.rejects(()=>readQuotationFile(new File([],'empty.txt')),/empty/);await assert.rejects(()=>readQuotationFile({size:10000001,name:'huge.xlsx'}),/10 MB/);await assert.rejects(()=>readQuotationFile(new File(['a'.repeat(12001)],'long.txt')),/12,000/)});

test('PDF positioned text preserves product table columns for requirement matching',()=>{const item=(str,x,y,width)=>({str,transform:[1,0,0,1,x,y],width,height:10});const text=pdfQuotationText([item('Item',30,700,20),item('Price',300,700,25),item('A4 paper 80gsm',30,680,90),item('9.50',300,680,20),item('A3 paper 80gsm',30,660,90),item('12.00',300,660,25)]);assert.equal(text,'Item\tPrice\nA4 paper 80gsm\t9.50\nA3 paper 80gsm\t12.00')});

test('CSV decoding supports Excel UTF-16, declared semicolons, decimal commas and multiline quoted descriptions',async()=>{
 const csv='\uFEFFsep=;\r\nSupplier;Paper House\r\nCurrency;EUR\r\nProduct;Unit Price (EUR/ream);MOQ\r\n"A4 paper\r\n80gsm, white";4,50;100\r\nA3 paper 80gsm;8,10;50';
 const source=await readQuotationFile(new File([Buffer.from(csv,'utf16le')],'export.csv'));
 assert.match(source.text,/A4 paper 80gsm, white/);
 const q=selectQuoteItem({text:source.text,candidates:extractQuoteItems(source.text)},'A4 paper 80gsm',undefined,100);
 assert.equal(q.values.price,'4.50'); assert.equal(q.values.currency,'EUR'); assert.equal(q.values.moq,'100');
});

test('CSV preserves embedded quotes and rejects unfinished quoted records',async()=>{
 const source=await readQuotationFile(new File(['Product,Unit Price (SGD/pc),MOQ\n"18"" Halloween foil balloon",0.20,100'],'quoted.csv'));
 const q=selectQuoteItem({text:source.text,candidates:extractQuoteItems(source.text)},'18 inch Halloween foil balloon',undefined,100);
 assert.equal(q.values.price,'0.20');
 await assert.rejects(()=>readQuotationFile(new File(['Product,Price\n"Unclosed,0.20'],'broken.csv')),/unclosed quoted cell/);
});

test('MIME folded headers, quoted-printable UTF-8 and soft breaks decode without attachment contamination',async()=>{
 const raw='MIME-Version: 1.0\r\nContent-Type: multipart/mixed;\r\n boundary="outer"\r\n\r\n--outer\r\nContent-Type: multipart/alternative; boundary="inner"\r\n\r\n--inner\r\nContent-Type: text/plain;\r\n charset="utf-8"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nSupplier: Caf=C3=A9 Supplies\r\nWe can offer foil balloons at SGD 0.20 per =\r\npiece, with a minimum order of 100 pieces.\r\n--inner\r\nContent-Type: text/html\r\n\r\n<p>Do not duplicate this alternative</p>\r\n--inner--\r\n--outer\r\nContent-Type: text/plain; name="old-quote.txt"\r\nContent-Disposition: attachment; filename="old-quote.txt"\r\n\r\nPrice: 99999\r\n--outer--';
 const source=await readQuotationFile(new File([raw],'folded.eml'));
 assert.match(source.text,/Café Supplies/); assert.match(source.text,/per piece/); assert.doesNotMatch(source.text,/99999|duplicate/);
 const q=selectQuoteItem({text:source.text,candidates:extractQuoteItems(source.text)},'foil balloons',undefined,100);
 assert.equal(q.values.price,'0.20'); assert.equal(q.values.supplier,'Café Supplies');
});

test('empty plain MIME alternative falls back to inert HTML quotation table',async()=>{
 const raw='Content-Type: multipart/alternative; boundary="alt"\n\n--alt\nContent-Type: text/plain\n\n\n--alt\nContent-Type: text/html\n\n<script>steal()</script><table><tr><th>Product</th><th>Unit Price (SGD/pc)</th></tr><tr><td>Foil balloon</td><td>0.25</td></tr></table>\n--alt--';
 const source=await readQuotationFile(new File([raw],'html-table.eml'));
 assert.doesNotMatch(source.text,/steal|script/);
 assert.equal(selectQuoteItem({text:source.text,candidates:extractQuoteItems(source.text)},'Foil balloon',undefined,100).values.price,'0.25');
});
