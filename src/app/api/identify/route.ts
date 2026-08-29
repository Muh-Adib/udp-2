import { NextRequest } from "next/server";
import { ok, findMatchCandidates, readBody } from "@/lib/crm/server";

/** Identity matching: cek kandidat duplikat sebelum create contact. */
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const candidates = await findMatchCandidates({
    email: body.email ? String(body.email) : null,
    whatsapp: body.whatsapp ? String(body.whatsapp) : null,
    phone: body.phone ? String(body.phone) : null,
    fullName: body.fullName ? String(body.fullName) : null,
    companyName: body.companyName ? String(body.companyName) : null,
  });
  return ok({ candidates });
}
