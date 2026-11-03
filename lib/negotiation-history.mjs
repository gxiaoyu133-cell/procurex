export const HISTORY_KEY='procurex.negotiation-history.v1';
const validSession=s=>s&&typeof s.id==='string'&&Array.isArray(s.events)&&s.context&&Array.isArray(s.context.assumptions)&&['awaiting_approval','completed','stopped'].includes(s.status)&&Number.isInteger(s.version)&&s.version>=0;
export function readNegotiationHistory(storage){
 try{const raw=storage.getItem(HISTORY_KEY);if(!raw)return{sessions:[],error:null};const parsed=JSON.parse(raw);if(parsed.version!==1||!Array.isArray(parsed.sessions)||!parsed.sessions.every(validSession))return{sessions:[],error:'Saved activity could not be read. Your current session can still be used.'};return{sessions:parsed.sessions,error:null};}
 catch{return{sessions:[],error:'Browser history storage is unavailable. Activity will remain available in this tab.'};}
}
export function saveNegotiationHistory(storage,sessions){
 try{storage.setItem(HISTORY_KEY,JSON.stringify({version:1,sessions}));return null;}catch{return'Activity could not be saved on this device. Export your conversation to keep a copy.';}
}
export function upsertNegotiationSession(sessions,incoming){
 if(!validSession(incoming))return sessions;
 const previous=sessions.find(s=>s.id===incoming.id);
 if(previous&&previous.version>=incoming.version)return sessions;
 return [incoming,...sessions.filter(s=>s.id!==incoming.id)].sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
// A context identifier prevents an approval for an old quotation applying to
// a changed price, specification, requirement or source. No source text is saved.
export function negotiationContextVersion(quotes,req){
 const text=JSON.stringify({req:{item:String(req.item||''),quantity:Number(req.quantity)||0,stock:Number(req.stock)||0,deadline:req.deadline},quotes:quotes.map(q=>({id:q.id,name:q.name,text:q.text,values:q.values,selectedId:q.match?.selectedId}))});
 let a=2166136261,b=5381;for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b,33)^text.charCodeAt(i);}
 return'context-'+(a>>>0).toString(16)+'-'+(b>>>0).toString(16);
}
export function exportNegotiationTranscript(session){
 const c=session.context||{},baseline=c.baseline||{};
 return ['PROCUREX — ACT HISTORY','DEMONSTRATION: rule-based negotiation; vendor replies and any assumed market data are simulated.',`Supplier: ${session.supplier}`,`Goal: ${session.goal}`,`Status: ${session.status}`,`Started: ${session.createdAt}`,`Updated: ${session.updatedAt}`,'','QUOTATION SNAPSHOT',JSON.stringify(baseline,null,2),'','REFERENCE DATA',JSON.stringify({vendorBenchmark:c.vendorBenchmark,industryBenchmark:c.industryBenchmark},null,2),'','ASSUMPTIONS',...(c.assumptions||[]).map(a=>`${a.label}: ${a.detail}`),'','CONVERSATION & CUSTOMER DECISIONS',...(session.events||[]).map(e=>`[${e.at}] ${e.actor||e.role}${e.simulation?' [SIMULATED]':''}\n${e.label||''}\n${e.text}`),'','OUTCOME',session.outcome?JSON.stringify(session.outcome,null,2):'No approved outcome.','This record does not place an order or send a message to a real vendor.'].join('\n\n');
}
