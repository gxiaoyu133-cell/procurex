import {getQuotationFacts} from './quotation-facts.mjs';

const compact=value=>String(value??'').replace(/\s+/g,' ').trim();
const normalize=value=>compact(value).toLowerCase();
const number=value=>value===null||value===undefined||compact(value)===''?null:Number.isFinite(Number(String(value).replace(/,/g,'')))?Number(String(value).replace(/,/g,'')):null;
const unique=values=>[...new Set(values.filter(Boolean))];
const copy=value=>structuredClone(value);
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const date=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;const d=new Date(value+'T00:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===value?value:null;};
const stamp=now=>{const d=now===undefined?new Date():new Date(now);if(!Number.isFinite(+d))throw new Error('Enter a valid review time.');return d.toISOString();};
const priorities=new Set(['reliability','cost','delivery']);
const priorityOf=value=>{if(!priorities.has(value))throw new Error('Choose reliability, cost or delivery priority.');return value;};
const scope='Approval permits negotiation with the selected supplier only; it is not a purchase approval.';
const limitation='This ranks quotation evidence, not verified supplier performance. No delivery history, quality audit or credit record has been supplied.';

function requirementFacts(req){
  const quantity=number(req?.quantity),stock=number(req?.stock),errors=[];
  if(!Number.isSafeInteger(quantity)||quantity<=0)errors.push('Enter a positive whole-unit demand.');
  if(!Number.isSafeInteger(stock)||stock<0)errors.push('Enter a valid whole-unit stock quantity, including zero.');
  if(!compact(req?.item))errors.push('Enter the required item and specification.');
  const net=errors.length?0:Math.max(0,quantity-stock);
  if(!errors.length&&net===0)errors.push('Existing stock covers the demand; no new supplier is recommended.');
  return {net,errors};
}

/** Rank the support in the quotations. A score is evidence completeness, never a supplier rating. */
export function buildSupplierRecommendation(quotes=[],req={},options={}){
  const priority=priorityOf(options.priority??'reliability');
  const today=date(options.today)||new Date().toISOString().slice(0,10);
  const preferredQuoteId=options.preferredQuoteId??null;
  const {net,errors}=requirementFacts(req);
  const deadline=date(req.deadline);
  const limitations=[limitation,...errors];
  const rows=quotes.map((quote,index)=>{
    const extracted=getQuotationFacts(quote,net),facts=extracted.selected;
    const reasons=[],risks=['Supplier delivery, quality and financial reliability have not been independently verified.'];
    let score=0;
    const quoteId=quote.id??index;
    const selectedValues=quote.match?.selectedId===facts?.candidateId?quote.values:(quote.candidates||[]).find(c=>c.id===facts?.candidateId)?.values||quote.values||{};
    const sourcePresent=!!compact(facts?.source||quote.text);
    const sameRequirement=!compact(quote.match?.requirement)||normalize(quote.match.requirement)===normalize(req.item);
    const humanRejected=quote.reviewed===true&&quote.equivalent===false;
    const matches=!!facts&&!humanRejected&&(sameRequirement&&(quote.equivalent===true||quote.match?.matchesRequirement===true)||normalize(facts.item)===normalize(req.item));
    const positivePrice=!!facts&&facts.unitPrice>0&&Number.isFinite(facts.unitPrice);
    const validUnits=!!facts&&Number.isSafeInteger(facts.priceUnit)&&facts.priceUnit>0;
    const currencyValid=!!facts&&/^[A-Z]{3}$/.test(facts.currency||'');
    const validOrder=!!facts&&Number.isSafeInteger(facts.orderQuantity)&&facts.orderQuantity>0&&facts.goodsSubtotal>0&&Number.isFinite(facts.goodsSubtotal);
    const invalidQuantity=!!facts&&[facts.moq,facts.packSize].some(n=>n!==null&&(!Number.isSafeInteger(n)||n<=0));
    const invalidCharges=!!facts&&(facts.freight.amount!==null&&facts.freight.amount<0||number(selectedValues.other)!==null&&number(selectedValues.other)<0);
    const eligible=errors.length===0&&matches&&positivePrice&&validUnits&&currencyValid&&validOrder&&!invalidQuantity&&!invalidCharges;
    if(matches){score+=20;reasons.push(quote.equivalent===true?'Product specification was confirmed by a person.':'Extracted product matches the procurement requirement.');}else risks.push(humanRejected?'A person has not accepted this product as equivalent. Explicitly confirm the specification in source review before approval.':'Product specification is not matched; select or correct the relevant product before approval.');
    if(positivePrice&&validUnits){score+=20;reasons.push('A positive source price and explicit unit basis are available.');}else risks.push('A positive price and valid units per quoted price are required.');
    if(currencyValid){score+=5;}else risks.push('The quotation currency is missing or invalid.');
    if(!sourcePresent)risks.push('Original source evidence is missing; check the entered quotation values.');
    if(facts){
      if(sourcePresent)score+=5;
      if(facts.tax.basis==='pre-tax'||facts.tax.basis==='tax-inclusive'){score+=5;reasons.push(facts.tax.label);}else risks.push('Tax basis is unresolved; prices cannot be compared on a common tax basis.');
      if(facts.moq!==null&&facts.moq>0&&Number.isSafeInteger(facts.moq)){score+=5;}else risks.push('Minimum order quantity requires supplier confirmation.');
      if(facts.packSize!==null&&facts.packSize>0&&Number.isSafeInteger(facts.packSize)){score+=5;}else risks.push('Order pack multiple requires supplier confirmation.');
      if(invalidQuantity)risks.push('MOQ or pack quantity is invalid; correct it before approval.');
      if(!validOrder)risks.push('The quoted price tier does not produce a valid goods total for this order.');
      if(facts.quantitySuggested)risks.push('The quoted tier requires a higher order quantity than requested.');
      if(facts.orderQuantity>net&&net>0)risks.push(`Order quantity rises from ${net} to ${facts.orderQuantity} units to meet the quoted conditions.`);
      if(facts.freight.amount!==null&&facts.freight.amount>=0&&!facts.freight.indicative){score+=10;reasons.push(facts.freight.conditional?'A conditional freight amount is available; the condition must remain satisfied.':'A freight amount is stated in the quotation.');}else risks.push(facts.freight.indicative?'Freight is an estimate and requires a new quote.':'Freight is not priced; the known subtotal is incomplete.');
      if(facts.freight.conditional)risks.push('Recheck the freight condition after any price or quantity change.');
      if(number(selectedValues.other)===null)risks.push('Other charges are not specified.');
      if(invalidCharges)risks.push('A freight or other charge is negative; correct the source values before approval.');
      const arrival=date(facts.arrival);
      if(arrival&&arrival>=today){score+=15;reasons.push(`Quoted arrival: ${arrival}.`);if(deadline&&arrival>deadline){score-=15;risks.push(`Quoted arrival ${arrival} is later than the required date ${deadline}.`);}}
      else if(compact(facts.leadTime)){score+=7;reasons.push(`Quoted lead time: ${facts.leadTime}.`);risks.push('A relative lead time is available; arrival depends on order date, stock and supplier confirmation.');}
      else risks.push('No usable arrival date or lead time is available.');
      if(facts.arrival&&!arrival)risks.push('The quoted arrival date is invalid.');
      if(arrival&&arrival<today)risks.push(`Quoted arrival ${arrival} is in the past; reconfirm the schedule.`);
      const expiry=date(facts.expiryDate);
      if(expiry&&expiry>=today){score+=10;reasons.push(`Quotation is dated valid through ${expiry}; availability still needs confirmation.`);}
      else if(expiry){score-=25;risks.push(`Quotation expired on ${expiry}; all prices and terms require revalidation before negotiation can produce a current offer.`);}
      else risks.push('Quotation validity is not stated.');
      const stockEvidence=compact(facts.source||quote.text).match(/(?:local stock|in stock|stock available|ready stock)/i);
      if(stockEvidence)reasons.push('Source mentions stock availability; current stock has not been independently confirmed.');
      risks.push(...facts.caveats);
    }else risks.push('No usable product row was extracted.');
    return {quoteId,supplier:extracted.supplier,facts,score:Math.max(0,Math.min(100,score)),reasons:unique(reasons),risks:unique(risks),eligible};
  });
  const usable=rows.filter(row=>row.eligible);
  // Cost comparisons require the same item, currency, tax treatment, and complete
  // non-indicative freight/other charges. Missing costs never become zero here.
  const costKey=row=>{
    const f=row.facts,q=quotes.find((q,i)=>(q.id??i)===row.quoteId);
    const values=q?.match?.selectedId===f?.candidateId?q.values:(q?.candidates||[]).find(c=>c.id===f?.candidateId)?.values||q?.values||{};
    return f&&['pre-tax','tax-inclusive'].includes(f.tax.basis)&&f.freight.amount!==null&&!f.freight.indicative&&number(values.other)!==null&&!f.tax.onCif&&(!date(f.expiryDate)||f.expiryDate>=today)?`${f.currency}|${f.tax.basis}|${normalize(f.item)}|${f.orderQuantity}|${normalize(f.incoterm)}`:null;
  };
  const keys=usable.map(costKey);
  const costComparable=usable.length>1&&keys.every(key=>key!==null&&key===keys[0]);
  if(usable.length>1&&!costComparable)limitations.push('No complete, like-for-like cost ranking is available across all candidates. Currencies, tax treatment, trade terms, product or order quantities may differ, some charges may be missing, or validity has expired. Native-currency amounts are not converted or treated as equal.');
  if(priority==='cost'&&!costComparable)limitations.push('Cost priority cannot be applied safely to these quotations; evidence completeness is used until cost bases are aligned.');
  if(!deadline)limitations.push('Required arrival date is missing or invalid; deadline suitability cannot be established.');
  if(!usable.length)limitations.push('No usable matching quotation is available for negotiation approval. Correct product, quantity, price or currency information first.');
  if(usable.length>1&&!costComparable)for(const row of rows)row.risks.push('This quotation cannot participate in a complete like-for-like cost comparison with every other candidate.');
  const ranked=[...rows].sort((a,b)=>{
    if(a.eligible!==b.eligible)return a.eligible?-1:1;
    if(priority==='cost'&&costComparable&&a.eligible&&b.eligible)return a.facts.knownSubtotal-b.facts.knownSubtotal||b.score-a.score;
    if(priority==='delivery'&&a.eligible&&b.eligible){const ad=date(a.facts.arrival),bd=date(b.facts.arrival),aCurrent=ad&&ad>=today?ad:null,bCurrent=bd&&bd>=today?bd:null;if(!!aCurrent!==!!bCurrent)return aCurrent?-1:1;if(aCurrent&&bCurrent&&aCurrent!==bCurrent)return aCurrent.localeCompare(bCurrent);}
    return b.score-a.score||String(a.quoteId).localeCompare(String(b.quoteId));
  });
  const preferred=ranked.find(row=>row.eligible&&row.quoteId===preferredQuoteId);
  if(preferredQuoteId!==null&&!preferred)limitations.push('The requested supplier is not currently usable; no approval has been recorded for that preference.');
  const best=preferredQuoteId!==null?preferred||null:ranked.find(row=>row.eligible)||null;
  const rationale=best?[preferred?'This is the customer-selected usable quotation for negotiation.':priority==='cost'&&costComparable?'Lowest complete known subtotal within the same currency, tax, product and order-quantity basis.':priority==='delivery'?'Quoted arrival dates are prioritised where current dates exist; other candidates use evidence completeness.':'Best-supported usable quotation for negotiation based on available source evidence.',`Evidence completeness: ${best.score}/100. This is not a supplier-performance score.`,...best.reasons.slice(0,3),scope]:['No supplier can be recommended from the current inputs.'];
  return freeze(copy({recommendedQuoteId:best?.quoteId??null,ranking:ranked,rationale,limitations:unique(limitations),priority,preferredQuoteId}));
}

function eventFor(review,type,at,feedback,detail){return {id:`review-${review.revision}-${review.events.length+1}`,at,type,revision:review.revision,feedback,detail,priority:review.priority,preferredQuoteId:review.preferredQuoteId,approvedQuoteId:review.approvedQuoteId,recommendation:copy(review.recommendation)};}
function requireContext(value){if(!compact(value))throw new Error('A current quotation context is required.');return value;}
function requireReview(review){if(!review||!Number.isSafeInteger(review.revision)||review.revision<1||!Array.isArray(review.events))throw new Error('Start a supplier review first.');}

export function createSupplierReview({quotes=[],req={},contextVersion,now}={}){
  const at=stamp(now),priority='reliability',preferredQuoteId=null;
  const recommendation=buildSupplierRecommendation(quotes,req,{priority,preferredQuoteId,today:at.slice(0,10)});
  const review={revision:1,status:'pending',needsRefresh:false,contextVersion:requireContext(contextVersion),priority,preferredQuoteId,recommendation,feedbackDraft:'',approvedQuoteId:null,createdAt:at,updatedAt:at,events:[]};
  review.events.push(eventFor(review,'created',at,'','Recommendation prepared for human review. '+scope));
  return freeze(review);
}

export function requestSupplierChanges(review,{feedback,now}={}){
  requireReview(review);
  if(!compact(feedback))throw new Error('Describe what you want changed before requesting a revision.');
  const at=stamp(now),next=copy(review);
  next.status='changes_requested';next.feedbackDraft=String(feedback);next.approvedQuoteId=null;next.updatedAt=at;
  next.events.push(eventFor(next,'changes_requested',at,String(feedback),'Customer requested changes. Approval is withheld until a revised recommendation is reviewed.'));
  return freeze(next);
}

export function reviseSupplierReview(review,{quotes=[],req={},contextVersion,priority=review?.priority,preferredQuoteId=review?.preferredQuoteId??null,feedback,now}={}){
  requireReview(review);
  if(review.status!=='changes_requested'&&!review.needsRefresh)throw new Error('Request changes and provide feedback before revising.');
  const exactFeedback=feedback===undefined?review.feedbackDraft:String(feedback);
  if(!compact(exactFeedback)&&!review.needsRefresh)throw new Error('The revision must retain the customer feedback.');
  const at=stamp(now),next=copy(review);
  next.revision+=1;next.status='pending';next.needsRefresh=false;next.contextVersion=requireContext(contextVersion);next.priority=priorityOf(priority);next.preferredQuoteId=preferredQuoteId;next.approvedQuoteId=null;next.feedbackDraft=exactFeedback;next.updatedAt=at;
  next.recommendation=copy(buildSupplierRecommendation(quotes,req,{priority:next.priority,preferredQuoteId,today:at.slice(0,10)}));
  const settingsChanged=next.priority!==review.priority||preferredQuoteId!==review.preferredQuoteId;
  const sourceChanged=contextVersion!==review.contextVersion;
  const changeSummary=settingsChanged||sourceChanged?'Applied structured settings:':'No structured setting or quotation-context change was recorded. Re-evaluated settings:';
  if(compact(exactFeedback))next.recommendation.limitations.unshift('Customer feedback is retained as a review request. Only explicit priority, supplier preference and saved source or requirement changes are applied; free-text instructions are not automatically executed.');
  next.events.push(eventFor(next,'revised',at,exactFeedback,`${changeSummary} priority = ${next.priority}; preferred supplier = ${preferredQuoteId??'automatic'}. Source data and requirement changes are re-evaluated. Free-text feedback is retained for review; it is not automatically interpreted or represented as completed. Human approval is required again.`));
  return freeze(next);
}

export function approveSupplierReview(review,{quoteId,contextVersion,acknowledged=false,revision,now}={}){
  requireReview(review);
  if(review.status!=='pending')throw new Error('Only the current pending recommendation can be approved.');
  if(review.needsRefresh)throw new Error('Source data changed. Refresh the recommendation and review it again before approval.');
  if(contextVersion!==review.contextVersion)throw new Error('Quotations or requirements changed. Generate and review the current recommendation first.');
  if(revision!==review.revision)throw new Error('This review revision is no longer current.');
  if(acknowledged!==true)throw new Error('Acknowledge the unresolved conditions and negotiation-only approval scope.');
  const row=review.recommendation.ranking.find(row=>row.quoteId===quoteId&&row.eligible);
  if(!row)throw new Error('Choose a usable matching quotation before approving negotiation.');
  if(quoteId!==review.recommendation.recommendedQuoteId)throw new Error('Revise the supplier preference and review the new recommendation before approving an alternative supplier.');
  const at=stamp(now),next=copy(review);
  next.status='approved';next.approvedQuoteId=quoteId;next.updatedAt=at;
  next.events.push(eventFor(next,'approved',at,'',`Customer approved negotiation with ${row.supplier}, acknowledging the visible source limitations and unresolved conditions. ${scope}`));
  return freeze(next);
}

export function isSupplierReviewApproved(review,contextVersion){
  return !!review&&!review.needsRefresh&&review.status==='approved'&&review.contextVersion===contextVersion&&review.approvedQuoteId!==null&&review.approvedQuoteId!==undefined&&review.recommendation?.ranking?.some(row=>row.quoteId===review.approvedQuoteId&&row.eligible)===true;
}

/** Revocation is sticky: reverting an edit cannot restore an old approval. */
export function invalidateSupplierReview(review,{reason='Quotation or requirement data changed.',now}={}){
  requireReview(review);
  const at=stamp(now),next=copy(review);
  next.status='pending';next.needsRefresh=true;next.approvedQuoteId=null;next.updatedAt=at;
  next.events.push(eventFor(next,'invalidated',at,'',compact(reason)+' Previous approval is revoked; refresh and review again.'));
  return freeze(next);
}

/** Conservative hints only. The UI must display these before applying a revision. */
export function interpretSupplierFeedback(text,review){
  const feedback=String(text??'');
  const result={suggestedPriority:null,preferredQuoteId:null,recognized:[],unhandledDataChange:false,warnings:[]};
  if(!compact(feedback))return freeze(result);
  if(/\b(?:skip|bypass|ignore|disable|avoid)\b.{0,35}\b(?:approval|review|permission)\b|\b(?:automatically approve|approve automatically)\b|(?:跳过|绕过|忽略|关闭|不要)(?:人工)?(?:审核|审查|批准|确认)|自动(?:批准|审核通过)/i.test(feedback)){
    result.warnings.push('Approval cannot be bypassed. Choose review settings explicitly; no feedback suggestions were applied.');
    return freeze(result);
  }
  const negated=index=>{
    const clause=feedback.slice(Math.max(0,index-65),index).split(/[,;.!?\n，；。！？]|\bbut\b|但是|而是/i).at(-1)||'';
    return /\b(?:not|don['’]t|do not|never|avoid|without)\b|不要|不想|不选|不是|避免|无需|不优先/i.test(clause);
  };
  const patterns={
    cost:/\b(?:lowest|lower|cheaper|minimum|reduced?)\s+(?:total\s+|landed\s+)?(?:costs?|prices?)\b|\b(?:cost|price)\s+(?:first|priority)\b|\bprioriti[sz]e\s+(?:cost|price)\b|(?:价格|成本|低价|最低价)(?:为先|优先)|优先(?:价格|成本|低价|最低价)/gi,
    delivery:/\b(?:quicker|faster|earlier|fastest|shorter)\s+(?:delivery|arrival|lead times?)\b|\b(?:delivery|arrival|lead time)\s+(?:first|priority)\b|\bprioriti[sz]e\s+(?:delivery|arrival|lead time)\b|(?:交期|交货|到货|配送|交付)(?:为先|优先)|优先(?:交期|交货|到货|配送|交付)|(?:更快|更早|缩短)(?:交货|到货|交期)/gi,
    reliability:/\b(?:stronger|better|more complete|verified)\s+(?:evidence|documentation)\b|\b(?:reliability|evidence)\s+(?:first|priority)\b|\b(?:prefer|prioriti[sz]e)\s+(?:reliability|evidence)\b|(?:可靠性?|证据|资料完整)(?:为先|优先)|优先(?:可靠性?|证据|资料完整)/gi,
  };
  const priorityMatches=Object.entries(patterns).filter(([,pattern])=>[...feedback.matchAll(pattern)].some(match=>!negated(match.index))).map(([priority])=>priority);
  if(priorityMatches.length===1){result.suggestedPriority=priorityMatches[0];result.recognized.push(`Suggested priority: ${priorityMatches[0]}. Confirm the visible setting before applying.`);}
  if(priorityMatches.length>1)result.warnings.push('Feedback mentions multiple priorities. Choose one explicitly before applying.');
  const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const suppliers=review?.recommendation?.ranking||[];
  const mentions=[];
  for(const supplier of suppliers){
    const aliases=unique([compact(supplier.supplier),compact(supplier.supplier).replace(/\s*\([^)]*\)\s*$/,'').trim()]).filter(name=>name.length>=3);
    const found=aliases.some(name=>{
      const pattern=new RegExp('(?:\\b(?:prefer|choose|select|switch to|use supplier)|选择|优先选择|改用|更换为)\\s*(?:supplier\\s+)?["“‘\\\']?'+escape(name)+'(?=$|[\\s,;.!?，；。！？"”’\\\'])','gi');
      return [...feedback.matchAll(pattern)].some(match=>!negated(match.index));
    });
    if(found)mentions.push(supplier);
  }
  const uniqueMentions=[...new Map(mentions.map(supplier=>[supplier.quoteId,supplier])).values()];
  if(uniqueMentions.length===1){if(uniqueMentions[0].eligible){result.preferredQuoteId=uniqueMentions[0].quoteId;result.recognized.push(`Suggested supplier: ${uniqueMentions[0].supplier}. Confirm the visible selection before applying.`);}else result.warnings.push(`The requested supplier ${uniqueMentions[0].supplier} has no usable matching quotation. Correct its source fields before selecting it.`);}
  if(uniqueMentions.length>1)result.warnings.push('Feedback names multiple supplier preferences. Choose one explicitly before applying.');
  result.unhandledDataChange=/(?:\b(?:change|set|replace|correct|reduce|lower|increase|make|require|request)\b.{0,55}(?:\d|certif|specification|material|tax|freight)|(?:修改|改为|改成|调整|降低|提高|需要|要求).{0,35}(?:\d|认证|证书|规格|材质|税|运费))/i.test(feedback);
  if(result.unhandledDataChange)result.warnings.push('Requested amount, term or evidence changes must be made in source review or confirmed with the supplier. Feedback does not change quoted facts.');
  if(!result.recognized.length&&!result.warnings.length)result.warnings.push('No explicit priority or known supplier preference was recognised. Choose settings or edit the source fields; the complete feedback remains in the review history.');
  return freeze(result);
}
