export type QuotationProductFacts = {
  candidateId:string; item:string; currency:string|null; unitPrice:number|null; quotedPrice:number|null; priceUnit:number|null;
  moq:number|null; packSize:number|null; tier:any; requestedQuantity:number; orderQuantity:number|null; quantitySuggested:boolean;
  goodsSubtotal:number|null; freight:{amount:number|null; indicative:boolean; conditional:boolean; label:string; evidence:string};
  tax:{rate:number|null; basis:string|null; onCif:boolean; label:string; evidence:string}; incoterm:string; leadTime:string; arrival:string|null;
  knownSubtotal:number|null; subtotalLabel:string; subtotalIncludes:string; taxAmount:number|null; displayOnly:boolean;
  caveats:string[]; expiryDate:string|null; location:string; source:string; evidence:Record<string,string>; tiers?:QuotationProductFacts[];
};
export function getQuotationFacts(quote:any,netQuantity:number|string):{supplier:string; selected:QuotationProductFacts|null; products:QuotationProductFacts[]; displayOnly:boolean; matchStatus:string; caveats:string[]};
export const buildQuotationFacts: typeof getQuotationFacts;
