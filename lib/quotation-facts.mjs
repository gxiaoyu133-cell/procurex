// Read-only presentation of extracted facts. A useful source fact is not the
// same as a verified, like-for-like offer; this module never changes ranking.
import {quotationCells, quotationFieldKey} from './rules.mjs';
const compact = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const amount = value => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(String(value).replace(/,/g, ''))) ? Number(String(value).replace(/,/g, '')) : null;
const rounded = value => Math.round((value + Number.EPSILON) * 1000000) / 1000000;
const unique = values => [...new Set(values.filter(Boolean))];
const linesOf = text => String(text || '').split(/\r?\n/).filter(line => line.trim());
const cells = line => line.includes('\t') ? quotationCells(line,'\t').map(compact) : line.includes('|') ? quotationCells(line.replace(/^\s*\||\|\s*$/g, ''),'|').map(compact) : line.includes(';') ? quotationCells(line,';').map(compact) : line.includes(',') ? quotationCells(line,',').map(compact) : line.trim().split(/\s{2,}/).map(compact);

function rowDetail(candidate, name) {
  const lines = linesOf(candidate.source);
  for (let i = 0; i < lines.length - 1; i++) {
    const headers = cells(lines[i]), index = headers.findIndex(header => name.test(header));
    if (index >= 0 && headers.length > 1) {
      const value = cells(lines[i + 1])[index];
      if (value) return {value, evidence: headers[index] + ': ' + value};
    }
  }
  return null;
}

function taxFacts(values, lines, candidate) {
  const row = rowDetail(candidate, /^(?:tax|gst|vat)(?:\s|$)|^(?:税率|税费|含税情况|税务处理)$/i);
  const sources = unique([row?.evidence, ...lines.filter(line => /\b(?:gst|vat|tax|taxes)\b|税率|含税|未税/i.test(line) && !/^\s*\d+\.\s*(?:taxes?|taxes?\s*&\s*freight)\s*$/i.test(line)).map(compact)]);
  const rateLine = sources.find(line => /\b(?:gst|vat|tax)\b.*?\d|\d+(?:\.\d+)?\s*%\s*(?:gst|vat)|税率.*?\d/i.test(line));
  let rate = null;
  if (rateLine) {
    const percent = rateLine.match(/(\d+(?:\.\d+)?)\s*%/);
    const fractional = rateLine.match(/\b(?:gst|vat)\b[^\d]*(0\.\d+)\b/i);
    rate = percent ? Number(percent[1]) : fractional ? Number(fractional[1]) * 100 : null;
  }
  const onCif = sources.some(line => /\bCIF\b/i.test(line));
  const basis = values.basis || (sources.some(line => /(?:inclusive|included)/i.test(line) && !/not included/i.test(line)) ? 'tax-inclusive' : sources.some(line => /exclud|exclusive|borne by buyer/i.test(line)) ? 'pre-tax' : null);
  const taxName = onCif ? 'import GST on CIF' : /\bGST\b/i.test(rateLine || '') ? 'GST' : /\bVAT\b/i.test(rateLine || '') ? 'VAT' : 'tax';
  const label = rate !== null ? `${rounded(rate)}% ${taxName}${basis === 'tax-inclusive' ? ' included' : onCif ? ' · buyer pays' : basis === 'pre-tax' ? ' excluded' : ''}` : basis === 'tax-inclusive' ? 'Tax included; rate not stated' : basis === 'pre-tax' ? 'Tax excluded; rate not stated' : 'Tax treatment not stated';
  return {rate, basis, onCif, label, evidence:sources.join('\n')};
}

function freightFacts(values, lines, goodsSubtotal, currency, candidate, orderQuantity) {
  const numeric = amount(values.delivery);
  const option = rowDetail(candidate, /^(?:freight|shipping|delivery)\s*(?:option|method|service)$/i)?.value;
  if (numeric !== null) return {amount:numeric, indicative:false, conditional:false, label:option || (numeric === 0 ? 'Delivery included' : 'Quoted freight'), evidence:values.delivery === undefined ? '' : candidate.evidence?.delivery || 'Freight: ' + numeric};
  const row = rowDetail(candidate, /^(?:(?:freight|shipping|delivery)(?:\s+(?:cost|charge|fee))?(?:\s*\([^)]*\))?|运费|配送费|运输费用)$/i);
  if (row && /unknown|tbc|pending|confirm|not specified|待确认|未知|未说明/i.test(row.value)) return {amount:null,indicative:false,conditional:true,label:'Freight requires supplier confirmation',evidence:row.evidence};
  const sources = lines.filter(line => /\b(?:delivery|freight|shipping)\b/i.test(line)).map(compact);
  const free = sources.find(line => /\b(?:free|included)\b/i.test(line) && /\b(?:delivery|shipping|freight)\b/i.test(line) && !/not\s+(?:free|included)/i.test(line));
  if (free) {
    const threshold = free.match(/\b(?:above|over|more than|at least)\s+(?:SGD|USD|S\$|US\$|\$)?\s*([\d,]+(?:\.\d+)?)/i);
    const atLeast = /at least/i.test(threshold?.[0] || '');
    const limit = threshold ? Number(threshold[1].replace(/,/g, '')) : null;
    if (limit === null && !/\b(?:if|subject|conditional)\b/i.test(free)) return {amount:0, indicative:false, conditional:/\blocal\b/i.test(free), label:/\blocal\b/i.test(free)?'Free local delivery':'Delivery included', evidence:free};
    if (limit !== null && goodsSubtotal !== null && (atLeast ? goodsSubtotal >= limit : goodsSubtotal > limit)) return {amount:0, indicative:false, conditional:true, label:'Free local delivery · qualifying order', evidence:free};
    const below = sources.find(line => /\bbelow\b/i.test(line) && /\bcharge\b/i.test(line));
    if (below && goodsSubtotal !== null && limit !== null && goodsSubtotal < limit) {
      const charge = below.match(/\bcharge\s+of\s+(?:SGD|USD|S\$|US\$|\$)\s*([\d,]+(?:\.\d+)?)/i);
      if (charge) return {amount:Number(charge[1].replace(/,/g,'')), indicative:false, conditional:true, label:'Local delivery · below free-delivery threshold', evidence:below};
    }
  }
  const quoted = sources.find(line => /(?:SGD|USD|S\$|US\$)\s*[\d,.]+\s*\/\s*(?:shipment|order)\b/i.test(line));
  if (quoted) {
    const match = quoted.match(/(SGD|USD|S\$|US\$)\s*([\d,]+(?:\.\d+)?)\s*\/\s*(?:shipment|order)\b/i);
    const code = match[1] === 'S$' ? 'SGD' : match[1] === 'US$' ? 'USD' : match[1].toUpperCase();
    if (!currency || code === currency) {
      const indicative = /\b(?:reference|approx|subject|estimate|indicative)\b/i.test(quoted) || sources.some(line => /final rate subject/i.test(line));
      const quotedIndex = lines.findIndex(line=>compact(line)===quoted);
      const context = compact(lines[quotedIndex + 1]);
      const referenceQty = context.match(/^\(?([\d,]+)\s*(?:pcs|pieces|units)\b/i);
      if (referenceQty && Number(referenceQty[1].replace(/,/g,'')) !== orderQuantity) return {amount:null, indicative:true, conditional:true, label:`Freight reference covers ${referenceQty[1]} units; requote needed`, evidence:quoted+'\n'+context};
      return {amount:Number(match[2].replace(/,/g,'')), indicative, conditional:false, label:indicative?'Reference freight · confirm final rate':'Quoted freight per shipment', evidence:quoted+(referenceQty?'\n'+context:'')};
    }
  }
  return {amount:null, indicative:false, conditional:!!free, label:free ? 'Conditional delivery · confirm threshold' : 'Freight not priced', evidence:free || sources.filter(line=>/charge|cost|rate|confirm|reference/i.test(line)).join('\n')};
}

function leadTimeFacts(lines, candidate) {
  const row = rowDetail(candidate, /(?:lead\s*time|delivery\s*lead|transit\s*time)|^(?:交期|交货周期|运输时效)$/i);
  if (row) return {label:row.value, evidence:row.evidence};
  const total = lines.find(line => /(?:total\s+door.to.door|total\s+(?:delivery|lead|transit)\s*time)/i.test(line) && /\d/.test(line));
  const local = lines.find(line => /local stock/i.test(line) && /\d/.test(line));
  const relative = lines.filter(line => /(?:lead time|working days|business days|production\s*:|door.to.door|sea freight\s*:\s*\d)/i.test(line) && /\d/.test(line));
  if (total) return {label:compact(total.replace(/^[^:]+:\s*/,'')) + ' door-to-door', evidence:relative.map(compact).join('\n')};
  if (local) {
    const match = local.match(/\d+\s*[–—-]\s*\d+\s*(?:working|business)?\s*days/i);
    return {label:(match ? match[0] : compact(local)) + ' · local stock', evidence:relative.map(compact).join('\n')};
  }
  return {label:relative[0] ? compact(relative[0]).replace(/^lead time\s*:\s*/i,'') : '', evidence:relative.map(compact).join('\n')};
}

function orderFor(candidate, quantity) {
  const values = candidate.values || {}, moq = amount(values.moq), pack = amount(values.packSize);
  let order = Math.max(quantity || 0, moq || 0);
  if (pack && order) order = Math.ceil(order / pack) * pack;
  const tier = candidate.tier;
  let suggested = false;
  if (tier && order < (tier.min || 0)) {order = amount(candidate.suggestedOrderQuantity) || tier.min; suggested = true;}
  return {quantity:order || null, suggested, withinTier:!tier || (order >= (tier.min || 0) && (tier.max === null || tier.max === undefined || order <= tier.max))};
}

function chooseTier(group, quantity, selectedId) {
  const selected = group.find(row => row.id === selectedId);
  if (selected) return selected;
  const evaluated = group.map(row => ({row, order:orderFor(row, quantity)}));
  const fitting = evaluated.filter(value => value.order.withinTier && !value.order.suggested);
  if (fitting.length) return fitting.sort((a,b)=>(b.row.tier?.min || 0)-(a.row.tier?.min || 0))[0].row;
  return evaluated.filter(value => value.order.withinTier).sort((a,b)=>(a.order.quantity || Infinity)-(b.order.quantity || Infinity))[0]?.row || group[0];
}

function factsFor(candidate, quote, quantity, lines) {
  if (candidate.structureType === 'key-value-blocks') {
    const firstItem = lines.findIndex(line=>quotationFieldKey(line.split(/[:=：]/)[0])==='item');
    lines = [...(firstItem>=0 ? lines.slice(0,firstItem) : []), ...linesOf(candidate.source)];
  } else {
    // A different product's row must never supply this product's tax or lead time.
    lines = lines.filter(line=>!(line.includes('\t') || line.includes(';') || line.includes('|')) || cells(line).length<=2 || /^(?:tax|gst|vat|note|税费|税率|备注)\b/i.test(line.trim()));
  }
  const isSelected = candidate.id === quote.match?.selectedId;
  const values = isSelected ? {...candidate.values,...quote.values} : candidate.values || {};
  const quotedPrice = amount(values.price), priceUnit = amount(values.priceUnit), currency = values.currency || null;
  const unitPrice = quotedPrice !== null && priceUnit > 0 ? rounded(quotedPrice/priceUnit) : null;
  const order = orderFor({...candidate,values},quantity);
  const goodsSubtotal = quotedPrice !== null && priceUnit > 0 && order.quantity !== null && order.withinTier ? rounded(quotedPrice / priceUnit * order.quantity) : null;
  const freight = freightFacts(values, lines, goodsSubtotal, currency, candidate, order.quantity);
  const tax = taxFacts(values, lines, candidate);
  const lead = leadTimeFacts(lines, candidate);
  const incotermSource = lines.find(line=>/\b(?:EXW|FOB|CIF|CFR|DAP|DDP|FCA)\b/i.test(line) && !/\b(?:gst|tax)\b/i.test(line));
  const incoterm = incotermSource?.match(/\b(?:EXW|FOB|CIF|CFR|DAP|DDP|FCA)\b(?:\s+[\p{L} -]+)?/iu)?.[0]?.trim().replace(/[,.;].*$/,'') || '';
  const other = amount(values.other);
  const knownSubtotal = goodsSubtotal === null ? null : rounded(goodsSubtotal + (freight.amount || 0) + (other || 0));
  const displayOnly = !isSelected || !quote.match?.matchesRequirement;
  const caveats = [];
  if (displayOnly) caveats.push('Specification requires confirmation; source facts are shown for review.');
  if (/indicative wholesale|final pricing will depend/i.test(quote.text || '')) caveats.push('Supplier describes pricing as indicative.');
  if (order.suggested) caveats.push(`Quoted price applies ${candidate.tier?.min===candidate.tier?.max?'at':'from'} ${order.quantity?.toLocaleString('en-US')} units; this order quantity needs confirmation.`);
  else if (order.quantity && order.quantity > quantity && quantity > 0) caveats.push(`Order raised from ${quantity.toLocaleString('en-US')} to ${order.quantity.toLocaleString('en-US')} to meet MOQ / pack size.`);
  if (!order.withinTier) caveats.push('Requested quantity exceeds this quoted price tier.');
  if (freight.amount === null) caveats.push('Freight not included in subtotal.');
  if (freight.indicative) caveats.push('Freight is a reference estimate; confirm final rate.');
  if (freight.conditional) caveats.push('Delivery amount depends on the stated freight conditions.');
  if (tax.basis !== 'tax-inclusive') caveats.push(tax.onCif ? 'Import GST and unquoted insurance are excluded; complete CIF value is needed.' : 'Tax is excluded or unconfirmed.');
  if (other === null) caveats.push('Other charges are not specified.');
  const knownComponents = ['goods',freight.amount !== null ? 'freight' : '',other !== null ? 'other charges' : ''].filter(Boolean);
  const componentsLabel = knownComponents.join(' + ').replace(/^goods/,'Goods');
  const taxLabel = tax.basis === 'tax-inclusive' ? 'GST included' : tax.onCif ? 'before import GST' : tax.basis === 'pre-tax' ? 'before tax' : 'tax unconfirmed';
  const subtotalLabel = freight.amount === null ? `${componentsLabel}${knownComponents.length===1?' only':''} · freight not priced` : freight.indicative ? 'Indicative · '+taxLabel : componentsLabel+' · '+taxLabel;
  const validity = lines.find(line=>/^\s*valid\s*(?:until|through|to)\s*[:\t]/i.test(line));
  const dateText = validity?.replace(/^\s*valid\s*(?:until|through|to)\s*[:\t]\s*/i,'').replace(/\s*\(.*/,'').trim();
  const isoDate = dateText?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  const dateValue = dateText && !isoDate ? Date.parse(dateText+' UTC') : NaN;
  const expiryDate = isoDate || (Number.isFinite(dateValue) ? new Date(dateValue).toISOString().slice(0,10) : null);
  return {
    candidateId:candidate.id, item:values.item || 'Unlabelled product', currency, unitPrice, quotedPrice, priceUnit,
    moq:amount(values.moq), packSize:amount(values.packSize), tier:candidate.tier || null,
    requestedQuantity:quantity, orderQuantity:order.quantity, quantitySuggested:order.suggested,
    goodsSubtotal, freight, tax, incoterm, leadTime:lead.label, arrival:values.arrival || null,
    knownSubtotal, subtotalLabel,
    subtotalIncludes:knownComponents.join(' + '), taxAmount:tax.basis === 'tax-inclusive' && tax.rate !== null && goodsSubtotal !== null ? rounded(goodsSubtotal-goodsSubtotal/(1+tax.rate/100)) : null,
    displayOnly, caveats, expiryDate, location:candidate.location || '', source:candidate.source || '',
    evidence:{...candidate.evidence,tax:tax.evidence,freight:freight.evidence,leadTime:lead.evidence,incoterm:incotermSource || ''},
  };
}

/** Useful extracted facts, including a clearly marked proposal when matching fails. */
export function getQuotationFacts(quote, netQuantity) {
  const quantity = Math.max(0, amount(netQuantity) || 0), lines = linesOf(quote.text);
  const candidates = quote.candidates?.length ? quote.candidates : [{id:'single',values:quote.values || {},evidence:quote.evidence || {},source:quote.text || ''}];
  const groups = new Map();
  for (const row of candidates) {
    const key = row.productKey || compact(row.values?.item).toLowerCase() || row.id;
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(row);
  }
  const products = [...groups.values()].map(group => {
    const candidate = chooseTier(group, quantity, quote.match?.selectedId);
    return {...factsFor(candidate,quote,quantity,lines), tiers:group.map(row=>factsFor(row,quote,quantity,lines))};
  });
  const selected = products.find(row=>row.candidateId===quote.match?.selectedId) || products[0] || null;
  return {supplier:quote.values?.supplier || candidates[0]?.values?.supplier || 'Unnamed supplier', selected, products, displayOnly:selected?.displayOnly ?? true, matchStatus:quote.match?.status || 'unmatched', caveats:selected?.caveats || []};
}

export const buildQuotationFacts = getQuotationFacts;
