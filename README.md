# Zoffer Bill Integration — Postman → Zoho Books

A scrappy but functionally complete prototype of the required workflow:
**Postman upload → server receives file → extracts bill data → maps to Zoho Books format → posts to Zoho Books.**

Built fully local: Ollama for LLM extraction (no OpenAI/cloud LLM calls), MongoDB for storage, Node/Express for the server.

## Why this stack

| Choice | Reasoning |
|---|---|
| **Ollama (local LLMs)**, not a cloud LLM API | Zero per-call cost while iterating, no invoice data leaving the machine (a real point in fintech accounting software's favor), and it's what I already had GPU headroom for (RTX 3060, 6GB VRAM). |
| **Two different Ollama models**, not one for everything | A digital PDF (Amazon's) has a real text layer — a small, fast text model (`llama3.2:3b`) is enough and ~4x faster than routing everything through a vision model. A handwritten scan needs an actual vision-capable model. Using one model for both would either waste vision-model latency on easy cases or starve the hard case of a model that can actually read an image. |
| **`qwen2.5vl:7b`** over `llava:7b` for the vision path | Tried `llava` first — it hallucinated a completely different invoice (fabricated line items like "car washing" that don't exist in the source). Swapped to `qwen2.5vl`, which is specifically stronger at document/text-in-image OCR, and it correctly read vendor name, invoice number, date, HSN code, and total exactly on the real handwritten test invoice. Documented under [Known limitations](#known-limitations) below — it's not perfect, but it's the one that actually reads the bill instead of inventing one. |
| **MongoDB**, matching the requested stack | Stores the raw extraction + mapped Zoho payload per bill as an audit trail, independent of whether the Zoho sync succeeds — useful for debugging a bad extraction without needing to re-run the (slow) LLM call. |
| **RAG as Express middleware**, not a separate service | Sits between extraction and Zoho-mapping in the request pipeline (`extractionMiddleware → ragMiddleware → zohoMappingMiddleware`). Cross-checks each line item's extracted GST rate against a small local knowledge base of HSN codes/rates (embedded with `nomic-embed-text`, compared via in-memory cosine similarity — no separate vector DB needed at this scale). It only **flags** mismatches for human review; it never silently "corrects" a number. |
| **No auth on the endpoint** | Deliberate scope call for a local-only scrappy demo, not an oversight — see [Known limitations](#known-limitations). |

## Architecture

```
Postman
   │  POST /bills  (multipart file "bill")
   ▼
multer (memory storage, 15MB cap)
   │
   ▼
extractionMiddleware
   │  1. file-type sniffs real bytes (never trusts client Content-Type)
   │  2. routes by actual content:
   │       image/*          ─────────────► Ollama vision (qwen2.5vl)
   │       pdf, has text layer ──────────► pdf-parse → Ollama text (llama3.2:3b)
   │       pdf, no text layer (scanned) ─► pdf-to-img → Ollama vision (qwen2.5vl)
   ▼
ragMiddleware
   │  embeds each line item's description (nomic-embed-text)
   │  compares against a small local GST/HSN knowledge base
   │  attaches ragFlags[] for rate mismatches - advisory only, never blocks
   ▼
zohoMappingMiddleware
   │  finds/creates the vendor as a Zoho contact
   │  looks up a default expense account from the chart of accounts
   │  builds the Zoho Books bill payload
   ▼
route handler
   │  POST to Zoho Books API
   │  saves Bill document to Mongo (status: synced/failed either way)
   ▼
Response to Postman (extraction + ragFlags + zohoBillId, or the error)
```

## Setup

**Prerequisites:** Node 20+, [Ollama](https://ollama.com) installed, MongoDB running locally (native install or `docker run -d -p 127.0.0.1:27017:27017 mongo:7`), a Zoho Books account.

```bash
npm install

ollama pull llama3.2:3b
ollama pull qwen2.5vl:7b
ollama pull nomic-embed-text
ollama serve   # if not already running as a background service
```

Copy `.env.example` to `.env` and fill in the Zoho block (see below). Then:

```bash
node server.js
```

Server starts on `http://localhost:3000`, connects to Mongo, and builds the RAG embedding index on boot.

### Getting Zoho credentials

1. Create/log into a Zoho Books account, note the **Organization ID** (Settings → Organization Profile).
2. Go to [api-console.zoho.in](https://api-console.zoho.in) → Add Client → **Self Client** (this is a backend-script client, no OAuth browser redirect needed).
3. In the **Generate Code** tab: scope `ZohoBooks.fullaccess.all`, generate a short-lived code.
4. Run `node scripts/exchangeZohoToken.js <THE_CODE>` — it exchanges the code for a long-lived refresh token and prints the `.env` line to add.
5. Fill in `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORG_ID` in `.env`.

> **Data center gotcha:** every Zoho account is pinned to one regional data center at signup (`.com` for US, `.in` for India, `.eu`, `.com.au`, ...), and the token endpoint must match it exactly - the wrong one returns `invalid_client` even with perfectly correct credentials, which looks identical to a genuinely bad client secret. Mine turned out to be on `.com` despite testing from India. If you hit `invalid_client`, don't assume the secret is wrong - check `ZOHO_ACCOUNTS_URL`/`ZOHO_API_DOMAIN` against your account's actual DC first (visible in the URL bar when logged into Zoho Books).

## API

- `POST /bills` — the real workflow: upload → extract → RAG check → post to Zoho Books → save to Mongo.
- `POST /bills/extract-only` — dev/testing endpoint: runs extraction + the RAG check but skips Zoho entirely. Useful for validating the AI pipeline without needing Zoho credentials wired up yet.
- `GET /health` — liveness check.

**Testing in Postman:** `POST http://localhost:3000/bills` (or `/bills/extract-only`), Body → form-data → key `bill` (type **File**) → pick the invoice.

```bash
curl -s -X POST http://localhost:3000/bills \
  -F "bill=@/path/to/invoice.pdf"
```

## Real test results

Both bills below were run through the real `/bills` endpoint end-to-end, including the actual Zoho Books sync (not just extraction).

**Amazon PDF (digital text, ~20s) — fully correct, synced to Zoho:**
```json
{
  "vendorName": "Moxcel Store",
  "invoiceNumber": "ZNGG-20929",
  "invoiceDate": "30.11.2024",
  "lineItems": [{ "description": "Catchex Stainless Steel Wax Carving Tools Double Ended", "hsnCode": "8205", "quantity": 1, "unitPrice": 354.05, "taxRate": 18, "amount": 417.78 }],
  "totalAmount": 417.78
}
```
Every field correct, including the tax rate (18%) — an earlier version of this pipeline misread it as 8% because plain `pdf-parse` flattens table columns into one text stream with no marker for which number belongs to which column. Fixed with a custom `pagerender` hook that reconstructs rows/columns from each text fragment's real x/y position on the page (see [extraction.js](src/services/extraction.js)) before handing text to the LLM — a layout fix, not an OCR fix, since the underlying character extraction was never wrong.

**Handwritten GST invoice (vision model, ~90-120s) — synced to Zoho, extraction imperfect:**
```json
{
  "vendorName": "R.J.I. ENGG. WORKS",
  "invoiceNumber": "611",
  "invoiceDate": "24-12-24",
  "lineItems": [
    { "description": "Moulding Body Tag", "hsnCode": "3923", "quantity": 545, "unitPrice": 6, "taxRate": null, "amount": 3270 },
    { "description": "Body Tag Base", "hsnCode": "3923", "quantity": 535, "unitPrice": 2.5, "taxRate": null, "amount": 1338 },
    { "description": "Body Tag Button", "hsnCode": "3923", "quantity": 520, "unitPrice": 6.5, "taxRate": null, "amount": 3380 }
  ],
  "totalAmount": 9426
}
```
Vendor, invoice number, date, HSN code, and total all match the source exactly. `taxRate: null` on each line is correct behavior, not a miss — the source invoice only states IGST 18% once for the whole bill, not per line item, and the model is (correctly) not inventing a per-line figure it wasn't given. See [Known limitations](#known-limitations) for what it still gets wrong on this specific invoice.

## Security guardrails applied

- **Real file-type sniffing** (`file-type` package reads actual bytes) instead of trusting the client-supplied `Content-Type` — blocks disguised/mislabeled uploads.
- **15MB upload cap** on multer — prevents a memory-exhaustion DoS via oversized uploads.
- **MongoDB bound to `127.0.0.1` only**, never `0.0.0.0` — the DB holds GST numbers and vendor financial details.
- **Zoho refresh token** lives only in `.env` (gitignored), never logged or echoed back in any API response.
- Mapped bill payload and raw extraction are stored in Mongo regardless of Zoho sync outcome, so a failed sync is debuggable without re-running the (slow) LLM call.

## Known limitations

Deliberately scoped out for a 3-day scrappy prototype — listed here instead of hidden, with the reasoning for why:

- **No auth on `/bills`.** Fine for local Postman testing; would need an API key/JWT check before this ever sits behind a public URL.
- **No human-review gate before posting to Zoho.** The biggest one. Right now extraction → Zoho is fully automatic. A real product handling real money should hold bills in a `pending_review` state, at least until extraction accuracy is proven over time — the RAG middleware's flags are a start toward that, not a replacement for it.
- **Handwritten-invoice line items can be mislabeled or duplicated** on a busy table with a header + indented sub-items (as in the test invoice) — across test runs this showed up as descriptions shifted by one row, or occasionally the last row duplicated instead of reading the real fourth item. `totalAmount` was correct every time (read directly off the invoice's stated grand total), but the line-item *breakdown* on this specific invoice is the one place I'd want a human glance before trusting it, which is exactly the review-gate point above.
- **GST knowledge base is 12 hand-picked HSN entries**, not the full CBIC master list (thousands of codes, and it changes via periodic government notifications). Good enough to demonstrate the RAG-flagging mechanism; not production tax-compliance data.
- **Single-page bills only.** Multi-page scanned bills would need per-page vision calls plus a stitching step to merge line items — not built.
- **Single hardcoded tenant** (`DEFAULT_ORG_ID`). `Bill.orgId` and the (currently unused) `Organization` model are the intended extension points for real multi-tenant auth.
- **No vendor-ID caching.** Every bill does a live Zoho contacts lookup/create; a `vendors` collection caching name → Zoho contact ID would cut an API call per repeat vendor.

## Project structure

```
server.js                          entrypoint
src/routes/bills.js                POST /bills, POST /bills/extract-only
src/middleware/
  extractionMiddleware.js          file-type sniff + routes to extraction service
  ragMiddleware.js                 GST rate cross-check, advisory flags only
  zohoMappingMiddleware.js         vendor lookup/create, builds Zoho payload
src/services/
  extraction.js                    image vs digital-PDF vs scanned-PDF routing
  ollama.js                        text/vision/embedding calls to local Ollama
  zoho.js                          Zoho OAuth token, contacts, chart of accounts, bills
src/rag/
  gstKnowledge.js                  the small HSN/rate knowledge base
  vectorStore.js                   embeds it once at boot, cosine-similarity lookup
src/models/Bill.js                 Mongo schema - one document per processed bill
scripts/exchangeZohoToken.js       one-time OAuth code → refresh token helper
```
