# ProcureX

## [Open the live demo →](https://gxiaoyu133-cell.github.io/procurex/)

No installation or login is required. Click **Load demo**, confirm the comparison, review and approve the supplier, then try **Negotiation plan** and **Act History**.

The public website runs quotation parsing, comparison and human review in your browser. Negotiation is clearly labelled **Practice simulation**: it makes no live AI calls and sends no supplier messages. The optional real Claude drafting workflow remains available in the local version below. Uploaded files and local records are not published to this repository.

ProcureX is an AI-assisted procurement prototype for SME purchasing teams. It extracts useful commercial information from supplier quotations, displays an evidence-backed comparison, requires human review, and helps prepare a negotiation message.

## What works

- **Mixed quotation intake:** upload selectable-text PDF, XLSX, CSV, TSV, EML and TXT files, or paste email text. The parser recognises common English and Chinese labels, item tables, quantity tiers, transposed tables and repeated product blocks. Select a worksheet when a workbook contains several sheets.
- **Requirement-based comparison:** match product and specification, choose the applicable quantity tier, and display source unit price, currency, quantity, MOQ, freight, tax treatment, lead time and unresolved conditions. Missing values stay unknown. Full landed-cost ranking requires compatible, confirmed costs; native-currency source facts remain visible when ranking is unavailable.
- **Human Must Decide:** review the proposed supplier, request revisions, see the changed recommendation, and approve the current version. Editing source facts or requirements invalidates an old approval. Evidence completeness is distinguished from proven supplier delivery performance.
- **Make It Act:** after supplier approval, choose a lower price, lower MOQ or faster-delivery goal. A real Claude integration reads quotation evidence, calls deterministic calculation tools, and proposes a negotiation message. Buyer feedback triggers another model revision and another approval. Approval of the exact draft allows a tool to save a local document.
- **Act History:** inspect the draft, revisions, approval and tool activity. The live workflow is labelled separately from the retained simulated negotiation demo.
- **Evidence collection:** timed trials and fulfilment records support collecting future evaluation evidence. Synthetic examples and unverified records are not represented as proven outcomes.

**The current agent does not send messages to suppliers, accept a supplier offer or place orders.** Supplier messaging is a future integration. A requested discount is a negotiation target, not a realised saving. No verified external industry-price feed is included.

## Start the local demo

Requires Node.js 22.13 or later. From the repository directory:

```sh
node scripts/serve-local.mjs
```

Open <http://127.0.0.1:4173/>. The repository includes the prebuilt local client, so the initial demo does not require an npm installation. Stop the server with Ctrl+C.

To use another port:

```sh
PROCUREX_PORT=4175 node scripts/serve-local.mjs
```

The server binds to `127.0.0.1`; this is a local demonstration, not a configured public hosting service.

## Optional Claude configuration

Comparison and manual review work without a model credential. The live Claude negotiation flow requires an Anthropic account, an authorised API key and an available model.

Create a `.dev.vars` file beside `package.json` with:

```dotenv
ANTHROPIC_API_KEY=replace-with-your-own-key
ANTHROPIC_MODEL=replace-with-a-model-enabled-for-your-account
```

Restart the local server after configuring it. Keep this file private. Real API requests can incur provider charges. Starting or revising a live negotiation sends the selected quotation context and buyer instructions to Anthropic; the browser never receives the credential.

Credentials, uploaded user files, local approval records and private workspace state are excluded from this repository. Do not commit `.dev.vars`, `.env` files or `.local-agent-records`.

## Develop and test

Install the locked development dependencies before rebuilding or testing:

```sh
npm ci
npm test
npm run build:local
npm run local
```

To rebuild the static public demo, run `npm run build:public`. The `public-demo/` output is deployed by the GitHub Pages workflow and uses the `/procurex/` base path. Keep the public-demo mode flag enabled: this hosting has no Claude backend or server secrets.

The local build uses React and esbuild. `npm test` runs the Node test suite, including parser fixtures, price-tier selection, comparison safeguards, human-review revision gates, evidence-ledger rules and the live-agent protocol with a mocked provider. On 3 November 2026, the audited source passed **150 tests**. This is automated functional coverage, not proof that every possible document layout is supported or that external model availability is guaranteed.

`npm run dev` and `npm run build` belong to the retained Sites / Cloudflare scaffold. Use `build:local` and `local` for the standalone demonstration documented here. Hosting-specific authentication and persistence must be configured separately before any public deployment.

## Source map

| Path | Purpose |
| --- | --- |
| `app/` | Quotation intake, comparison, supplier review, live negotiation, history and evidence UI |
| `lib/source-reader.ts` | PDF / spreadsheet / MIME email reading |
| `lib/quotation-structure.mjs`, `lib/item-matching.mjs`, `lib/quotation-facts.mjs` | Structure recognition, product matching and source facts |
| `lib/engine.mjs`, `lib/comparison-preview.mjs`, `lib/supplier-review.mjs` | Cost comparison and approval workflow |
| `lib/live-agent.mjs` | Claude tool loop, target calculation, revisions and exact-version approval |
| `scripts/serve-local.mjs` | Local HTTP server and private local document persistence |
| `scripts/build-local.mjs`, `scripts/local-entry.tsx` | Reproducible browser bundle build |
| `local/` | Included prebuilt client and local API bundle |
| `tests/` | Automated tests and synthetic / de-identified fixtures |
| `public/vendor/`, `lib/vendor/`, `vendor/` | Required vendored libraries and licence notices |
| `worker/`, `db/`, `drizzle/`, `examples/` | Retained optional hosting scaffold |

## Data and limitations

Quotation intake is local and rule-based. The normal parsing path does not call a model. Files stay in browser memory and are cleared on refresh; activity and evidence records may persist in this browser's local storage. Approved live-agent documents are also saved under `.local-agent-records/` on the local server. In-memory live-agent sessions reset when the server restarts.

The parser does not support legacy XLS files, scanned-image PDF OCR, arbitrary unknown layouts or arbitrary product synonyms. XLSX formulas use saved cell values rather than recalculating formulas. EML attachments are ignored; upload each attachment separately. File size, PDF page and extracted-text limits apply. Multiple ambiguous products require a human selection.

Currency and tax treatment are preserved. The confirmed cost-ranking path uses compatible SGD pre-tax quotations; it does not invent exchange rates, import tax, missing freight or arrival dates. Review original source evidence before making a purchasing decision.

Third-party licence notices remain beside the vendored dependencies. Dependencies installed through npm retain their own licences.
