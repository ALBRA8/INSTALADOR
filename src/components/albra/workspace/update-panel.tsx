"use client";

/**
 * ALBRA — Panel de actualización con inyección de fallo (demo) y rollback.
 * Flujo: CHECK → DOWNLOAD → VERIFY → BACKUP → STAGE → STOP → SWAP → MIGRATE → START → HEALTH → COMMIT.
 */

import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowUpCircle,
  Database,
  History,
  Loader2,
  RefreshCw,
  UploadCloud,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { RunSteps } from "@/components/albra/run-steps";
import { api, ApiError, useRunPolling } from "@/hooks/use-albra";
import type { LifecycleRunDTO, ProductDetail } from "@/lib/albra/api-types";

type RunMode = "update" | "rollback";

export function UpdatePanel({ detail, onDone }: { detail: ProductDetail; onDone: () => void }) {
  const [targetVersion, setTargetVersion] = useState<string>("");
  const [injectFailure, setInjectFailure] = useState<boolean>(false);
  const [failureKind, setFailureKind] = useState<string>("MIGRATION");
  const [runId, setRunId] = useState<string | null>(null);
  const [posting, setPosting] = useState<boolean>(false);
  const modeRef = useRef<RunMode>("update");

  const handleFinished = (run: LifecycleRunDTO) => {
    if (modeRef.current === "update") {
      if (run.status === "SUCCESS") {
        toast.success("Actualización completada");
        onDone();
      } else if (run.status === "ROLLED_BACK") {
        toast.warning("La actualización falló; ALBRA revirtió a la versión anterior");
        onDone();
      } else {
        toast.error(run.error ?? "La actualización falló");
        onDone();
      }
    } else {
      if (run.status === "SUCCESS") {
        toast.success("Reversión completada: se restauró la versión anterior");
        onDone();
      } else {
        toast.error(run.error ?? "El rollback no se completó");
        onDone();
      }
    }
  };

  const run = useRunPolling(runId, undefined, handleFinished);
  const runFinished = Boolean(run?.finishedAt);

  const startUpdate = async () => {
    if (!targetVersion) {
      toast.warning("Elige la versión de destino");
      return;
    }
    setPosting(true);
    modeRef.current = "update";
    try {
      const body: { targetVersion: string; injectFailure?: boolean } = { targetVersion };
      if (injectFailure) body.injectFailure = true;
      const res = await api<{ runId?: string; id?: string }>(`/api/products/${detail.productId}/update`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setRunId(res.runId ?? res.id ?? null);
    } catch (e) {
      const err = e as ApiError;
      if (err instanceof ApiError && err.code === "PRODUCT_BUSY") {
        toast.warning("Hay una operación en curso");
      } else {
        toast.error(err instanceof ApiError ? (err.userMessage ?? err.message) : "No se pudo iniciar la actualización");
      }
    } finally {
      setPosting(false);
    }
  };

  const startRollback = async () => {
    setPosting(true);
    modeRef.current = "rollback";
    try {
      const res = await api<{ runId?: string; id?: string }>(`/api/products/${detail.productId}/rollback`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setRunId(res.runId ?? res.id ?? null);
    } catch (e) {
      const err = e as ApiError;
      if (err instanceof ApiError && err.code === "PRODUCT_BUSY") {
        toast.warning("Hay una operación en curso");
      } else {
        toast.error(err instanceof ApiError ? (err.userMessage ?? err.message) : "No se pudo iniciar el rollback");
      }
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-6">
        <div className="flex items-center gap-2">
          <ArrowUpCircle className="size-5 text-emerald-400" />
          <h3 className="text-sm font-semibold text-zinc-100">Actualizar {detail.displayName}</h3>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-xs text-zinc-500">Versión actual</span>
          <span className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-lg font-bold tracking-tight text-emerald-400">
            v{detail.version}
          </span>
        </div>

        {detail.updates.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {detail.updates.map((u) => (
              <li
                key={u.version}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3"
              >
                <span className="text-sm font-semibold text-zinc-100">v{u.version}</span>
                {u.hasMigration ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-400">
                    <Database className="size-3" />
                    incluye migración de datos
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-xs text-zinc-500">Estás en la última versión disponible.</p>
        )}

        {detail.updates.length > 0 && (
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label className="text-zinc-300">Versión de destino</Label>
              <Select value={targetVersion} onValueChange={setTargetVersion}>
                <SelectTrigger className="w-full border-zinc-700 bg-zinc-800 sm:w-72">
                  <SelectValue placeholder="Selecciona la versión…" />
                </SelectTrigger>
                <SelectContent className="border-zinc-700 bg-zinc-900 text-zinc-100">
                  {detail.updates.map((u) => (
                    <SelectItem key={u.version} value={u.version}>
                      v{u.version}
                      {u.hasMigration ? " — con migración" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Switch
                id="inject-failure"
                checked={injectFailure}
                onCheckedChange={setInjectFailure}
                className="data-[state=checked]:bg-amber-500"
              />
              <Label htmlFor="inject-failure" className="text-zinc-300">
                Inyección de fallo <span className="text-zinc-500">(modo prueba)</span>
              </Label>
            </div>

            {injectFailure && (
              <div className="space-y-2">
                <Label className="text-zinc-300">Tipo de fallo inyectado</Label>
                <Select value={failureKind} onValueChange={setFailureKind}>
                  <SelectTrigger className="w-full border-zinc-700 bg-zinc-800 sm:w-72">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-zinc-700 bg-zinc-900 text-zinc-100">
                    <SelectItem value="MIGRATION">Fallo de migración</SelectItem>
                    <SelectItem value="START">Fallo de arranque</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <Button
              onClick={startUpdate}
              disabled={posting || (run !== null && !runFinished)}
              className="bg-emerald-500 font-semibold text-zinc-950 hover:bg-emerald-600"
            >
              {posting || (run && !runFinished) ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <UploadCloud className="size-4" />
              )}
              Actualizar
            </Button>
          </div>
        )}

        {run && (
          <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <p className="mb-3 flex items-center gap-2 text-xs font-medium text-zinc-400">
              {modeRef.current === "rollback" ? "Reversión" : "Actualización"}
              {runFinished ? " — finalizada" : " — en progreso"}
            </p>
            <RunSteps steps={run.steps} running={!runFinished} />
            {modeRef.current === "update" && run.status === "ROLLED_BACK" && (
              <Alert className="mt-3 border-amber-500/40 bg-amber-500/10 text-amber-300">
                <AlertTriangle className="size-4" />
                <AlertTitle>La actualización falló</AlertTitle>
                <AlertDescription className="text-amber-300/80">
                  La actualización falló y ALBRA revirtió automáticamente a la versión anterior. Tus datos no se
                  perdieron.
                </AlertDescription>
              </Alert>
            )}
            {modeRef.current === "update" && run.status === "FAILURE" && (
              <Alert variant="destructive" className="mt-3 border-red-500/40 bg-red-500/10">
                <AlertTriangle className="size-4" />
                <AlertTitle>La actualización falló</AlertTitle>
                <AlertDescription>{run.error ?? "Error desconocido durante la actualización."}</AlertDescription>
              </Alert>
            )}
            {modeRef.current === "rollback" && run.status === "FAILURE" && (
              <Alert variant="destructive" className="mt-3 border-red-500/40 bg-red-500/10">
                <AlertTriangle className="size-4" />
                <AlertTitle>El rollback falló</AlertTitle>
                <AlertDescription>{run.error ?? "No se pudo revertir a la versión anterior."}</AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </div>

      <Separator className="bg-zinc-800" />

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-6">
        <div className="flex items-center gap-2">
          <History className="size-5 text-emerald-400" />
          <h3 className="text-sm font-semibold text-zinc-100">Rollback</h3>
        </div>

        {detail.rollbackAvailable ? (
          <Alert className="mt-4 border-amber-500/30 bg-amber-500/5 text-amber-300">
            <History className="size-4" />
            <AlertTitle>Versión anterior disponible</AlertTitle>
            <AlertDescription className="text-zinc-400">
              ALBRA conserva la versión anterior en la bóveda. Puedes revertir la última actualización cuando quieras.
              <div className="mt-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={startRollback}
                  disabled={posting || (run !== null && !runFinished)}
                  className="border-amber-500/40 bg-transparent text-amber-300 hover:bg-amber-500/10 hover:text-amber-200"
                >
                  {posting || (run !== null && !runFinished) ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                  Revertir última actualización
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : (
          <p className="mt-2 text-xs text-zinc-500">No hay una versión anterior disponible para revertir.</p>
        )}
      </div>

      <p className="font-mono text-[11px] text-zinc-600">
        El flujo es CHECK → DOWNLOAD → VERIFY → BACKUP → STAGE → STOP → SWAP → MIGRATE → START → HEALTH → COMMIT.
      </p>
    </div>
  );
}
