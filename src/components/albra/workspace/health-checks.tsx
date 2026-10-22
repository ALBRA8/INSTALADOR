"use client";

/**
 * ALBRA — Salud del producto: resumen general + grilla de checks.
 */

import {
  AlertTriangle,
  CheckCircle2,
  MinusCircle,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { HealthCheckDTO } from "@/lib/albra/api-types";

const OVERALL_STYLES: Record<string, string> = {
  HEALTHY: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  DEGRADED: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  FAILED: "border-red-500/40 bg-red-500/10 text-red-400",
  UNKNOWN: "border-zinc-700 bg-zinc-800 text-zinc-400",
};

const STATUS_ICON: Record<HealthCheckDTO["status"], { icon: typeof CheckCircle2; className: string }> = {
  PASS: { icon: CheckCircle2, className: "text-emerald-400" },
  WARN: { icon: AlertTriangle, className: "text-amber-400" },
  FAIL: { icon: XCircle, className: "text-red-400" },
  SKIP: { icon: MinusCircle, className: "text-zinc-500" },
};

export function HealthChecks({
  checks,
  overall,
  onRefresh,
  refreshing,
}: {
  checks: HealthCheckDTO[];
  overall: string;
  onRefresh: () => void;
  refreshing?: boolean;
}) {
  const OverallIcon = overall === "HEALTHY" ? ShieldCheck : AlertTriangle;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <OverallIcon className="size-5 text-emerald-400" />
          <h3 className="text-sm font-semibold text-zinc-100">Salud del producto</h3>
          <Badge variant="outline" className={OVERALL_STYLES[overall] ?? OVERALL_STYLES.UNKNOWN}>
            {overall}
          </Badge>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onRefresh}
          disabled={refreshing}
          className="border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-800 hover:text-zinc-50"
        >
          <RefreshCw className={`size-4 ${refreshing ? "animate-spin text-amber-400" : ""}`} />
          Verificar ahora
        </Button>
      </div>

      {checks.length === 0 ? (
        <p className="mt-4 text-xs text-zinc-500">
          Sin checks registrados todavía. Ejecuta «Verificar ahora» para evaluar la salud.
        </p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {checks.map((check) => {
            const meta = STATUS_ICON[check.status] ?? STATUS_ICON.SKIP;
            const Icon = meta.icon;
            return (
              <div
                key={check.checkId}
                className="flex gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4"
              >
                <Icon className={`mt-0.5 size-4 shrink-0 ${meta.className}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium text-zinc-100">{check.label}</span>
                    <span className="rounded-full border border-zinc-700 bg-zinc-800 px-1.5 py-px font-mono text-[10px] text-zinc-400">
                      {check.target}
                    </span>
                    {check.critical ? (
                      <span className="text-xs font-medium text-amber-400">crítico</span>
                    ) : null}
                  </div>
                  {check.detail ? (
                    <p className="mt-1 break-words text-xs text-zinc-500">{check.detail}</p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
