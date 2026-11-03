export const fields=['supplier','item','currency','basis','price','priceUnit','packSize','moq','delivery','other','arrival'];
export const labels={supplier:'Supplier',item:'Item / specification',currency:'Currency',basis:'Cost basis',price:'Quoted price (S$)',priceUnit:'Units per quoted price',packSize:'Order pack multiple',moq:'Minimum order (units)',delivery:'Delivery charge (S$)',other:'Other charges (S$)',arrival:'Arrival date'};
export function addDays(date,n){if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return '';const d=new Date(date+'T00:00:00Z');if(!Number.isFinite(+d))return '';d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
export function evaluateQuote(q,req,offset=0){
 const v=q.values,issues=[]; const num=k=>v[k]===null||v[k]===''||!Number.isFinite(Number(v[k]))?null:Number(v[k]);
 const demand=Number(req.quantity),stock=Number(req.stock),net=Math.max(0,demand-stock);
 if(!Number.isSafeInteger(demand)||demand<=0||!Number.isSafeInteger(stock)||stock<0)issues.push('Enter valid whole-unit demand and stock.');
 if(!req.deadline||addDays(req.deadline,0)!==req.deadline||!req.item.trim())issues.push('Item and a valid deadline are required.');
 if(q.candidates?.length>1&&!q.match?.selectedId)issues.push('Choose the matching item row from this quotation.');
 if(!q.reviewed)issues.push('Human review is required.');
 if(!q.equivalent)issues.push('Equivalent specification is not confirmed.');
 for(const k of fields)if(v[k]===null||v[k]===undefined||String(v[k]).trim()==='')issues.push(labels[k]+' is unknown.');
 if(v.currency!=='SGD')issues.push('Only SGD quotations are comparable.');
 if(v.basis!=='pre-tax')issues.push('Confirm a common pre-tax cost basis.');
 const price=num('price'),unit=num('priceUnit'),pack=num('packSize'),moq=num('moq'),delivery=num('delivery'),other=num('other');
 if(price===null||price<=0)issues.push('Quoted price must be positive.');
 for(const [k,n,min]of [['priceUnit',unit,1],['packSize',pack,1],['moq',moq,0]])if(n===null||!Number.isSafeInteger(n)||n<min)issues.push(labels[k]+' is invalid.');
 if(delivery===null||delivery<0||other===null||other<0)issues.push('Delivery and other charges must be explicitly confirmed, including zero.');
 const deadline=addDays(req.deadline,offset);
 if(addDays(String(v.arrival||''),0)!==v.arrival)issues.push('Arrival date is invalid.');
 else if(v.arrival>deadline)issues.push('Arrives '+v.arrival+' after '+deadline+'.');
 if(net===0)issues.push('Confirmed stock covers demand. No purchase required.');
 const quantityValid=pack!==null&&Number.isSafeInteger(pack)&&pack>0&&moq!==null&&Number.isSafeInteger(moq)&&moq>=0&&Number.isSafeInteger(demand)&&demand>0&&Number.isSafeInteger(stock)&&stock>=0;
 const priceValid=price!==null&&price>0&&unit!==null&&Number.isSafeInteger(unit)&&unit>0;
 // Never label a foreign-currency or tax-incompatible arithmetic result as an
 // SGD pre-tax landed total. The native unit price may still be shown for
 // review, but conversion and tax treatment must be confirmed first.
 const commercialBasisValid=v.currency==='SGD'&&v.basis==='pre-tax';
 const calcValid=commercialBasisValid&&quantityValid&&priceValid&&delivery!==null&&delivery>=0&&other!==null&&other>=0;
 const order=quantityValid&&net>0?Math.ceil(Math.max(net,moq)/pack)*pack:0;
 const rawTotal=calcValid&&net>0?order*price/unit+delivery+other:null;
 const safeTotal=rawTotal!==null&&Number.isFinite(rawTotal)&&Number.isSafeInteger(order)&&rawTotal*100<=Number.MAX_SAFE_INTEGER;
 if(rawTotal!==null&&!safeTotal)issues.push('Cost or order quantity exceeds the supported numeric range.');
 const total=safeTotal?Math.round(rawTotal*100)/100:null;
 return {q,issues:[...new Set(issues)],eligible:issues.length===0,net,order,total,unitPrice:priceValid?price/unit:null,deadline};
}
export function compare(quotes,req,offset=0){const rows=quotes.map(q=>evaluateQuote(q,req,offset));const eligible=rows.filter(r=>r.eligible).sort((a,b)=>a.total-b.total);return{rows,winner:eligible[0]||null,eligible};}
export function csvCell(x){let s=String(x??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'}
export function exportCSV(quotes,req,offset=0){const h=['Supplier','Status','Reasons','Net demand','Order quantity','Pre-tax total SGD','Arrival','Scenario deadline'];const rows=compare(quotes,req,offset).rows.map(r=>[r.q.values.supplier,r.eligible?'Eligible':'Excluded',r.issues.join(' | '),r.net,r.order,r.total,r.q.values.arrival,r.deadline]);return '\uFEFF'+[h,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')}
export const samples=[
 {name:'Atlas · email',text:'Supplier: Atlas Supply\nItem: A4 copy paper 80gsm, ream of 500 sheets\nCurrency: SGD\nCost basis: pre-tax\nPrice: S$9.50 per ream\nUnits per quoted price: 1\nOrder pack multiple: 10 reams\nMinimum order: 100 reams\nDelivery charge: S$800\nOther charges: S$0\nArrival date: 2026-11-09',values:{supplier:'Atlas Supply',item:'A4 copy paper 80gsm, ream of 500 sheets',currency:'SGD',basis:'pre-tax',price:'9.50',priceUnit:'1',packSize:'10',moq:'100',delivery:'800',other:'0',arrival:'2026-11-09'}},
 {name:'Beacon · quotation',text:'Quotation from Beacon Office\nA4 copy paper 80gsm, ream of 500 sheets\nSGD, pre-tax\nS$100.00 per carton of 10 reams\nOrder pack multiple: 10 reams\nMinimum order: 100 reams\nDelivery included: S$0\nOther charges: S$0\nArrival date: 2026-11-10',values:{supplier:'Beacon Office',item:'A4 copy paper 80gsm, ream of 500 sheets',currency:'SGD',basis:'pre-tax',price:'100',priceUnit:'10',packSize:'10',moq:'100',delivery:'0',other:'0',arrival:'2026-11-10'}},
 {name:'Cedar · quotation',text:'Supplier: Cedar Trading\nItem: A4 copy paper 80gsm, ream of 500 sheets\nCurrency: SGD, pre-tax\nS$8.80 per ream\nUnits per quoted price: 1\nOrder pack multiple: 50 reams\nMinimum order: 1500 reams\nDelivery charge: to be confirmed\nOther charges: S$0\nArrival date: 2026-11-17',values:{supplier:'Cedar Trading',item:'A4 copy paper 80gsm, ream of 500 sheets',currency:'SGD',basis:'pre-tax',price:'8.80',priceUnit:'1',packSize:'50',moq:'1500',delivery:null,other:'0',arrival:'2026-11-17'}}
];
export function demoQuotes(){return samples.map((s,i)=>({id:i,synthetic:true,name:s.name,text:s.text,values:{...s.values},evidence:Object.fromEntries(fields.map(k=>[k,k==='delivery'&&i===2?'Delivery charge: to be confirmed':s.text.split('\n').find(l=>l.toLowerCase().includes(k.toLowerCase()))||s.text])),risks:i===2?['Delivery fee is unknown.','Minimum order exceeds demand.','Arrival misses the baseline deadline.']:[],reviewed:false,equivalent:false,method:'Synthetic sample · manually prepared'}));}
