import {fields,labels} from './engine.mjs';

const aliases={supplier:['supplier','supplier name','vendor','quotation from'],item:['item','item specification','specification','description','product','product name','product description'],currency:['currency'],basis:['basis','cost basis','tax basis'],price:['price','quoted price','unit price','quoted price s'],priceUnit:['priceunit','price unit','units per quoted price','units per price'],packSize:['packsize','pack size','order pack multiple','pack multiple'],moq:['moq','minimum order','minimum order units','minimum order quantity'],delivery:['delivery','delivery charge','delivery charges','delivery fee','delivery included','shipping','shipping fee','freight','freight cost'],other:['other','other charges','other fees'],arrival:['arrival','arrival date','delivery date','arrival deadline']};
const chineseAliases={supplier:['供应商','供应商名称'],item:['商品','商品名称','产品','产品名称','品名','规格','产品规格'],currency:['币种','货币'],basis:['计价基础','税费基础'],price:['价格','单价','报价'],priceUnit:['报价单位数量','每报价单位数量'],packSize:['包装数量','订购倍数'],moq:['最低订购量','起订量'],delivery:['运费','配送费'],other:['其他费用'],arrival:['到货日期','交货日期']};
for(const [key,names] of Object.entries(chineseAliases))aliases[key].push(...names);
const normalizedLabel=s=>String(s).trim().toLowerCase().normalize('NFKC').replace(/\s*\((?:[^)]*\b(?:sgd|usd|eur|gbp|cny|rmb|aud|jpy|pcs?|pieces?|units?|sets?|reams?)\b[^)]*|[^)]*\/[^)]*)\)\s*$/i,'').replace(/[^a-z0-9\p{Script=Han}]+/gu,' ').trim();
const keyOf=s=>Object.keys(aliases).find(k=>aliases[k].includes(normalizedLabel(s)));
export const quotationFieldKey=keyOf;
export function quotationCells(line,separator){let parts=[],value='',quoted=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++}else quoted=!quoted;}else if(c===separator&&!quoted){parts.push(value.trim());value=''}else value+=c;}parts.push(value.trim());return parts;}
function numberFrom(s){if(/(?:unknown|unresolved|tbc|to be confirmed|pending|not specified|n\/a|to be agreed|待确认|未知|未说明)/i.test(s))return null;const m=String(s).replace(/,/g,'').match(/(?:S\$|SGD\s*|\$)?\s*(-?\d+(?:\.\d+)?)/);return m?m[1]:null;}

/** Conservative local patterns: unsupported or absent facts remain unknown. */
export function normalizeQuote(text){
 const values=Object.fromEntries(fields.map(k=>[k,null])),evidence={};
 const lines=String(text).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
 function put(k,raw,source){if(!k||!raw)return;let value=String(raw).trim();if(['price','priceUnit','packSize','moq','delivery','other'].includes(k))value=numberFrom(value);else if(k==='currency'){const code=value.match(/\b(?:SGD|USD|EUR|GBP|CNY|RMB|AUD|JPY)\b/i)?.[0];value=code?(code.toUpperCase()==='RMB'?'CNY':code.toUpperCase()):value}else if(k==='basis')value=/(?:\bpre[- ]tax\b|\btax[- ]exclusive\b|未税|不含税)/i.test(value)?'pre-tax':/\btax[- ]inclusive\b/i.test(value)?'tax-inclusive':value;else if(k==='arrival')value=value.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0]||null;else if(/^(?:unknown|tbc|to be confirmed|pending|n\/a)$/i.test(value))value=null;values[k]=value;evidence[k]=source;}
 // CSV/TSV header + row, and key/value exports.
 for(let i=0;i<lines.length;i++){const separator=lines[i].includes('\t')?'\t':',';const row=quotationCells(lines[i],separator),keys=row.map(keyOf);if(keys.filter(Boolean).length>=2&&lines[i+1]){const next=quotationCells(lines[i+1],separator);keys.forEach((k,j)=>{if(k)put(k,next[j],lines[i]+'\n'+lines[i+1])});i++;continue;}if(row.length===2&&keys[0])put(keys[0],row[1],lines[i]);}
 for(const line of lines){const pair=line.match(/^([^:=]+?)\s*[:=]\s*(.+)$/);if(pair)put(keyOf(pair[1]),pair[2],line);
  const supplier=line.match(/^Quotation from\s+(.+)$/i);if(supplier)put('supplier',supplier[1],line);
  if(values.item===null&&/^A\d\s+(?:copy\s+)?paper\b/i.test(line))put('item',line,line);
  if(values.currency===null&&/\bSGD\b/.test(line))put('currency','SGD',line);
  if(values.basis===null&&/\bpre[- ]tax\b/i.test(line))put('basis','pre-tax',line);
  if(values.basis===null&&/\b(?:prices?|amounts?)\b.*\binclusive of\s+\d+(?:\.\d+)?\s*%\s*(?:gst|tax)\b/i.test(line))put('basis','tax-inclusive',line);
  if(values.basis===null&&/\bprices?\b.*\b(?:exclude|excludes|exclusive of)\b.*\b(?:gst|tax|taxes)\b/i.test(line))put('basis','pre-tax',line);
  const priced=line.match(/(?:S\$|SGD\s+)([\d,]+(?:\.\d+)?)\s+per\s+(?:carton|pack|box)\s+of\s+(\d+)/i);
  const single=line.match(/(?:S\$|SGD\s+)([\d,]+(?:\.\d+)?)\s+per\s+(?:ream|unit|piece|each)\b/i);
  if(priced){put('price',priced[1],line);if(values.priceUnit===null)put('priceUnit',priced[2],line)}else if(single){put('price',single[1],line);if(values.priceUnit===null)put('priceUnit','1',line)}
 }
 const risks=fields.filter(k=>values[k]===null).map(k=>labels[k]+' could not be confirmed by local rules. Review the source and enter it manually.');
 return {values,evidence,risks};
}

const cash=n=>'S$'+Number(n).toLocaleString('en-SG',{minimumFractionDigits:2,maximumFractionDigits:2});
/** One evidence-grounded, editable rule draft per supplier; never sends messages. */
export function draftRulePlan(result,req){return result.rows.map(r=>{
 const v=r.q.values,name=v.supplier||'This supplier',deadline=r.deadline||req.deadline,unknown=fields.filter(k=>v[k]===null||v[k]===undefined||String(v[k]).trim()==='');
 const requests=[];if(unknown.length)requests.push('confirm '+unknown.map(k=>labels[k].toLowerCase()).join(', '));
 if(v.arrival&&deadline&&v.arrival>deadline)requests.push('offer arrival by '+deadline+' (currently '+v.arrival+')');
 if(r.order>r.net)requests.push('reduce the minimum order or pack requirement to avoid '+(r.order-r.net)+' excess units');
 if(v.currency&&v.currency!=='SGD')requests.push('provide an SGD quotation');if(v.basis&&v.basis!=='pre-tax')requests.push('confirm a comparable pre-tax cost basis');
 const winner=result.winner;if(!requests.length&&winner&&r.q.id!==winner.q.id&&r.total!==null)requests.push('reduce the confirmed total by at least '+cash(r.total-winner.total)+' to match '+cash(winner.total)+', without changing specification or arrival');
 if(!requests.length)requests.push('confirm that '+cash(Number(v.delivery))+' delivery applies to our address and '+r.order+' units, and commit to arrival on '+v.arrival);
 const evidence=['Quoted delivery: '+(v.delivery===null?'unknown':cash(Number(v.delivery))), 'MOQ: '+(v.moq??'unknown'), 'Order quantity: '+r.order, 'Arrival: '+(v.arrival||'unknown'), 'Scenario deadline: '+deadline, 'Confirmed pre-tax total: '+(r.total===null?'unresolved':cash(r.total))].join('; ');
 return {question:name+': can you '+requests.join('; ')+ '?',objective:unknown.length||!r.eligible?'Resolve the outstanding conditions, then recalculate eligibility and total cost before a decision.':'Confirm or improve the reviewed terms; recalculate the comparison if any supplier terms change.',evidence};
 });}
