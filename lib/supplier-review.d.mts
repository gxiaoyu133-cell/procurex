import type {QuotationProductFacts} from './quotation-facts.mjs';
export type SupplierPriority='reliability'|'cost'|'delivery';
export type SupplierRanking={quoteId:string|number;supplier:string;facts:QuotationProductFacts|null;score:number;reasons:string[];risks:string[];eligible:boolean};
export type SupplierRecommendation={recommendedQuoteId:string|number|null;ranking:SupplierRanking[];rationale:string[];limitations:string[];priority:SupplierPriority;preferredQuoteId:string|number|null};
export type SupplierReviewEvent={id:string;at:string;type:'created'|'changes_requested'|'revised'|'approved'|'invalidated';revision:number;feedback:string;detail:string;priority:SupplierPriority;preferredQuoteId:string|number|null;approvedQuoteId:string|number|null;recommendation:SupplierRecommendation};
export type SupplierReview={revision:number;status:'pending'|'changes_requested'|'approved';contextVersion:string;needsRefresh:boolean;priority:SupplierPriority;preferredQuoteId:string|number|null;recommendation:SupplierRecommendation;feedbackDraft:string;approvedQuoteId:string|number|null;createdAt:string;updatedAt:string;events:SupplierReviewEvent[]};
export function buildSupplierRecommendation(quotes:any[],req:any,options?:{priority?:SupplierPriority;preferredQuoteId?:string|number|null;today?:string}):SupplierRecommendation;
export function createSupplierReview(options:{quotes:any[];req:any;contextVersion:string;now?:string|number|Date}):SupplierReview;
export function requestSupplierChanges(review:SupplierReview,options:{feedback:string;now?:string|number|Date}):SupplierReview;
export function reviseSupplierReview(review:SupplierReview,options:{quotes:any[];req:any;contextVersion:string;priority?:SupplierPriority;preferredQuoteId?:string|number|null;feedback?:string;now?:string|number|Date}):SupplierReview;
export function approveSupplierReview(review:SupplierReview,options:{quoteId:string|number;contextVersion:string;acknowledged:boolean;revision:number;now?:string|number|Date}):SupplierReview;
export function isSupplierReviewApproved(review:SupplierReview|null|undefined,contextVersion:string):boolean;

export function invalidateSupplierReview(review:SupplierReview,options?:{reason?:string;now?:string|number|Date}):SupplierReview;
export type SupplierFeedbackInterpretation={suggestedPriority:SupplierPriority|null;preferredQuoteId:string|number|null;recognized:string[];unhandledDataChange:boolean;warnings:string[]};
export function interpretSupplierFeedback(text:string,review:SupplierReview|null|undefined):SupplierFeedbackInterpretation;
