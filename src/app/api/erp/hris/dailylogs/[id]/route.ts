import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, readBody, logAudit, numOrNull } from "@/lib/crm/server";
import { resolveActor, assertRole } from "@/lib/crm/auth";
import { MANAGER_PLUS_ROLES, requireSelfEmployee, strOrNull, parseIsoDate, utcDayRange } from "../../_utils";

// PATCH /api/erp/hris/dailylogs/[id] — pemilik log ATAU manager+.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readBody(req);
  const actor = await resolveActor(req, body);
  if (actor.denied) return fail(actor.reason, 401);

  const log = await db.dailyLog.findUnique({
    where: { id },
    include: { employee: { select: { id: true, preferredName: true, userId: true } } },
  });
  if (!log) return fail("Log harian tidak ditemukan", 404);

  const isOwner = !!actor.id && log.employee.userId === actor.id;
  if (!isOwner) {
    const gate = assertRole(actor, MANAGER_PLUS_ROLES);
    if (!gate.ok) return fail("Hanya pemilik log atau manajer yang bisa mengubah", 403);
  }

  const data: Record<string, unknown> = {};
  if ("date" in body) {
    const d = parseIsoDate(body.date);
    if (!d) return fail("Tanggal tidak valid (format YYYY-MM-DD)");
    data.date = utcDayRange(d).start;
  }
  if ("content" in body) {
    const c = strOrNull(body.content);
    if (!c) return fail("Isi pekerjaan tidak boleh kosong");
    data.content = c;
  }
  if ("hours" in body) {
    const h = numOrNull(body.hours);
    if (h === null || h < 0 || h > 24) return fail("Jam kerja harus di rentang 0–24");
    data.hours = h;
  }
  if ("projectId" in body) data.projectId = strOrNull(body.projectId);

  const updated = await db.dailyLog.update({
    where: { id },
    data,
    include: {
      employee: {
        select: {
          id: true, preferredName: true, employeeNumber: true,
          department: true, position: true, userId: true, supervisorId: true,
        },
      },
    },
  });

  await logAudit({
    actorName: actor.name, actorRole: actor.role,
    action: "update", entity: "hris_dailylog", entityId: id,
    entityLabel: `Log — ${log.employee.preferredName}`,
    field: Object.keys(data).join(",") || null, req,
  });
  return ok({ log: updated });
}
