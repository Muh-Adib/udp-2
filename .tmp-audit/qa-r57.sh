#!/usr/bin/env bash
# QA R57 — Term of Payment sinkron quotation → invoice (jatuh tempo).
set -u
cd /home/z/my-project
BASE=http://localhost:3000

# 0) Pastikan server hidup (start bila perlu, tunggu siap)
if ! curl -s -o /dev/null "$BASE/"; then
  setsid nohup bun run dev >> dev.log 2>&1 < /dev/null &
fi
for i in $(seq 1 60); do
  curl -s -o /dev/null "$BASE/" && break
  sleep 2
done
echo "server: $(curl -s -o /dev/null -w '%{http_code}' $BASE/)"

# 1) Login
curl -s -c .tmp-audit/cookies.txt -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"andri@udp.co.id","password":"udp1234"}' -o /dev/null -w "login: %{http_code}\n"

# 2) Cari opportunity bertahap awal (belum proposal_sent) dgn company
curl -s -b .tmp-audit/cookies.txt "$BASE/api/opportunities" -o .tmp-audit/opps.json
OPP_ID=$(python3 -c "
import json
d = json.load(open('.tmp-audit/opps.json'))
opps = d.get('opportunities', d) if isinstance(d, dict) else d
for o in opps:
    if o.get('companyId') and o.get('stage') in ('estimation','proposal_sent','verbal_agreement'):
        print(o['id']); break
")
STAGE=$(python3 -c "
import json
d = json.load(open('.tmp-audit/opps.json'))
opps = d.get('opportunities', d) if isinstance(d, dict) else d
for o in opps:
    if o['id'] == '$OPP_ID': print(o.get('stage')); break
")
echo "opportunity: $OPP_ID (stage=$STAGE)"
[ -z "$OPP_ID" ] && { echo "TIDAK ADA OPPORTUNITY COCOK"; exit 1; }

# 3) Buat quotation dgn TOP terstruktur (60/40, final H+14 setelah BASTP)
curl -s -b .tmp-audit/cookies.txt -X POST "$BASE/api/quotations" \
  -H "Content-Type: application/json" \
  -d '{
    "opportunityId": "'"$OPP_ID"'",
    "items": [{"description":"QA R57 — TOP sync test","qty":1,"unitPrice":10000000}],
    "discountPct": 0,
    "taxName": null,
    "terms": [
      {"label":"Down Payment","pct":60,"dueDays":0,"dueEvent":"invoice"},
      {"label":"Final Payment","pct":40,"dueDays":14,"dueEvent":"bastp"}
    ],
    "actorName":"QA R57","actorRole":"director"
  }' -o .tmp-audit/q-create.json -w "create quotation: %{http_code}\n"
QID=$(python3 -c "
import json
d = json.load(open('.tmp-audit/q-create.json'))
q = d.get('quotation', {})
print(q.get('id',''))
")
python3 -c "
import json
q = json.load(open('.tmp-audit/q-create.json')).get('quotation', {})
print('number       :', q.get('number'))
print('terms tersimpan :', q.get('terms'))
print('termOfPayment auto :')
print(q.get('termOfPayment'))
"
[ -z "$QID" ] && { echo "GAGAL BUAT QUOTATION"; cat .tmp-audit/q-create.json; exit 1; }

# 4) Validasi server: TOP invalid (sum != 100) harus tetap tersimpan? (server clamp per-baris,
#    sum divalidasi di UI — server menerima; cukup catat)
# 4) Accept quotation
curl -s -b .tmp-audit/cookies.txt -X PATCH "$BASE/api/quotations/$QID" \
  -H "Content-Type: application/json" \
  -d '{"action":"accept","actorName":"QA R57","actorRole":"director"}' \
  -o .tmp-audit/q-accept.json -w "accept: %{http_code}\n"

# 5) Convert → invoice; verifikasi terms diwarisi
curl -s -b .tmp-audit/cookies.txt -X PATCH "$BASE/api/quotations/$QID" \
  -H "Content-Type: application/json" \
  -d '{"action":"convert_invoice","actorName":"QA R57","actorRole":"director"}' \
  -o .tmp-audit/q-convert.json -w "convert_invoice: %{http_code}\n"
python3 -c "
import json
d = json.load(open('.tmp-audit/q-convert.json'))
inv = d.get('invoice', {})
print('invoice number:', inv.get('number'))
print('invoice terms :', inv.get('terms'))
print('invoice dueDate:', inv.get('dueDate'))
"

# 6) Cleanup — hapus artefak QA (invoice, quotation, audit) + pulihkan stage opportunity
cat > .tmp-audit/cleanup.ts <<'EOF'
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const qid = process.argv[2]!;
const stage = process.argv[3]!;
async function main() {
  const q = await db.quotation.findUnique({ where: { id: qid } });
  if (!q) { console.log("quotation sudah tiada"); return; }
  const inv = await db.invoice.findFirst({ where: { description: { contains: q.number } } });
  if (inv) {
    await db.payment.deleteMany({ where: { invoiceId: inv.id } });
    await db.auditLog.deleteMany({ where: { OR: [{ entity: "invoice", entityId: inv.id }, { entityId: qid }] } });
    await db.invoice.delete({ where: { id: inv.id } });
    console.log("invoice dihapus:", inv.number);
  }
  await db.auditLog.deleteMany({ where: { entity: "quotation", entityId: qid } });
  await db.quotation.delete({ where: { id: qid } });
  if (stage !== "null" && stage !== "") {
    await db.opportunity.update({ where: { id: q.opportunityId }, data: { stage } }).catch(() => {});
  }
  console.log("quotation dihapus:", q.number, "| stage dipulihkan:", stage);
}
main().finally(() => db.$disconnect());
EOF
bunx tsx .tmp-audit/cleanup.ts "$QID" "$STAGE"
rm -f .tmp-audit/q-create.json .tmp-audit/q-accept.json .tmp-audit/q-convert.json .tmp-audit/opps.json .tmp-audit/cleanup.ts .tmp-audit/login.json
echo "QA SELESAI"
