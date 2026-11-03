export type NegotiationGoal = 'price' | 'delivery' | 'moq' | 'clarify';
export type NegotiationTone = 'polite' | 'firm';
export type NegotiationOptions = { goal: NegotiationGoal; tone: NegotiationTone; target?: string; notes?: string };
export function createNegotiationMessage(result: any, req: any, quoteId: string | number, options?: NegotiationOptions): { message: string; summary: string; evidence: string[] };
