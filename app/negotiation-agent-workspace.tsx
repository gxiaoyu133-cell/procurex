'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Check,CheckCircle2,ChevronDown,Clock3,FileText,History,MessageSquareText,Package,PauseCircle,Play,RotateCcw,ShieldCheck,Sparkles,TrendingDown,Truck,UserRound,X} from 'lucide-react';
import {getQuotationFacts} from '../lib/quotation-facts.mjs';
import {createNegotiationSession,advanceNegotiation} from '../lib/negotiation-agent.mjs';
import './negotiation-agent-workspace.css';

type Goal='price'|'moq'|'delivery';
type Props={quotes:any[];req:any;history:any[];onSessionChange:(session:any)=>void;onViewHistory:()=>void;contextVersion:string;activeSessionId?:string|null;onActiveSessionChange?:(id:string|null)=>void;approvalGranted:boolean;approvedQuoteId:string|number|null;onReviewSupplier:()=>void};
const goals=[
 {id:'price' as Goal,label:'Lower the price',description:'Negotiate a better unit price.',Icon:TrendingDown},
 {id:'moq' as Goal,label:'Reduce MOQ',description:'Buy a smaller minimum quantity.',Icon:Package},
 {id:'delivery' as Goal,label:'Improve delivery',description:'Request a shorter lead time.',Icon:Truck},
];
const count=(v:any)=>v==null?'Not stated':Number(v).toLocaleString('en-SG');
const money=(v:any,currency:any,digits=4)=>v==null?'Not stated':`${currency||'Currency not stated'} ${Number(v).toLocaleString('en-SG',{minimumFractionDigits:2,maximumFractionDigits:digits})}`;
const time=(v:any)=>{const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleTimeString('en-SG',{hour:'2-digit',minute:'2-digit'}):''};
function defaultTarget(goal:Goal,fact:any){
 if(goal==='price')return '10';
 if(goal==='moq')return String(Math.max(1,Math.floor((Number(fact?.moq)||Number(fact?.requestedQuantity)||100)*.8)));
 const match=String(fact?.leadTime||'').match(/(\d+)\s*(?:[–—-]\s*(\d+))?\s*(?:working|business|calendar)?\s*(days?|weeks?)/i);
 const arrivalDays=fact?.arrival?Math.ceil((Date.parse(fact.arrival+'T00:00:00Z')-Date.parse(new Date().toISOString().slice(0,10)+'T00:00:00Z'))/86400000):0;
 const baseline=match?Number(match[2]||match[1])*(/^week/i.test(match[3])?7:1):arrivalDays>0?arrivalDays:7;
 return String(Math.max(1,baseline-2));
}
function offerValue(offer:any,v:any){return offer?.goal==='price'?money(v,offer.currency):`${count(v)} ${offer?.unit|| (offer?.goal==='moq'?'units':'days')}`;}

export function NegotiationTranscript({session}:{session:any}){
 const end=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(end.current){const scroller=end.current.closest('.na-chat-log');if(scroller)scroller.scrollTop=scroller.scrollHeight;}},[session?.events?.length]);
 return <div className="na-chat-log" role="log" aria-label="Negotiation conversation" aria-live="polite">
  {(session?.events||[]).map((event:any)=>{
   const vendor=event.role==='vendor',customer=event.role==='customer',system=event.role==='system';
   return <div className={'na-message na-message-'+event.role} key={event.id}>
    {!system&&<span className="na-message-avatar">{customer?<UserRound size={15}/>:vendor?<Package size={15}/>:<Sparkles size={15}/>}</span>}
    <div className="na-message-content"><div className="na-message-heading"><strong>{customer?'You':vendor?session.supplier:system?'Session note':'ProcureX agent'}</strong>{vendor&&<span className="na-sim-mini">Simulated supplier</span>}<time dateTime={event.at}>{time(event.at)}</time></div>
     {event.label&&<span className="na-event-label">{event.label}</span>}<p>{event.text}</p>
    </div>
   </div>;
  })}<div ref={end}/>
 </div>;
}

export function NegotiationEvidence({context}:{context:any}){
 if(!context)return null;
 return <div className="na-evidence">
  <div className="na-evidence-heading"><FileText size={15}/><h3>What informs this negotiation</h3></div>
  <div className="na-reference-grid">
   <article><span className="na-data-label">SELECTED QUOTATION</span><strong>{money(context.baseline?.unitPrice,context.baseline?.currency)}<small> / unit</small></strong><p>{count(context.baseline?.orderQuantity)} units · MOQ {count(context.baseline?.moq)}</p><p>{context.baseline?.leadTime||`${count(context.baseline?.deliveryDays)} ${context.baseline?.deliveryUnit||'days'} (assumed)`}</p></article>
   <article><span className="na-data-label">OTHER UPLOADED SUPPLIER</span>{context.vendorBenchmark?<><strong>{money(context.vendorBenchmark.unitPrice,context.vendorBenchmark.currency)}<small> / unit</small></strong><p>{context.vendorBenchmark.supplier}</p><p>{context.vendorBenchmark.detail}</p></>:<><strong>No comparable reference</strong><p>No usable like-for-like supplier price in the uploaded files.</p></>}</article>
   <article className="na-reference-assumed"><span className="na-data-label">ILLUSTRATIVE INDUSTRY REFERENCE</span>{context.industryBenchmark?<><strong>{money(context.industryBenchmark.unitPrice,context.industryBenchmark.currency)}<small> / unit</small></strong><p>{context.industryBenchmark.detail}</p></>:<><strong>No price reference</strong><p>A source unit price is needed to calculate an illustration.</p></>}<span className="na-assumption-tag">Assumption · not market data</span></article>
  </div>
  <details className="na-evidence-details"><summary>Source facts & assumptions <ChevronDown size={14}/></summary><div className="na-evidence-list">{(context.evidence||[]).map((entry:any,i:number)=><div key={'e'+i}><span className="na-source-tag">Source fact</span><strong>{entry.label}</strong><p>{entry.detail}</p></div>)}{(context.assumptions||[]).map((entry:any,i:number)=><div key={'a'+i}><span className="na-assumption-tag">Assumption</span><strong>{entry.label}</strong><p>{entry.detail}</p></div>)}</div></details>
 </div>;
}

export default function NegotiationAgentWorkspace({quotes,req,history,onSessionChange,onViewHistory,contextVersion,activeSessionId,onActiveSessionChange,approvalGranted,approvedQuoteId,onReviewSupplier}:Props){
 const [localSessionId,setLocalSessionId]=useState<string|null>(null),[selectedId,setSelectedId]=useState<any>(quotes[0]?.id??null),[goal,setGoal]=useState<Goal>('price'),[target,setTarget]=useState('10'),[notes,setNotes]=useState(''),[decisionNote,setDecisionNote]=useState(''),[error,setError]=useState(''),[newDraft,setNewDraft]=useState(false);
 const sessionId=activeSessionId===undefined?localSessionId:activeSessionId;
 const session=history.find((s:any)=>s.id===sessionId)||null;
 const net=Math.max(0,(Number(req?.quantity)||0)-(Number(req?.stock)||0));
 const rows=quotes.map(q=>({q,facts:getQuotationFacts(q,net)}));
 const selected=rows.find(r=>r.q.id===(approvalGranted?approvedQuoteId:selectedId))||rows[0];
 const fact=selected?.facts.selected;
 const stale=!!session&&(session.contextVersion!==contextVersion||!quotes.some(q=>q.id===session.quoteId));
 const canAct=approvalGranted&&!!session&&session.quoteId===approvedQuoteId&&!stale;
 const showingSession=!!session&&!newDraft;
 const offer=session?.pendingOffer;
 function setActive(id:string|null){setLocalSessionId(id);onActiveSessionChange?.(id)}
 useEffect(()=>{if(session){setSelectedId(session.quoteId);setGoal(session.goal);setTarget(String(session.target));setNewDraft(false);setError('');setDecisionNote('')}},[sessionId]);
 function prepare(nextGoal:Goal,nextFact=fact){setGoal(nextGoal);setTarget(defaultTarget(nextGoal,nextFact));setActive(null);setNewDraft(true);setError('')}
 function start(){
  if(!selected||!approvalGranted||selected.q.id!==approvedQuoteId){setError('Approve this supplier in the comparison review before negotiating.');return;}
  try{
   setError('');
   const numeric=Number(target);
   if(!Number.isFinite(numeric)||numeric<=0)throw new Error('Enter a positive target before starting.');
   if(goal==='price'&&numeric>=100)throw new Error('Choose a price reduction below 100%.');
   if(goal!=='price'&&!Number.isInteger(numeric))throw new Error('Enter a whole number for quantity or days.');
   const next=createNegotiationSession({quote:selected.q,quotes,req,goal,target:numeric,notes:notes.trim(),contextVersion});
   onSessionChange(next);setActive(next.id);setNewDraft(false);setDecisionNote('');requestAnimationFrame(()=>document.getElementById('negotiation-conversation')?.scrollIntoView({behavior:'smooth',block:'start'}));
  }catch(e:any){setError(e.message||'Check the target and try again.')}
 }
 function act(type:'approve'|'counter'|'reject'){
  if(!session||!canAct||session.status!=='awaiting_approval')return;
  try{const next=advanceNegotiation(session,{type,note:decisionNote.trim(),offerId:offer?.id,currentContextVersion:contextVersion});onSessionChange(next);setDecisionNote('');setError('')}catch(e:any){setError(e.message||'This action could not be completed.')}
 }
 return <div className="na-workspace">
  <div className="na-demo-notice"><span className="na-demo-chip"><Sparkles size={13}/>DEMO AGENT</span><p>Watch the negotiation, then approve the proposed terms. Supplier replies are simulated; no messages are sent.</p><button type="button" onClick={onViewHistory}><History size={14}/>Act History<ArrowRight size={14}/></button></div>
  {!approvalGranted&&<div className="na-stale" role="status"><ShieldCheck size={18}/><div><strong>Human review required</strong><p>Saved conversations are available to read. Approve the current supplier recommendation before negotiating.</p><button className="button ghost small" onClick={onReviewSupplier}>Review supplier recommendation<ArrowRight size={14}/></button></div></div>}
  <section className="na-setup card" aria-label="Negotiation setup">
   <div className="na-section-top"><div><span className="na-step">1</span><h2>{approvalGranted?'Your approved supplier':'Quotation sources'}</h2></div>{showingSession&&<button className="na-text-button" type="button" onClick={()=>{setActive(null);setNewDraft(true);setNotes('');setError('')}}><RotateCcw size={13}/>New negotiation</button>}</div>
   {rows.length?<div className="na-suppliers">{rows.map(({q,facts})=><button type="button" key={q.id} disabled={!approvalGranted||q.id!==approvedQuoteId} title={q.id!==approvedQuoteId?'Approve this supplier in the comparison review first':''} className={'na-supplier '+(selected?.q.id===q.id?'selected':'')} aria-pressed={selected?.q.id===q.id} onClick={()=>{setSelectedId(q.id);prepare(goal,facts.selected);setNotes('')}}><span className="na-supplier-initial">{facts.supplier.charAt(0)}</span><span><strong>{facts.supplier}</strong><small>{money(facts.selected?.unitPrice,facts.selected?.currency)} / unit · {count(facts.selected?.orderQuantity)} units</small></span>{selected?.q.id===q.id&&<CheckCircle2 size={17}/>}</button>)}</div>:<p className="na-no-sources">Upload and confirm quotations in Quote comparison to start a new negotiation. Your saved conversations remain available below.</p>}
   {approvalGranted&&<p className="na-approved-supplier"><ShieldCheck size={14}/>Only your approved supplier can be negotiated with. <button type="button" onClick={onReviewSupplier}>Review another supplier</button></p>}
   {!showingSession&&selected&&approvalGranted&&<>
    <div className="na-goal-heading"><span className="na-step">2</span><h2>What should the agent improve?</h2></div>
    <div className="na-goals">{goals.map(({id,label,description,Icon})=><button type="button" key={id} aria-pressed={goal===id} className={goal===id?'selected':''} onClick={()=>prepare(id)}><span className="na-goal-icon"><Icon size={19}/></span><span><strong>{label}</strong><small>{description}</small></span><span className="na-radio">{goal===id&&<span/>}</span></button>)}</div>
    <form className="na-brief" onSubmit={e=>{e.preventDefault();start()}}>
     <label className="na-target-label">{goal==='price'?'Target price reduction':goal==='moq'?'Target minimum order':'Target lead time'}<div className="na-target-input"><input aria-label={goal==='price'?'Target price reduction':goal==='moq'?'Target minimum order':'Target lead time'} type="number" min={goal==='price'?0.1:1} max={goal==='price'?99.9:undefined} step={goal==='price'?0.1:1} value={target} onChange={e=>setTarget(e.target.value)}/><span>{goal==='price'?'%':goal==='moq'?'units':/working|business/i.test(fact?.leadTime||'')?'working days':'days'}</span></div><small>{goal==='price'?`Current unit price: ${money(fact?.unitPrice,fact?.currency)}`:goal==='moq'?`Quoted MOQ: ${count(fact?.moq)} units`:`Quoted lead time: ${fact?.leadTime||'Not stated; demo assumes 7 calendar days'}`}</small></label>
     <label className="na-notes-label">Your instructions <span>optional</span><textarea value={notes} maxLength={1600} onChange={e=>setNotes(e.target.value)} placeholder="e.g. Keep the same specification and payment terms. Ask whether the lower price affects delivery." aria-label="Negotiation instructions"/></label>
     <div className="na-start"><p><ShieldCheck size={15}/>The agent pauses before accepting a supplier offer.</p><button type="submit" className="button primary"><Play size={14}/>Start negotiation<ArrowRight size={15}/></button></div>
    </form>
   </>}
   {showingSession&&<div className="na-session-brief"><span><strong>{goals.find(g=>g.id===session.goal)?.label}</strong> · Target {session.target}{session.goal==='price'?'% reduction':session.goal==='moq'?' units':' '+(session.context?.baseline?.deliveryUnit||'days')}</span><span className={'na-status na-status-'+session.status}>{session.status==='awaiting_approval'?<PauseCircle size={13}/>:session.status==='completed'?<CheckCircle2 size={13}/>:<X size={13}/>} {session.status==='awaiting_approval'?'Waiting for your decision':session.status==='completed'?'Approved in demo':'Negotiation stopped'}</span></div>}
  </section>
  {error&&<p className="na-error" role="alert">{error}</p>}
  {showingSession?<>
   {stale&&<div className="na-stale" role="status"><Clock3 size={17}/><div><strong>Saved conversation · quotation context has changed</strong><p>This conversation remains in Act History. Start a new negotiation with the current quotations to make another decision.</p></div></div>}
   <NegotiationEvidence context={session.context}/>
   <section id="negotiation-conversation" className="na-conversation card" aria-label="Live negotiation demo">
    <header className="na-conversation-header"><span className="na-chat-mark"><MessageSquareText size={21}/></span><div><h2>Negotiation with {session.supplier}</h2><p>Every request, supplier reply and customer decision is recorded.</p></div><span className="na-simulation-badge">SIMULATED CONVERSATION</span></header>
    <NegotiationTranscript session={session}/>
    {session.status==='awaiting_approval'&&offer&&<div className="na-decision">
     <div className="na-decision-heading"><span className="na-approval-icon"><ShieldCheck size={21}/></span><div><span className="na-data-label">YOUR APPROVAL IS REQUIRED</span><h3>{session.goal==='price'?'Accept this price?':session.goal==='moq'?'Accept this minimum order?':'Accept this delivery proposal?'}</h3><p>The agent is paused. It will continue only after your decision.</p></div></div>
     <div className="na-offer-values"><div><span>Original {session.goal==='price'?'unit price':session.goal==='moq'?'MOQ':'lead time'}</span><strong>{offerValue(offer,offer.before)}</strong></div><ArrowRight size={19}/><div className="na-offer-new"><span>Supplier counteroffer</span><strong>{offerValue(offer,offer.after)}</strong></div><div className="na-offer-saving"><span>{session.goal==='price'?'Goods savings':session.goal==='moq'?'MOQ reduction':'Time improvement'}</span><strong>{session.goal==='price'?money(offer.goodsSavings,offer.currency,2):`${count(Number(offer.before)-Number(offer.after))} ${offer.unit}`}</strong><small>{session.goal==='price'?`${Number(offer.improvementPercent).toLocaleString('en-SG',{maximumFractionDigits:2})}% lower · ${count(offer.orderQuantity)} units`:'Subject to the conditions below'}</small></div></div>
     {session.goal==='price'&&offer.quantityValid&&<p className="na-goods-change">Goods value: <strong>{money(offer.before*offer.orderQuantity,offer.currency,2)}</strong> → <strong>{money(offer.after*offer.orderQuantity,offer.currency,2)}</strong> · {session.context?.baseline?.taxBasis==='tax-inclusive'?'same tax-inclusive basis':'same quoted tax basis'}; freight unchanged.</p>}
     <div className="na-conditions"><strong>Terms attached to this offer</strong><ul>{(offer.conditions||[]).map((condition:string,i:number)=><li key={i}>{condition}</li>)}</ul></div>
     {canAct?<><label className="na-decision-note">Add a condition or counteroffer instruction <span>optional</span><textarea value={decisionNote} maxLength={1600} onChange={e=>setDecisionNote(e.target.value)} aria-label="Decision instruction" placeholder="e.g. Please confirm the same delivery date before proceeding."/></label><div className="na-decision-actions"><button type="button" className="na-decline" onClick={()=>act('reject')}>Decline & stop</button><button type="button" className="button ghost" onClick={()=>act('counter')}><RotateCcw size={14}/>Request counteroffer</button><button type="button" className="button primary" onClick={()=>act('approve')}><Check size={15}/>Approve & continue demo</button></div></>:<p className="na-stale">This offer is read-only until its supplier and current quotation context are approved.</p>}
    </div>}
    {session.status!=='awaiting_approval'&&<div className={'na-outcome '+(session.status==='completed'?'complete':'')}><CheckCircle2 size={20}/><div><strong>{session.status==='completed'?'Your approval and the simulated supplier confirmation are recorded.':'This negotiation has been stopped.'}</strong><p>{session.status==='completed'?'Review the full exchange and assumptions in Act History. No order has been placed.':'The agent will take no further action in this session.'}</p></div><button type="button" className="button ghost" onClick={onViewHistory}>View Act History<ArrowRight size={14}/></button></div>}
   </section>
  </>:<section className="na-empty card"><span><MessageSquareText size={28}/></span><div><h2>Your negotiation will appear here</h2><p>Choose a goal to begin. The agent uses quotation facts and labelled assumptions, exchanges proposals with a simulated supplier, and asks for your approval.</p><ol><li>Agent opens discussion</li><li>Supplier replies</li><li>You approve or counter</li><li>Agent continues</li></ol></div></section>}
 </div>;
}
