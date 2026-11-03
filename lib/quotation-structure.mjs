import {quotationCells, quotationFieldKey as baseFieldKey} from './rules.mjs';

const structure = (kind, evidence) => ({
  kind,
  label: kind === 'tier-table' ? 'Tiered price table' : kind === 'item-table' ? 'Price table' : kind === 'narrative' ? 'Natural language' : kind === 'key-value' ? 'Structured fields' : 'Unrecognised layout',
  evidence,
});

const compact = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const keyText = value => compact(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
// Extra source labels are kept here instead of widening arithmetic field rules.
const headerAliases = {supplier:['vendor name','seller','供货商','供货单位'],item:['item description','goods description','商品描述','产品描述','物料名称'],price:['rate','unit cost','单价','含税单价','未税单价'],priceUnit:['price quantity','每价数量'],packSize:['order multiple','订购倍数'],moq:['min qty','min order qty','最低起订量','最小起订量'],delivery:['shipping cost','运输费用'],arrival:['eta','预计到货日期']};
const quotationFieldKey = header => {
  const clean = compact(header).toLowerCase().replace(/\s*[([][^)\]]*[)\]]\s*/g,' ').replace(/\s*\/\s*(?:pcs?|pieces?|units?|sets?|个|件|套)\s*$/i,'').trim();
  return baseFieldKey(header) || Object.keys(headerAliases).find(key=>headerAliases[key].includes(clean));
};
const numeric = value => {
  let text = compact(value);
  if (!text || /(?:unknown|unresolved|tbc|to be confirmed|pending|not specified|n\/a|to be agreed|estimate|approx|subject|from\s|待确认|未知|未说明|暂定|约|起)|[=%<>]/i.test(text)) return null;
  text = text.replace(/^(?:SGD|USD|EUR|GBP|CNY|RMB|AUD|JPY|S\$|US\$|[$€£¥])\s*/i,'').replace(/\s*(?:SGD|USD|EUR|GBP|CNY|RMB|AUD|JPY)$/i,'').replace(/\s*(?:\/|per\s+)?\s*(?:pcs?|pieces?|units?|sets?|each|ea|reams?|个|件|套)\s*$/i,'').trim();
  // Preserve decimal commas without treating an arbitrary token / cell address as money.
  if (/^-?\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(text)) text = text.replace(/\./g,'').replace(',','.');
  else if (/^-?\d+,\d{1,2}$/.test(text)) text = text.replace(',','.');
  else if (/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text)) text = text.replace(/,/g,'');
  return /^-?\d+(?:\.\d+)?$/.test(text) ? text : null;
};
const splitRow = line => {
  if (line.includes('\t')) return quotationCells(line,'\t');
  if (line.includes('|')) return quotationCells(line.replace(/^\s*\||\|\s*$/g,''),'|');
  const separators = [';',','].map(separator=>({separator,cells:quotationCells(line,separator)})).sort((a,b)=>b.cells.length-a.cells.length);
  return separators[0].cells.length>1 ? separators[0].cells : /\S\s{2,}\S/.test(line) ? line.trim().split(/\s{2,}/) : [line.trim()];
};
const quoteUnit = header => {
  if (/\b(?:carton|box|pack|lot|bag)\b|[箱盒包袋]/i.test(header)) return null;
  return /(?:\/|\bper\s+)(?:pc|pcs|piece|pieces|unit|units|set|sets|each|ea|ream|reams)\b|\/(?:个|件|套)/i.test(header) || /^(?:unit price|unit cost|单价|含税单价|未税单价)(?:\s|\(|$)/i.test(compact(header)) ? '1' : null;
};
const itemAttribute = header => /^(?:item\s*(?:no\.?|number|code)|sku|model|size|style|styles|material|colour|color|variant|specification|specifications|description|货号|型号|尺寸|颜色|规格|材质)$/i.test(compact(header));
const tierHeader = header => /^(?:(?:qty|quantity|order quantity)\s*(?:tier|break|range)?|price\s*(?:tier|break))\b|^(?:数量区间|数量阶梯|订购数量|采购数量|数量)(?:\s|\(|$)/i.test(compact(header));
const metadataItem = item => /^(?:sub\s*total|grand\s*total|total|tax|gst|vat|discount|freight|shipping|delivery|notes?|terms|payment|合计|总计|小计|税额|税费|运费|备注|折扣)(?:\s|:|$)/i.test(compact(item));
const quantityAmount = value => numeric(compact(value).replace(/\s*\([^)]*\)\s*$/, ''));
const taxBasis = value => /(?:tax[- ]exclusive|pre[- ]tax|(?:gst|vat|tax)\s+(?:excluded|exclusive)|(?:excluded|exclusive)\b.*(?:gst|vat|tax)|不含税|未税)/i.test(value) ? 'pre-tax' : /(?:tax[- ]inclusive|(?:gst|vat|tax)\s+(?:included|inclusive)|(?:included|inclusive)\b.*(?:gst|vat|tax)|含税)/i.test(value) ? 'tax-inclusive' : null;
const companyLine = line => /\b(?:pte\.?\s*lt[d.]?|co\.?\s*,?\s*lt[d.]?|limited|inc\.?|llc)\b/i.test(line) && !/^(?:to|attn|address|email|tel|website)\s*:/i.test(line);

function pairFromLine(line) {
  const cells = splitRow(line);
  if (cells.length === 2 && cells[0] && cells[1]) return [cells[0], cells[1]];
  const pair = line.match(/^([^:=：]+?)\s*[:=：]\s*(.+)$/);
  return pair ? [pair[1], pair[2]] : null;
}

export function parseQuantityTier(value) {
  const label = compact(value);
  const normal = label.replace(/[–—−]/g, '-').replace(/,/g, '');
  let match = normal.match(/(\d+)\s*(?:-|to)\s*(\d+)/i);
  if (match) return {label, min: Number(match[1]), max: Number(match[2]), quantity: null, applicable: null};
  match = normal.match(/(?:>=|at least|from)\s*(\d+)/i) || normal.match(/(\d+)\s*(?:\+|and above|or more)/i);
  if (match) return {label, min: Number(match[1]), max: null, quantity: null, applicable: null};
  match = normal.match(/(?:<=|up to|under)\s*(\d+)/i);
  if (match) return {label, min: 0, max: Number(match[1]), quantity: null, applicable: null};
  match = normal.match(/^(\d+)\s*(?:pcs?|pieces?|units?|sets?|reams?)?$/i);
  return match ? {label, min: Number(match[1]), max: null, quantity: null, applicable: null, priceBreak: true} : null;
}

export function applyQuantityToTier(tier, quantity) {
  if (!tier) return null;
  const requested = Number(quantity);
  const valid = Number.isSafeInteger(requested) && requested > 0;
  return {
    ...tier,
    quantity: valid ? requested : null,
    applicable: valid ? requested >= (tier.min ?? 0) && (tier.max === null || tier.max === undefined || requested <= tier.max) : null,
  };
}

function extractConditions(lines) {
  const conditions = [];
  for (const original of lines) {
    const line = compact(original);
    const tabular = original.includes('\t') && splitRow(original).length > 3;
    if (tabular && !/^\s*(?:tax|note)\b/i.test(original)) continue;
    if (/^\d+\.\s*(?:taxes?|lead time|delivery\s*\/\s*freight)\s*$/i.test(line) || /^\d+\.\s*taxes?\s*&\s*freight\s*$/i.test(line)) continue;
    let kind = '';
    if (/\b(?:tax|taxes|gst|duty)\b/i.test(line)) kind = 'tax';
    else if (/\b(?:freight|shipping|delivery charge|delivery fee)\b/i.test(line)) kind = 'freight';
    else if (/\b(?:indicative|final pricing|price depends|prices? .*depend|verify before use)\b/i.test(line)) kind = 'pricing';
    else if (/\b(?:lead time|working days|business days|production\s*:|door-to-door|sea freight\s*:\s*\d)\b/i.test(line)) kind = 'lead-time';
    if (!kind) continue;
    let resolved = false;
    if (kind === 'tax' && /\b0\s*%/.test(line) && !/\b9\s*%/.test(line)) resolved = true;
    if (kind === 'tax' && /\binclusive of\s+\d+(?:\.\d+)?\s*%\s*(?:gst|tax)\b/i.test(line)) resolved = true;
    if (kind === 'freight' && /\b(?:delivery|freight)\s+(?:included|free)\b/i.test(line) && !/\b(?:above|below|if|subject|reference|approx)\b/i.test(line)) resolved = true;
    conditions.push({kind, text: line, resolved});
  }
  const seen = new Set();
  return conditions.filter(condition => {
    const id = condition.kind + ':' + condition.text.toLowerCase();
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, 12);
}

function globalFacts(lines) {
  const values = {}, evidence = {};
  const put = (key, value, source) => {
    if (value === null || value === undefined || value === '') return;
    values[key] = String(value);
    evidence[key] = compact(source);
  };
  for (const line of lines) {
    const pair = pairFromLine(line);
    if (!pair) continue;
    const key = quotationFieldKey(pair[0]);
    if (key === 'supplier') put('supplier', compact(pair[1]), line);
    if (key === 'currency') {
      const code = compact(pair[1]).match(/\b(?:SGD|USD|EUR|GBP|CNY|RMB|AUD|JPY)\b/i)?.[0];
      if (code) put('currency', code.toUpperCase() === 'RMB' ? 'CNY' : code.toUpperCase(), line);
    }
    if (key === 'moq') { const amount = quantityAmount(pair[1]); if (amount) put('moq', amount, line); }
    if (key === 'packSize') { const amount = quantityAmount(pair[1]); if (amount) put('packSize', amount, line); }
    if (key === 'basis') { const basis = taxBasis(pair[1]); if (basis) put('basis', basis, line); }
    if (key === 'arrival') {
      const date = compact(pair[1]).match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
      if (date) put('arrival', date, line);
    }
    if (key === 'delivery' && !/\b(?:subject|reference|approx|above|below|if|exclude|option)\b/i.test(line)) {
      const amount = numeric(pair[1]);
      if (amount) put('delivery', amount, line);
    }
    if (key === 'other') { const amount = numeric(pair[1]); if (amount) put('other', amount, line); }
  }
  if (!values.supplier) {
    const heading = lines.findIndex(line => /^quotation\b/i.test(compact(line)));
    const headerCompany = heading >= 0 ? lines.slice(heading + 1, heading + 7).find(line => companyLine(compact(line))) : null;
    const signatureCompany = [...lines].reverse().slice(0, 14).reverse().find(line => companyLine(compact(line)));
    const company = headerCompany || signatureCompany;
    if (company) put('supplier', compact(company), company);
  }
  const currencies = [...new Set(lines.flatMap(line => [...compact(line).matchAll(/\b(?:SGD|USD|EUR|GBP|CNY|RMB|AUD|JPY)\b/gi)].map(match => match[0].toUpperCase() === 'RMB' ? 'CNY' : match[0].toUpperCase())))];
  if (!values.currency && currencies.length === 1) {
    const source = lines.find(line => new RegExp('\\b' + currencies[0] + '\\b', 'i').test(line));
    put('currency', currencies[0], source);
  }
  const inclusive = lines.find(line => /\b(?:prices?|amounts?)\b.*\binclusive of\s+\d+(?:\.\d+)?\s*%\s*(?:gst|tax)\b/i.test(line) || /\ball prices quoted are inclusive of\b/i.test(line));
  const exclusive = lines.find(line => /\bprices?\b.*\b(?:exclude|excludes|exclusive of)\b.*\b(?:gst|tax|taxes)\b/i.test(line));
  if (inclusive) put('basis', 'tax-inclusive', inclusive);
  else if (exclusive) put('basis', 'pre-tax', exclusive);
  const proseMoq = lines.find(line => /\bMOQ\b.*?\b(?:is|:)\s*[\d,]+/i.test(line));
  if (!values.moq && proseMoq) { const amount = numeric(proseMoq.match(/\b(?:is|:)\s*([\d,]+)/i)?.[1]); if (amount) put('moq', amount, proseMoq); }
  return {values, evidence};
}

function outsideItem(lines, headerIndex) {
  let product = null;
  const attributes = [];
  for (let index = Math.max(0, headerIndex - 30); index < headerIndex; index++) {
    const pair = pairFromLine(lines[index]);
    if (!pair) continue;
    const key = quotationFieldKey(pair[0]);
    if (key === 'item') {
      product = {value: compact(pair[1]), evidence: compact(lines[index]), index};
      attributes.length = 0;
    } else if (product && itemAttribute(pair[0]) && index > product.index) {
      attributes.push({value: compact(pair[1]), evidence: compact(lines[index])});
    }
  }
  if (!product) return null;
  return {
    item: [product.value, ...attributes.map(attribute => attribute.value)].filter(Boolean).join(' '),
    evidence: [product.evidence, ...attributes.map(attribute => attribute.evidence)].join('\n'),
  };
}

function finaliseTierBreaks(records, quantity) {
  const groups = new Map();
  for (const record of records) {
    if (!record.tier) continue;
    const group = groups.get(record.productKey) || [];
    group.push(record);
    groups.set(record.productKey, group);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => (a.tier.min ?? 0) - (b.tier.min ?? 0));
    for (let index = 0; index < group.length; index++) {
      const current = group[index], next = group[index + 1];
      if (current.tier.priceBreak && current.tier.max === null && next?.tier?.min > current.tier.min) current.tier.max = next.tier.min - 1;
      delete current.tier.priceBreak;
      current.tier = applyQuantityToTier(current.tier, quantity);
    }
  }
  return records;
}

function tableRecords(lines, common, conditions, quantity) {
  const records = [];
  // A note that the product price excludes freight does not invalidate a
  // separate numeric Freight Cost column. Only explicitly provisional freight
  // language keeps that column unresolved.
  const freightUncertain = lines.some(line => /\bfreight\b.*\b(?:subject to|depends|to be confirmed|reference|approx(?:imately)?)\b|\b(?:subject to|depends|to be confirmed|reference|approx(?:imately)?)\b.*\bfreight\b/i.test(line));
  for (let index = 0; index < lines.length; index++) {
    const headers = splitRow(lines[index]);
    if (headers.length < 2) continue;
    const keys = headers.map(quotationFieldKey);
    const priceIndex = keys.findIndex(key => key === 'price');
    const itemIndexes = keys.flatMap((key, cell) => key === 'item' ? [cell] : []);
    const tierIndex = headers.findIndex(tierHeader);
    if (priceIndex < 0 || (!itemIndexes.length && tierIndex < 0)) continue;
    const external = itemIndexes.length ? null : outsideItem(lines, index);
    if (!itemIndexes.length && !external) continue;
    const attributeIndexes = headers.flatMap((header, cell) => itemAttribute(header) ? [cell] : []);
    const taxIndex = headers.findIndex(header => /^(?:tax|tax basis|gst|vat|税费|税率|含税情况|税务处理)$/i.test(compact(header)));
    const leadTimeIndex = headers.findIndex(header => /^(?:delivery\s+)?lead time$|^(?:交期|交货周期|运输时效)$/i.test(compact(header)));
    const priceUnit = quoteUnit(headers[priceIndex]);
    const headerCurrency = compact(headers[priceIndex]).match(/\b(?:SGD|USD|EUR|GBP|CNY|RMB|AUD|JPY)\b/i)?.[0];
    const rowStructure = structure(tierIndex >= 0 ? 'tier-table' : 'item-table', compact(lines[index]));
    for (let rowIndex = index + 1; rowIndex < lines.length; rowIndex++) {
      if (!compact(lines[rowIndex])) break;
      const cells = splitRow(lines[rowIndex]);
      if (cells.length < 2 || cells.length > headers.length) break;
      while (cells.length < headers.length) cells.push('');
      if (cells.every(cell=>/^[-: ]*$/.test(cell))) continue;
      if (cells.some((cell,n)=>keys[n] && quotationFieldKey(cell)===keys[n])) break;
      const price = numeric(cells[priceIndex]);
      const tier = tierIndex >= 0 ? parseQuantityTier(cells[tierIndex]) : null;
      if (tierIndex >= 0 && !tier) continue;
      const itemParts = itemIndexes.map(cell => compact(cells[cell])).filter(Boolean);
      for (const cell of attributeIndexes) if (compact(cells[cell]) && !itemParts.includes(compact(cells[cell]))) itemParts.push(compact(cells[cell]));
      const item = itemParts.join(' ') || external?.item || '';
      if (!item) break;
      if (metadataItem(item)) continue;
      const values = {...common.values, item, price};
      const evidence = {...common.evidence, item: itemIndexes.length ? compact(lines[index] + '\n' + lines[rowIndex]) : external.evidence, price: compact(lines[index] + '\n' + lines[rowIndex])};
      if (priceUnit) { values.priceUnit = priceUnit; evidence.priceUnit = compact(headers[priceIndex]); }
      if (headerCurrency) { values.currency = headerCurrency.toUpperCase() === 'RMB' ? 'CNY' : headerCurrency.toUpperCase(); evidence.currency = compact(headers[priceIndex]); }
      const cellCurrency = compact(cells[priceIndex]).match(/\b(?:SGD|USD|EUR|GBP|CNY|RMB|AUD|JPY)\b|S\$|US\$/i)?.[0]?.toUpperCase();
      if (cellCurrency) { values.currency=cellCurrency==='S$'?'SGD':cellCurrency==='US$'?'USD':cellCurrency==='RMB'?'CNY':cellCurrency; evidence.currency=compact(cells[priceIndex]); }
      for (let cell = 0; cell < keys.length; cell++) {
        const key = keys[cell];
        if (!['supplier', 'currency', 'basis', 'priceUnit', 'moq', 'packSize', 'arrival', 'delivery', 'other'].includes(key)) continue;
        if (key === 'supplier') {
          if (compact(cells[cell])) { values.supplier = compact(cells[cell]); evidence.supplier = compact(lines[index] + '\n' + lines[rowIndex]); }
          continue;
        }
        if (key === 'currency') {
          const code = compact(cells[cell]).match(/\b(?:SGD|USD|EUR|GBP|CNY|RMB|AUD|JPY)\b/i)?.[0];
          values.currency=code ? code.toUpperCase()==='RMB'?'CNY':code.toUpperCase() : null;
          evidence.currency = compact(lines[index] + '\n' + lines[rowIndex]);
          continue;
        }
        if (key === 'basis') { values.basis=taxBasis(compact(cells[cell])); evidence.basis=compact(lines[index]+'\n'+lines[rowIndex]); continue; }
        if (key === 'arrival') {
          const date = compact(cells[cell]).match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
          if (date) { values[key] = date; evidence[key] = compact(lines[index] + '\n' + lines[rowIndex]); }
        } else if (key === 'delivery') {
          const amount = numeric(cells[cell]);
          values.delivery = !freightUncertain && amount ? amount : null;
          evidence.delivery = compact(lines[index] + '\n' + lines[rowIndex]);
        } else {
          values[key] = ['moq','packSize','priceUnit'].includes(key) ? quantityAmount(cells[cell]) : numeric(cells[cell]);
          evidence[key] = compact(lines[index] + '\n' + lines[rowIndex]);
        }
      }
      if (taxIndex >= 0 && cells[taxIndex]) {
        const taxText = compact(cells[taxIndex]);
        if (taxBasis(taxText)) {
          values.basis = taxBasis(taxText);
          evidence.basis = compact(lines[index] + '\n' + lines[rowIndex]);
        } else if (/unknown|tbc|pending|not specified|待确认|未知|未说明/i.test(taxText)) {
          values.basis = null;
          evidence.basis = compact(lines[index] + '\n' + lines[rowIndex]);
        }
      }
      if (/未税单价/.test(headers[priceIndex])) { values.basis='pre-tax'; evidence.basis=headers[priceIndex]; }
      else if (/含税单价/.test(headers[priceIndex])) { values.basis='tax-inclusive'; evidence.basis=headers[priceIndex]; }
      const deliveryIndex = keys.findIndex(key => key === 'delivery');
      const rowConditions = [...conditions];
      if (deliveryIndex >= 0 && cells[deliveryIndex]) {
        const freightText = headers[deliveryIndex] + ': ' + compact(cells[deliveryIndex]);
        rowConditions.push({kind: 'freight', text: freightText, resolved: !freightUncertain && numeric(cells[deliveryIndex]) !== null});
      }
      if (taxIndex >= 0 && cells[taxIndex]) {
        const taxText = headers[taxIndex] + ': ' + compact(cells[taxIndex]);
        rowConditions.push({kind:'tax',text:taxText,resolved:!!taxBasis(cells[taxIndex])});
      }
      if (leadTimeIndex >= 0 && cells[leadTimeIndex]) rowConditions.push({kind:'lead-time',text:headers[leadTimeIndex]+': '+compact(cells[leadTimeIndex]),resolved:false});
      const productKey = keyText(item);
      records.push({
        values,
        evidence,
        source: lines[index] + '\n' + lines[rowIndex],
        location: 'Row ' + (rowIndex + 1),
        structure: rowStructure,
        structureType: tierIndex >= 0 ? (itemIndexes.length ? 'tabular-tiered' : 'tiered-price-table') : 'tabular-items',
        tier,
        productKey,
        conditions: rowConditions,
      });
    }
  }
  return finaliseTierBreaks(records, quantity);
}

function transposedRecords(lines, common, conditions, quantity) {
  const records = [];
  for (let start = 0; start < lines.length; start++) {
    const first = splitRow(lines[start]);
    if (first.length < 2 || quotationFieldKey(first[0]) !== 'item' || first.slice(1).some(value=>quotationFieldKey(value))) continue;
    const block = [first];
    let end = start + 1;
    for (; end < lines.length; end++) {
      const row = splitRow(lines[end]);
      if (row.length !== first.length || quotationFieldKey(row[0]) === 'item') break;
      if (!quotationFieldKey(row[0]) && !itemAttribute(row[0]) && !tierHeader(row[0]) && !/^(?:tax|gst|vat|lead time|税率|税费|交期)$/i.test(row[0])) break;
      block.push(row);
    }
    if (!block.some(row=>quotationFieldKey(row[0]) === 'price')) continue;
    const tsv = value => /[\t\n"]/u.test(value) ? '"'+value.replace(/"/g,'""')+'"' : value;
    const horizontal = [block.map(row=>tsv(row[0])).join('\t'), ...first.slice(1).map((_,column)=>block.map(row=>tsv(row[column+1])).join('\t'))];
    for (const record of tableRecords(horizontal, common, conditions, quantity)) {
      record.location = 'Columns in rows '+(start+1)+'–'+end;
      record.structure = {...record.structure,label:'Transposed price table'};
      record.structureType = 'transposed-items';
      records.push(record);
    }
    start = end - 1;
  }
  return finaliseTierBreaks(records, quantity);
}

function narrativeRecords(text, lines, common, conditions, quantity) {
  const records = [];
  const add = ({item, currencyToken, price, moq, source, supplier, quotedQuantity, priceBreak}) => {
    item = compact(item);
    if (!item || records.some(record => record.source === source)) return;
    const token = currencyToken.toUpperCase();
    const currency = token === 'S$' ? 'SGD' : token === 'US$' ? 'USD' : token === '$' ? common.values.currency || null : token === 'RMB' ? 'CNY' : token;
    const values = {...common.values, item, price:numeric(price), priceUnit:'1', currency};
    const evidence = {...common.evidence, item:source, price:source, priceUnit:source, currency:source};
    if (supplier && !values.supplier) { values.supplier=compact(supplier); evidence.supplier=source; }
    if (moq) { values.moq=String(Number(String(moq).replace(/,/g,''))); evidence.moq=source; }
    let tier=null;
    if (quotedQuantity) {
      const amount=Number(String(quotedQuantity).replace(/,/g,''));
      tier=applyQuantityToTier({label:amount.toLocaleString('en-US')+(priceBreak?' units and above':' units quoted quantity'),min:amount,max:priceBreak?null:amount},quantity);
    }
    records.push({values,evidence,source,location:'Narrative price '+(records.length+1),structure:structure('narrative',source),structureType:'natural-language',tier,productKey:keyText(item),conditions});
  };
  const pattern = /(?:^|[.!?]\s+|\n)For\s+(?:our|the)\s+([\s\S]*?),\s+(?:our\s+wholesale\s+price\s+is|the\s+price\s+is)\s+(SGD|USD|EUR|GBP|CNY|RMB|AUD|JPY|S\$|US\$|\$)\s*([\d,.]+)\s+per\s+(piece|pc|set|unit|each|ream)(?:\s+for\s+an?\s+order\s+of\s+([\d,]+)\s+(?:pieces?|pcs?|sets?|units?|reams?))?/gi;
  for (const match of text.matchAll(pattern)) {
    const source = compact(match[0]);
    add({item:match[1],currencyToken:match[2],price:match[3],quotedQuantity:match[5],source});
  }
  const offerPattern=/(?:^|[.!?]\s+|\n)(?:(?!We\b)([^.!?\n]{2,80}?)\s+can\s+(?:also\s+)?offer|We\s+can\s+(?:also\s+)?offer)\s+([\s\S]*?)\s+at\s+(SGD|USD|EUR|GBP|CNY|RMB|AUD|JPY|S\$|US\$|\$)\s*([\d,.]+)\s+per\s+(piece|pc|set|unit|each|ream)(?:,?\s+with\s+(?:a\s+)?minimum\s+order\s+of\s+([\d,]+)\s+(?:pieces?|pcs?|sets?|units?|reams?))?/gi;
  for(const match of text.matchAll(offerPattern)){
    const source=compact(match[0]);
    add({supplier:match[1],item:match[2],currencyToken:match[3],price:match[4],moq:match[6],quotedQuantity:match[6],priceBreak:!!match[6],source});
  }
  if(records.length){
    const supplier=records.find(record=>record.values.supplier)?.values.supplier;
    const supplierEvidence=records.find(record=>record.values.supplier)?.evidence.supplier;
    if(supplier)for(const record of records)if(!record.values.supplier){record.values.supplier=supplier;record.evidence.supplier=supplierEvidence;}
  }
  return records;
}

/** Detects layout before extracting facts. It only returns values supported by source text. */
export function recognizeQuotationStructure(text, options = {}) {
  const source = String(text ?? '').replaceAll('：', ':');
  const lines = source.split(/\r?\n/).map(line => line.trimEnd()).filter(line=>line.trim());
  const common = globalFacts(lines), conditions = extractConditions(lines);
  const table = tableRecords(lines, common, conditions, options.quantity);
  if (table.length) return {structure: table[0].structure, records: table, conditions};
  const transposed = transposedRecords(lines, common, conditions, options.quantity);
  if (transposed.length) return {structure:transposed[0].structure,records:transposed,conditions};
  const narrative = narrativeRecords(source, lines, common, conditions, options.quantity);
  if (narrative.length) return {structure: narrative[0].structure, records: narrative, conditions};
  const recognisedPairs = lines.filter(line => {
    const pair = pairFromLine(line);
    return pair && quotationFieldKey(pair[0]);
  });
  return {structure: structure(recognisedPairs.length >= 2 ? 'key-value' : 'unknown', recognisedPairs.slice(0, 3).join('\n')), records: [], conditions};
}
