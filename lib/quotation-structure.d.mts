export type QuotationStructureKind='tier-table'|'item-table'|'narrative'|'key-value'|'unknown';
export interface QuotationStructure {kind:QuotationStructureKind;label:string;evidence:string}
export interface QuantityTier {label:string;min:number|null;max:number|null;quantity:number|null;applicable:boolean|null}
export interface QuotationCondition {kind:'tax'|'freight'|'pricing'|'lead-time';text:string;resolved:boolean}
export function parseQuantityTier(value:string):QuantityTier|null;
export function applyQuantityToTier(tier:QuantityTier|null,quantity?:number|string):QuantityTier|null;
export function recognizeQuotationStructure(text:string,options?:{quantity?:number|string}):{structure:QuotationStructure;records:any[];conditions:QuotationCondition[]};
