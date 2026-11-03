// Send source facts once, without UI candidates or duplicated review snapshots.
export function quotationForAgent(q){
 const selected=(q.candidates||[]).find(c=>c.id===q.match?.selectedId);
 const candidate=selected||((q.candidates||[]).length===1?q.candidates[0]:null);
 return {id:q.id,name:q.name,text:q.text,sourceFormat:q.sourceFormat,synthetic:!!q.synthetic,values:q.values,evidence:q.evidence,reviewed:q.reviewed,equivalent:q.equivalent,match:q.match?{selectedId:q.match.selectedId,requirement:q.match.requirement,matchesRequirement:q.match.matchesRequirement,status:q.match.status}:null,candidates:candidate?[candidate]:[]};
}
export function reviewForAgent(r){return {status:r?.status,approvedQuoteId:r?.approvedQuoteId,contextVersion:r?.contextVersion,revision:r?.revision,needsRefresh:!!r?.needsRefresh};}
