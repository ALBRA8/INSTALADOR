"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck,
  CheckCircle2,
  Circle,
  Loader2,
  MinusCircle,
  ShieldAlert,
  TriangleAlert,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError, api, fetchCertification, fmtDate, useRunPolling } from "@/hooks/use-albra";
import type {
  CertificationDTO,
  CertificationStepDTO,
  RunStepDTO,
} from "@/lib/albra/api-types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/** Vista de paso de certificación; extiende CertificationStepDTO con estado en vivo. */
interface CertStepView {
  step: string;
  label: string;
  status: CertificationStepDTO["status"];
  detail?: string;
  durationMs: number;
  live?: "running" | "pending";
}

/** Mapea RunStepDTO (ciclo de vida) a la vista de certificación. */
function toCertStep(s: RunStepDTO): CertStepView {
  return {
    step: s.step,
    label: s.label,
    status:
      s.status === "SUCCESS" ? "PASS" : s.status === "FAILURE" ? "FAIL" : "SKIP",
    detail: s.detail,
    durationMs: s.durationMs ?? 0,
    live: s.status === "RUNNING" ? "running" : s.status === "PENDING" ? "pending" : undefined,
  };
}

function StepIcon({ s }: { s: CertStepView }) {
  if (s.live === "running") {
    return <Loader2 aria-hidden className="mt-0.5 size-4 shrink-0 animate-spin text-amber-400" />;
  }
  if (s.live === "pending") {
    return <Circle aria-hidden className="mt-0.5 size-4 shrink-0 text-zinc-700" />;
  }
  const map: Record<CertStepView["status"], { Icon: LucideIcon; className: string }> = {
    PASS: { Icon: CheckCircle2, className: "text-emerald-500" },
    FAIL: { Icon: XCircle, className: "text-red-500" },
    SKIP: { Icon: MinusCircle, className: "text-zinc-600" },
  };
  const { Icon, className } = map[s.status];
  return <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", className)} />;
}

function StepRow({ s }: { s: CertStepView }) {
  return (
    <li className="flex items-start gap-2.5">
      <StepIcon s={s} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "text-sm",
              s.live === "pending" ? "text-zinc-500" : "text-zinc-200"
            )}
          >
            {s.label}
          </span>
          <span className="ml-auto shrink-0 font-mono text-[11px] text-zinc-600">
            {s.durationMs} ms
          </span>
        </div>
        {s.detail && (
          <p className="break-words font-mono text-xs text-zinc-500">{s.detail}</p>
        )}
      </div>
    </li>
  );
}

/** Respuesta tolerante de POST /api/certification. */
interface CertificationStartResponse {
  runId?: string;
  id?: string;
  run?: { id?: string };
}

export function CertificationDialog({
  open,
  onOpenChange,
  onFinished,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onFinished: () => void;
}) {
  const [prev, setPrev] = useState<CertificationDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPrev(await fetchCertification("crm"));
    } catch {
      setPrev(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setRunId(null);
    void load();
  }, [open, load]);

  const run = useRunPolling(runId, undefined, (finishedRun) => {
    if (finishedRun.status === "SUCCESS") {
      toast.success("ALBRA CERTIFIED — suite completada con éxito");
    } else {
      toast.error("La certificación falló. Revisa los pasos.");
    }
    onFinished();
  });

  const start = async () => {
    setStarting(true);
    try {
      const res = await api<CertificationStartResponse>("/api/certification", {
        method: "POST",
        body: JSON.stringify({ productId: "crm" }),
      });
      const id = res.runId ?? res.id ?? res.run?.id ?? null;
      if (!id) throw new ApiError(500, "NO_RUN", "La certificación no devolvió un run válido.");
      setRunId(id);
    } catch (e: unknown) {
      const err = e as ApiError;
      toast.error(err.userMessage ?? err.message);
    } finally {
      setStarting(false);
    }
  };

  const running = runId != null && run?.finishedAt == null;
  const liveSteps = run?.steps.map(toCertStep) ?? null;
  const finishedOk = run?.finishedAt != null && run.status === "SUCCESS";
  const finishedBad = run?.finishedAt != null && run.status !== "SUCCESS";
  const showPrev = !runId && prev != null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl border-zinc-800 bg-zinc-950 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">Certificación ALBRA</DialogTitle>
          <DialogDescription className="text-zinc-400">
            Suite de certificación en vivo del producto <span className="font-mono">crm</span>.
          </DialogDescription>
        </DialogHeader>

        {/* Advertencia */}
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-400">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          La suite ejecuta el ciclo de vida completo (2-3 min) incluyendo instalación,
          actualización, rollback y desinstalación real.
        </p>

        {loading && (
          <div className="flex items-center gap-2 py-4 text-sm text-zinc-400">
            <Loader2 className="size-4 animate-spin text-amber-400" aria-hidden />
            Cargando resultado previo…
          </div>
        )}

        {/* Resultado en vivo */}
        {runId && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {run?.finishedAt == null ? (
                <Badge className="gap-1 border-amber-500/30 bg-amber-500/10 text-amber-400">
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                  Certificando…
                </Badge>
              ) : finishedOk ? (
                <Badge className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                  <BadgeCheck className="size-3" aria-hidden />
                  ALBRA CERTIFIED
                </Badge>
              ) : (
                <Badge className="gap-1 border-red-500/30 bg-red-500/10 text-red-400">
                  <ShieldAlert className="size-3" aria-hidden />
                  NO CERTIFICADO
                </Badge>
              )}
              <span className="text-xs text-zinc-600" title={fmtDate(run?.startedAt)}>
                run <span className="font-mono">{runId.slice(0, 8)}</span>
              </span>
            </div>
            <ul className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900 p-3 pr-1">
              {(liveSteps ?? []).map((s, i) => (
                <StepRow key={`${s.step}-${i}`} s={s} />
              ))}
            </ul>
          </div>
        )}

        {/* Resultado previo */}
        {showPrev && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {prev?.passed ? (
                <Badge className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                  <BadgeCheck className="size-3" aria-hidden />
                  ALBRA CERTIFIED
                </Badge>
              ) : (
                <Badge className="gap-1 border-red-500/30 bg-red-500/10 text-red-400">
                  <ShieldAlert className="size-3" aria-hidden />
                  NO CERTIFICADO
                </Badge>
              )}
              <span className="text-xs text-zinc-600">
                {prev?.finishedAt ? `Última ejecución: ${fmtDate(prev.finishedAt)}` : "Sin resultado"}
              </span>
            </div>
            <ul className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900 p-3 pr-1">
              {(prev?.steps ?? []).map((s) => (
                <StepRow key={s.step} s={{ ...s, live: undefined }} />
              ))}
            </ul>
          </div>
        )}

        {!loading && !runId && !prev && (
          <p className="py-2 text-sm text-zinc-500">
            Este producto aún no ha sido certificado. Ejecuta la suite para generarlo.
          </p>
        )}

        <DialogFooter>
          <Button
            onClick={() => void start()}
            disabled={starting || running}
            className="bg-emerald-600 text-white hover:bg-emerald-500"
          >
            {starting || running ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <BadgeCheck aria-hidden />
            )}
            {running ? "Certificando…" : "Ejecutar certificación"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
