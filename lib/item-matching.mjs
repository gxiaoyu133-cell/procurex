import {fields, labels} from './engine.mjs';
import {normalizeQuote, quotationFieldKey, quotationCells} from './rules.mjs';
import {applyQuantityToTier, recognizeQuotationStructure} from './quotation-structure.mjs';

const sharedFields = ['supplier', 'currency', 'basis', 'delivery', 'other', 'arrival', 'priceUnit', 'packSize', 'moq'];
const clean = value => String(value ?? '').normalize('NFKC').toLowerCase()
  // These are equivalent spellings of a unit, not approximate size matches.
  .replace(/(\d+(?:\.\d+)?)\s*[-–—]?\s*(?:inches\b|inch\b|in\b|英寸|["″”])/g, '$1 inch ')
  .replace(/(\d)\s+(gsm|mm|cm|kg|ml|gb|tb)\b/g, '$1$2')
  // A small, explicit product vocabulary also lets the procurement field use
  // Chinese without silently relaxing numerical or material specifications.
  .replace(/万圣节/g, ' halloween ').replace(/铝膜|铝箔/g, ' foil ').replace(/气球/g, ' balloon ')
  .replace(/[^\p{L}\p{N}.]+/gu, ' ').trim().replace(/\s+/g, ' ');
const tokens = value => clean(value).split(' ').map(word => /^[a-z]{4,}s$/.test(word)&&!/ss$/.test(word)?word.slice(0,-1):word).filter(word => word && !['of','the','a','an','for','and'].includes(word));
const splitRow = line => line.includes('\t') ? quotationCells(line, '\t') : line.includes('|') ? quotationCells(line.replace(/^\s*\||\|\s*$/g, ''), '|') : /\S\s{2,}\S/.test(line) ? line.trim().split(/\s{2,}/) : quotationCells(line, ',');

export function itemMatches(requirement, item) {
  const needed = tokens(requirement), available = new Set(tokens(item));
  return needed.length > 0 && needed.every(word => available.has(word));
}

function positiveQuantity(value) {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(String(value).replaceAll(',', ''));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function candidateAtQuantity(row, quantity) {
  const requestedQuantity = positiveQuantity(quantity);
  const minimum = positiveQuantity(row.values.moq);
  const multiple = positiveQuantity(row.values.packSize);
  let pricingQuantity = requestedQuantity === null ? null : Math.max(requestedQuantity, minimum || 0);
  if (pricingQuantity !== null && multiple) pricingQuantity = Math.ceil(pricingQuantity / multiple) * multiple;
  if (!Number.isSafeInteger(pricingQuantity)) pricingQuantity = null;
  const tier = applyQuantityToTier(row.tier, pricingQuantity);
  // An exact quoted quantity is useful as an alternative, but its unit price
  // must not silently be used for a different order quantity.
  const exactQuotedQuantity = row.tier?.min === row.tier?.max ? positiveQuantity(row.tier?.min) : null;
  const suggestedOrderQuantity = pricingQuantity !== null && exactQuotedQuantity > pricingQuantity
    ? exactQuotedQuantity : null;
  return {
    ...row,
    tier,
    requestedQuantity,
    pricingQuantity,
    quantityBasis: pricingQuantity === null ? null : multiple && pricingQuantity > Math.max(requestedQuantity, minimum || 0)
      ? 'pack-multiple' : minimum && minimum > requestedQuantity ? 'minimum-order' : 'requirement',
    suggestedOrderQuantity,
    orderSuggestionReason: suggestedOrderQuantity ? 'This price was quoted for '+suggestedOrderQuantity+' units; '+(suggestedOrderQuantity-requestedQuantity)+' more than the net requirement.' : '',
  };
}

function commonValues(lines) {
  // Only explicitly labelled terms outside item rows can become shared terms.
  const source = lines.filter(line => {
    const pair = line.match(/^([^:=：]+?)\s*[:=：]\s*(.+)$/);
    if (pair) return sharedFields.includes(quotationFieldKey(pair[1]));
    const row = splitRow(line);
    return row.length === 2 && sharedFields.includes(quotationFieldKey(row[0]));
  }).join('\n').replaceAll('：', ':');
  return normalizeQuote(source);
}

function candidate(raw, common, id, source, location, metadata = {}) {
  const parsed = normalizeQuote(raw.replaceAll('：', ':'));
  for (const field of sharedFields) {
    // Explicit unknowns in a row must not inherit a known global term.
    if (!(field in parsed.evidence) && common.values[field] !== null) {
      parsed.values[field] = common.values[field];
      parsed.evidence[field] = common.evidence[field];
    }
  }
  for (const [field, value] of Object.entries(metadata.values || {})) {
    if (fields.includes(field) && value !== undefined) parsed.values[field] = value;
  }
  Object.assign(parsed.evidence, metadata.evidence || {});
  return {id, values: parsed.values, evidence: parsed.evidence, source, location, structure:metadata.structure, structureType:metadata.structureType, tier:metadata.tier||null, productKey:metadata.productKey||clean(parsed.values.item), conditions:metadata.conditions||[], risks:metadata.risks||[]};
}

function explicitOrderLots(rows, text) {
  const products = new Set(rows.map(row=>row.productKey || clean(row.values.item)).filter(Boolean));
  return rows.map(row=>{
    // Respect a reviewed/explicit pack value, including an explicit unknown.
    if (row.values.packSize !== null && row.values.packSize !== undefined || row.evidence.packSize) return row;
    // Whole-document wording can only apply globally when there is one product.
    // A carton or bag count alone describes packaging and is never an order rule.
    const source = [row.source,row.evidence.moq,...(products.size===1?[text]:[])].filter(Boolean).join('\n');
    const lots = [...source.matchAll(/\b1\s*lot\s*=\s*([\d,]+)\s*(?:pcs?|pieces?|units?)\b/gi)]
      .map(match=>({size:Number(match[1].replaceAll(',','')),evidence:match[0]}))
      .filter(lot=>Number.isSafeInteger(lot.size) && lot.size>0);
    if (new Set(lots.map(lot=>lot.size)).size!==1) return row;
    return {...row,values:{...row.values,packSize:String(lots[0].size)},evidence:{...row.evidence,packSize:lots[0].evidence}};
  });
}

/** Keep each product and its price together. Never choose a row by price. */
export function extractQuoteItems(text, options = {}) {
  const lines = String(text).split(/\r?\n/), rows = [], consumed = new Set();
  const recognised = recognizeQuotationStructure(text, options);
  if (recognised.records.length) {
    const common = commonValues(lines);
    return explicitOrderLots(recognised.records.map((record, index) => candidate(
      Object.entries(record.values).filter(([, value]) => value !== null && value !== undefined && value !== '').map(([field, value]) => (field === 'basis' ? 'Cost basis' : field === 'priceUnit' ? 'Units per quoted price' : field === 'packSize' ? 'Order pack multiple' : field === 'moq' ? 'Minimum order' : field.charAt(0).toUpperCase() + field.slice(1)) + ': ' + value).join('\n'),
      common,
      record.structure?.kind === 'item-table' ? 'row-' + index : 'structured-' + index,
      record.source,
      record.location,
      {...record, risks:(record.conditions||[]).filter(condition=>!condition.resolved).map(condition=>condition.kind.charAt(0).toUpperCase()+condition.kind.slice(1)+' condition requires review: '+condition.text)},
    )),text);
  }
  for (let i = 0; i < lines.length; i++) {
    const headers = splitRow(lines[i]), keys = headers.map(quotationFieldKey);
    if (!keys.includes('item') || !keys.includes('price')) continue;
    consumed.add(i);
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (!lines[j].trim()) break;
      const cells = splitRow(lines[j]);
      if (cells.length < 2 || (cells.length === 2 && sharedFields.includes(quotationFieldKey(cells[0]))) || cells.some((cell, n) => quotationFieldKey(cell) === 'price' && keys[n] === 'price')) break;
      const item = keys.flatMap((key, n) => key === 'item' && cells[n] ? [cells[n]] : []).join(' ');
      if (!item || /^[-: ]+$/.test(item)) continue;
      const raw = ['Item: ' + item, ...keys.flatMap((key, n) => key && key !== 'item' ? [key + ': ' + (cells[n] || 'unknown')] : [])].join('\n');
      rows.push({raw, source: lines[i] + '\n' + lines[j], location: 'Row ' + (j + 1)});
      consumed.add(j);
    }
    i = j - 1;
  }
  if (rows.length) {
    const common = commonValues(lines.filter((_, i) => !consumed.has(i)));
    return explicitOrderLots(rows.map((row, i) => candidate(row.raw, common, 'row-' + i, row.source, row.location, {structure:recognised.structure,structureType:'tabular-items',conditions:recognised.conditions})),text);
  }
  const starts = lines.flatMap((line, i) => {
    const pair = line.match(/^([^:=：]+?)\s*[:=：]\s*(.+)$/);
    return pair && quotationFieldKey(pair[1]) === 'item' ? [i] : [];
  });
  if (starts.length > 1) {
    const common = commonValues(lines.slice(0, starts[0]));
    return explicitOrderLots(starts.map((start, i) => {
      const source = lines.slice(start, starts[i + 1] ?? lines.length).join('\n');
      return candidate(source, common, 'item-' + i, source, 'Item ' + (i + 1), {structure:recognised.structure,structureType:'key-value-blocks',conditions:recognised.conditions});
    }),text);
  }
  const parsed = normalizeQuote(String(text).replaceAll('：', ':'));
  const priceLines = lines.filter(line => /(?:S\$|SGD\s+)\s*[\d,.]+\s+per\b/i.test(line) || quotationFieldKey(line.split(/[:=：]/)[0]) === 'price');
  if (priceLines.length > 1) {parsed.values.price = null;parsed.evidence.price = 'Multiple prices without recognised item rows. Select the correct amount from the original source during review.';}
  return explicitOrderLots([{id: 'single', ...parsed, source: String(text), location: 'Quotation', structure:recognised.structure, structureType:recognised.structure.kind==='key-value'?'key-value':'unknown', tier:null, productKey:clean(parsed.values.item), conditions:recognised.conditions, risks:[...parsed.risks,...recognised.conditions.filter(condition=>!condition.resolved).map(condition=>condition.kind.charAt(0).toUpperCase()+condition.kind.slice(1)+' condition requires review: '+condition.text)]}],text);
}

export function selectQuoteItem(quote, requirement, chosenId, quantity) {
  const candidates = (quote.candidates || extractQuoteItems(quote.text, {quantity})).map(row => candidateAtQuantity(row, quantity));
  const itemMatchesRows = candidates.filter(row => itemMatches(requirement, row.values.item));
  const hasTierRows = itemMatchesRows.some(row => row.tier);
  const tierPool = hasTierRows && Number.isSafeInteger(Number(quantity)) && Number(quantity)>0 ? itemMatchesRows.filter(row=>!row.tier||row.tier.applicable===true) : itemMatchesRows;
  const sameRequirement = quote.match?.requirement === String(requirement ?? '');
  const previousProductKey = sameRequirement ? quote.match?.manualProductKey : '';
  const preferredPool = previousProductKey ? candidates.filter(row=>row.productKey===previousProductKey&&(!row.tier||row.tier.applicable!==false)) : tierPool;
  const automaticPool = previousProductKey && preferredPool.length ? preferredPool : tierPool;
  const chosen = chosenId ? candidates.find(row => row.id === chosenId) : automaticPool.length === 1 ? automaticPool[0] : null;
  const itemMatched = !!chosen && itemMatches(requirement, chosen.values.item);
  const tierMatched = !!chosen && (!chosen.tier || chosen.tier.applicable !== false);
  const matched = itemMatched && tierMatched;
  const status = chosen ? (matched ? chosenId ? 'selected' : 'matched' : 'manual') : !clean(requirement) ? 'waiting' : automaticPool.length > 1 ? 'ambiguous' : 'unmatched';
  const empty = Object.fromEntries(fields.map(key => [key, null]));
  // Keep only supplier identity when no row is selected. No unrelated price leaks into comparison.
  const supplier = candidates[0]?.values.supplier ?? null;
  const values = chosen ? {...chosen.values} : {...empty, supplier};
  const evidence = chosen ? {...chosen.evidence} : {};
  const noApplicableTier = hasTierRows && Number.isSafeInteger(Number(quantity)) && Number(quantity)>0 && tierPool.length===0;
  const quantityExplanation = chosen?.pricingQuantity > chosen?.requestedQuantity ? ' Pricing quantity is '+chosen.pricingQuantity+' after '+(chosen.quantityBasis==='pack-multiple'?'pack rounding':'the minimum order')+' ('+chosen.requestedQuantity+' required).' : '';
  const reason = status === 'waiting' ? 'Enter your required item to filter this file.' : status === 'ambiguous' ? automaticPool.length + ' matching rows. Choose the intended item or refine your specification.' : status === 'unmatched' ? noApplicableTier ? 'The item matches, but no quoted quantity tier covers '+quantity+' units after minimum-order and known pack adjustments.' : 'No matching item found. Refine the specification or review the source.' : status === 'manual' ? !tierMatched ? 'Selected price tier does not cover '+(chosen.pricingQuantity||quantity)+' units. Review the source before ranking.' : 'Selected item differs from the requirement. Review and confirm equivalence before ranking.' : (chosenId ? 'You selected this matching item.' : 'Matched the required item'+(chosen?.tier?' and selected the '+chosen.tier.label+' price tier':'')+'.') + quantityExplanation + ' ' + (candidates.length - itemMatchesRows.length) + ' unrelated row(s) filtered out.';
  const risks = [...new Set([...(chosen?.risks||[]),...fields.filter(key => values[key] === null).map(key => labels[key] + ' is unresolved.')])];
  if (!matched) risks.unshift(reason);
  const manualProductKey = chosenId ? chosen?.productKey||'' : previousProductKey||'';
  return {...quote, candidates, values, evidence, risks, structure:chosen?.structure||quote.structure||candidates[0]?.structure, structureType:chosen?.structureType||quote.structureType||candidates[0]?.structureType, tier:chosen?.tier||null, conditions:chosen?.conditions||quote.conditions||candidates[0]?.conditions||[], reviewed:false, equivalent:false, match:{status, requirement:String(requirement ?? ''), selectedId:chosen?.id ?? '', manualProductKey, matches:automaticPool.length, filtered:candidates.length-itemMatchesRows.length, reason, source:chosen?.source ?? '', location:chosen?.location ?? '', matchesRequirement:matched,requestedQuantity:positiveQuantity(quantity),pricingQuantity:chosen?.pricingQuantity??null,quantityBasis:chosen?.quantityBasis??null}};
}
