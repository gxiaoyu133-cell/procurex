import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compare, demoQuotes} from '../lib/engine.mjs';
import {canConfirmComparison, comparePreview, exportPreviewCSV} from '../lib/comparison-preview.mjs';

const req = {item: 'A4 copy paper 80gsm, ream of 500 sheets', quantity: 1000, stock: 0, deadline: '2026-11-10'};
const countQuotes = count => Array.from({length: count}, (_, i) => ({...demoQuotes()[0], id: i}));

test('confirmation accepts 2–10 sources and rejects zero, one, and eleven', () => {
  for (const count of [0, 1, 11]) assert.equal(canConfirmComparison(countQuotes(count), req).canConfirm, false);
  for (let count = 2; count <= 10; count++) assert.equal(canConfirmComparison(countQuotes(count), req).canConfirm, true);
});

test('confirmation validates requirements and source text without requiring recognised values', () => {
  const quotes = demoQuotes();
  for (const changed of [{quantity: 0}, {quantity: 1.5}, {quantity: 1e30}, {stock: -1}, {stock: ''}, {stock: 0.5}, {item: ' '}, {deadline: '2026-02-31'}]) {
    assert.equal(canConfirmComparison(quotes, {...req, ...changed}).canConfirm, false, JSON.stringify(changed));
  }
  quotes[0].text = 'short';
  assert.equal(canConfirmComparison(quotes, req).canConfirm, false);
  quotes[0].text = 'Unrecognised quotation text';
  quotes[0].values = Object.fromEntries(Object.keys(quotes[0].values).map(key => [key, null]));
  assert.equal(canConfirmComparison(quotes, req).canConfirm, true);
  assert.equal(comparePreview(quotes, req).rows[0].eligible, false);
});

test('preview compares exact specifications while preserving original review objects and final gate', () => {
  const quotes = demoQuotes(), before = JSON.stringify(quotes);
  const result = comparePreview(quotes, req);
  assert.equal(result.winner.q.values.supplier, 'Beacon Office');
  assert.equal(result.winner.total, 10000);
  assert.equal(result.rows[0].total, 10300);
  assert.equal(result.rows[0].q, quotes[0]);
  assert.equal(result.rows[0].requiresReview, true);
  assert.equal(result.rows[0].specMatchedByText, true);
  assert.equal(JSON.stringify(quotes), before);
  assert.equal(compare(quotes, req).winner, null);
});

test('specification matching changes only case and whitespace, never semantic attributes', () => {
  const quotes = demoQuotes();
  quotes[0].values.item = '  a4 COPY paper\n80gsm,  ream of 500 sheets  ';
  quotes[1].values.item = 'A4 copy paper 70gsm, ream of 500 sheets';
  quotes[2].values.item = 'A4 paper';
  const result = comparePreview(quotes, req, 7);
  assert.equal(result.rows[0].eligible, true);
  assert.equal(result.rows[1].specMatchedByText, false);
  assert.equal(result.rows[1].eligible, false);
  assert.equal(result.rows[2].specMatchedByText, false);
  quotes[1].equivalent = true;
  assert.equal(comparePreview(quotes, req).rows[1].eligible, true);
});

test('reviewed specification rejection overrides an exact text match', () => {
  const quotes = demoQuotes();
  quotes[1].reviewed = true;
  quotes[1].equivalent = false;
  const result = comparePreview(quotes, req);
  assert.equal(result.rows[1].specMatchedByText, true);
  assert.equal(result.rows[1].eligible, false);
  assert.ok(result.rows[1].issues.includes('Equivalent specification is not confirmed.'));
  assert.equal(result.winner.q.values.supplier, 'Atlas Supply');
  assert.equal(quotes[1].equivalent, false);
});

test('preview still excludes missing fees, late arrivals, incompatible currency and cost basis', () => {
  const result = comparePreview(demoQuotes(), req);
  assert.equal(result.rows[2].total, null);
  assert.equal(result.rows[2].eligible, false);
  assert.equal(result.rows[2].order, 1500);
  for (const [key, value] of [['delivery', null], ['arrival', '2026-11-11'], ['currency', 'USD'], ['basis', 'tax-inclusive']]) {
    const quote = demoQuotes()[0];
    quote.values[key] = value;
    assert.equal(comparePreview([quote], req).winner, null, key);
  }
});

test('a fresh preview responds to edited costs, quantities, and scenarios', () => {
  const quotes = demoQuotes();
  assert.equal(comparePreview(quotes, req).winner.q.id, 1);
  quotes[0].values.delivery = '0';
  assert.equal(comparePreview(quotes, req).winner.q.id, 0);
  assert.equal(comparePreview(quotes, {...req, quantity: 113, stock: 4}).rows[0].order, 110);
  assert.equal(comparePreview(quotes, req, -7).winner, null);
  assert.equal(req.deadline, '2026-11-10');
});

test('preview CSV labels provisional comparison and protects formula fields', () => {
  const quotes = demoQuotes();
  quotes[0].values.supplier = '=1+1';
  const csv = exportPreviewCSV(quotes, req);
  assert.ok(csv.includes("'=1+1"));
  assert.ok(csv.includes('Preliminary comparable'));
  assert.ok(csv.includes('Not comparable'));
  assert.ok(csv.includes('Pending human review'));
  assert.ok(csv.includes('Delivery charge (S$) is unknown.'));
});
