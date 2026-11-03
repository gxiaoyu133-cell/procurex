export const HISTORY_KEY:string;
export function readNegotiationHistory(storage:Pick<Storage,'getItem'>):{sessions:any[];error:string|null};
export function saveNegotiationHistory(storage:Pick<Storage,'setItem'>,sessions:any[]):string|null;
export function upsertNegotiationSession(sessions:any[],incoming:any):any[];
export function negotiationContextVersion(quotes:any[],req:any):string;
export function exportNegotiationTranscript(session:any):string;
