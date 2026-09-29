"use client";

/**
 * Ronde 56 — dialog "Kirim link via Email" untuk project.
 * Dulu link portal klien hanya bisa DISALIN ke clipboard (copyPortalLink) lalu
 * dikirim manual via WhatsApp/email pribadi. Kini ada pengiriman resmi dari UI:
 * - Input email klien tujuan (prefill bila kontak email tersedia pada data project).
 * - Checkbox konfirmasi legal WAJIB — pengiriman terekam sebagai korespondensi resmi.
 * - POST /api/projects/[id]/email-link → terkirim nyata via SMTP kanal brand,
 *   atau tersimulasi bila kanal demo (status "simulated" → toast warning).
 */

import { useEffect, useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface ProjectEmailLinkDialogProps {
  projectId: string;
  projectName: string;
  /** Prefill email klien bila tersedia (mis. kontak utama perusahaan) — boleh null. */
  companyEmail?: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Dipanggil setelah pengiriman berhasil diproses (sent/simulated). */
  onSent?: () => void;
}

export function ProjectEmailLinkDialog({
  projectId,
  projectName,
  companyEmail,
  open,
  onOpenChange,
  onSent,
}: ProjectEmailLinkDialogProps) {
  const [email, setEmail] = useState("");
  const [confirmLegal, setConfirmLegal] = useState(false);
  const [sending, setSending] = useState(false);

  // Setiap kali dialog dibuka: reset form + prefill email klien dari prop.
  useEffect(() => {
    if (open) {
      setEmail(companyEmail ?? "");
      setConfirmLegal(false);
      setSending(false);
    }
  }, [open, companyEmail]);

  async function handleSubmit() {
    const recipient = email.trim();
    if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      toast.error("Isi alamat email klien tujuan yang valid");
      return;
    }
    if (!confirmLegal) {
      toast.error("Centang konfirmasi syarat & ketentuan pengiriman terlebih dahulu");
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/email-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: recipient, confirmLegal: true }),
      });
      if (res.ok) {
        const data = (await res.json()) as { status?: string; note?: string; link?: string };
        const status = data.status ?? "sent";
        toast.success(`Link project terkirim via email (${status})`);
        // Kanal demo → email tidak benar-benar terkirim; beri tahu user dengan jujur.
        if (status === "simulated") {
          toast.warning("Kanal email demo — email tersimulasi, tidak terkirim nyata");
        }
        onSent?.();
        onOpenChange(false);
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(data?.error ?? "Gagal mengirim link project via email");
      }
    } catch {
      toast.error("Gagal mengirim link project via email");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // Cegah menutup paksa saat pengiriman sedang berjalan.
        if (!v && sending) return;
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-zinc-500" aria-hidden /> Kirim link via Email
          </DialogTitle>
          <DialogDescription>
            Kirim link portal klien untuk project{" "}
            <span className="font-medium text-zinc-700">{projectName}</span> ke email klien. Link bersifat privat
            untuk klien tersebut dan pengiriman tercatat sebagai korespondensi resmi.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-1.5">
            <Label htmlFor="email-link-recipient">Email klien tujuan</Label>
            <Input
              id="email-link-recipient"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email klien tujuan"
              disabled={sending}
              aria-label="Email klien tujuan"
            />
          </div>
          <div
            className={cn(
              "flex items-start gap-2.5 rounded-lg border border-zinc-200 bg-zinc-50 p-3",
              sending && "opacity-60",
            )}
          >
            <Checkbox
              id="email-link-confirm"
              checked={confirmLegal}
              onCheckedChange={(v) => setConfirmLegal(v === true)}
              disabled={sending}
              className="mt-0.5"
            />
            <Label
              htmlFor="email-link-confirm"
              className="cursor-pointer text-xs font-normal leading-relaxed text-zinc-600"
            >
              Saya konfirmasi bahwa link project ini akan dikirim ke email klien yang berhak, dan saya setuju bahwa
              pengiriman ini terekam sebagai korespondensi resmi perusahaan (terms: link bersifat privat untuk klien
              tersebut). <span className="text-rose-600">*</span>
            </Label>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Batal
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={sending}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {sending ? "Mengirim…" : "Kirim Email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
