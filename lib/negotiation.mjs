import { fields, labels } from './engine.mjs';

const hasValue = value => value !== null && value !== undefined && String(value).trim() !== '';
const finite = value => hasValue(value) && Number.isFinite(Number(value));
const cash = value => 'S$' + Number(value).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cleanLine = value => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''));

/** Local drafting rules only. Returned text is a buyer draft, never a sent message. */
export function createNegotiationMessage(result, req, quoteId, options = {}) {
  const row = result.rows.find(item => String(item.q.id) === String(quoteId));
  if (!row) throw new Error('Choose a supplier quotation before creating a draft.');
  const v = row.q.values;
  const name = cleanLine(v.supplier) || 'Supplier';
  const goal = ['price', 'delivery', 'moq', 'clarify'].includes(options.goal) ? options.goal : 'clarify';
  const firm = options.tone === 'firm';
  const pending = !row.q.reviewed || !row.q.equivalent;
  const deadline = validDate(row.deadline) ? row.deadline : validDate(req.deadline) ? req.deadline : null;
  const net = finite(row.net) && Number.isSafeInteger(Number(row.net)) && Number(row.net) >= 0 ? Number(row.net) : null;
  const totalKnown = v.currency === 'SGD' && v.basis === 'pre-tax' && finite(row.total) && Number(row.total) >= 0;
  const quotedMoney = value => !hasValue(value) ? 'unknown — please confirm' : finite(value) && Number(value) >= 0 && v.currency === 'SGD' ? cash(value) : cleanLine(value) + ' ' + cleanLine(v.currency || '(currency unconfirmed)');
  const facts = [
    'Item: ' + (cleanLine(v.item) || cleanLine(req.item) || 'please confirm the specification'),
    'Quoted delivery charge: ' + quotedMoney(v.delivery),
    'Quoted other charges: ' + quotedMoney(v.other),
    'Quoted minimum order: ' + (hasValue(v.moq) ? cleanLine(v.moq) + ' units' : 'unknown — please confirm'),
    'Quoted arrival: ' + (hasValue(v.arrival) ? cleanLine(v.arrival) : 'unknown — please confirm'),
    'Required arrival for this scenario: ' + (deadline || 'to be agreed'),
    'Net purchasing requirement: ' + (net === null ? 'to be confirmed' : net + ' units'),
    'Calculated pre-tax total: ' + (totalKnown ? cash(row.total) : 'unresolved; missing or incompatible terms must be confirmed')
  ];
  const evidence = [...(pending ? ['Internal review pending: quotation fields and equivalent specification must be checked.'] : []), ...facts, ...row.issues.map(issue => 'Comparison condition: ' + issue)];
  const asks = [];
  const winner = result.winner;
  const comparable = winner?.eligible && winner.q?.reviewed && winner.q?.equivalent && finite(winner.total) && winner.q.values.currency === 'SGD' && winner.q.values.basis === 'pre-tax';
  if (goal === 'price') {
    if (comparable && String(winner.q.id) !== String(row.q.id)) {
      asks.push('We have another comparable offer at ' + cash(winner.total) + ' before tax. Can you match or improve this total, including delivery and other charges, with the same specification and required arrival date?');
    } else {
      asks.push('Please provide your best revised pre-tax total, including delivery and all other charges, for our net purchasing requirement' + (net === null ? '' : ' of ' + net + ' units') + '.');
    }
    if (hasValue(options.target)) asks.push('Our requested price target is ' + (finite(options.target) && Number(options.target) >= 0 ? cash(options.target) + ' total before tax, including delivery and other charges' : cleanLine(options.target)) + '. This is a buyer request for your consideration; please confirm whether you can offer it.');
    asks.push('Please state any conditions, price validity and changes to the quoted terms.');
  } else if (goal === 'delivery') {
    asks.push(deadline ? 'Can you commit to arrival at our delivery address by ' + deadline + '?' : 'Please confirm the earliest arrival date you can commit to.');
    asks.push('Please confirm the delivery charge and any surcharge for this commitment before we accept revised terms.');
  } else if (goal === 'moq') {
    asks.push(net === null ? 'Please confirm your minimum order quantity and pack multiple for this item.' : net === 0 ? 'Our confirmed usable stock covers the current requirement. Please confirm whether your quotation can be retained for a future purchase without placing an order now.' : 'Our net purchasing requirement is ' + net + ' units after usable stock. Can you offer an order quantity closer to this requirement by reducing the minimum order or allowing a smaller pack multiple?');
    if (net !== null && net > 0 && finite(row.order) && Number(row.order) > net) asks.push('The current minimum order and pack rules result in ' + row.order + ' units, which is ' + (Number(row.order) - net) + ' units above our requirement.');
    asks.push('Please quote the revised quantity, unit pricing, delivery charge and arrival date together.');
  } else {
    const unknown = fields.filter(key => !hasValue(v[key]));
    if (unknown.length) asks.push('Please confirm the following missing terms: ' + unknown.map(key => labels[key].toLowerCase()).join(', ') + '.');
    if (!row.q.equivalent && hasValue(v.item)) asks.push('Please confirm that the offered item meets our required specification: ' + cleanLine(req.item) + '.');
    if (hasValue(v.currency) && v.currency !== 'SGD') asks.push('Please provide the quotation in SGD.');
    if (hasValue(v.basis) && v.basis !== 'pre-tax') asks.push('Please provide a pre-tax breakdown so we can compare like for like.');
    if (validDate(v.arrival) && deadline && v.arrival > deadline) asks.push('Can you bring arrival forward to ' + deadline + ' and confirm any additional charge?');
    if (row.issues.some(issue => /positive|invalid\.|numeric range/.test(issue)) && !unknown.length) asks.push('Please verify the price, pricing unit, pack multiple, minimum order and arrival date on a corrected quotation.');
    if (!unknown.length && row.issues.some(issue => /charges must be/.test(issue))) asks.push('Please confirm all delivery and other charges explicitly, including any zero charges.');
    if (!asks.length) asks.push('Please confirm the specification, order quantity, delivery and other charges, and arrival date remain valid.');
    asks.push('Please send a revised quotation or a written clarification for any changed terms.');
  }
  const title = { price: 'Revised quotation request', delivery: 'Delivery commitment request', moq: 'Order quantity request', clarify: 'Quotation clarification request' }[goal];
  const briefFacts = [
    totalKnown ? cash(row.total) + ' calculated total before tax' : null,
    finite(v.delivery) && Number(v.delivery) >= 0 && v.currency === 'SGD' ? cash(v.delivery) + ' delivery' : null,
    validDate(v.arrival) ? 'arrival ' + v.arrival : null
  ].filter(Boolean);
  const body = [
    'Subject: ' + title + ' — ' + (cleanLine(req.item) || cleanLine(v.item) || 'Procurement enquiry'),
    'Hello ' + name + ',',
    pending ? 'We are checking your quotation. The figures below are provisional until reviewed.' : 'Thank you for your quotation.',
    ...(briefFacts.length ? ['Current quotation: ' + briefFacts.join('; ') + '.'] : []),
    (firm ? 'Please address these points:' : 'Could you help with the following?') + '\n\n' + asks.map((ask, index) => (index + 1) + '. ' + ask).join('\n\n')
  ];
  if (hasValue(options.notes)) body.push('Additional buyer request:\n' + String(options.notes));
  body.push(firm ? 'Please confirm the revised terms in writing before we proceed. This enquiry is not a purchase order.' : 'Thank you. Please confirm any revised terms in writing. This enquiry is not a purchase order.', 'Best regards,\nPurchasing team');
  const action = {
    price: 'Ask ' + name + ' for a revised total including every charge' + (comparable && String(winner.q.id) !== String(row.q.id) ? ', aiming to match ' + cash(winner.total) : '') + '.',
    delivery: 'Ask ' + name + ' to confirm ' + (deadline ? 'arrival by ' + deadline : 'the earliest available arrival date') + ' and the delivery fee.',
    moq: 'Ask ' + name + ' to ' + (net === null ? 'confirm the minimum order and pack multiple' : net === 0 ? 'hold the quotation for a future purchase; current stock covers demand' : 'reduce the order towards your ' + net + '-unit net requirement') + '.',
    clarify: 'Ask ' + name + ' to confirm the quoted terms' + (row.issues.length ? ' and resolve ' + row.issues.length + ' flagged comparison condition(s)' : '') + '.'
  }[goal];
  return {
    message: body.join('\n\n'),
    summary: (pending ? 'Review pending. ' : '') + action + ' Draft only — review and copy when ready.',
    evidence
  };
}
