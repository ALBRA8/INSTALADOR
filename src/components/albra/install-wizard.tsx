"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Rocket,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RunSteps } from "@/components/albra/run-steps";
import { ApiError, api, useRunPolling } from "@/hooks/use-albra";
import type {
  CatalogItem,
  LifecycleRunDTO,
  PreflightIssueDTO,
  PreflightReportDTO,
} from "@/lib/albra/api-types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Phase = "preflight" | "confirm" | "running" | "done";

const ISSUE_ICON: Record<PreflightIssueDTO["severity"], { Icon: LucideIcon; className: string }> = {
  BLOCKER: { Icon: XCircle, className: "text-red-500" },
  WARNING: { Icon: AlertTriangle, className: "text-amber-500" },
  RESOLVED: { Icon: CheckCircle2, className: "text-emerald-700" },
};

/** Respuesta tolerante de POST /api/install (según forma del backend). */
interface InstallStartResponse {
  runId?: string;
  id?: string;
  run?: { id?: string };
}

export function InstallWizard({
  open,
  onOpenChange,
  item,
  onInstalled,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  item: CatalogItem | null;
  onInstalled: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("preflight");
  const [preflight, setPreflight] = useState<PreflightReportDTO | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [finished, setFinished] = useState<LifecycleRunDTO | null>(null);

  const productId = item?.productId ?? null;

  // Preflight al abrir el asistente.
  useEffect(() => {
    if (!open || !productId) return;
    setPhase("preflight");
    setPreflight(null);
    setPreflightError(null);
    setRunId(null);
    setInstalling(false);
    setFinished(null);
    let cancelled = false;
    api<PreflightReportDTO>("/api/preflight", {
      method: "POST",
      body: JSON.stringify({ packageId: productId }),
    })
      .then((r) => {
        if (!cancelled) setPreflight(r);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const err = e as ApiError;
        setPreflightError(err.userMessage ?? err.message);
        toast.error(err.userMessage ?? err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [open, productId]);

  const startInstall = async () => {
    if (!item) return;
    setInstalling(true);
    try {
      const res = await api<InstallStartResponse>("/api/install", {
        method: "POST",
        body: JSON.stringify({ packageId: item.productId }),
      });
      const id = res.runId ?? res.id ?? res.run?.id ?? null;
      if (!id) throw new ApiError(500, "NO_RUN", "El instalador no devolvió un run válido.");
      setRunId(id);
      setPhase("running");
    } catch (e: unknown) {
      const err = e as ApiError;
      toast.error(err.userMessage ?? err.message);
    } finally {
      setInstalling(false);
    }
  };

  const run = useRunPolling(phase === "running" ? runId : null, undefined, (finishedRun) => {
    setFinished(finishedRun);
    setPhase("done");
    if (finishedRun.status === "SUCCESS") {
      toast.success(`${item?.displayName ?? "Producto"} instalado correctamente`);
    }
  });

  const ok = preflight?.ok === true;
  const runFinished = phase === "running" ? run?.finishedAt != null : false;
  const runSuccess = run?.status === "SUCCESS";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-zinc-800 bg-zinc-950 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">
            {phase === "done" && runSuccess
              ? "Instalación completada"
              : phase === "done"
                ? "La instalación falló"
                : `Instalar ${item?.displayName ?? "producto"}`}
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            {phase === "preflight" && "Verificando requisitos del sistema antes de instalar."}
            {phase === "confirm" && "Revisa el resumen y confirma la instalación."}
            {phase === "running" && "Ejecutando el instalador con transacción PREPARE / STAGE / COMMIT."}
            {phase === "done" &&
              (runSuccess
                ? "El producto quedó instalado y disponible en el catálogo."
                : "El instalador revirtió los cambios; revisa el detalle técnico.")}
          </DialogDescription>
        </DialogHeader>

        {/* ── Fase: preflight ── */}
        {phase === "preflight" && (
          <div className="space-y-4">
            {!preflight && !preflightError && (
              <div className="flex items-center gap-3 py-6 text-sm text-zinc-400">
                <Loader2 className="size-4 animate-spin text-amber-400" aria-hidden />
                Ejecutando preflight…
              </div>
            )}
            {preflightError && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {preflightError}
              </div>
            )}
            {preflight && (
              <>
                {!ok && (
                  <p className="flex items-center gap-2 text-sm font-medium text-red-400">
                    <AlertTriangle className="size-4" aria-hidden />
                    No se puede instalar
                  </p>
                )}
                <ul className="max-h-48 space-y-2 overflow-y-auto">
                  {preflight.issues.map((issue, i) => {
                    const { Icon, className } = ISSUE_ICON[issue.severity];
                    return (
                      <li key={`${issue.code}-${i}`} className="flex items-start gap-2 text-sm">
                        <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", className)} />
                        <div className="min-w-0">
                          <span className="text-zinc-200">{issue.message}</span>{" "}
                          <span className="font-mono text-xs text-zinc-500">{issue.code}</span>
                        </div>
                      </li>
                    );
                  })}
                  {preflight.issues.length === 0 && (
                    <li className="text-sm text-zinc-400">Sin incidencias detectadas.</li>
                  )}
                </ul>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2.5">
                    <p className="text-[11px] uppercase tracking-wide text-zinc-500">Adaptador</p>
                    <p className="truncate text-sm text-zinc-100">{preflight.platform.adapterLabel}</p>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2.5">
                    <p className="text-[11px] uppercase tracking-wide text-zinc-500">Disco libre</p>
                    <p className="text-sm text-zinc-100">{preflight.platform.freeDiskMB} MB</p>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2.5">
                    <p className="text-[11px] uppercase tracking-wide text-zinc-500">Puerto</p>
                    <p className="font-mono text-sm text-zinc-100">
                      {preflight.assignedPort ?? item?.port ?? "auto"}
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Fase: confirm ── */}
        {phase === "confirm" && item && preflight && (
          <div className="space-y-3">
            <div className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-900">
              <div className="flex items-center justify-between p-3 text-sm">
                <span className="text-zinc-500">Producto</span>
                <span className="text-zinc-100">{item.displayName}</span>
              </div>
              <div className="flex items-center justify-between p-3 text-sm">
                <span className="text-zinc-500">Versión</span>
                <span className="font-mono text-zinc-100">
                  {item.latestVersion ?? item.installedVersion ?? "—"}
                </span>
              </div>
              <div className="flex items-center justify-between p-3 text-sm">
                <span className="text-zinc-500">Puerto</span>
                <span className="font-mono text-zinc-100">
                  {preflight.assignedPort ?? item.port ?? "auto"}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ── Fase: running ── */}
        {phase === "running" && (
          <div className="min-h-24 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
            <RunSteps steps={run?.steps ?? []} running={!runFinished} />
          </div>
        )}

        {/* ── Fase: done ── */}
        {phase === "done" && runSuccess && (
          <div className="flex flex-col items-center gap-3 py-4">
            <CheckCircle2 className="size-12 text-emerald-500" aria-hidden />
            <p className="text-sm text-zinc-300">
              {item?.displayName ?? "Producto"} v{item?.latestVersion ?? item?.installedVersion ?? "?"} quedó
              instalado correctamente.
            </p>
          </div>
        )}
        {phase === "done" && !runSuccess && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
              <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{finished?.error ?? run?.error ?? "Error desconocido durante la instalación."}</span>
            </div>
            <div className="max-h-48 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900 p-3">
              <RunSteps steps={run?.steps ?? []} />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {phase === "preflight" && ok && (
            <Button
              onClick={() => setPhase("confirm")}
              className="bg-emerald-600 text-white hover:bg-emerald-500"
            >
              Continuar
            </Button>
          )}
          {phase === "preflight" && (!ok || preflightError) && (
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
            >
              Cerrar
            </Button>
          )}
          {phase === "confirm" && (
            <>
              <Button
                variant="outline"
                onClick={() => setPhase("preflight")}
                disabled={installing}
                className="border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
              >
                Atrás
              </Button>
              <Button
                onClick={() => void startInstall()}
                disabled={installing}
                className="bg-emerald-600 text-white hover:bg-emerald-500"
              >
                {installing ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Rocket aria-hidden />
                )}
                INSTALAR
              </Button>
            </>
          )}
          {phase === "running" && (
            <Button disabled className="gap-2 bg-zinc-800 text-zinc-300">
              <Loader2 className="animate-spin" aria-hidden />
              Trabajando…
            </Button>
          )}
          {phase === "done" && runSuccess && (
            <Button
              onClick={() => {
                onInstalled();
                onOpenChange(false);
              }}
              className="bg-emerald-600 text-white hover:bg-emerald-500"
            >
              ABRIR PRODUCTO
            </Button>
          )}
          {phase === "done" && !runSuccess && (
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
            >
              Cerrar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
