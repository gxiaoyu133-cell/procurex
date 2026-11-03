import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, demoQuotes } from '../lib/engine.mjs';
import { createNegotiationMessage } from '../lib/negotiation.mjs';

const req = { item: 'A4 copy paper', quantity: 1000, stock: 0, deadline: '2026-11-10' };
const reviewed = () => demoQuotes().map(q => ({ ...q, reviewed: true, equivalent: true }));

test('price draft uses a reviewed eligible comparison and labels target as a buyer request', () => {
  const draft = createNegotiationMessage(compare(reviewed(), req), req, 0, { goal: 'price', tone: 'polite', target: 'S$9,800 including delivery' });
  assert.match(draft.message, /another comparable offer at S\$10,000\.00/);
  assert.match(draft.message, /Our requested price target is S\$9,800 including delivery/);
  assert.match(draft.message, /buyer request for your consideration/);
  assert.doesNotMatch(draft.message, /recommended supplier|place an order/i);
});

test('unknown delivery remains unknown and unreviewed quotations are never promoted as benchmarks', () => {
  const result = compare(demoQuotes(), req);
  const draft = createNegotiationMessage(result, req, 2, { goal: 'price', tone: 'firm' });
  assert.match(draft.summary, /Review pending/);
  assert.ok(draft.evidence.some(fact => /Quoted delivery charge: unknown/.test(fact)));
  assert.ok(draft.evidence.some(fact => /Calculated pre-tax total: unresolved/.test(fact)));
  assert.doesNotMatch(draft.message, /S\$0\.00 delivery|another comparable offer/);
});

test('delivery draft uses the active scenario deadline without overwriting the baseline', () => {
  const draft = createNegotiationMessage(compare(reviewed(), req, -7), req, '0', { goal: 'delivery', tone: 'polite' });
  assert.match(draft.message, /commit to arrival.*2026-11-03/);
  assert.match(draft.message, /Current quotation:.*arrival 2026-11-09/);
  assert.equal(req.deadline, '2026-11-10');
});

test('MOQ request uses net demand after stock and calculated excess', () => {
  const withStock = { ...req, stock: 200 };
  const draft = createNegotiationMessage(compare(reviewed(), withStock), withStock, 2, { goal: 'moq', tone: 'polite' });
  assert.match(draft.message, /net purchasing requirement is 800 units/);
  assert.match(draft.message, /result in 1500 units, which is 700 units above/);
});

test('clarification draft converts commercial issues into requests and appends notes verbatim', () => {
  const notes = 'Please quote split delivery.\nWe can accept 400 units first.';
  const result = compare(reviewed(), req);
  const draft = createNegotiationMessage(result, req, 2, { goal: 'clarify', tone: 'firm', notes });
  for (const issue of result.rows[2].issues) assert.ok(draft.evidence.some(fact => fact.includes(issue)));
  assert.match(draft.message, /confirm the following missing terms: delivery charge/);
  assert.match(draft.message, /bring arrival forward to 2026-11-10/);
  assert.ok(draft.message.includes('Additional buyer request:\n' + notes));
  assert.match(draft.summary, /Draft only/);
});

test('supplier drafts omit internal review terminology and keep the facts panel separate', () => {
  const draft = createNegotiationMessage(compare(demoQuotes(), req), req, 0, { goal: 'clarify', tone: 'polite' });
  assert.match(draft.message, /confirm that the offered item meets our required specification/);
  assert.doesNotMatch(draft.message, /Human review is required|Equivalent specification is not confirmed|Quotation details for reference|eligible/i);
  assert.ok(draft.evidence.length >= 8);
  for (const goal of ['price', 'delivery', 'moq', 'clarify']) {
    const message = createNegotiationMessage(compare(reviewed(), req), req, 0, { goal, tone: 'firm', target: '9800' }).message;
    assert.ok(message.split(/\s+/).length <= 220, goal + ' draft should stay concise');
  }
});

test('invalid supplier selection cannot silently draft for a different supplier', () => {
  assert.throws(() => createNegotiationMessage(compare(reviewed(), req), req, 'missing', { goal: 'price', tone: 'polite' }), /Choose a supplier/);
});
