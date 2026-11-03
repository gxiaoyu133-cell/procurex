# Historical validation log

This file records earlier implementation stages. For the current live Claude workflow, use README.md. Latest local audit: 150 tests passed on 2026-11-03.

# Rule-based revision — 2 November 2026

Requested scope: SME quotation normalisation, landed-cost comparison, unresolved conditions and negotiation drafts. Current version uses local rules; LLM integration is planned.

Validation completed:
- 14 Node tests passed: cost calculation, MOQ/pack rounding, missing fees, review gates, dates, overflow, CSV safety, rule extraction and dynamic negotiation.
- TypeScript check passed. Local production client rebuilt.
- Browser verified: import with rules → source review of all three synthetic quotations → two eligible suppliers → rule-based negotiation plan generated from current facts.
- Browser width 726 px: no page overflow; supplier comparison scrolls inside its table.

Limits: selectable-text PDF only; XLSX/CSV/TSV supported; legacy XLS unsupported; unsupported text patterns require manual correction. Domestic SGD pre-tax only. Current interface makes no LLM API calls. No website deployment performed.

## Multi-format intake redesign

19 tests passed, including XLSX cell/date conversion, explicit worksheet selection, missing formula results, MIME email decoding, CSV and file/text size limits. TypeScript and local build passed. Browser checked an XLSX upload and explicit worksheet selection, a selectable-text PDF upload, and pasted supplier email. All three flowed into source review with correct sample cost fields; the unknown email delivery fee stayed unresolved. At 390 px the page had no horizontal overflow; the viewport override was reset.

## Negotiation message studio

26 tests passed. Browser verified supplier selection, target-price and extra-request drafting, source review, approval/copy, editing cancelling approval and independent supplier history. Unknown shipping remains unresolved in the clarification draft. No external supplier messages are sent.

## Batch collection and explicit confirmation

34 Node tests pass, including 8 confirmation and preliminary comparison checks. TypeScript and local client build pass. Browser verified mixed PDF/XLSX/EML upload, pasted email, source removal, no results before confirmation, and a single Confirm & compare transition. The sample comparison shows Atlas at S$10,300 and Beacon at S$10,000; Cedar keeps unknown shipping and is excluded. A multiple-worksheet workbook pauses the queue and disables confirmation, then processes the next email after selection. Returning to edit hides stale results. Final summary stays locked pending human review. At 390 px the collection page has no horizontal overflow.

Automatic matching never overrides a reviewed specification rejection. Changing the required item or a quote item/unit clears outdated specification approval. No external deployment or model API call is used.

## Requirement-based product and price matching

46 Node tests pass; TypeScript and the local client build pass. New checks cover correct middle-row pricing, competing specifications, ambiguous matches, stale requirement changes, Chinese labels, row-level unknown fees, unsupported multi-price layouts and PDF column preservation.

Browser verified three synthetic multi-product files (PDF, XLSX and EML). Requirement A4 paper 80gsm selects the middle product from all three files, filters two unrelated rows from each, and produces Atlas S$10,300 / Beacon S$10,000 with Cedar excluded for unresolved delivery. Requirement A4 paper shows multiple choices without automatically selecting a price; manual selection works. Requirement A5 paper clears all three prices. Source evidence shows the selected PDF item and price. At 390 px, the page has no horizontal overflow; viewport override was reset. The site remains local and rule-based.

## Irregular quotation structure recognition — 3 November 2026

53 Node tests pass, including four de-identified acceptance tests for natural-language email quotations, loose spreadsheet headers with Tax and Freight fields, product descriptions separated from PDF quantity-tier tables, quantity-driven tier changes, and unmatched-product price isolation. TypeScript/local build passes.

The three supplied real files were also exercised end-to-end in the local browser with a net requirement of 1,000 units: the EML selected SGD 0.18 from two narrative products, the XLSX selected the 1,000–2,999 tier at SGD 0.12 and retained SGD 95 freight, and the PDF selected the 1,000 tier at USD 0.08. Tax, conditional freight, foreign currency, pack rounding and relative lead times remain visible and unresolved rather than being fabricated. The confirmation step opens a partial comparison with native-currency unit prices and provisional quantities; no incompatible quote is promoted as a confirmed landed-cost winner.
