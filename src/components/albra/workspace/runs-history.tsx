"use client";

/**
 * ALBRA — Historial de ciclos de vida (runs) del producto con polling bajo demanda.
 */

import { useCallback, useEffect, useState } from "react";
import { History, RefreshCw } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RunSteps } from "@/components/albra/run-steps";
import { api, fmtDate } from "@/hooks/use-albra";
import type { LifecycleRunDTO, RunStatus } from "@/lib/albra/api-types";

const STATUS_BADGE: Record<RunStatus, string> = {
  SUCCESS: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  WARNING: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  FAILURE: "border-red-500/40 bg-red-500/10 text-red-400",
  ROLLED_BACK: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  RUNNING: "border-amber-500/40 bg-amber-500/10 text-amber-400 animate-pulse",
};

const STATUS_LABEL: Record<RunStatus, string> = {
  SUCCESS: "ÉXITO",
  WARNING: "CON AVISOS",
  FAILURE: "FALLO",
  ROLLED_BACK: "REVERTIDO",
  RUNNING: "EN CURSO",
};

export function RunsHistory({ productId }: { productId: string }) {
  const [runs, setRuns] = useState<LifecycleRunDTO[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ runs: LifecycleRunDTO[] }>(`/api/runs?productId=${productId}&limit=20`);
      setRuns(data.runs ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <History className="size-5 text-emerald-400" />
          <h3 className="text-sm font-semibold text-zinc-100">Ciclo de vida · historial de operaciones</h3>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void load()}
          disabled={loading}
          className="border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-800 hover:text-zinc-50"
        >
          <RefreshCw className={`size-4 ${loading ? "animate-spin text-amber-400" : ""}`} />
          Refrescar
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive" className="mt-4 border-red-500/40 bg-red-500/10">
          <AlertTitle>No se pudo cargar el historial</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : runs.length === 0 && !loading ? (
        <p className="mt-4 text-xs text-zinc-500">Sin operaciones registradas todavía para este producto.</p>
      ) : (
        <Accordion type="single" collapsible className="mt-4">
          {runs.map((run) => (
            <AccordionItem key={run.id} value={run.id} className="border-zinc-800">
              <AccordionTrigger className="py-3 text-zinc-200 hover:no-underline">
                <div className="flex flex-wrap items-center gap-2 pr-2">
                  <span className="font-mono text-xs font-semibold uppercase tracking-wider text-zinc-100">
                    {run.operation}
                  </span>
                  <span className="text-zinc-600">·</span>
                  <Badge variant="outline" className={STATUS_BADGE[run.status] ?? STATUS_BADGE.RUNNING}>
                    {STATUS_LABEL[run.status] ?? run.status}
                  </Badge>
                  <span className="text-xs text-zinc-500">· {fmtDate(run.startedAt)}</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-3">
                <RunSteps steps={run.steps} running={run.status === "RUNNING"} />
                {run.error ? (
                  <Alert variant="destructive" className="border-red-500/40 bg-red-500/10">
                    <AlertTitle>La operación terminó con error</AlertTitle>
                    <AlertDescription>{run.error}</AlertDescription>
                  </Alert>
                ) : null}
                {run.status === "ROLLED_BACK" ? (
                  <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-300">
                    <AlertTitle className="text-amber-300">Operación revertida</AlertTitle>
                    <AlertDescription className="text-amber-300/80">
                      ALBRA deshizo los cambios automáticamente y restauró el estado anterior.
                    </AlertDescription>
                  </Alert>
                ) : null}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  );
}
