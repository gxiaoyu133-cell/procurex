'use client';

import {useEffect, useState} from 'react';
import {ArrowRight, CheckCircle2, ChevronDown, Download, FileCheck2, FileText, History, MessageSquareText, RotateCcw, ShieldCheck, SlidersHorizontal, TriangleAlert} from 'lucide-react';
import {interpretSupplierFeedback} from '../lib/supplier-review.mjs';
import './supplier-review-panel.css';

type QuoteId = string|number;
type Priority = 'reliability'|'cost'|'delivery';
type Props = {
 review:any;
 quotes:any[];
 onRequestChanges:(feedback:string)=>void;
 onRevise:(settings:{priority:Priority; preferredQuoteId:QuoteId|null; feedback:string})=>void;
 onApprove:(decision:{quoteId:QuoteId; acknowledged:boolean; revision:number})=>void;
 onReviewQuote:(quoteId:QuoteId)=>void;
 onContinue:()=>void;
 onExport?:()=>void;
 error?:string;
};
const priorities:Record<Priority,{label:string; detail:string}> = {
 reliability:{label:'Quotation confidence',detail:'Prefer stronger evidence and fewer unresolved terms.'},
 cost:{label:'Lowest comparable cost',detail:'Compare prices only when currency, units and tax basis agree.'},
 delivery:{label:'Delivery certainty',detail:'Prefer documented timing that supports your deadline.'},
};
const number=(value:any)=>value===null||value===undefined||value===''||!Number.isFinite(Number(value))?'Not stated':new Intl.NumberFormat('en-GB',{maximumFractionDigits:3}).format(Number(value));
const money=(value:any,currency?:string)=>value===null||value===undefined||value===''||!Number.isFinite(Number(value))?'Not stated':`${currency||'Currency unknown'} ${new Intl.NumberFormat('en-GB',{minimumFractionDigits:2,maximumFractionDigits:4}).format(Number(value))}`;
const when=(value:any)=>{const d=new Date(value);return Number.isNaN(d.getTime())?'':new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(d)};
const eventLabel:Record<string,string>={created:'Initial recommendation',changes_requested:'Changes requested',revised:'Recommendation revised',approved:'Approved by you',invalidated:'Approval reset after a data change'};

export default function SupplierReviewPanel({review,quotes=[],onRequestChanges,onRevise,onApprove,onReviewQuote,onContinue,onExport,error}:Props){
 const [acknowledged,setAcknowledged]=useState(false);
 const [requestOpen,setRequestOpen]=useState(false);
 const [feedback,setFeedback]=useState(review?.feedbackDraft||'');
 const [priority,setPriority]=useState<Priority>(review?.priority||'reliability');
 const [feedbackHint,setFeedbackHint]=useState<any>(null);
 const [preferred,setPreferred]=useState(review?.preferredQuoteId===null||review?.preferredQuoteId===undefined?'':String(review.preferredQuoteId));
 useEffect(()=>{
  setAcknowledged(false);setRequestOpen(false);
  setFeedback(review?.feedbackDraft||'');
  const hint=review?.status==='changes_requested'?interpretSupplierFeedback(review.feedbackDraft||'',review):null;
  setFeedbackHint(hint);
  setPriority(hint?.suggestedPriority||review?.priority||'reliability');
  const suggestedId=hint?.preferredQuoteId??review?.preferredQuoteId;
  setPreferred(suggestedId===null||suggestedId===undefined?'':String(suggestedId));
 },[review?.contextVersion,review?.revision,review?.status,review?.feedbackDraft,review?.priority,review?.preferredQuoteId,review?.needsRefresh]);

 if(!review)return <section className="sr-panel card" id="supplier-review" aria-label="Supplier review"><div className="sr-empty"><ShieldCheck size={23}/><h2>Review your supplier recommendation</h2><p>Confirm the comparison to prepare an evidence-based recommendation for your approval.</p></div></section>;
 const recommendation=review.recommendation||{};
 const ranking:any[]=recommendation.ranking||[];
 const selected=ranking.find(candidate=>String(candidate.quoteId)===String(recommendation.recommendedQuoteId));
 const canApprove=!review.needsRefresh&&selected?.eligible&&recommendation.recommendedQuoteId!==null&&recommendation.recommendedQuoteId!==undefined;
 const approved=review.status==='approved'&&!review.needsRefresh;
 const changing=review.status==='changes_requested'||review.needsRefresh;
 const sourceReady=selected?.eligible&&recommendation.recommendedQuoteId!==null&&recommendation.recommendedQuoteId!==undefined;
 const isPreferred=review.preferredQuoteId!==null&&review.preferredQuoteId!==undefined&&String(review.preferredQuoteId)===String(selected?.quoteId);
 const concreteReasons=[...(selected?.reasons||[])].sort((a:string,b:string)=>Number(/freight|GST|tax|lead time|arrival|valid through/i.test(b))-Number(/freight|GST|tax|lead time|arrival|valid through/i.test(a)));
 const recommendationReasons=[...new Set([...concreteReasons,recommendation.rationale?.[0]].filter(Boolean))] as string[];
 const displayedRisks=[...(selected?.risks||[])].sort((a:string,b:string)=>Number(/expired|invalid|later than/i.test(b))-Number(/expired|invalid|later than/i.test(a)));
 const selectedFacts=selected?.facts;
 const appliedPriority:Priority=review.priority||'reliability';
 const latestRevision=[...(review.events||[])].reverse().find((event:any)=>event.type==='revised');
 const selectedQuote=quotes.find(quote=>String(quote.id)===String(selected?.quoteId));
 const sourceRows=ranking.length?ranking:quotes.map(quote=>({quoteId:quote.id,supplier:quote.values?.supplier||quote.name||'Quotation',eligible:false,facts:null,reasons:[],risks:['No matched item is ready for recommendation.']}));
 function applyRevision(){
  const preferredQuote=sourceRows.find(candidate=>String(candidate.quoteId)===preferred);
  onRevise({priority,preferredQuoteId:preferredQuote?.quoteId??null,feedback:feedback.trim()});
 }

 return <section className="sr-panel card" id="supplier-review" aria-labelledby="supplier-review-title">
  <header className="sr-header"><div className="sr-heading-icon"><ShieldCheck size={20}/></div><div><span className="sr-eyebrow">HUMAN REVIEW · BEFORE NEGOTIATION</span><h2 id="supplier-review-title">Your supplier decision</h2><p>Review the evidence, request changes, then approve one supplier.</p></div><span className={`sr-status ${approved?'approved':changing?'changes':'pending'}`}>{approved?<CheckCircle2 size={13}/>:changing?<RotateCcw size={13}/>:<FileCheck2 size={13}/>} {approved?'Approved':review.needsRefresh?'Needs fresh review':changing?'Changes requested':'Awaiting your review'}</span></header>
  <div className="sr-body">
   <div className="sr-criteria"><span><SlidersHorizontal size={14}/><strong>{priorities[appliedPriority]?.label||appliedPriority}</strong></span><span>Revision {review.revision}</span></div>
   {recommendation.limitations?.filter((limitation:string)=>/^Cost priority cannot/i.test(limitation)).map((limitation:string)=><p key={limitation} className="sr-priority-limit"><TriangleAlert size={14}/>{limitation}</p>)}
   {error&&<div className="sr-error" role="alert"><TriangleAlert size={16}/>{error}</div>}
   {review.needsRefresh&&<div className="sr-error" role="status"><RotateCcw size={16}/>Quotation data changed. The previous recommendation is shown for reference and cannot be approved until it is refreshed.</div>}
   {selected&&sourceReady?<>
    <div className="sr-recommendation"><div><span className="sr-eyebrow">{isPreferred?'YOUR SUPPLIER PREFERENCE':'RECOMMENDED FOR YOUR REVIEW'}</span><h3>{selected.supplier}</h3><p>{selectedFacts?.item||'Matched quotation item'}</p></div><button type="button" className="sr-text-button" onClick={()=>onReviewQuote(selected.quoteId)}><FileText size={14}/>Review source<ArrowRight size={13}/></button></div>
    <div className="sr-fact-grid"><div><span>Quoted unit price</span><strong>{money(selectedFacts?.unitPrice,selectedFacts?.currency)}</strong><small>{selectedFacts?.tax?.label||'Tax treatment requires review'}</small></div><div><span>Known order subtotal</span><strong>{money(selectedFacts?.knownSubtotal,selectedFacts?.currency)}</strong><small>{selectedFacts?.subtotalIncludes||selectedFacts?.subtotalLabel||'Only stated charges included'}</small></div><div><span>Delivery evidence</span><strong>{selectedFacts?.arrival||selectedFacts?.leadTime||'Not stated'}</strong><small>{selectedFacts?.orderQuantity?`${number(selectedFacts.orderQuantity)} units in calculation`:'Order quantity requires confirmation'}</small></div></div>
    <div className="sr-evidence-grid"><div><h4><CheckCircle2 size={15}/>Why this supplier is suggested</h4><ul>{recommendationReasons.slice(0,3).map((reason:string,index:number)=><li key={index}>{reason}</li>)}</ul>{recommendationReasons.length>3&&<details className="sr-more-evidence"><summary>{recommendationReasons.length-3} more supporting details</summary><ul>{recommendationReasons.slice(3).map((reason:string,index:number)=><li key={index}>{reason}</li>)}</ul></details>}</div><div className="sr-risk-summary"><h4><TriangleAlert size={15}/>Resolve with the supplier</h4>{displayedRisks.length?<><ul>{displayedRisks.slice(0,3).map((risk:string,index:number)=><li key={index}>{risk}</li>)}</ul>{displayedRisks.length>3&&<details className="sr-more-evidence"><summary>{displayedRisks.length-3} additional unresolved checks</summary><ul>{displayedRisks.slice(3).map((risk:string,index:number)=><li key={index}>{risk}</li>)}</ul></details>}</>:<p>No additional extraction flags. Supplier performance and final terms still need verification.</p>}</div></div>
    {selectedQuote?.name&&<p className="sr-source-caption"><FileText size={12}/>Source: {selectedQuote.name}</p>}
   </>:<div className="sr-no-recommendation"><TriangleAlert size={21}/><div><h3>No supplier is ready for a recommendation</h3><p>A matched item and usable price are required. Open a source below to confirm the item or correct extracted fields, then confirm the comparison again.</p></div></div>}

   {recommendation.limitations?.length>0&&<details className="sr-limitations"><summary><FileText size={14}/>How this recommendation is limited<ChevronDown size={14}/></summary><ul>{recommendation.limitations.map((limitation:string,index:number)=><li key={index}>{limitation}</li>)}</ul></details>}
   <details className="sr-candidates"><summary>Compare recommendation candidates <span>{sourceRows.length} suppliers</span><ChevronDown size={14}/></summary><p>Original currencies and tax terms are preserved. A lower unit price alone does not establish a lower landed cost.</p><div className="sr-table-scroll"><table><thead><tr><th>Supplier</th><th>Unit price</th><th>Known subtotal</th><th>Delivery evidence</th><th>Review</th></tr></thead><tbody>{sourceRows.map((candidate:any)=><tr key={candidate.quoteId} className={String(candidate.quoteId)===String(selected?.quoteId)?'chosen':''}><td><strong>{candidate.supplier}</strong><small>{String(candidate.quoteId)===String(selected?.quoteId)?'Suggested for review':candidate.eligible?'Available for consideration':'Needs source correction'}</small></td><td>{money(candidate.facts?.unitPrice,candidate.facts?.currency)}<small>{candidate.facts?.tax?.label||'Tax unconfirmed'}</small></td><td>{money(candidate.facts?.knownSubtotal,candidate.facts?.currency)}<small>{candidate.facts?.subtotalLabel||'Incomplete costs'}</small></td><td>{candidate.facts?.arrival||candidate.facts?.leadTime||'Not stated'}</td><td><button type="button" className="sr-text-button" onClick={()=>onReviewQuote(candidate.quoteId)} aria-label={`Review source for ${candidate.supplier}`}>Source<ArrowRight size={12}/></button></td></tr>)}</tbody></table></div></details>

   {latestRevision&&!changing&&<div className="sr-revision-note" role="status"><RotateCcw size={16}/><div><strong>Revision {review.revision} is ready for another review.</strong><p>Review settings: {priorities[appliedPriority]?.label}{isPreferred?` · preferred supplier ${selected?.supplier}`:review.preferredQuoteId!==null&&review.preferredQuoteId!==undefined?' · supplier preference could not be applied':''}.</p>{latestRevision.feedback&&<p className="sr-feedback-quote">Your feedback: “{latestRevision.feedback}”</p>}<small>Notes are retained as review instructions. They do not change extracted prices or terms; use Review source to correct those fields.</small></div></div>}

   {(requestOpen||changing)?<div className="sr-change-form" aria-label={changing?'Revise supplier recommendation':'Request recommendation changes'}>
    <div className="sr-form-heading"><MessageSquareText size={18}/><div><h3>{changing?'Revise, then review again':'What should change?'}</h3><p>{changing?'The recommendation is paused until you apply your changes.':'Tell us why this recommendation does not meet your needs.'}</p></div></div>
    <label className="sr-field">Your feedback <span>required</span><textarea value={feedback} onChange={event=>setFeedback(event.target.value)} placeholder="For example: prioritise documented delivery, or correct the quantity using the source." rows={3}/></label>
    {changing&&feedbackHint&&(feedbackHint.recognized?.length>0||feedbackHint.warnings?.length>0)&&<div className="sr-feedback-hint" role="status">{feedbackHint.recognized?.length>0&&<><strong>Suggested from your feedback</strong><ul>{feedbackHint.recognized.map((detail:string,index:number)=><li key={index}>{detail}</li>)}</ul><p>Check the settings below. Your choices are applied only when you select Apply changes &amp; review again.</p></>}{feedbackHint.warnings?.map((warning:string,index:number)=><p key={index} className="sr-feedback-warning">{warning}</p>)}</div>}
    {changing&&<div className="sr-settings"><label className="sr-field">Ranking priority<select value={priority} onChange={event=>setPriority(event.target.value as Priority)}>{Object.entries(priorities).map(([value,option])=><option key={value} value={value}>{option.label}</option>)}</select><small>{priorities[priority].detail}</small></label><label className="sr-field">Supplier preference <span>optional</span><select value={preferred} onChange={event=>setPreferred(event.target.value)}><option value="">Recommend using the selected priority</option>{sourceRows.map((candidate:any)=><option key={candidate.quoteId} value={String(candidate.quoteId)} disabled={!candidate.eligible}>{candidate.supplier}{!candidate.eligible?' · source correction needed':''}</option>)}</select><small>A preference changes the suggested supplier; it does not remove unresolved terms.</small></label></div>}
    <p className="sr-note"><FileText size={14}/>Explicit priority and supplier preferences in your feedback can suggest the settings above. These settings are applied only after you confirm. Requests to change prices, quantities or other quoted facts remain review notes. Use Review source for data corrections.</p>
    <div className="sr-form-actions">{!changing&&<button type="button" className="sr-text-button" onClick={()=>{setRequestOpen(false);setFeedback(review.feedbackDraft||'')}}>Cancel</button>}<button type="button" className="button primary" disabled={!feedback.trim()} onClick={()=>changing?applyRevision():onRequestChanges(feedback.trim())}>{changing?'Apply changes & review again':'Submit change request'}<ArrowRight size={15}/></button></div>
   </div>:approved?<div className="sr-approved"><span><CheckCircle2 size={20}/><strong>You approved {selected?.supplier||'this supplier'}.</strong></span><p>Proceed with this supplier. Any change to your requirement or quotation data will require a fresh approval.</p><div><button type="button" className="sr-text-button" onClick={()=>setRequestOpen(true)}>Request another review</button><button type="button" className="button primary" onClick={onContinue}>Continue to negotiation<ArrowRight size={15}/></button></div></div>:<div className="sr-approval"><label className="sr-acknowledgement"><input type="checkbox" checked={acknowledged} disabled={!canApprove} onChange={event=>setAcknowledged(event.target.checked)}/><span>I reviewed the displayed quotation, item, costs and unresolved terms. I approve {selected?.supplier||'the recommended supplier'} for negotiation.</span></label><p>This approves a negotiation, not a purchase order. Unresolved terms remain open.</p><div className="sr-approval-actions"><button type="button" className="button ghost" onClick={()=>{setAcknowledged(false);setRequestOpen(true)}}><MessageSquareText size={15}/>Request changes</button><button type="button" className="button primary" disabled={!canApprove||!acknowledged} onClick={()=>onApprove({quoteId:selected.quoteId,acknowledged,revision:review.revision})}><ShieldCheck size={15}/>Approve & continue to negotiation<ArrowRight size={15}/></button></div></div>}


   <details className="sr-history"><summary><History size={14}/>Review history<span>{review.events?.length||0} events</span><ChevronDown size={14}/></summary>{onExport&&<div className="sr-history-export"><button type="button" className="sr-text-button" onClick={onExport}><Download size={13}/>Export review record</button></div>}<ol>{(review.events||[]).map((event:any,index:number)=><li key={event.id||index}><span className="sr-history-dot"/><div><div className="sr-history-title"><strong>{eventLabel[event.type]||event.type} · revision {event.revision}</strong><time dateTime={event.at}>{when(event.at)}</time></div><p>{event.detail}</p>{event.recommendation&&<small>Suggested supplier: {event.recommendation.ranking?.find((candidate:any)=>String(candidate.quoteId)===String(event.recommendation.recommendedQuoteId))?.supplier||'None eligible'} · {priorities[event.priority as Priority]?.label||event.priority}</small>}{event.feedback&&<blockquote>{event.feedback}</blockquote>}{event.type==='revised'&&<small>Ranking preference: {priorities[event.priority as Priority]?.label||event.priority}. Notes remain review instructions.</small>}</div></li>)}</ol></details>
   <p className="sr-boundary">Recommendation reflects quotation evidence only. Supplier performance history has not been independently verified.</p>
  </div>
 </section>;
}
