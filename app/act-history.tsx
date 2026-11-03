'use client';

import {useMemo, useState} from 'react';
import {ArrowRight, Bot, CheckCircle2, ChevronRight, Clock3, Download, FileText, History, Lightbulb, MessageSquareText, Package, ShieldCheck, Store, TrendingDown, Truck, UserRound} from 'lucide-react';
import './act-history.css';

type Props = {sessions:any[]; onResume:(id:string)=>void; onExport:(session:any)=>void};
type Filter = 'all'|'awaiting_approval'|'completed'|'stopped';
const goals:Record<string,{label:string; Icon:typeof TrendingDown}> = {
 price:{label:'Lower the price',Icon:TrendingDown}, moq:{label:'Reduce the MOQ',Icon:Package}, delivery:{label:'Improve delivery',Icon:Truck},
};
const statuses:Record<string,{label:string; className:string}> = {
 awaiting_approval:{label:'Needs approval',className:'pending'}, completed:{label:'Completed',className:'complete'}, stopped:{label:'Stopped',className:'stopped'},
};
function date(value:any, short=false){
 const parsed=new Date(value);
 return Number.isNaN(parsed.getTime())?'Date unavailable':new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',...(short?{}:{year:'numeric'}),hour:'2-digit',minute:'2-digit'}).format(parsed);
}
function number(value:any){return value===null||value===undefined||value===''?'Not quoted':Number.isFinite(Number(value))?new Intl.NumberFormat('en-GB',{maximumFractionDigits:3}).format(Number(value)):String(value)}
function money(value:any,currency?:string){
 if(value===null||value===undefined||value==='')return 'Not quoted';
 const n=Number(value); if(!Number.isFinite(n))return String(value);
 return `${currency||'Currency unknown'} ${new Intl.NumberFormat('en-GB',{minimumFractionDigits:2,maximumFractionDigits:4}).format(n)}`;
}
function offerValue(offer:any,value:any){return offer?.goal==='price'?money(value,offer.currency):`${number(value)} ${offer?.unit||'units'}`}
function Status({status}:{status:string}){const value=statuses[status]||{label:status||'In progress',className:'pending'};return <span className={`ah-status ${value.className}`}>{status==='completed'?<CheckCircle2 size={12}/>:status==='awaiting_approval'?<Clock3 size={12}/>:null}{value.label}</span>}
function fact(value:any){return typeof value==='string'?value:value?.detail||value?.label||''}

export default function ActHistory({sessions=[],onResume,onExport}:Props){
 const [filter,setFilter]=useState<Filter>('all');
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const ordered=useMemo(()=>[...sessions].sort((a,b)=>new Date(b.updatedAt||b.createdAt).getTime()-new Date(a.updatedAt||a.createdAt).getTime()),[sessions]);
 const filtered=ordered.filter(s=>filter==='all'||s.status===filter);
 const selected=filtered.find(s=>s.id===selectedId)||filtered[0];
 const pending=ordered.filter(s=>s.status==='awaiting_approval').length;
 const completed=ordered.filter(s=>s.status==='completed').length;
 const baseline=selected?.context?.baseline||{};
 const offer=selected?.outcome||selected?.pendingOffer||selected?.lastOffer;
 const assumptions=selected?.context?.assumptions||[];
 const vendorBenchmark=selected?.context?.vendorBenchmark;
 const industryBenchmark=selected?.context?.industryBenchmark;

 if(!sessions.length)return <section className="ah-empty card" aria-label="No negotiation activity">
  <div className="ah-empty-icon"><History size={27}/></div><span className="ah-eyebrow">YOUR NEGOTIATION RECORD</span>
  <h2>Your first negotiation starts the history.</h2>
  <p>Choose a supplier and a goal in Negotiation plan. Your conversation, supplier replies, assumptions and approval decisions will appear here.</p>
  <div className="ah-empty-steps"><span><MessageSquareText size={16}/>Follow the conversation</span><ChevronRight size={14}/><span><ShieldCheck size={16}/>Review each decision</span><ChevronRight size={14}/><span><FileText size={16}/>Keep the full record</span></div>
  <div className="ah-simulation-note"><span className="ah-demo-dot"/>Demo mode · Supplier conversations are simulated.</div>
 </section>;

 return <div className="act-history">
  <div className="ah-summary" aria-label="Negotiation activity summary">
   <div><span className="ah-summary-icon"><History size={20}/></span><span><strong>{ordered.length}</strong><small>Negotiations recorded</small></span></div>
   <div><span className="ah-summary-icon pending"><ShieldCheck size={20}/></span><span><strong>{pending}</strong><small>Waiting for your approval</small></span></div>
   <div><span className="ah-summary-icon complete"><CheckCircle2 size={20}/></span><span><strong>{completed}</strong><small>Completed in demo</small></span></div>
  </div>
  <div className="ah-browser card">
   <aside className="ah-sidebar" aria-label="Negotiation history list">
    <div className="ah-list-heading"><h2>Activity</h2><span>{ordered.length} {ordered.length===1?'session':'sessions'}</span></div>
    <div className="ah-filters" role="group" aria-label="Filter activity">
     {([['all','All'],['awaiting_approval','Needs approval'],['completed','Completed'],['stopped','Stopped']] as [Filter,string][]).map(([key,label])=><button key={key} type="button" aria-pressed={filter===key} className={filter===key?'selected':''} onClick={()=>setFilter(key)}>{label}</button>)}
    </div>
    <div className="ah-session-list">{filtered.map(session=>{
     const goal=goals[session.goal]||{label:session.goal,Icon:MessageSquareText};const Icon=goal.Icon;
     return <button type="button" key={session.id} className={`ah-session ${selected?.id===session.id?'selected':''}`} aria-pressed={selected?.id===session.id} onClick={()=>setSelectedId(session.id)}>
      <span className="ah-session-top"><span className="ah-session-icon"><Icon size={16}/></span><time dateTime={session.updatedAt||session.createdAt}>{date(session.updatedAt||session.createdAt,true)}</time></span>
      <strong>{session.supplier||'Supplier quotation'}</strong><span className="ah-session-goal">{goal.label}</span><Status status={session.status}/>
     </button>
    })}{!filtered.length&&<p className="ah-no-results">No {filter==='awaiting_approval'?'negotiations waiting for approval':filter+' negotiations'} yet.</p>}</div>
    <p className="ah-local-note">Saved in this browser. Each record keeps the facts and assumptions used at the time.</p>
   </aside>
   {selected?<article className="ah-detail" aria-label={`Negotiation record for ${selected.supplier}`}>
    <header className="ah-detail-heading">
     <div><span className="ah-eyebrow">{goals[selected.goal]?.label||selected.goal}</span><h2>{selected.supplier}</h2><p>{selected.item||'Quotation negotiation'} · Started {date(selected.createdAt)}</p></div>
     <Status status={selected.status}/>
    </header>
    <div className="ah-record-actions"><span className="ah-simulation-note"><span className="ah-demo-dot"/>Demo · Simulated supplier replies</span><div><button type="button" className="button ghost small" onClick={()=>onExport(selected)}><Download size={13}/>Export record</button><button type="button" className="button primary small" onClick={()=>onResume(selected.id)}>{selected.status==='awaiting_approval'?'Review decision':'Open negotiation'}<ArrowRight size={13}/></button></div></div>
    {offer&&<section className={`ah-offer ${selected.outcome?'approved':''}`} aria-label={selected.outcome?'Approved offer':'Offer awaiting decision'}>
     <div className="ah-offer-title"><span>{selected.outcome?<CheckCircle2 size={15}/>:<ShieldCheck size={15}/>}<strong>{selected.outcome?'Approved by you':selected.status==='stopped'?'Last proposal · not accepted':'Customer approval required'}</strong></span>{Number.isFinite(Number(offer.improvementPercent))&&Number(offer.improvementPercent)>0&&<span className="ah-offer-change">{number(offer.improvementPercent)}% improvement</span>}</div>
     <div className="ah-offer-values"><span><small>Original quotation</small><strong>{offerValue(offer,offer.before)}</strong></span><ArrowRight size={18}/><span><small>{selected.outcome?'Approved offer':'Supplier proposal'}</small><strong>{offerValue(offer,offer.after)}</strong></span></div>
     {offer.summary&&<p>{offer.summary}</p>}
     {offer.goodsSavings!==null&&offer.goodsSavings!==undefined&&Number(offer.goodsSavings)>0&&<p className="ah-savings">Goods saving: <strong>{money(offer.goodsSavings,offer.currency)}</strong>{offer.orderQuantity?` for ${number(offer.orderQuantity)} units`:''}. On the quoted tax basis; freight is excluded.</p>}
     {offer.conditions?.length>0&&<ul>{offer.conditions.map((condition:string,i:number)=><li key={i}>{condition}</li>)}</ul>}
     {selected.outcome?.approvedAt&&<small className="ah-approved-time">Customer approved {date(selected.outcome.approvedAt)}. Vendor acceptance is simulated.</small>}
    </section>}
    <section className="ah-transcript" aria-label="Full negotiation transcript">
     <div className="ah-section-heading"><h3><MessageSquareText size={16}/>Conversation & decisions</h3><span>{selected.events?.length||0} events</span></div>
     <ol className="ah-events">{(selected.events||[]).map((event:any,i:number)=>{
      const role=event.role||'system';const isDecision=role==='customer'&&/approv|declin|reject|stop|accept|counter|decision/i.test(`${event.label||''} ${event.text||''}`);const Icon=role==='vendor'?Store:role==='customer'?UserRound:role==='agent'?Bot:Clock3;
      return <li key={event.id||i} className={`ah-event role-${role} ${isDecision?'decision':''}`}><span className="ah-event-avatar"><Icon size={15}/></span><div className="ah-event-body"><div className="ah-event-meta"><strong>{event.actor||(role==='vendor'?'Supplier':role==='customer'?'You':role==='agent'?'ProcureX agent':'Activity')}</strong>{role==='vendor'&&<span className="ah-simulation-stamp">Simulated supplier</span>}{isDecision&&<span className="ah-decision-stamp">Your decision</span>}<time dateTime={event.at}>{date(event.at,true)}</time></div>{event.label&&<h4>{event.label}</h4>}<p>{event.text}</p>{event.source&&role!=='vendor'&&<small className="ah-event-source">{event.source}</small>}</div></li>
     })}</ol>
    </section>
    <div className="ah-context-grid">
     <section className="ah-context"><h3><FileText size={16}/>Quotation at the start</h3><dl>
      <div><dt>Unit price</dt><dd>{money(baseline.unitPrice,baseline.currency)}</dd></div><div><dt>MOQ</dt><dd>{baseline.moq!==null&&baseline.moq!==undefined?`${number(baseline.moq)} units${baseline.moqAssumed?' · assumed':''}`:'Not quoted'}</dd></div><div><dt>Order quantity</dt><dd>{baseline.orderQuantity?`${number(baseline.orderQuantity)} units`:'Not confirmed'}</dd></div><div><dt>Lead time</dt><dd>{baseline.leadTime|| (baseline.deliveryDays?`${baseline.deliveryDays} ${baseline.deliveryUnit||'days'}${baseline.deliveryDaysAssumed?' · assumed':''}`:'Not quoted')}</dd></div><div><dt>Tax basis</dt><dd>{baseline.taxBasis||'Not confirmed'}</dd></div>
     </dl>{selected.context?.evidence?.length>0&&<details><summary>View source evidence</summary>{selected.context.evidence.map((entry:any,i:number)=><div className="ah-evidence" key={i}><strong>{entry.label||'Quotation evidence'}</strong><p>{fact(entry)}</p><small>{entry.kind==='uploaded_quote'?'Uploaded quotation':'Source quotation'}</small></div>)}</details>}</section>
     <section className="ah-context"><h3><TrendingDown size={16}/>Price reference</h3>{vendorBenchmark?<div className="ah-benchmark"><span className="ah-source-tag">Uploaded quote</span><strong>{vendorBenchmark.label||'Other supplier quotation'}</strong>{vendorBenchmark.unitPrice!==null&&vendorBenchmark.unitPrice!==undefined&&<b>{money(vendorBenchmark.unitPrice,vendorBenchmark.currency)} / unit</b>}<p>{vendorBenchmark.detail}</p></div>:<p className="ah-context-empty">No comparable uploaded supplier benchmark was available.</p>}{industryBenchmark?<div className="ah-benchmark assumption"><span className="ah-source-tag">Assumption · not market data</span><strong>{industryBenchmark.label||'Illustrative industry reference'}</strong>{industryBenchmark.unitPrice!==null&&industryBenchmark.unitPrice!==undefined&&<b>{money(industryBenchmark.unitPrice,industryBenchmark.currency)} / unit</b>}<p>{industryBenchmark.detail}</p></div>:<p className="ah-context-empty">No industry-price reference was used.</p>}</section>
    </div>
    <section className="ah-assumptions" aria-label="Assumptions used"><div className="ah-section-heading"><h3><Lightbulb size={16}/>Assumptions used in this discussion</h3><span>{assumptions.length}</span></div><p className="ah-assumption-intro">These are explicitly assumed inputs for the demo, not verified supplier commitments or historical market data.</p>{assumptions.length?<ul>{assumptions.map((assumption:any,i:number)=><li key={assumption.id||i}><span className="ah-assumption-number">{String(i+1).padStart(2,'0')}</span><div><strong>{assumption.label||'Discussion assumption'}</strong><p>{fact(assumption)}</p></div></li>)}</ul>:<p className="ah-context-empty">No additional assumptions were recorded.</p>}</section>
   </article>:<div className="ah-filter-empty"><Clock3 size={28}/><h3>No activity in this view</h3><p>Choose another filter to see your negotiation records.</p></div>}
  </div>
 </div>;
}
