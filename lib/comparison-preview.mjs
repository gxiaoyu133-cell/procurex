import {addDays, compare, csvCell} from './engine.mjs';
import {getQuotationFacts} from './quotation-facts.mjs';

// Exact text matching proposes comparability; it never records human approval.
const specificationText = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export function comparePreview(quotes, req, offset = 0) {
  const requirement = specificationText(req.item);
  const matched = quotes.map(q => !!requirement && (specificationText(q.values.item) === requirement || (q.match?.requirement === req.item && q.match?.matchesRequirement === true)));
  const comparison = compare(quotes.map((q, i) => ({
    ...q,
    reviewed: true,
    equivalent: q.equivalent === true || (q.reviewed !== true && matched[i]),
  })), req, offset);
  const rows = comparison.rows.map((row, i) => ({
    ...row,
    q: quotes[i],
    specMatchedByText: matched[i],
    requiresReview: quotes[i].reviewed !== true || quotes[i].equivalent !== true,
  }));
  const eligible = rows.filter(row => row.eligible).sort((a, b) => a.total - b.total);
  return {rows, eligible, winner: eligible[0] || null};
}

export function canConfirmComparison(quotes, req) {
  const errors = [];
  if (quotes.length < 2) errors.push('Add at least 2 quotations to compare.');
  if (quotes.length > 10) errors.push('Compare up to 10 quotations at a time.');
  quotes.forEach((q, i) => {
    if (String(q.text ?? '').trim().length < 10) errors.push('Quotation ' + (i + 1) + ' needs at least 10 characters of source text.');
  });
  const quantity = Number(req.quantity), stock = Number(req.stock);
  if (req.quantity === null || req.quantity === undefined || String(req.quantity).trim() === '' || !Number.isSafeInteger(quantity) || quantity <= 0) {
    errors.push('Enter a positive whole-unit demand.');
  }
  if (req.stock === null || req.stock === undefined || String(req.stock).trim() === '' || !Number.isSafeInteger(stock) || stock < 0) {
    errors.push('Enter a valid whole-unit stock quantity, including zero.');
  }
  if (!String(req.item ?? '').trim()) errors.push('Enter the required item and specification.');
  if (typeof req.deadline !== 'string' || !req.deadline || addDays(req.deadline, 0) !== req.deadline) {
    errors.push('Enter a valid required arrival date.');
  }
  return {canConfirm: errors.length === 0, errors};
}

export function exportPreviewCSV(quotes, req, offset = 0) {
  const header = ['Supplier', 'Status', 'Human review', 'Specification check', 'Unresolved conditions', 'Net demand', 'Order quantity', 'Preliminary pre-tax total SGD', 'Arrival', 'Scenario deadline', 'Extracted product', 'Original currency', 'Unit price', 'Quoted order quantity', 'MOQ', 'Price tier', 'Goods value', 'Freight', 'Freight conditions', 'Tax treatment', 'Trade terms', 'Lead time', 'Known subtotal in original currency', 'Subtotal basis', 'Quotation valid until', 'Source file', 'Source caveats', 'Original quoted price', 'Units per quoted price'];
  const rows = comparePreview(quotes, req, offset).rows.map(row => {
    const f=getQuotationFacts(row.q, row.net).selected;
    return [
    row.q.values.supplier,
    row.eligible ? 'Preliminary comparable' : 'Not comparable',
    row.requiresReview ? 'Pending human review' : 'Reviewed',
    row.q.equivalent === true ? 'Human-confirmed' : row.specMatchedByText ? 'Requirement match; confirmation required' : 'Not confirmed',
    row.issues.join(' | '),
    row.net,
    row.order,
    row.total,
    row.q.values.arrival,
    row.deadline,
    f?.item, f?.currency, f?.unitPrice, f?.orderQuantity, f?.moq, f?.tier?.label,
    f?.goodsSubtotal, f?.freight.amount, f?.freight.label, f?.tax.label, f?.incoterm,
    f?.leadTime, f?.knownSubtotal, f?.subtotalLabel, f?.expiryDate, row.q.name, f?.caveats.join(' | '), f?.quotedPrice, f?.priceUnit,
  ]});
  return '\uFEFF' + [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
}
