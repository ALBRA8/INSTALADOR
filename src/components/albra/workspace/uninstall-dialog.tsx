"use client";

/**
 * ALBRA — Diálogo de desinstalación con elección de destino de datos
 * (KEEP / EXPORT / DELETE) y seguimiento del run en vivo.
 */

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Archive, CheckCircle2, Database, Loader2, Trash2, XCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { RunSteps } from "@/components/albra/run-steps";
import { api, ApiError, useRunPolling } from "@/hooks/use-albra";
import type { LifecycleRunDTO } from "@/lib/albra/api-types";

type DataMode = "KEEP" | "EXPORT" | "DELETE";

export function UninstallDialog({
  open,
  onOpenChange,
  productId,
  displayName,
  onUninstalled,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  productId: string;
  displayName: string;
  onUninstalled: () => void;
}) {
  const [dataMode, setDataMode] = useState<DataMode>("KEEP");
  const [acknowledged, setAcknowledged] = useState<boolean>(false);
  const [phase, setPhase] = useState<"form" | "running">("form");
  const [runId, setRunId] = useState<string | null>(null);
  const [posting, setPosting] = useState<boolean>(false);

  const reset = () => {
    setPhase("form");
    setRunId(null);
    setAcknowledged(false);
    setDataMode("KEEP");
  };

  const handleFinished = (run: LifecycleRunDTO) => {
    if (run.status === "SUCCESS") {
      toast.success(`${displayName} se desinstaló correctamente`);
      onUninstalled();
      onOpenChange(false);
      reset();
    } else {
      toast.error(run.error ?? "La desinstalación no se completó");
      setPhase("form");
      setRunId(null);
    }
  };

  const run = useRunPolling(runId, undefined, handleFinished);

  const uninstall = async () => {
    setPosting(true);
    try {
      const res = await api<{ runId?: string; id?: string }>(`/api/products/${productId}/uninstall`, {
        method: "POST",
        body: JSON.stringify({ dataMode }),
      });
      setRunId(res.runId ?? res.id ?? null);
      setPhase("running");
    } catch (e) {
      const err = e as ApiError;
      if (err instanceof ApiError && err.code === "PRODUCT_BUSY") {
        toast.warning("Hay una operación en curso");
      } else {
        toast.error(err instanceof ApiError ? (err.userMessage ?? err.message) : "No se pudo iniciar la desinstalación");
      }
    } finally {
      setPosting(false);
    }
  };

  const MODES: Array<{ value: DataMode; label: string; note?: string; danger?: boolean; icon: typeof Database }> = [
    {
      value: "KEEP",
      label: "Conservar datos (podrás reinstalar y recuperarlos)",
      icon: Database,
    },
    {
      value: "EXPORT",
      label: "Exportar datos y eliminar",
      note: "Se descarga una copia en la carpeta exports/ antes de borrar.",
      icon: Archive,
    },
    {
      value: "DELETE",
      label: "Eliminar todos los datos permanentemente",
      danger: true,
      icon: Trash2,
    },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && phase === "running") return; // no cerrar durante el run
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-xl border-zinc-800 bg-zinc-900 text-zinc-100 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-400">
            <AlertTriangle className="size-5" />
            Desinstalar {displayName}
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            Elige qué hacer con los datos del producto. La aplicación se eliminará de esta máquina; los datos puedes
            conservarlos, exportarlos o borrarlos.
          </DialogDescription>
        </DialogHeader>

        {phase === "running" ? (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-xs font-medium text-amber-400">
              <Loader2 className="size-4 animate-spin" />
              Desinstalación en curso…
            </p>
            <RunSteps steps={run?.steps ?? []} running />
          </div>
        ) : (
          <div className="space-y-4">
            <RadioGroup value={dataMode} onValueChange={(v) => setDataMode(v as DataMode)} className="gap-3">
              {MODES.map((m) => {
                const Icon = m.icon;
                return (
                  <Label
                    key={m.value}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
                      dataMode === m.value
                        ? m.danger
                          ? "border-red-500/50 bg-red-500/10"
                          : "border-emerald-500/50 bg-emerald-500/5"
                        : "border-zinc-800 bg-zinc-900 hover:bg-zinc-800/60"
                    }`}
                  >
                    <RadioGroupItem
                      value={m.value}
                      className={m.danger ? "mt-0.5 border-red-500/60 text-red-400" : "mt-0.5"}
                    />
                    <div className="min-w-0 flex-1">
                      <span className={`flex items-center gap-2 text-sm font-medium ${m.danger ? "text-red-400" : "text-zinc-100"}`}>
                        <Icon className={`size-4 ${m.danger ? "text-red-400" : "text-zinc-400"}`} />
                        {m.label}
                      </span>
                      {m.note ? <span className="mt-1 block text-xs text-zinc-500">{m.note}</span> : null}
                    </div>
                  </Label>
                );
              })}
            </RadioGroup>

            <Label className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <Checkbox
                checked={acknowledged}
                onCheckedChange={(v) => setAcknowledged(v === true)}
                className="mt-0.5 border-zinc-600 data-[state=checked]:border-red-500 data-[state=checked]:bg-red-500 data-[state=checked]:text-zinc-950"
              />
              <span className="text-sm text-zinc-300">
                Entiendo que {displayName} se eliminará de esta máquina
              </span>
            </Label>

            {dataMode === "DELETE" && (
              <Alert variant="destructive" className="border-red-500/40 bg-red-500/10">
                <XCircle className="size-4" />
                <AlertTitle className="text-red-400">Borrado permanente</AlertTitle>
                <AlertDescription>
                  Los datos de {displayName} se eliminarán de forma definitiva. No habrá forma de recuperarlos.
                </AlertDescription>
              </Alert>
            )}
            {dataMode === "KEEP" && (
              <Alert className="border-emerald-500/30 bg-emerald-500/5 text-emerald-300">
                <CheckCircle2 className="size-4" />
                <AlertTitle className="text-emerald-300">Datos a salvo</AlertTitle>
                <AlertDescription>
                  Podrás reinstalar {displayName} más adelante y recuperar tus datos tal como están.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            disabled={phase === "running" || posting}
            onClick={() => {
              onOpenChange(false);
              reset();
            }}
            className="border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-800 hover:text-zinc-50"
          >
            Cancelar
          </Button>
          <Button
            disabled={!acknowledged || phase === "running" || posting}
            onClick={uninstall}
            className="bg-red-500 font-semibold text-zinc-950 hover:bg-red-600 disabled:opacity-50"
          >
            {posting || phase === "running" ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            Desinstalar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
