import {getQuotationFacts} from './quotation-facts.mjs';
import {itemMatches} from './item-matching.mjs';

export const NEGOTIATION_GOALS = Object.freeze([
  Object.freeze({id:'price',label:'Lower price',targetLabel:'Target reduction',targetUnit:'%',defaultTarget:10}),
  Object.freeze({id:'moq',label:'Reduce MOQ',targetLabel:'Target minimum order',targetUnit:'units',defaultTarget:null}),
  Object.freeze({id:'delivery',label:'Faster delivery',targetLabel:'Target lead time',targetUnit:'days',defaultTarget:null}),
]);
const number = value => value === '' || value === null || value === undefined ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const round = (value,places=4) => Math.round((value+Number.EPSILON)*10**places)/10**places;
const text = value => String(value ?? '').trim();
const clone = value => JSON.parse(JSON.stringify(value));
function freeze(value) { if(value && typeof value==='object' && !Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);} return value; }
function timestamp(now) { const date = now === undefined ? new Date() : new Date(now); if(!Number.isFinite(+date)) throw new Error('A valid negotiation timestamp is required.'); return date.toISOString(); }
const money = (value,currency) => value === null ? 'not quoted' : `${currency || 'Currency unknown'} ${Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:4})}`;
const whole = value => Number.isSafeInteger(value) && value > 0;
const assumption = (id,label,detail) => ({id,label,detail,kind:'assumption'});
function explicitOrderLot(selected,quote,facts) {
  // A carton/bag count describes packaging, not necessarily an ordering rule.
  // Only the supplier's explicit "1 lot = N pcs" statement is used here.
  const source=[selected.source,selected.evidence?.moq,selected.evidence?.packSize,...(facts.products.length===1?[quote.text]:[])].filter(Boolean).join('\n');
  const matches=[...source.matchAll(/\b1\s*lot\s*=\s*([\d,]+)\s*(?:pcs?|pieces?|units?)\b/gi)].map(match=>({size:Number(match[1].replaceAll(',','')),evidence:match[0]})).filter(value=>whole(value.size));
  const sizes=[...new Set(matches.map(value=>value.size))];
  return sizes.length===1?matches[0]:null;
}
function leadDays(facts,at) {
  const label = facts.leadTime || '';
  const match = label.match(/(\d+)\s*(?:[–—-]\s*(\d+))?\s*(working\s+|business\s+|calendar\s+)?(days?|weeks?)/i);
  if(match) return {days:Number(match[2] || match[1])*(/^week/i.test(match[4])?7:1),unit:/working|business/i.test(match[3] || '')?'working days':'calendar days',assumed:false};
  if(facts.arrival && /^\d{4}-\d{2}-\d{2}$/.test(facts.arrival)) {
    const difference = Math.ceil((Date.parse(facts.arrival+'T00:00:00Z')-Date.parse(at.slice(0,10)+'T00:00:00Z'))/86400000);
    if(whole(difference)) return {days:difference,unit:'calendar days',assumed:false};
  }
  return {days:7,unit:'calendar days',assumed:true};
}
function benchmarks(quote,quotes,selected,net) {
  const candidates = (quotes || []).filter(q=>q.id!==quote.id).map(q=>({quote:q,facts:getQuotationFacts(q,net)})).filter(({facts})=>{
    const f=facts.selected;
    return f && f.unitPrice>0 && f.goodsSubtotal!==null && f.currency===selected.currency && f.tax.basis && f.tax.basis===selected.tax.basis && itemMatches(selected.item,f.item) && itemMatches(f.item,selected.item);
  }).sort((a,b)=>a.facts.selected.unitPrice-b.facts.selected.unitPrice);
  const peer=candidates[0];
  return {
    vendorBenchmark:peer?{kind:'uploaded_quote',label:'Other uploaded supplier',unitPrice:peer.facts.selected.unitPrice,currency:selected.currency,supplier:peer.facts.supplier,quoteId:peer.quote.id,detail:`${peer.facts.supplier}: ${money(peer.facts.selected.unitPrice,selected.currency)} per unit for the same extracted product and tax basis. Source: ${peer.quote.name || 'uploaded quotation'}. Freight and commercial conditions may differ.`}:null,
    industryBenchmark:selected.unitPrice>0 && selected.currency?{kind:'assumption',label:'Illustrative industry reference',unitPrice:round(selected.unitPrice*0.95),currency:selected.currency,detail:`No verified industry or historical price data is connected. For this demonstration only, use 5% below this supplier’s unit price (${money(round(selected.unitPrice*0.95),selected.currency)}) as a discussion reference; this is not an observed market price.`}:null,
  };
}
function addEvent(session,role,label,content,at,source) {
  const actor=role==='agent'?'ProcureX agent':role==='vendor'?session.supplier:role==='customer'?'Customer':'ProcureX';
  session.events.push({id:`${session.id}:event:${session.events.length+1}`,at,role,actor,label,text:content,simulation:role==='vendor'||role==='agent',source:source || (role==='vendor'?'Simulated supplier':role==='agent'?'Local rule-based agent':role==='customer'?'Customer decision':'Local demo')});
}
function makeOffer(session,after,sequence) {
  const {baseline,quotation}=session.context;
  const before=session.goal==='price'?baseline.unitPrice:session.goal==='moq'?baseline.moq:baseline.deliveryDays;
  const net=baseline.requestedQuantity;
  const order=session.goal==='moq'?Math.ceil(Math.max(net,after)/baseline.packSize)*baseline.packSize:baseline.orderQuantity;
  const quantityValid=whole(order) && (session.goal==='moq' ? true : quotation.goodsSubtotal!==null);
  const conditions=[
    `Product specification: ${session.item}.`,
    session.goal==='price'?`Order quantity remains ${baseline.orderQuantity || 'unconfirmed'} units.`:`Unit price remains ${money(baseline.unitPrice,baseline.currency)}; supplier confirmation is simulated.`,
    `Tax basis remains ${baseline.taxBasis || 'unconfirmed'}.`,
    `${quotation.freight.conditional?'Conditional freight reference':'Freight remains'} ${quotation.freight.amount===null?'unpriced':money(quotation.freight.amount,baseline.currency)}${quotation.freight.indicative?' (reference estimate)':''}.${quotation.freight.conditional?' Recheck the original delivery threshold against the revised goods value; this amount is not guaranteed at the new price or quantity.':''} Goods savings use the original quoted tax basis and exclude separate freight and other charges.`,
    session.goal==='moq'?`Order pack multiple remains ${baseline.packSize} units${baseline.packSizeAssumed?' (assumed for this demo)':''}. The proposed minimum order is ${after} units; the procurement order would be ${order} units.`:'MOQ and other quoted terms remain unchanged.',
  ];
  if(session.goal==='moq' && quotation.tier && order<(quotation.tier.min || 0)) conditions.push('The lower order is outside the original price tier. Holding the unit price is an explicit simulated supplier concession, not a verified quotation.');
  if(!quantityValid) conditions.push('Order quantity / price tier needs confirmation; savings are not calculated.');
  if(quotation.displayOnly) conditions.push('Confirm that the extracted product matches the procurement requirement before any real purchase.');
  if(session.notes) conditions.push('Customer discussion notes are passed through verbatim. Any additional terms in those notes remain unevaluated and are not part of the agreed structured proposal.');
  conditions.push(...quotation.caveats);
  if(quotation.expiryDate) conditions.push(`Original quotation valid through ${quotation.expiryDate}${quotation.expiryDate<session.createdAt.slice(0,10)?'; expired — all proposals require a refreshed supplier quotation.':'; confirm validity before any real acceptance.'}`);
  const improvementPercent=before>0?round((before-after)/before*100,2):0;
  const goodsSavings=session.goal==='price' && quantityValid ? round((before-after)*order,2):null;
  const unit=session.goal==='price'?'per unit':session.goal==='moq'?'units':baseline.deliveryUnit;
  const summary=session.goal==='price'?`${money(before,baseline.currency)} → ${money(after,baseline.currency)} per unit (${improvementPercent}% lower)`:session.goal==='moq'?`MOQ ${before} → ${after} units`:`Lead time ${before} → ${after} ${unit}`;
  return {id:`${session.id}:offer:${sequence}`,goal:session.goal,before,after,unit,currency:baseline.currency,improvementPercent,goodsSavings,orderQuantity:order,quantityValid,conditions,summary};
}
function defaultTarget(goal,baseline,target) {
  const supplied=number(target);
  if(goal==='price') {
    const value=supplied ?? 10;
    if(value<=0 || value>=100) throw new Error('Price reduction must be greater than 0% and less than 100%.');
    return value;
  }
  const value=supplied ?? (goal==='moq'?Math.max(1,Math.floor(baseline.moq*0.8)):Math.max(1,baseline.deliveryDays-2));
  if(!whole(value)) throw new Error('Enter a positive whole-number target.');
  const before=goal==='moq'?baseline.moq:baseline.deliveryDays;
  if(value>=before) throw new Error(`The target must be lower than the current ${goal==='moq'?'MOQ':'lead time'} (${before}).`);
  return value;
}
function requestText(session) {
  const {baseline}=session.context;
  if(session.goal==='price') return `For ${session.item}, could you reduce ${money(baseline.unitPrice,baseline.currency)} per unit by ${session.target}% for ${baseline.orderQuantity || 'the requested'} units? Please keep specification, MOQ, freight and tax terms unchanged.`;
  if(session.goal==='moq') return `Could you reduce the minimum order for ${session.item} from ${baseline.moq} to ${session.target} units while retaining the quoted unit price ${money(baseline.unitPrice,baseline.currency)} and other commercial terms? Please confirm the order pack multiple.`;
  return `Could you shorten delivery of ${session.item} from ${baseline.deliveryDays} to ${session.target} ${baseline.deliveryUnit}, retaining the quoted unit price and freight terms? Please confirm stock and the dispatch commitment.`;
}
function approvalText(offer) {
  return `${offer.summary}. ${offer.goodsSavings!==null?`Goods savings: ${money(offer.goodsSavings,offer.currency)} for ${offer.orderQuantity} units. `:''}Please approve these terms, request a better offer, or stop. I will not continue the supplier conversation until you decide.`;
}

/** Local demo only: all supplier replies are generated deterministically; no external messages are sent. */
export function createNegotiationSession({id,quote,quotes=[],req={},goal='price',target,notes='',now,contextVersion=''}) {
  if(!quote) throw new Error('Choose a supplier quotation first.');
  if(!NEGOTIATION_GOALS.some(value=>value.id===goal)) throw new Error('Choose a supported negotiation goal.');
  const at=timestamp(now), net=Math.max(0,(number(req.quantity)||0)-(number(req.stock)||0));
  const facts=getQuotationFacts(quote,net), selected=facts.selected;
  if(!selected) throw new Error('This quotation has no extracted product to negotiate.');
  if(goal==='price' && (!(selected.unitPrice>0) || !selected.currency)) throw new Error('A quoted unit price and currency are required for price negotiation.');
  const lead=leadDays(selected,at), assumptions=[];
  const hasMoq=Number.isSafeInteger(selected.moq) && selected.moq>=0;
  const moq=hasMoq?selected.moq:(whole(net)?net:100);
  const orderLot=whole(selected.packSize)?null:explicitOrderLot(selected,quote,facts);
  const packSize=whole(selected.packSize)?selected.packSize:orderLot?.size || 1;
  const packSizeAssumed=!whole(selected.packSize) && !orderLot;
  if(!hasMoq) assumptions.push(assumption('moq','Assumed MOQ',`No valid MOQ was quoted. Use ${moq} units as the starting minimum for this demonstration; supplier confirmation is required.`));
  if(packSizeAssumed) assumptions.push(assumption('pack','Assumed order multiple','No order multiple was quoted. Use one unit for demonstration calculations; confirm packaging with the supplier.'));
  if(lead.assumed) assumptions.push(assumption('lead-time','Assumed delivery baseline','No usable delivery lead time is available. Use 7 calendar days for this demonstration; this is not a supplier commitment.'));
  else if(!selected.leadTime && selected.arrival) assumptions.push(assumption('order-date','Assumed order date',`Translate quoted arrival ${selected.arrival} into ${lead.days} calendar days by assuming an order placed on ${at.slice(0,10)}.`));
  if(selected.displayOnly) assumptions.push(assumption('specification','Specification review required','The extracted product has not been confirmed against the procurement requirement. This session discusses that extracted product only.'));
  if(selected.expiryDate && selected.expiryDate<at.slice(0,10)) assumptions.push(assumption('quote-validity','Expired source quotation',`The original quotation expired on ${selected.expiryDate}. For demonstration only, assume the source price can be discussed; a refreshed real quotation is required before acceptance.`));
  const refs=benchmarks(quote,quotes,selected,net);
  if(refs.industryBenchmark) assumptions.push(assumption('industry-reference',refs.industryBenchmark.label,refs.industryBenchmark.detail));
  if(!refs.vendorBenchmark) assumptions.push(assumption('peer-reference','No comparable supplier benchmark','No uploaded quote with the same extracted product, currency and tax basis is available. The strategy uses this supplier’s own quotation; no competitor price is invented.'));
  assumptions.push(assumption('supplier-response','Simulated supplier willingness','Supplier replies and concessions in this session are a local demonstration. No supplier has been contacted and no purchase order is placed.'));
  const orderQuantity=orderLot && whole(selected.orderQuantity)?Math.ceil(selected.orderQuantity/packSize)*packSize:selected.orderQuantity;
  const baseline={unitPrice:selected.unitPrice,currency:selected.currency,moq,moqAssumed:!hasMoq,packSize,packSizeAssumed,requestedQuantity:net,orderQuantity,leadTime:selected.leadTime,deliveryDays:lead.days,deliveryUnit:lead.unit,deliveryDaysAssumed:lead.assumed,taxBasis:selected.tax.basis};
  const session={id:String(id || `neg-${at}-${quote.id}`),quoteId:quote.id,supplier:facts.supplier,item:selected.item,goal,target:defaultTarget(goal,baseline,target),notes:text(notes),status:'awaiting_approval',createdAt:at,updatedAt:at,version:1,contextVersion:String(contextVersion),simulation:true,context:{baseline,quotation:clone(selected),...refs,assumptions,evidence:[{label:'Original quotation',detail:`${quote.name || 'Uploaded quotation'} · ${facts.supplier} · ${selected.item}. Unit price ${money(selected.unitPrice,selected.currency)}. MOQ ${selected.moq ?? 'not quoted'}. Lead time ${selected.leadTime || selected.arrival || 'not quoted'}.`,kind:'quotation'},...(refs.vendorBenchmark?[{label:refs.vendorBenchmark.label,detail:refs.vendorBenchmark.detail,kind:'uploaded_quote'}]:[])]},pendingOffer:null,outcome:null,events:[]};
  let after=goal==='price'?round(baseline.unitPrice*(1-session.target/100)):session.target;
  if(goal==='price' && (after<=0 || after>=baseline.unitPrice)) throw new Error('This reduction cannot be represented at four decimal places. Choose another target.');
  session.pendingOffer=makeOffer(session,after,1);
  session.lastOffer=session.pendingOffer;
  session.context.evidence.push(...selected.caveats.map(detail=>({label:'Quotation condition',detail,kind:'quotation'})));
  if(orderLot) session.context.evidence.push({label:'Explicit order lot',detail:orderLot.evidence,kind:'quotation'});
  if(selected.expiryDate) session.context.evidence.push({label:'Original quotation validity',detail:`Valid through ${selected.expiryDate}.`,kind:'quotation'});
  addEvent(session,'system','Demo session started','Local rule-based negotiation simulation. Uploaded quotation facts and explicitly labelled assumptions are snapshotted below; supplier replies are simulated.',at);
  addEvent(session,'customer','Negotiation goal',`${NEGOTIATION_GOALS.find(value=>value.id===goal).label}: ${goal==='price'?session.target+'%':session.target+' '+(goal==='moq'?'units':baseline.deliveryUnit)}.${session.notes?' Customer instructions: '+session.notes:''}`,at);
  addEvent(session,'agent','Review quotation and benchmarks',`I am using ${facts.supplier}’s quotation for ${selected.item}: ${money(selected.unitPrice,selected.currency)} per unit, MOQ ${moq}, lead time ${baseline.deliveryDays} ${baseline.deliveryUnit}.${refs.vendorBenchmark?' Uploaded supplier benchmark: '+refs.vendorBenchmark.detail:' No directly comparable supplier price is available.'}${refs.industryBenchmark?' Industry discussion reference: '+refs.industryBenchmark.detail:''}`,at);
  addEvent(session,'agent','Opening request',requestText(session)+(session.notes?' Customer discussion note (passed through as written): '+session.notes:''),at);
  addEvent(session,'vendor','Simulated supplier offer',`For this demonstration, we can offer ${session.pendingOffer.summary}. ${goal==='moq'?'We would retain the unit price for this revised minimum order.':'Other commercial terms remain unchanged.'} Please confirm whether these terms are acceptable.`,at);
  addEvent(session,'agent','Customer approval required',approvalText(session.pendingOffer),at);
  return freeze(session);
}

/** Decisions are bound to one pending offer and one unchanged procurement context. */
export function advanceNegotiation(session,{type,note='',now,offerId,currentContextVersion}={}) {
  if(!session || session.status!=='awaiting_approval' || !session.pendingOffer) return session;
  if(!['approve','counter','reject'].includes(type)) return session;
  if(offerId!==undefined && offerId!==session.pendingOffer.id) return session;
  if(currentContextVersion!==undefined && String(currentContextVersion)!==session.contextVersion) return session;
  const at=timestamp(now), next=clone(session), offer=next.pendingOffer;
  next.version+=1; next.updatedAt=at;
  const noteText=text(note);
  if(type==='reject') {
    addEvent(next,'customer','Negotiation stopped','Stop this negotiation. No offer is accepted.'+(noteText?' '+noteText:''),at);
    addEvent(next,'agent','Session closed','I have stopped the demo. No acceptance or order has been sent.',at);
    next.status='stopped'; next.pendingOffer=null;
  } else if(type==='approve') {
    addEvent(next,'customer','Offer approved',`I approve: ${offer.summary}.`+(noteText?' '+noteText:''),at);
    addEvent(next,'agent','Continue after customer approval',`The customer has approved ${offer.summary}. Please confirm these exact terms and the unchanged conditions for our review.${next.notes?' Original customer note (passed through as written): '+next.notes:''}${noteText?' Customer approval note (passed through as written): '+noteText:''}`,at);
    const unresolvedNotes=[...(next.notes?[{source:'initial',text:next.notes}]:[]),...(noteText?[{source:'approval',text:noteText}]:[])];
    addEvent(next,'vendor','Simulated supplier confirmation',`Confirmed for this demonstration: ${offer.summary}. The listed conditions remain part of this proposal.${unresolvedNotes.length?' Your free-text notes are received but have not been evaluated; no agreement to additional conditions in those notes is implied.':''}`,at);
    addEvent(next,'system','Demo agreement recorded','Customer approval and the simulated supplier confirmation are recorded. The original quotation comparison is unchanged; no purchase order was created.',at);
    next.status='completed'; next.outcome={...offer,conditions:[...offer.conditions,...(unresolvedNotes.length?['Free-text customer notes are recorded for follow-up; any additional terms remain unconfirmed.']:[])],approvedAt:at,unresolvedNotes}; next.pendingOffer=null;
  } else {
    addEvent(next,'customer','Request a better offer','Please seek a better offer; I have not approved the current terms.'+(noteText?' '+noteText:''),at);
    const after=next.goal==='price'?Math.max(round(next.context.baseline.unitPrice*0.5),round(offer.after-next.context.baseline.unitPrice*0.02)):next.goal==='moq'?Math.max(1,offer.after-Math.max(1,Math.floor(next.context.baseline.moq*0.1))):Math.max(1,offer.after-1);
    const bounded=next.goal==='price'?Math.min(offer.after,after):after;
    next.pendingOffer=makeOffer(next,bounded,next.version);
    next.lastOffer=next.pendingOffer;
    addEvent(next,'agent','Request revised terms',`The customer has asked for a better offer. Could you improve on ${offer.summary} while retaining the listed conditions?${noteText?' Customer note: '+noteText:''}`,at);
    addEvent(next,'vendor','Simulated revised offer',bounded===offer.after?`This is our best simulated offer: ${next.pendingOffer.summary}.`:`We can improve the simulated proposal to ${next.pendingOffer.summary}. Other listed conditions remain unchanged.`,at);
    addEvent(next,'agent','Customer approval required',approvalText(next.pendingOffer),at);
  }
  return freeze(next);
}
