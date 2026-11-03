export type PreviewRow = {
  q: any;
  issues: string[];
  eligible: boolean;
  net: number;
  order: number;
  total: number | null;
  unitPrice: number | null;
  deadline: string;
  specMatchedByText: boolean;
  requiresReview: boolean;
};
export function comparePreview(quotes: any[], req: any, offset?: number): {rows: PreviewRow[]; eligible: PreviewRow[]; winner: PreviewRow | null};
export function canConfirmComparison(quotes: any[], req: any): {canConfirm: boolean; errors: string[]};
export function exportPreviewCSV(quotes: any[], req: any, offset?: number): string;
