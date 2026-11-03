'use client';
import {Search, CheckCircle2, AlertTriangle} from 'lucide-react';
import {itemMatches} from '../lib/item-matching.mjs';

const structureNames:Record<string,string>={
 'tier-table':'Tiered price table',
 table:'Price table',
 'item-table':'Price table',
 narrative:'Natural language',
 'key-value':'Structured fields',
 unknown:'Unrecognised layout',
};
const conditionNames:Record<string,string>={tax:'Tax',freight:'Freight','lead-time':'Lead time',pricing:'Pricing'};

export default function ItemMatch({quote, index, requirement, quantity, disabled, onSelect}:{quote:any;index:number;requirement:string;quantity:number;disabled:boolean;onSelect:(index:number,id:string)=>void}) {
 const match=quote.match, candidates=quote.candidates||[];
 if(!match)return null;
 const selected=candidates.find((row:any)=>row.id===match.selectedId),structure=quote.structure||selected?.structure||candidates[0]?.structure;
 const tier=quote.tier||selected?.tier||null,structureName=structureNames[structure?.kind]||structure?.label||'Unrecognised layout';
 const conditions=quote.conditions||selected?.conditions||candidates[0]?.conditions||[],conditionKinds=[...new Set(conditions.map((condition:any)=>conditionNames[condition.kind]||condition.kind).filter(Boolean))];
 const tierText=tier?.label||((tier?.min!==null||tier?.max!==null)?`${tier?.min??'Any'}–${tier?.max??'and above'} units`:'');
 const matched=match.matchesRequirement;
 return <div className={'item-match '+(matched?'item-match-found':'item-match-pending')}>
  <div className="quote-structure-summary" title={structure?.evidence||''}><span><b>Detected structure</b>{structureName}</span>{structure?.kind==='tier-table'&&<span className={tier?'tier-selected':'tier-pending'}><b>Quantity tier</b>{tier?`${tierText}${tier.quantity?` · selected for ${tier.quantity} units`:''}`:quantity?`No applicable tier for ${quantity} units`:'Enter quantity to select a tier'}</span>}{conditionKinds.length>0&&<span><b>Terms detected</b>{conditionKinds.join(' · ')}</span>}</div>
  <div className="item-match-heading">{matched?<CheckCircle2 size={14}/>:<Search size={14}/>}<strong>{matched?'Matching item selected':match.status==='ambiguous'?'Choose the matching item':match.status==='waiting'?'Waiting for purchase requirements':'Item needs clarification'}</strong><span>{candidates.length} item{candidates.length===1?'':'s'} found</span></div>
  <p>{match.reason}</p>
  {candidates.length>0&&<label>Item from this file<select aria-label={'Matched item for quotation '+(index+1)} value={match.selectedId} disabled={disabled} onChange={e=>onSelect(index,e.target.value)}><option value="">Automatic match to requirement</option>{candidates.map((row:any)=><option key={row.id} value={row.id}>{row.values.item||'Unrecognised item'} · {row.values.currency||''} {row.values.price??'Price unknown'}{row.values.priceUnit?' / '+row.values.priceUnit+' unit(s)':''}{itemMatches(requirement,row.values.item)?' · Matches requirement':' · Needs specification review'}</option>)}</select></label>}
  {match.selectedId&&<details><summary>View selected price evidence · {match.location}</summary><pre>{match.source}</pre><small>Delivery, MOQ and arrival remain part of the cost and eligibility checks.</small></details>}
  {!match.selectedId&&<small><AlertTriangle size={12}/>No price is used until an item is selected.</small>}
 </div>;
}
