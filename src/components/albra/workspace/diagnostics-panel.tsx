"use client";

/**
 * ALBRA — Diagnóstico del producto: bundle de estado, hallazgos y reparaciones.
 * El bundle nunca incluye secretos (redacción automática).
 */

import { useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  Download,
  FileJson,
  Info,
  Loader2,
  ScanSearch,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api, ApiError, fmtDate } from "@/hooks/use-albra";
import type { DiagnosticsDTO, FindingDTO, ProductDetail, RepairActionDTO } from "@/lib/albra/api-types";

const SEVERITY_STYLES: Record<FindingDTO["severity"], { badge: string; icon: typeof Info; iconClass: string }> = {
  ERROR: { badge: "border-red-500/40 bg-red-500/10 text-red-400", icon: TriangleAlert, iconClass: "text-red-400" },
  WARN: { badge: "border-amber-500/40 bg-amber-500/10 text-amber-400", icon: TriangleAlert, iconClass: "text-amber-400" },
  INFO: { badge: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400", icon: Info, iconClass: "text-emerald-400" },
};

const RISK_STYLES: Record<RepairActionDTO["risk"], string> = {
  LOW: "border-zinc-700 bg-zinc-800 text-zinc-300",
  MEDIUM: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  HIGH: "border-red-500/40 bg-red-500/10 text-red-400",
};

const RISK_LABEL: Record<RepairActionDTO["risk"], string> = {
  LOW: "Riesgo bajo",
  MEDIUM: "Riesgo medio",
  HIGH: "Riesgo alto",
};

function normalizeBundle(raw: unknown, productId: string): DiagnosticsDTO | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if ("summary" in obj && "findings" in obj) return obj as unknown as DiagnosticsDTO;
  const inner = (obj.diagnostics ?? obj.bundle) as Record<string, unknown> | undefined;
  if (inner && "summary" in inner && "findings" in inner) return inner as unknown as DiagnosticsDTO;
  return { ...(obj as unknown as DiagnosticsDTO), productId };
}

export function DiagnosticsPanel({
  productId,
  detail,
  onRepaired,
}: {
  productId: string;
  detail: ProductDetail | null;
  onRepaired: () => void;
}) {
  const [bundle, setBundle] = useState<DiagnosticsDTO | null>(null);
  const [running, setRunning] = useState<boolean>(false);
  const [repairingId, setRepairingId] = useState<string | null>(null);
  const [pendingRepair, setPendingRepair] = useState<{ action: RepairActionDTO } | null>(null);

  const runDiagnostics = async () => {
    setRunning(true);
    try {
      const raw = await api<unknown>(`/api/products/${productId}/diagnostics`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const data = normalizeBundle(raw, productId);
      if (!data) {
        toast.error("Respuesta de diagnóstico inválida");
        return;
      }
      setBundle(data);
      toast.success("Diagnóstico completado");
    } catch (e) {
      const err = e as ApiError;
      if (err instanceof ApiError && err.code === "PRODUCT_BUSY") {
        toast.warning("Hay una operación en curso");
      } else {
        toast.error(err instanceof ApiError ? (err.userMessage ?? err.message) : "No se pudo ejecutar el diagnóstico");
      }
    } finally {
      setRunning(false);
    }
  };

  const executeRepair = async (action: RepairActionDTO) => {
    setRepairingId(action.actionId);
    try {
      await api(`/api/products/${productId}/repair`, {
        method: "POST",
        body: JSON.stringify({ actionId: action.actionId, confirmed: true }),
      });
      toast.success(`Reparación aplicada: ${action.label}`);
      setPendingRepair(null);
      onRepaired();
      void runDiagnostics();
    } catch (e) {
      const err = e as ApiError;
      if (err instanceof ApiError && err.code === "REPAIR_REQUIRES_CONFIRMATION") {
        toast.warning("Esta reparación requiere confirmación explícita del usuario");
      } else if (err instanceof ApiError && err.code === "PRODUCT_BUSY") {
        toast.warning("Hay una operación en curso");
      } else {
        toast.error(err instanceof ApiError ? (err.userMessage ?? err.message) : "No se pudo aplicar la reparación");
      }
    } finally {
      setRepairingId(null);
    }
  };

  const requestRepair = (action: RepairActionDTO) => {
    if (action.risk !== "LOW") {
      setPendingRepair({ action });
      return;
    }
    void executeRepair(action);
  };

  const exportBundle = () => {
    if (!bundle) return;
    try {
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `albra-diagnostics-${productId}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Bundle exportado como JSON");
    } catch {
      toast.error("No se pudo exportar el bundle");
    }
  };

  const summary = bundle?.summary;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ScanSearch className="size-5 text-emerald-400" />
            <h3 className="text-sm font-semibold text-zinc-100">Diagnóstico</h3>
          </div>
          <div className="flex gap-2">
            {bundle && (
              <Button
                size="sm"
                variant="outline"
                onClick={exportBundle}
                className="border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-800 hover:text-zinc-50"
              >
                <FileJson className="size-4" />
                Exportar bundle JSON
              </Button>
            )}
            <Button
              size="sm"
              onClick={runDiagnostics}
              disabled={running}
              className="bg-emerald-500 font-semibold text-zinc-950 hover:bg-emerald-600"
            >
              {running ? <Loader2 className="size-4 animate-spin" /> : <ScanSearch className="size-4" />}
              Ejecutar diagnóstico
            </Button>
          </div>
        </div>

        {bundle && summary ? (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { label: "Estado", value: summary.state, mono: false },
                { label: "Versión", value: `v${summary.version}`, mono: true },
                { label: "Salud", value: summary.health, mono: false },
                {
                  label: "Archivos de aplicación",
                  value: summary.appFilesOk ? "OK" : "Dañados",
                  ok: summary.appFilesOk,
                },
                { label: "Plataforma", value: summary.platform, mono: true },
                { label: "Recolectado", value: fmtDate(bundle.collectedAt), mono: false },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{item.label}</p>
                  <p
                    className={`mt-1 text-sm font-semibold break-words ${
                      item.ok === false ? "text-red-400" : item.ok === true ? "text-emerald-400" : "text-zinc-100"
                    } ${item.mono ? "font-mono text-xs" : ""}`}
                  >
                    {item.value ?? "—"}
                  </p>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                Hallazgos ({bundle.findings.length})
              </p>
              {bundle.findings.length === 0 ? (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-emerald-400">
                  <CheckCircle2 className="size-4" />
                  <p className="text-sm font-medium">Sin hallazgos. Todo en orden.</p>
                </div>
              ) : (
                bundle.findings.map((f) => {
                  const sev = SEVERITY_STYLES[f.severity] ?? SEVERITY_STYLES.INFO;
                  const SevIcon = sev.icon;
                  return (
                    <Card key={f.findingId} className="rounded-xl border-zinc-800 bg-zinc-900 p-0">
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <SevIcon className={`mt-0.5 size-4 shrink-0 ${sev.iconClass}`} />
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline" className={sev.badge}>
                                {f.severity}
                              </Badge>
                              <span className="text-sm font-semibold text-zinc-100">{f.title}</span>
                            </div>
                            <p className="text-sm text-zinc-400">{f.explain}</p>
                            <p className="font-mono text-xs text-zinc-500">code: {f.code}</p>
                            {f.repairs.length > 0 && (
                              <div className="flex flex-wrap gap-2 pt-1">
                                {f.repairs.map((r) => (
                                  <Button
                                    key={r.actionId}
                                    size="sm"
                                    variant="outline"
                                    disabled={repairingId !== null}
                                    onClick={() => requestRepair(r)}
                                    className="border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-800 hover:text-zinc-50"
                                  >
                                    {repairingId === r.actionId ? (
                                      <Loader2 className="size-3.5 animate-spin" />
                                    ) : (
                                      <Wrench className="size-3.5" />
                                    )}
                                    {r.label}
                                    <span
                                      className={`rounded-full border px-1.5 py-px text-[10px] font-medium ${RISK_STYLES[r.risk]}`}
                                    >
                                      {RISK_LABEL[r.risk]}
                                    </span>
                                  </Button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <p className="mt-4 text-xs text-zinc-500">
            Ejecuta el diagnóstico para recolectar estado, salud, configuración y hallazgos con reparaciones sugeridas.
            {detail ? "" : " (El producto no está disponible ahora mismo.)"}
          </p>
        )}

        <p className="mt-4 flex items-center gap-1.5 text-[11px] text-zinc-600">
          <Download className="size-3" />
          El bundle nunca incluye secretos (redacción automática).
        </p>
      </div>

      <AlertDialog
        open={pendingRepair !== null}
        onOpenChange={(v) => {
          if (!v) setPendingRepair(null);
        }}
      >
        <AlertDialogContent className="border-zinc-800 bg-zinc-900 text-zinc-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlert className={`size-5 ${pendingRepair?.action.risk === "HIGH" ? "text-red-400" : "text-amber-400"}`} />
              Confirmar reparación
            </AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              {pendingRepair
                ? `Reparación con riesgo ${RISK_LABEL[pendingRepair.action.risk]}: ${pendingRepair.action.description} ¿Continuar?`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-800 hover:text-zinc-50">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={repairingId !== null}
              onClick={(e) => {
                e.preventDefault();
                if (pendingRepair) void executeRepair(pendingRepair.action);
              }}
              className={
                pendingRepair?.action.risk === "HIGH"
                  ? "bg-red-500 font-semibold text-zinc-950 hover:bg-red-600"
                  : "bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-600"
              }
            >
              {repairingId ? "Aplicando…" : "Continuar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
