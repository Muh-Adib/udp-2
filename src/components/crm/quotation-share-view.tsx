"use client";

/**
 * Ronde 56 — tampilan PUBLIK link aman quotation (tanpa login CRM).
 * Dibuka dari `/?quote=<token>[&key=<magic>]` — magic link dari email brand
 * langsung terbuka tanpa password (keterangan password tetap ditampilkan),
 * terbatas 3 kali buka; habis → tombol "Request New Code" yang otomatis
 * mengirim kode baru via email brand. Klien dapat menandatangani (e-sign)
 * → quotation accepted + deal WON otomatis di CRM.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, Loader2, Lock, MailCheck, PenLine, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

interface ShareItem { description?: string; qty?: number; unitPrice?: number; subtotal?: number }
interface ShareData {
  quotation: {
    number: string; status: string; issueDate: string; validUntil: string | null;
    regarding: string | null; attn: string | null; clientAddress: string | null;
    timeline: string | null; revisionNotes: string | null; termOfPayment: string | null;
    letterBody: string | null; letterClosing: string | null;
    currency: string; subtotal: number; discountAmount: number;
    taxName: string | null; taxPct: number; taxAmount: number; total: number;
    items: ShareItem[];
    signedAt: string | null; signedByName: string | null;
  };
  company: { name: string | null };
  brand: { name: string | null; color: string | null; logoUrl: string | null; letterheadHeader: string | null; letterheadFooter: string | null; signerName: string | null };
  opensLeft: number;
  maxOpens: number;
}

function money(v: number, cur: string): string {
  const n = Math.round(Number(v) || 0);
  return cur === "IDR" ? `Rp${n.toLocaleString("en-US")}` : `${cur} ${n.toLocaleString("en-US")}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
}

export default function QuotationShareView({ token, magicKey }: { token: string; magicKey: string | null }) {
  const [state, setState] = useState<"loading" | "ready" | "need_password" | "need_new_code" | "error">("loading");
  const [data, setData] = useState<ShareData | null>(null);
  const [message, setMessage] = useState<string>("");
  const [password, setPassword] = useState("");
  const [checking, setChecking] = useState(false);
  const [codeSent, setCodeSent] = useState(false);

  const load = useCallback(async (pwd?: string) => {
    setChecking(true);
    try {
      const qs = new URLSearchParams();
      if (magicKey) qs.set("key", magicKey);
      if (pwd) qs.set("password", pwd);
      const res = await fetch(`/api/public/quotation/${encodeURIComponent(token)}?${qs.toString()}`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 403 && json.needsNewCode) {
        setMessage(String(json.message ?? "Open limit reached."));
        setState("need_new_code");
        return;
      }
      if (res.status === 401) {
        setMessage("This secure link requires a password. Please enter the password provided by our team, or open the latest link from your email.");
        setState("need_password");
        return;
      }
      if (!res.ok || !json.quotation) {
        setMessage(String(json.error ?? json.message ?? "This link is invalid or has been revoked."));
        setState("error");
        return;
      }
      setData(json as unknown as ShareData);
      setState("ready");
    } catch {
      setMessage("Network error — please try again.");
      setState("error");
    } finally {
      setChecking(false);
    }
  }, [token, magicKey]);

  useEffect(() => { void load(); }, [load]);

  async function requestNewCode() {
    setChecking(true);
    try {
      const res = await fetch(`/api/public/quotation/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request_new_code" }),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok && (json.sent || json.status === "simulated")) {
        setCodeSent(true);
        toast.success("New access code sent", { description: `Check your email (${String(json.to ?? "")}). The new link opens without a password.` });
      } else {
        toast.error(String(json.error ?? "Failed to send new code"));
      }
    } finally {
      setChecking(false);
    }
  }

  if (state === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100" role="status">
        <div className="flex items-center gap-3 rounded-xl bg-white px-6 py-4 shadow-sm">
          <Loader2 className="size-5 animate-spin text-orange-500" aria-hidden />
          <span className="text-sm text-zinc-600">Opening secure quotation…</span>
        </div>
      </div>
    );
  }

  if (state === "need_password") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100 px-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2">
            <Lock className="size-5 text-orange-500" aria-hidden />
            <h1 className="text-lg font-bold text-zinc-900">Protected Document</h1>
          </div>
          <p className="mt-2 text-sm text-zinc-600">{message}</p>
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (password.trim()) void load(password.trim());
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="share-password">Password</Label>
              <Input id="share-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Document password" autoComplete="off" />
            </div>
            <Button type="submit" className="w-full" disabled={checking || !password.trim()}>
              {checking ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ShieldCheck className="size-4" aria-hidden />}
              Open Quotation
            </Button>
            <p className="text-center text-xs text-zinc-400">
              Tip: the newest email from us contains a magic link — just click it, no password needed.
            </p>
          </form>
        </div>
      </div>
    );
  }

  if (state === "need_new_code") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100 px-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-sm">
          <RefreshCw className="mx-auto size-8 text-orange-500" aria-hidden />
          <h1 className="mt-3 text-lg font-bold text-zinc-900">Open limit reached</h1>
          <p className="mt-2 text-sm text-zinc-600">{message}</p>
          {codeSent ? (
            <div className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              <MailCheck className="size-4" aria-hidden /> New access code sent — please check your email.
            </div>
          ) : (
            <Button className="mt-4 w-full" onClick={() => void requestNewCode()} disabled={checking}>
              {checking ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
              Request New Code
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (state === "error" || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100 px-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-sm">
          <ShieldCheck className="mx-auto size-8 text-zinc-400" aria-hidden />
          <h1 className="mt-3 text-lg font-bold text-zinc-900">Link unavailable</h1>
          <p className="mt-2 text-sm text-zinc-600">{message}</p>
        </div>
      </div>
    );
  }

  const q = data.quotation;
  const accent = data.brand.color || "#2563eb";
  const items = q.items ?? [];
  const subtotal = items.length > 0 ? items.reduce((s, it) => s + Math.round((it.qty || 1) * (it.unitPrice || 0)), 0) : q.subtotal;
  const discount = q.discountAmount || 0;
  const afterDiscount = subtotal - discount;
  const taxAmount = q.taxName ? Math.round((afterDiscount * (q.taxPct || 0)) / 100) : 0;
  const total = afterDiscount + taxAmount;
  const signed = Boolean(q.signedAt);

  return (
    <div className="min-h-screen bg-zinc-100 pb-16">
      <div className="mx-auto max-w-3xl px-3 pt-4 sm:px-6">
        {/* Bar akses aman */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-4 py-2.5 text-xs shadow-sm">
          <span className="flex items-center gap-1.5 font-medium text-emerald-700">
            <ShieldCheck className="size-4" aria-hidden /> Secure document · {data.opensLeft} of {data.maxOpens} opens left
          </span>
          <div className="flex items-center gap-2">
            <a
              href={`/api/public/quotation/${encodeURIComponent(token)}?pdf=1${magicKey ? `&key=${encodeURIComponent(magicKey)}` : ""}`}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
            >
              <Download className="size-3.5" aria-hidden /> Download PDF
            </a>
            {signed ? (
              <span className="flex items-center gap-1.5 rounded-lg bg-emerald-100 px-3 py-1.5 font-semibold text-emerald-700">
                <CheckCircle2 className="size-3.5" aria-hidden /> Signed {q.signedByName ? `by ${q.signedByName}` : ""}
              </span>
            ) : (
              <SignDialog token={token} magicKey={magicKey} accent={accent} quoteNumber={q.number} totalText={money(total, q.currency)} onSigned={() => void load()} />
            )}
          </div>
        </div>

        {/* Dokumen (HTML mirror dari PDF) */}
        <article className="overflow-hidden rounded-xl bg-white shadow-sm">
          {data.brand.letterheadHeader ? (
            <img src={data.brand.letterheadHeader} alt={`${data.brand.name ?? "Brand"} letterhead`} className="w-full" />
          ) : (
            <header className="border-b-4 px-6 pb-4 pt-6" style={{ borderColor: accent }}>
              <div className="flex items-center gap-3">
                {data.brand.logoUrl ? (
                  <img src={data.brand.logoUrl} alt={`${data.brand.name ?? "Brand"} logo`} className="h-10 w-auto object-contain" />
                ) : null}
                <h1 className="text-2xl font-black tracking-tight" style={{ color: accent }}>{data.brand.name ?? "Quotation"}</h1>
              </div>
            </header>
          )}

          <div className="px-6 py-5">
            <div className="flex items-start justify-between gap-4 text-sm">
              <div className="space-y-0.5 text-zinc-700">
                <p><span className="font-semibold">Number</span> : {q.number}</p>
                <p><span className="font-semibold">Date</span> : {fmtDate(q.issueDate)}</p>
                {q.regarding ? <p><span className="font-semibold">Regarding</span> : {q.regarding}</p> : null}
              </div>
              <p className="shrink-0 font-semibold text-zinc-700">{fmtDate(q.issueDate)}</p>
            </div>

            <div className="mt-4 space-y-0.5 text-sm text-zinc-700">
              <p><span className="inline-block w-16 font-semibold">To</span> : {data.company.name ?? "-"}</p>
              {q.attn ? <p><span className="inline-block w-16 font-semibold">Attn.</span> : {q.attn}</p> : null}
              {q.clientAddress ? <p><span className="inline-block w-16 font-semibold">Address</span> : <span className="whitespace-pre-line">{q.clientAddress}</span></p> : null}
            </div>

            <p className="mt-5 whitespace-pre-line text-sm leading-relaxed text-zinc-700">
              {q.letterBody?.trim() || `Respectfully,\nThrough this email, we would like to submit our price offer for the following services:`}
            </p>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr style={{ backgroundColor: accent }} className="text-white">
                    <th className="border px-2 py-1.5 text-center font-semibold">No.</th>
                    <th className="border px-2 py-1.5 text-left font-semibold">Service</th>
                    <th className="border px-2 py-1.5 text-center font-semibold">Unit</th>
                    <th className="border px-2 py-1.5 text-right font-semibold">Unit Price</th>
                    <th className="border px-2 py-1.5 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i} className={i % 2 === 1 ? "bg-zinc-50" : ""}>
                      <td className="border px-2 py-1.5 text-center">{i + 1}</td>
                      <td className="border px-2 py-1.5">{it.description}</td>
                      <td className="border px-2 py-1.5 text-center">{it.qty ?? 1}</td>
                      <td className="border px-2 py-1.5 text-right">{money(it.unitPrice || 0, q.currency)}</td>
                      <td className="border px-2 py-1.5 text-right">{money((it.qty || 1) * (it.unitPrice || 0), q.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 ml-auto w-full max-w-xs space-y-1 text-sm">
              {discount > 0 ? (
                <p className="flex justify-between border-b py-1 italic text-zinc-600"><span>Discount</span><span>-{money(discount, q.currency)}</span></p>
              ) : null}
              <p className="flex justify-between border-b py-1 font-bold"><span>TOTAL</span><span>{money(total, q.currency)}</span></p>
            </div>

            <div className="mt-5 grid gap-3 text-xs sm:grid-cols-3">
              {[["Timeline", q.timeline], ["Revision", q.revisionNotes], ["Term of Payment", q.termOfPayment]].map(([title, body]) => (
                <div key={title} className="overflow-hidden rounded border">
                  <p className="px-2 py-1 text-center font-semibold text-white" style={{ backgroundColor: accent }}>{title}</p>
                  <p className="whitespace-pre-line px-2 py-1.5 leading-relaxed text-zinc-700">{body || "-"}</p>
                </div>
              ))}
            </div>

            {q.validUntil ? <p className="mt-4 text-xs italic text-zinc-500">This quotation is valid until {fmtDate(q.validUntil)}.</p> : null}
            <p className="mt-2 whitespace-pre-line text-sm text-zinc-700">
              {q.letterClosing?.trim() || "We look forward to cooperating with your company."}
            </p>

            {signed ? (
              <div className="mt-6 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <CheckCircle2 className="size-5 text-emerald-600" aria-hidden />
                <div className="text-sm">
                  <p className="font-semibold text-emerald-800">Electronically signed{q.signedByName ? ` by ${q.signedByName}` : ""} on {fmtDate(q.signedAt)}</p>
                  <p className="text-xs text-emerald-700">This quotation is confirmed — our team will issue the invoice shortly.</p>
                </div>
              </div>
            ) : null}
          </div>

          {data.brand.letterheadFooter ? (
            <img src={data.brand.letterheadFooter} alt={`${data.brand.name ?? "Brand"} footer`} className="w-full" />
          ) : (
            <footer className="border-t px-6 py-3 text-center text-xs text-zinc-500">
              {data.brand.name ?? ""} — confidential quotation prepared for {data.company.name ?? "the client"}.
            </footer>
          )}
        </article>

        <p className="mx-auto mt-4 max-w-3xl text-center text-[11px] leading-relaxed text-zinc-400">
          Password note: this secure link can be opened up to {data.maxOpens} times. If the limit is reached, click &quot;Request New Code&quot; and a fresh magic link will be emailed to you automatically — no password typing needed when opening from email.
        </p>
      </div>
    </div>
  );
}

// ============ Dialog tanda tangan (e-sign) ============

function SignDialog({ token, magicKey, accent, quoteNumber, totalText, onSigned }: {
  token: string;
  magicKey: string | null;
  accent: string;
  quoteNumber: string;
  totalText: string;
  onSigned: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [agree, setAgree] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);

  function pos(e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * e.currentTarget.width, y: ((e.clientY - rect.top) / rect.height) * e.currentTarget.height };
  }
  function startDraw(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = true;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function moveDraw(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = pos(e);
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    hasInk.current = true;
  }
  function endDraw() { drawing.current = false; }
  function clearCanvas() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasInk.current = false;
  }

  async function submit() {
    const canvas = canvasRef.current;
    if (!name.trim()) { toast.error("Please type your full name"); return; }
    if (!hasInk.current) { toast.error("Please draw your signature in the box"); return; }
    if (!agree) { toast.error("Please confirm the legal terms checkbox"); return; }
    setSubmitting(true);
    try {
      const signature = canvas?.toDataURL("image/png") ?? "";
      const res = await fetch(`/api/public/quotation/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sign", name: name.trim(), title: title.trim(), signature, ...(magicKey ? { key: magicKey } : {}) }),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok && json.signed) {
        toast.success("Quotation signed — thank you!", { description: "Our team has been notified and will issue the invoice." });
        setOpen(false);
        onSigned();
      } else {
        toast.error(String(json.error ?? "Failed to sign"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button size="sm" style={{ backgroundColor: accent }} className="gap-1.5 text-white hover:opacity-90" onClick={() => setOpen(true)}>
        <PenLine className="size-3.5" aria-hidden /> Sign Quotation
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Electronically sign quotation {quoteNumber}</DialogTitle>
            <DialogDescription>
              Signing confirms the purchase of <span className="font-semibold text-zinc-700">{totalText}</span> on behalf of your company.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="sign-name">Full name *</Label>
                <Input id="sign-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sign-title">Position (optional)</Label>
                <Input id="sign-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Procurement Manager" />
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label>Draw your signature *</Label>
                <button type="button" className="text-xs font-medium text-zinc-500 underline-offset-2 hover:underline" onClick={clearCanvas}>
                  Clear
                </button>
              </div>
              <canvas
                ref={canvasRef}
                width={640}
                height={200}
                className="h-36 w-full touch-none rounded-lg border border-dashed bg-zinc-50"
                onPointerDown={startDraw}
                onPointerMove={moveDraw}
                onPointerUp={endDraw}
                onPointerLeave={endDraw}
                aria-label="Signature drawing area"
              />
            </div>
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-600">
              <Checkbox checked={agree} onCheckedChange={(v) => setAgree(v === true)} className="mt-0.5" id="legal-agree" />
              <span>
                By signing electronically I confirm that I am authorized to bind the company named above; I agree to the scope, timeline,
                revision policy, and terms of payment stated in this quotation; and I understand this electronic signature carries the same
                legal effect as a handwritten signature. Payments follow the stated terms; late payments may pause production. This document
                and its acceptance are recorded and archived by both parties. *
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
            <Button onClick={() => void submit()} disabled={submitting || !agree} style={{ backgroundColor: accent }} className="text-white hover:opacity-90">
              {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <PenLine className="size-4" aria-hidden />}
              Sign &amp; Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
