import {getQuotationFacts} from './quotation-facts.mjs';

export const EVIDENCE_KEY='procurex.evidence-ledger.v1';
export const DELIVERY_OPTIONS={stated:'Stated amount; no recorded condition',conditional:'Conditional or indicative',unpriced:'Not priced'};
const clean=value=>String(value??'').trim();
const finite=value=>value!==null&&value!==undefined&&clean(value)!==''&&Number.isFinite(Number(value));
const clone=value=>JSON.parse(JSON.stringify(value));
const unique=()=>globalThis.crypto?.randomUUID?.()||`evidence-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const iso=value=>new Date(value).toISOString();
const stamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&Number.isFinite(Date.parse(value))?Date.parse(value):NaN;
const date=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value)))return false;const d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;};
// Delivery dates are business calendar dates on the user's device, while
// observation timestamps retain an explicit UTC offset in their ISO strings.
const day=value=>{const d=new Date(value);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const hash=value=>{let h=2166136261;for(const c of JSON.stringify(value))h=Math.imul(h^c.charCodeAt(0),16777619);return (h>>>0).toString(16);};
export const emptyEvidenceLedger=()=>({version:1,trials:[],orders:[],activeTrial:null});

/** The answer key is a snapshot of visible extracted facts, not independently verified ground truth. */
export function buildEvidenceBenchmark(quotes=[],req={},quoteId){
 const quantity=Math.max(0,(Number(req.quantity)||0)-(Number(req.stock)||0));
 const candidates=quotes.filter(q=>quoteId===undefined||String(q.id)===String(quoteId));
 for(const quote of candidates){
  const result=getQuotationFacts(quote,quantity),f=result.selected;
  if(!f||!clean(quote.text)||!f.item||!finite(f.unitPrice)||Number(f.unitPrice)<=0||!String(f.currency||'').match(/^[A-Z]{3}$/))continue;
  const deliveryStatus=f.freight?.amount===null||f.freight?.amount===undefined?'unpriced':f.freight?.conditional||f.freight?.indicative?'conditional':'stated';
  const snapshot={quoteId:quote.id,supplier:result.supplier,item:f.item,sourceName:quote.name||'Quotation text',sourceText:quote.text,quantity,unitPrice:Number(f.unitPrice),currency:f.currency,deliveryStatus,deliveryLabel:f.freight?.label||'Not priced',deliveryAmount:f.freight?.amount??null,deliveryEvidence:f.freight?.evidence||'',taxLabel:f.tax?.label||'Tax not stated',sourceFactsNeedReview:!!result.displayOnly};
  return {...snapshot,id:'benchmark-'+hash(snapshot),answerKeyBasis:'Snapshot of extracted quotation facts; source review required',fields:['unitPrice','currency','deliveryStatus'],expected:{unitPrice:snapshot.unitPrice,currency:snapshot.currency,deliveryStatus}};
 }
 return null;
}

export function scoreEvidenceAnswers(benchmark,answers={}){
 if(!benchmark?.expected)throw new Error('A quotation task is required.');
 const complete=finite(answers.unitPrice)&&Number(answers.unitPrice)>0&&/^[A-Z]{3}$/.test(clean(answers.currency).toUpperCase())&&Object.hasOwn(DELIVERY_OPTIONS,answers.deliveryStatus);
 const correct={unitPrice:finite(answers.unitPrice)&&Math.abs(Number(answers.unitPrice)-Number(benchmark.expected.unitPrice))<0.000001,currency:clean(answers.currency).toUpperCase()===benchmark.expected.currency,deliveryStatus:answers.deliveryStatus===benchmark.expected.deliveryStatus};
 return {complete,correct,count:Object.values(correct).filter(Boolean).length,total:3,accuracyPercent:Object.values(correct).filter(Boolean).length/3*100};
}

function validateBenchmark(benchmark){return benchmark&&Array.isArray(benchmark.fields)&&benchmark.fields.join(',')==='unitPrice,currency,deliveryStatus'&&clean(benchmark.id)&&clean(benchmark.supplier)&&clean(benchmark.sourceText)&&finite(benchmark.expected?.unitPrice)&&Number(benchmark.expected.unitPrice)>0&&/^[A-Z]{3}$/.test(benchmark.expected.currency)&&Object.hasOwn(DELIVERY_OPTIONS,benchmark.expected.deliveryStatus);}
export function startEvidenceTrial({participantAlias,participantRole,consent,synthetic=false,benchmark,now=new Date().toISOString()}={}){
 if(!clean(participantAlias))throw new Error('Enter a participant alias.');
 if(!['sme_buyer','team_member','other'].includes(participantRole))throw new Error('Choose the participant’s role.');
 if(consent!==true)throw new Error('The participant must consent before timing starts.');
 if(!validateBenchmark(benchmark))throw new Error('Choose a quotation with usable source facts.');
 if(!Number.isFinite(stamp(now)))throw new Error('The trial start time is invalid.');
 return {id:unique(),type:'paired_trial',participantAlias:clean(participantAlias).slice(0,80),participantRole,consent:true,synthetic:!!synthetic,createdAt:iso(now),updatedAt:iso(now),method:'Same-task manual-first comparison; practice and order effects are not controlled.',benchmark:clone(benchmark),status:'manual_running',manual:{startedAt:iso(now)},assisted:null};
}
export function finishEvidencePhase(trial,{answers,now=new Date().toISOString()}={}){
 if(!trial||!['manual_running','assisted_running'].includes(trial.status))throw new Error('Start a task before finishing it.');
 const mode=trial.status==='manual_running'?'manual':'assisted',start=stamp(trial[mode]?.startedAt),end=stamp(now);
 if(!Number.isFinite(end)||!Number.isFinite(start)||end<=start)throw new Error('The finish time must follow the start time.');
 const score=scoreEvidenceAnswers(trial.benchmark,answers);if(!score.complete)throw new Error('Answer all three fields before stopping the timer.');
 return {...clone(trial),updatedAt:iso(now),status:mode==='manual'?'manual_complete':'complete',[mode]:{...trial[mode],endedAt:iso(now),durationMs:end-start,answers:{unitPrice:Number(answers.unitPrice),currency:clean(answers.currency).toUpperCase(),deliveryStatus:answers.deliveryStatus},score}};
}
export function startAssistedEvidencePhase(trial,now=new Date().toISOString()){
 if(trial?.status!=='manual_complete')throw new Error('Complete the manual task first.');
 if(!Number.isFinite(stamp(now))||stamp(now)<stamp(trial.manual.endedAt))throw new Error('The assisted task cannot start before the manual task finishes.');
 return {...clone(trial),status:'assisted_running',updatedAt:iso(now),assisted:{startedAt:iso(now)}};
}
export function validateEvidenceTrial(trial,now=new Date().toISOString()){
 const errors=[];
 if(!trial||trial.type!=='paired_trial'||trial.status!=='complete')return {valid:false,errors:['Both tasks must be complete.'],comparable:false};
 if(!clean(trial.participantAlias)||!['sme_buyer','team_member','other'].includes(trial.participantRole)||trial.consent!==true)errors.push('Participant and consent are required.');
 if(!validateBenchmark(trial.benchmark))errors.push('The quotation task snapshot is invalid.');
 const current=stamp(now);if(!Number.isFinite(current))errors.push('The review time is invalid.');
 let allCorrect=true;
 for(const mode of ['manual','assisted']){
  const phase=trial[mode],start=stamp(phase?.startedAt),end=stamp(phase?.endedAt);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end>current||phase?.durationMs!==end-start)errors.push(`${mode} timing is invalid or in the future.`);
  try{const score=scoreEvidenceAnswers(trial.benchmark,phase?.answers);if(!score.complete)errors.push(`${mode} answers are incomplete.`);allCorrect&&=score.count===score.total;}catch{errors.push(`${mode} answer key is invalid.`);allCorrect=false;}
 }
 if(stamp(trial.assisted?.startedAt)<stamp(trial.manual?.endedAt))errors.push('Task timings overlap.');
 if(!Number.isFinite(stamp(trial.createdAt))||stamp(trial.createdAt)!==stamp(trial.manual?.startedAt)||stamp(trial.updatedAt)!==stamp(trial.assisted?.endedAt))errors.push('Trial provenance timestamps are inconsistent.');
 return {valid:errors.length===0,errors,comparable:errors.length===0&&allCorrect&&!trial.synthetic};
}

export function validateSupplierEvidence(record,now=new Date().toISOString()){
 const errors=[];
 if(!record)return {valid:false,errors:['A completed-order record is required.'],eligible:false};
 const current=stamp(now);if(!Number.isFinite(current))errors.push('The review time is invalid.');
 for(const [field,label] of [['supplier','Supplier'],['orderRef','Order reference'],['attestedBy','Recorded by'],['sourceReference','Evidence reference']])if(!clean(record[field]))errors.push(`${label} is required.`);
 if(!date(record.promisedDate)||!date(record.actualDate))errors.push('Valid promised and actual delivery dates are required.');
 else if(Number.isFinite(current)&&record.actualDate>day(now))errors.push('Actual delivery cannot be in the future.');
 const ordered=Number(record.orderedUnits),delivered=Number(record.deliveredUnits),rejected=Number(record.rejectedUnits);
 if(!finite(record.orderedUnits)||!Number.isSafeInteger(ordered)||ordered<=0)errors.push('Ordered units must be a positive whole number.');
 if(!finite(record.deliveredUnits)||!Number.isSafeInteger(delivered)||delivered<0||delivered>ordered)errors.push('Delivered units must be between zero and ordered units.');
 if(!finite(record.rejectedUnits)||!Number.isSafeInteger(rejected)||rejected<0||rejected>delivered)errors.push('Rejected units must be between zero and delivered units.');
 if(!['documented','self_reported'].includes(record.provenance))errors.push('Choose an evidence type.');
 if(record.verified===true&&record.provenance!=='documented')errors.push('Only document-linked records can be attested as checked.');
 if(record.verified===true&&!clean(record.verificationNote))errors.push('Describe the documents checked.');
 if(!Number.isFinite(stamp(record.createdAt))||stamp(record.createdAt)>stamp(now))errors.push('The record creation time is invalid or in the future.');
 return {valid:errors.length===0,errors,eligible:errors.length===0&&record.verified===true&&record.provenance==='documented'&&!record.synthetic};
}
export function createSupplierEvidence(input={},now=new Date().toISOString()){
 const record={id:unique(),type:'completed_order',supplierId:clean(input.supplierId),supplier:clean(input.supplier),orderRef:clean(input.orderRef),promisedDate:clean(input.promisedDate),actualDate:clean(input.actualDate),orderedUnits:Number(input.orderedUnits),deliveredUnits:Number(input.deliveredUnits),rejectedUnits:Number(input.rejectedUnits),sourceReference:clean(input.sourceReference),attestedBy:clean(input.attestedBy),provenance:input.provenance,verified:input.verified===true,verificationNote:clean(input.verificationNote),synthetic:input.synthetic===true,createdAt:iso(now)};
 // Validate original inputs too: an empty field must never silently become zero.
 const validation=validateSupplierEvidence({...record,orderedUnits:input.orderedUnits,deliveredUnits:input.deliveredUnits,rejectedUnits:input.rejectedUnits},now);
 if(!validation.valid)throw new Error(validation.errors.join(' '));
 return record;
}

export function summariseEvidence(ledger=emptyEvidenceLedger(),now=new Date().toISOString()){
 const trials=(ledger.trials||[]).map(t=>({record:t,...validateEvidenceTrial(t,now)}));
 const measured=trials.filter(t=>t.valid&&!t.record.synthetic),comparable=measured.filter(t=>t.comparable);
 const averages=comparable.length?{manualMs:comparable.reduce((s,t)=>s+t.record.manual.durationMs,0)/comparable.length,assistedMs:comparable.reduce((s,t)=>s+t.record.assisted.durationMs,0)/comparable.length}:null;
 if(averages)averages.timeDifferencePercent=(averages.manualMs-averages.assistedMs)/averages.manualMs*100;
 const orders=(ledger.orders||[]).map(record=>({record,...validateSupplierEvidence(record,now)}));
 // Re-entering an order does not increase its weight. All duplicates are excluded for review.
 const orderKey=r=>clean(r.supplier).toLowerCase()+'\u0000'+clean(r.orderRef).toLowerCase();
 const counts=new Map();for(const row of orders.filter(o=>o.valid&&!o.record.synthetic)){const key=orderKey(row.record);counts.set(key,(counts.get(key)||0)+1);}
 for(const row of orders)if((counts.get(orderKey(row.record))||0)>1){row.eligible=false;row.errors.push('Duplicate supplier/order reference; remove the duplicate before using metrics.');}
 const suppliers=[];
 for(const name of [...new Set(orders.map(o=>clean(o.record.supplier)).filter(Boolean))]){
  const rows=orders.filter(o=>clean(o.record.supplier).toLowerCase()===name.toLowerCase()),eligible=rows.filter(o=>o.eligible),onTime=eligible.filter(o=>o.record.deliveredUnits>0&&o.record.actualDate<=o.record.promisedDate).length;
  const ordered=eligible.reduce((sum,o)=>sum+Number(o.record.orderedUnits),0),delivered=eligible.reduce((sum,o)=>sum+Number(o.record.deliveredUnits),0),accepted=eligible.reduce((sum,o)=>sum+Number(o.record.deliveredUnits)-Number(o.record.rejectedUnits),0);
  if(suppliers.some(s=>s.supplier.toLowerCase()===name.toLowerCase()))continue;
  suppliers.push({supplier:name,records:rows.length,eligibleOrders:eligible.length,onTimeOrders:onTime,onTimeRate:eligible.length?onTime/eligible.length:null,orderedUnits:ordered,deliveredUnits:delivered,acceptedUnits:accepted,acceptedUnitRate:delivered?accepted/delivered:null,fulfilmentRate:ordered?delivered/ordered:null,canSupportRecordedPerformance:eligible.length>0,provenance:'Document-linked records checked and attested by the named user; not independently audited.'});
 }
 return {trialCount:measured.length,smeBuyerTrials:measured.filter(t=>t.record.participantRole==='sme_buyer').length,internalTrials:measured.filter(t=>t.record.participantRole==='team_member').length,comparableTrialCount:comparable.length,excludedTrialCount:trials.length-measured.length,averages,trials,orders,suppliers,limitations:['Same-task manual-first trials have learning and order effects; they do not establish causal productivity gains.','Accuracy is checked against an extracted quotation snapshot, not independent ground truth.','Performance rates describe the recorded orders only and do not predict future supplier reliability.','Document references are user-attested. No independent verification or vendor contact occurs.']};
}
export function readEvidenceLedger(storage){
 try{const raw=storage.getItem(EVIDENCE_KEY);if(!raw)return {ledger:emptyEvidenceLedger(),error:null};const parsed=JSON.parse(raw);if(parsed.version!==1||!Array.isArray(parsed.trials)||!Array.isArray(parsed.orders)||!parsed.trials.every(r=>r&&typeof r.id==='string'&&r.type==='paired_trial')||!parsed.orders.every(r=>r&&typeof r.id==='string'&&r.type==='completed_order'))throw new Error();if(parsed.activeTrial&&(!validateBenchmark(parsed.activeTrial.benchmark)||!['manual_running','manual_complete','assisted_running'].includes(parsed.activeTrial.status)||!Number.isFinite(stamp(parsed.activeTrial.manual?.startedAt))))throw new Error();return {ledger:parsed,error:null};}
 catch{return {ledger:emptyEvidenceLedger(),error:'Saved evidence could not be loaded. Records in this session remain available for export.'};}
}
export function saveEvidenceLedger(storage,ledger){try{storage.setItem(EVIDENCE_KEY,JSON.stringify(ledger));return null;}catch{return 'Evidence could not be saved on this device. Export it before leaving this page.';}}
export function exportEvidenceJSON(ledger,now=new Date().toISOString()){return JSON.stringify({product:'ProcureX',exportedAt:iso(now),version:1,storage:'This browser only; local entries can be edited outside the app.',ledger,summary:summariseEvidence(ledger,now)},null,2);}
const csvCell=value=>{const text=String(value??'');return '"'+(/^[\s]*[=+@-]/.test(text)?"'"+text:text).replaceAll('"','""')+'"';};
export function exportEvidenceCSV(ledger,now=new Date().toISOString()){
 const summary=summariseEvidence(ledger,now),rows=[['record_type','id','participant_or_supplier','role_or_order_ref','created_at','source_reference','synthetic','status','manual_seconds','assisted_seconds','manual_correct_of_3','assisted_correct_of_3','promised_date','actual_date','ordered_units','delivered_units','rejected_units','provenance','attested_by','verification_note','eligible_for_comparison_or_rates','exported_at']];
 for(const {record:r,valid,comparable} of summary.trials)rows.push(['paired_trial',r.id,r.participantAlias,r.participantRole,r.createdAt,r.benchmark?.sourceName,r.synthetic,valid?'complete':'invalid',r.manual?.durationMs/1000,r.assisted?.durationMs/1000,r.manual?.answers&&validateBenchmark(r.benchmark)?scoreEvidenceAnswers(r.benchmark,r.manual.answers).count:'',r.assisted?.answers&&validateBenchmark(r.benchmark)?scoreEvidenceAnswers(r.benchmark,r.assisted.answers).count:'','','','','','','Observed manual-first same-task trial','','',comparable,iso(now)]);
 for(const {record:r,valid,eligible} of summary.orders)rows.push(['completed_order',r.id,r.supplier,r.orderRef,r.createdAt,r.sourceReference,r.synthetic,valid?'complete':'invalid','','','','',r.promisedDate,r.actualDate,r.orderedUnits,r.deliveredUnits,r.rejectedUnits,r.provenance,r.attestedBy,r.verificationNote,eligible,iso(now)]);
 return rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
