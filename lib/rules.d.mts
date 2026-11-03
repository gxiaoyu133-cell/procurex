export function normalizeQuote(text:string):{values:Record<string,string|null>;evidence:Record<string,string>;risks:string[]};
export function draftRulePlan(result:any,req:any):{question:string;objective:string;evidence:string}[];

export function quotationFieldKey(value:string):string|undefined;
export function quotationCells(line:string,separator:string):string[];
