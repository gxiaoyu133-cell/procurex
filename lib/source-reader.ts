import JSZip from './vendor/jszip.cjs';
import xmlToJs from './vendor/xml-parser.cjs';

export type QuotationFormat = 'email' | 'pdf' | 'spreadsheet' | 'text';
export interface QuotationSheet { name: string; text: string }
export interface QuotationSource {
  text: string;
  format: QuotationFormat;
  sheetNames?: string[];
  /** A multi-sheet workbook deliberately has empty text until the user selects a sheet. */
  sheets?: QuotationSheet[];
}
const MAX_FILE_BYTES = 10_000_000;
const MAX_TEXT = 12_000;
type XmlNode = { name?: string; type?: string; text?: string; cdata?: string; attributes?: Record<string, string>; elements?: XmlNode[] };
const localName = (name = '') => name.split(':').pop();
const children = (node: XmlNode, name: string) => (node.elements || []).filter(n => localName(n.name) === name);
const child = (node: XmlNode, name: string) => children(node, name)[0];
const descendants = (node: XmlNode, name: string): XmlNode[] => (node.elements || []).flatMap(n => [...(localName(n.name) === name ? [n] : []), ...descendants(n, name)]);
const nodeText = (node?: XmlNode): string => node ? (node.text ?? node.cdata ?? '') + (node.elements || []).map(nodeText).join('') : '';
function parseXml(text: string): XmlNode {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Unsupported XML declarations in this spreadsheet. Export a fresh XLSX or CSV.');
  try { return xmlToJs(text, {compact: false, ignoreComment: true, ignoreDeclaration: true}) as XmlNode; }
  catch { throw new Error('This spreadsheet contains invalid XML. Save it again as XLSX or CSV.'); }
}
function checkedText(text: string, label = 'quotation'): string {
  const cleaned = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();
  if (!cleaned) throw new Error('This ' + label + ' contains no readable text.');
  if (cleaned.length > MAX_TEXT) throw new Error('This ' + label + ' exceeds 12,000 characters. Keep one supplier quotation or select a smaller worksheet.');
  return cleaned;
}
function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0] || 'A';
  let index = 0;
  for (const letter of letters.toUpperCase()) index = index * 26 + letter.charCodeAt(0) - 64;
  if (index > 256) throw new Error('Use a quotation with 256 columns or fewer.');
  return index - 1;
}
function excelDate(value: string, date1904: boolean): string {
  const serial = Number(value);
  if (!Number.isFinite(serial) || serial < 0 || serial > 2958465) return value;
  // Excel's 1900 leap-year bug affects serials before March 1900.
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, serial < 60 ? 31 : 30);
  return new Date(base + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
}
const tsvCell = (value: string) => {
  const singleLine = value.replace(/\r\n?|\n/g,' ');
  return /[\t"]/u.test(singleLine) ? '"' + singleLine.replace(/"/g, '""') + '"' : singleLine;
};

function delimitedText(bytes: ArrayBuffer, extension: string): string {
  const data = new Uint8Array(bytes);
  const charset = data[0] === 0xff && data[1] === 0xfe ? 'utf-16le' : data[0] === 0xfe && data[1] === 0xff ? 'utf-16be' : 'utf-8';
  let source = decodedBytes(data, charset).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const declared = source.match(/^sep=([;,\t|])\n/i);
  if (declared) source = source.slice(declared[0].length);
  function rowsFor(separator: string): string[][] {
    const rows: string[][] = [], row: string[] = [];
    let value = '', quoted = false;
    for (let index=0; index<source.length; index++) {
      const char = source[index];
      if (char === '"') {
        if (quoted && source[index+1] === '"') { value+='"'; index++; }
        else if (quoted || !value.trim()) quoted=!quoted;
        else value+=char;
      } else if (char === separator && !quoted) { row.push(value.trim()); value=''; }
      else if (char === '\n' && !quoted) { row.push(value.trim()); rows.push([...row]); row.length=0; value=''; }
      else value+=char;
    }
    if (quoted) throw new Error('This CSV / TSV contains an unclosed quoted cell. Save a fresh spreadsheet export and upload it again.');
    if (value || row.length) { row.push(value.trim()); rows.push(row); }
    return rows;
  }
  const choices = declared ? [declared[1]] : extension === 'tsv' ? ['\t'] : [',',';','\t','|'];
  let parseError: unknown;
  const parsed = choices.flatMap(separator=>{try{return [{separator,rows:rowsFor(separator)}]}catch(error){parseError=error;return []}});
  const score = (rows:string[][]) => rows.filter(row=>row.length>1).length * 100 + rows.reduce((sum,row)=>sum+Math.min(row.length,20),0);
  const selected = parsed.sort((a,b)=>score(b.rows)-score(a.rows))[0];
  if (!selected || (parseError && !selected.rows.some(row=>row.length>1))) throw parseError;
  return checkedText(selected.rows.map(row=>row.map(value=>tsvCell(value.replace(/\n/g,' '))).join('\t')).join('\n'),'spreadsheet');
}

async function readWorkbook(data: ArrayBuffer): Promise<QuotationSource> {
  let zip: any;
  try { zip = await JSZip.loadAsync(data); }
  catch { throw new Error('This file is not a readable XLSX workbook. Password-protected workbooks must be unlocked first.'); }
  const entries: any[] = Object.values(zip.files);
  const expandedSize = entries.reduce((sum, entry) => sum + Number(entry._data?.uncompressedSize || 0), 0);
  if (entries.length > 500 || expandedSize > 32_000_000) throw new Error('This workbook is too large after unpacking. Export only the quotation sheet.');
  async function xml(path: string, optional = false): Promise<XmlNode> {
    const entry = zip.file(path);
    if (!entry) { if (optional) return {}; throw new Error('This XLSX workbook is missing required worksheet data.'); }
    if (Number(entry._data?.uncompressedSize || 0) > 8_000_000) throw new Error('This worksheet is too large. Export a smaller quotation sheet.');
    const raw = await entry.async('string');
    if (raw.length > 8_000_000) throw new Error('This worksheet is too large. Export a smaller quotation sheet.');
    return parseXml(raw);
  }
  const workbook = await xml('xl/workbook.xml');
  const relations = await xml('xl/_rels/workbook.xml.rels');
  const shared = await xml('xl/sharedStrings.xml', true);
  const styles = await xml('xl/styles.xml', true);
  const strings = descendants(shared, 'si').map(n => descendants(n, 't').map(nodeText).join(''));
  const customFormats = new Map(descendants(styles, 'numFmt').map(n => [Number(n.attributes?.numFmtId), n.attributes?.formatCode || '']));
  const formats = descendants(styles, 'cellXfs')[0];
  const dateStyles = new Set((formats ? children(formats, 'xf') : []).flatMap((n, i) => {
    const id = Number(n.attributes?.numFmtId || 0);
    const format = (customFormats.get(id) || '').replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '');
    return ((id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || /[yd]/i.test(format)) ? [i] : [];
  }));
  const date1904 = ['1', 'true'].includes(descendants(workbook, 'workbookPr')[0]?.attributes?.date1904 || '');
  const sheets = descendants(workbook, 'sheet');
  if (!sheets.length || sheets.length > 20) throw new Error('Use an XLSX workbook with 1–20 worksheets.');
  const result: QuotationSheet[] = [];
  for (const sheet of sheets) {
    const relationshipId = sheet.attributes?.['r:id'] || Object.entries(sheet.attributes || {}).find(([key]) => localName(key) === 'id')?.[1];
    const relationship = descendants(relations, 'Relationship').find(n => n.attributes?.Id === relationshipId);
    const target = relationship?.attributes?.Target;
    if (!target || relationship?.attributes?.TargetMode === 'External' || !/\/worksheet$/.test(relationship?.attributes?.Type || '')) continue;
    const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    if (path.includes('..') || !path.startsWith('xl/')) throw new Error('Unsupported worksheet path in this workbook.');
    const sheetXml = await xml(path);
    const rows = descendants(sheetXml, 'row');
    if (rows.length > 5000) throw new Error('Use a quotation sheet with 5,000 rows or fewer.');
    const lines = rows.map(row => {
      const cells: string[] = [];
      for (const cell of children(row, 'c')) {
        const attrs = cell.attributes || {};
        const raw = nodeText(child(cell, 'v'));
        let value = attrs.t === 's' ? strings[Number(raw)] ?? '' : attrs.t === 'inlineStr' ? descendants(cell, 't').map(nodeText).join('') : raw;
        if (attrs.t === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
        if (dateStyles.has(Number(attrs.s)) && (!attrs.t || attrs.t === 'n') && raw) value = excelDate(raw, date1904);
        // Use saved values only. Do not execute formulas, macros or external links.
        if (!value && child(cell, 'f')) value = 'Unresolved formula (no saved value)';
        cells[attrs.r ? columnIndex(attrs.r) : cells.length] = value;
      }
      return Array.from(cells, value => tsvCell(value || '')).join('\t').replace(/\t+$/, '');
    }).filter(line => line.trim()).join('\n');
    if (lines.trim()) result.push({name: sheet.attributes?.name || 'Worksheet ' + (result.length + 1), text: checkedText(lines, 'worksheet')});
  }
  if (!result.length) throw new Error('No readable quotation cells were found in this workbook.');
  return {format: 'spreadsheet', text: result.length === 1 ? result[0].text : '', sheetNames: result.map(s => s.name), sheets: result};
}

function decodedBytes(bytes: Uint8Array, charset = 'utf-8'): string {
  try { return new TextDecoder(charset.trim().replace(/["']/g, '')).decode(bytes); }
  catch { return new TextDecoder().decode(bytes); }
}
function decodeMailBody(body: string, encoding: string, charset: string): string {
  if (/base64/i.test(encoding)) {
    try { return decodedBytes(Uint8Array.from(atob(body.replace(/\s/g, '')), c => c.charCodeAt(0)), charset); }
    catch { throw new Error('This email has invalid base64 text. Paste the email body instead.'); }
  }
  if (/quoted-printable/i.test(encoding)) {
    const unfolded = body.replace(/=\r?\n/g, '');
    const bytes: number[] = [];
    for (let i = 0; i < unfolded.length; i++) {
      if (unfolded[i] === '=' && /^[0-9a-f]{2}$/i.test(unfolded.slice(i + 1, i + 3))) { bytes.push(parseInt(unfolded.slice(i + 1, i + 3), 16)); i += 2; }
      else bytes.push(...new TextEncoder().encode(unfolded[i]));
    }
    return decodedBytes(new Uint8Array(bytes), charset);
  }
  return body;
}
function mailParts(source: string, depth = 0): {plain: string[]; html: string[]} {
  if (depth > 8) throw new Error('This email has too many nested parts. Paste its quotation text instead.');
  const separator = /\r?\n\r?\n/.exec(source);
  if (!separator) return {plain: [source], html: []};
  const header = source.slice(0, separator.index).replace(/\r?\n[ \t]+/g, ' ');
  const body = source.slice(separator.index + separator[0].length);
  const get = (key: string) => header.match(new RegExp('^' + key + ':\\s*(.*)$', 'im'))?.[1] || '';
  const type = get('Content-Type') || 'text/plain';
  if (/attachment/i.test(get('Content-Disposition')) || /name\s*=/i.test(type)) return {plain: [], html: []};
  if (/multipart\//i.test(type)) {
    const boundary = type.match(/boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i);
    if (!boundary) throw new Error('The email MIME boundary is missing. Paste the quotation text instead.');
    const marker = '--' + (boundary[1] || boundary[2]);
    const parts = body.split(marker).slice(1).filter(p => !p.startsWith('--'));
    return parts.reduce((result, part) => { const read = mailParts(part.replace(/^\r?\n/, ''), depth + 1); result.plain.push(...read.plain); result.html.push(...read.html); return result; }, {plain: [] as string[], html: [] as string[]});
  }
  const charset = type.match(/charset\s*=\s*(?:"([^"]+)"|([^;\s]+))/i);
  const decoded = decodeMailBody(body, get('Content-Transfer-Encoding'), charset?.[1] || charset?.[2] || 'utf-8');
  if (/^text\/plain/i.test(type)) return {plain: [decoded], html: []};
  if (/^text\/html/i.test(type)) return {plain: [], html: [decoded]};
  return {plain: [], html: []};
}
function htmlText(html: string): string {
  // Read text only; never create live HTML, fetch resources or execute scripts.
  return html.replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<(?:br|\/p|\/div|\/tr|\/li)\b[^>]*>/gi, '\n').replace(/<\/t[dh]>/gi, '\t').replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[0-9a-f]+|\d+);/gi, entity => {
    const named: Record<string, string> = {'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' '};
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const code = entity.startsWith('&#x') ? parseInt(entity.slice(3), 16) : parseInt(entity.slice(2), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}
function readEmail(text: string): string {
  const parts = mailParts(text);
  const plain = parts.plain.filter(part=>part.trim());
  const body = plain.length ? plain.join('\n') : parts.html.map(htmlText).join('\n');
  return checkedText(body, 'email');
}

export function pdfQuotationText(items:any[]):string {
  if(items.some(item=>item.str&&!Array.isArray(item.transform)))return items.map(item=>item.str?item.str+(item.hasEOL?'\n':' '):'').join('');
  const rows:{y:number;items:any[]}[]=[];
  for(const item of items){
    if(!item.str?.trim())continue;
    const y=item.transform[5];let row=rows.find(row=>Math.abs(row.y-y)<2);
    if(!row){row={y,items:[]};rows.push(row)}row.items.push(item);
  }
  return rows.sort((a,b)=>b.y-a.y).map(row=>{
    const ordered=row.items.sort((a,b)=>a.transform[4]-b.transform[4]);
    return ordered.map((item,i)=>{
      const previous=ordered[i-1],gap=previous?item.transform[4]-(previous.transform[4]+(previous.width||0)):0;
      return (i?(gap>=Math.max(8,(item.height||10)*.7)?'\t':' '):'')+item.str.trim();
    }).join('');
  }).join('\n');
}

export async function readQuotationFile(file: File): Promise<QuotationSource> {
  if (file.size > MAX_FILE_BYTES) throw new Error('Use a file smaller than 10 MB.');
  if (!file.size) throw new Error('This file is empty.');
  const extension = file.name.toLowerCase().match(/\.([^.]+)$/)?.[1];
  if (extension === 'xlsx') return readWorkbook(await file.arrayBuffer());
  if (extension === 'xls') throw new Error('Legacy XLS files are not supported. Save the spreadsheet as XLSX or CSV, then upload it.');
  if (extension === 'eml') return {format: 'email', text: readEmail(await file.text())};
  if (['csv', 'tsv'].includes(extension || '')) return {format:'spreadsheet',text:delimitedText(await file.arrayBuffer(), extension!)};
  if (extension === 'txt') return {format:'text',text:checkedText(await file.text())};
  if (extension === 'pdf') {
    const modulePath = '/vendor/pdf.mjs';
    const pdfjs = await import(/* @vite-ignore */ modulePath);
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.mjs';
    const document = await pdfjs.getDocument({data: await file.arrayBuffer(), isEvalSupported: false}).promise;
    try {
      if (document.numPages > 30) throw new Error('Use a quotation with 30 pages or fewer.');
      let text = '';
      for (let page = 1; page <= document.numPages; page++) {
        const content = await (await document.getPage(page)).getTextContent();
        text += pdfQuotationText(content.items) + '\n';
        if (text.length > MAX_TEXT) throw new Error('This PDF exceeds 12,000 characters. Upload only the relevant quotation pages.');
      }
      if (text.trim().length < 10) throw new Error('This PDF has no selectable text. Paste its text manually; scanned PDF OCR is not supported.');
      return {format: 'pdf', text: checkedText(text, 'PDF')};
    } finally { await document.destroy(); }
  }
  throw new Error('Choose an email (.eml), selectable-text PDF, XLSX spreadsheet, CSV, TSV or TXT file.');
}
