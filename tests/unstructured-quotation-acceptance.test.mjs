import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractQuoteItems, selectQuoteItem} from '../lib/item-matching.mjs';
import {evaluateQuote} from '../lib/engine.mjs';
import {comparePreview} from '../lib/comparison-preview.mjs';

// These are synthetic, de-identified excerpts shaped like the three real inputs.
// Keeping them as text makes the parser contract reviewable without copying private files.
const emailNarrative = `
Subject: Halloween party decoration quotation

Hello,

Night Owl Party Supplies can offer 18-inch Halloween foil balloons at SGD 0.18 per piece,
with a minimum order of 2,000 pieces. We can also offer Halloween hanging swirl
decorations at SGD 0.42 per set, with a minimum order of 800 sets.

Freight depends on the delivery address and will be confirmed separately.
Lead time is 12-15 days after deposit. Tax has not been specified.
`;

const spreadsheetTsv = `
Supplier Name\tProduct Description\tQty Range\tUnit Price (SGD/pc)\tMOQ (pcs)\tTax\tFreight Cost (SGD)\tDelivery Lead Time
Bright Festive Co.\t18 inch Halloween foil balloon\t500-999\t0.32\t500\tGST excluded\t85\t7-10 business days
Bright Festive Co.\t18 inch Halloween foil balloon\t1000-1999\t0.24\t500\tGST excluded\t85\t7-10 business days
Bright Festive Co.\t18 inch Halloween foil balloon\t2000+\t0.18\t500\tGST excluded\t85\t7-10 business days
Bright Festive Co.\tHalloween table runner\t500+\t0.78\t500\tGST excluded\t85\t7-10 business days
Note\tPrices are EXW and exclude freight and GST; use the separate freight cost column
`;

const pdfTextWithIndependentTiers = `
QUOTATION
Supplier: Moonlight Decorations Ltd.
Product: 18 inch Halloween foil balloon
Currency: USD
Minimum order quantity: 500 pcs
Pack size: 1 pc
Other charges: 0
Tax: 9% VAT included
Shipping: To be confirmed after destination is provided
Delivery lead time: 14-18 days after deposit

Quantity Tier\tUnit Price (USD/pc)
500-999\t0.30
1000-1999\t0.23
2000+\t0.17
`;

const quoteFor = (text, requirement, quantity) => selectQuoteItem({
  id: 'acceptance-quote',
  text,
  candidates: extractQuoteItems(text),
}, requirement, undefined, quantity);

const retainedConditionText = quote => JSON.stringify({
  evidence: quote.evidence,
  risks: quote.risks,
  terms: quote.terms,
  candidates: quote.candidates?.map(candidate => ({
    evidence: candidate.evidence,
    risks: candidate.risks,
    terms: candidate.terms,
  })),
});

test('natural-language email keeps each item with its own price and leaves conditional terms pending', () => {
  const q = quoteFor(emailNarrative, '18 inch Halloween foil balloons', 2500);

  assert.equal(q.match.status, 'matched');
  assert.equal(q.values.price, '0.18');
  assert.equal(q.values.priceUnit, '1');
  assert.equal(q.values.moq, '2000');
  assert.equal(q.values.currency, 'SGD');
  assert.match(q.values.item, /18.?inch Halloween foil balloons/i);
  assert.equal(q.candidates.find(candidate => candidate.id === q.match.selectedId)?.structureType, 'natural-language');

  // Conditional freight, relative lead time and unspecified tax must not become invented facts.
  assert.equal(q.values.delivery, null);
  assert.equal(q.values.arrival, null);
  assert.equal(q.values.basis, null);
  assert.match(retainedConditionText(q), /depends on the delivery address/i);
  assert.match(retainedConditionText(q), /12-15 days after deposit/i);
  assert.match(retainedConditionText(q), /tax has not been specified/i);

  // The second product's price must remain attached to that product only.
  assert.notEqual(q.values.price, '0.42');
});

test('loose spreadsheet headers map useful fields and purchase quantity selects the applicable tier', () => {
  const cases = [
    {quantity: 750, price: '0.32', tier: /500-999/},
    {quantity: 1500, price: '0.24', tier: /1000-1999/},
    {quantity: 2500, price: '0.18', tier: /2000\+/},
  ];

  for (const {quantity, price, tier} of cases) {
    const q = quoteFor(spreadsheetTsv, '18 inch Halloween foil balloon', quantity);
    assert.equal(q.match.status, 'matched', `quantity ${quantity}`);
    assert.equal(q.values.price, price, `quantity ${quantity}`);
    assert.equal(q.values.priceUnit, '1', `quantity ${quantity}`);
    assert.equal(q.values.moq, '500', `quantity ${quantity}`);
    assert.equal(q.values.currency, 'SGD', `quantity ${quantity}`);
    assert.equal(q.values.basis, 'pre-tax', `quantity ${quantity}`);
    assert.equal(q.values.delivery, '85', `quantity ${quantity}`);
    assert.equal(q.values.arrival, null, `quantity ${quantity}`);
    assert.equal(q.candidates.find(candidate => candidate.id === q.match.selectedId)?.structureType, 'tabular-tiered');
    assert.match(q.evidence.price, tier, `selected price evidence for quantity ${quantity}`);
  }
});

test('PDF product heading can be joined to a separate tier table without resolving unsafe conditions', () => {
  const q = quoteFor(pdfTextWithIndependentTiers, '18 inch Halloween foil balloon', 2500);

  assert.equal(q.match.status, 'matched');
  assert.equal(q.values.price, '0.17');
  assert.equal(q.values.priceUnit, '1');
  assert.equal(q.values.moq, '500');
  assert.equal(q.values.currency, 'USD');
  assert.match(q.values.item, /18 inch Halloween foil balloon/i);
  assert.equal(q.candidates.find(candidate => candidate.id === q.match.selectedId)?.structureType, 'tiered-price-table');
  assert.match(q.evidence.price, /2000\+/);

  // A VAT-inclusive USD quote with destination-dependent freight and relative lead time
  // can expose its usable unit price, but it cannot enter the comparable ranking yet.
  assert.equal(q.values.basis, null);
  assert.equal(q.values.delivery, null);
  assert.equal(q.values.arrival, null);
  const retained = retainedConditionText(q);
  assert.match(retained, /9% VAT included/i);
  assert.match(retained, /destination is provided/i);
  assert.match(retained, /14-18 days after deposit/i);

  const evaluated = evaluateQuote({...q, reviewed: true, equivalent: true}, {
    item: '18 inch Halloween foil balloon',
    quantity: 2500,
    stock: 0,
    deadline: '2026-11-20',
  });
  assert.equal(evaluated.eligible, false);
  assert.equal(evaluated.total, null);
  assert.ok(evaluated.issues.some(issue => /Only SGD quotations/i.test(issue)));
  assert.ok(evaluated.issues.some(issue => /pre-tax cost basis/i.test(issue)));
});

test('an unmatched requirement never receives a price from another product or tier', () => {
  const q = quoteFor(spreadsheetTsv, '12 inch latex balloon', 2500);

  assert.equal(q.match.status, 'unmatched');
  assert.equal(q.values.item, null);
  assert.equal(q.values.price, null);
  assert.equal(q.values.priceUnit, null);
  assert.equal(q.values.moq, null);
  assert.equal(q.values.delivery, null);
  assert.equal(comparePreview([q], {
    item: '12 inch latex balloon',
    quantity: 2500,
    stock: 0,
    deadline: '2026-11-20',
  }).winner, null);
});
