# Task 40-A — Backend APIs (Ronde 40)

Agent: Z.ai Code (backend APIs)
Status: SELESAI — tsc 0, lint 0, QA API end-to-end lolos, data QA dibersihkan.

## File yang diubah (kepemilikan 40-A saja)
- BARU `src/lib/crm/task-parse.ts` — `parseTaskAssignees` (trim/dedupe/buang kosong/maks 10), `parseTaskAttachments` (link http(s); file data URL ≤5MB decoded; maks 5; blokir MIME/ekstensi via `unsafeAttachmentReason`; Error pesan Indonesia).
- BARU `src/app/api/taxes/route.ts` — GET auto-seed [PPN 11, PPh 21 5, PPh 23 2], return aktif order name asc; POST/PATCH gate finance/director/super_admin; rate clamp 0–100; audit entity "tax".
- `src/app/api/tasks/route.ts` — POST: assignees/attachments via task-parse, opportunityId divalidasi (400), assigneeName = assignees[0] ?? legacy.
- `src/app/api/tasks/[id]/route.ts` — PATCH: assignees/attachments/opportunityId (boleh null), status done → completedAt (perilaku lama dipertahankan).
- `src/app/api/opportunities/[id]/estimation/route.ts` — PUT: costItems (array|JSON, maks 50, subtotal server round(qty*unitPrice) IDR), totalCost = SUM(subtotal) > 0 ? itu : sum 9 kategori; taxName null → taxPct 0 (tanpa pajak); tak dikirim → pakai costItems tersimpan.
- `src/app/api/approvals/route.ts` — PATCH: approve estimation → auto-move opportunity ke "negotiation" bila stage lama di [new, contact_attempted, connected, qualified, discovery, estimation] + audit.
- `src/app/api/opportunities/route.ts` — POST: ownerName default actor.name (sesi); brand divalidasi; currency fallback brand.primaryCurrency ?? "IDR".
- `src/app/api/opportunities/[id]/route.ts` — GET: include approvals pending (take 5) → response `pendingApprovals`.
- `src/app/api/inbox/convert/route.ts` — brand divalidasi; currency fallback brand; ownerName default actor (trim).
- `src/app/api/quotations/route.ts` — POST: taxName passthrough (null/kosong → taxPct 0).
- `src/app/api/quotations/[id]/route.ts` — PATCH generic: taxName + recompute totals (tanpa item pun konsisten); action send: `channel` whitelist CHANNELS (fallback email) dipakai utk Interaction + audit; convert_invoice: invoice.taxName = quotation.taxName.
- `src/app/api/dashboard/route.ts` — myTasks match assigneeName ATAU parseTaskAssignees(assignees).
- `src/app/api/notifications/route.ts` — gating task non-pimpinan: OR [assigneeName, assignees contains] + presisi in-memory (take 30 → filter → 15).
- `src/lib/crm/types.ts` — TaxDTO, EstimationCostItem, TaskAttachment baru; extend EstimationDTO/QuotationDTO/InvoiceDTO/TaskDTO/OpportunityDTO (pendingApprovals).
- `src/lib/crm/api-client.ts` — taxes(), createTax(), updateTax(); signature lama tidak diubah.

## Bentuk endpoint (ringkas)
- GET /api/taxes → `{taxes:[{id,name,rate,active}]}` (sesi wajib — semua /api/* digerbangi proxy.ts).
- POST /api/taxes `{name,rate}` → 201 `{tax}`; PATCH `{id,name?,rate?,active?}` → `{tax}`; non-finance/director/super_admin → 403.
- POST /api/tasks `{title, assignees:[nama], attachments:[{type,name,url,size?}], opportunityId?}` → 201 `{task}`; validasi gagal → 400 pesan Indonesia.
- PUT /api/opportunities/[id]/estimation `{costItems?, taxName?, taxPct?, revenue?, submit?}` → `{estimation, approval?}`.
- PATCH /api/approvals `{id, decision, decisionNote?}` → `{approval}` (+ auto-move stage).
- GET /api/opportunities/[id] → `{opportunity{...pendingApprovals[]}, related}`.

## Hal penting utk agent lain
- 40-C/40-E: kirim `taxName` sebagai STRING NAMA (dari GET /api/taxes), bukan id. Quotation draft edit: PATCH taxName tanpa items ikut menghitung ulang totals.
- Detail opportunity (40-E): tombol keputusan estimasi bisa render dari `opportunity.pendingApprovals`.
- Task form (40-E): lampiran file harus data URL ≤5MB; >5 file ditolak server (pesan Indonesia tampil via fail()).

## Deviasi / catatan
- `parseTaskAssignees` >10 nama: dipotong ke 10 pertama (bukan error) — kontrak tidak menentukan; `parseTaskAttachments` >5: error (sesuai kontrak).
- PATCH quotation taxName tanpa items: taxAmount/total dihitung ulang dari item tersimpan agar tidak yatim (tambahan kecil di luar kontrak minimum, menjaga konsistensi).
- Insiden lingkungan: next-server lama OOM-killed sandbox (RSS 2.2GB/4GB setelah 5 jam). Server tidak bisa dipertahankan antar-call shell; QA dilakukan dalam satu sesi panjang. Preview perlu sistem menjalankan `bun run dev` lagi bila 502.
