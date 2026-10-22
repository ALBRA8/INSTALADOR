"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  MinusCircle,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import type { RunStepDTO, RunStepStatus } from "@/lib/albra/api-types";
import { cn } from "@/lib/utils";

function stepIcon(status: RunStepStatus): { Icon: LucideIcon; className: string } {
  switch (status) {
    case "RUNNING":
      return { Icon: Loader2, className: "animate-spin text-amber-400" };
    case "SUCCESS":
      return { Icon: CheckCircle2, className: "text-emerald-500" };
    case "WARNING":
      return { Icon: AlertTriangle, className: "text-amber-500" };
    case "FAILURE":
      return { Icon: XCircle, className: "text-red-500" };
    case "SKIPPED":
      return { Icon: MinusCircle, className: "text-zinc-600" };
    case "PENDING":
    default:
      return { Icon: Circle, className: "text-zinc-700" };
  }
}

export function RunSteps({ steps, running }: { steps: RunStepDTO[]; running?: boolean }) {
  if (steps.length === 0 && !running) return null;

  return (
    <div className="space-y-2">
      <ol className="space-y-2">
        {steps.map((s, i) => {
          const { Icon, className } = stepIcon(s.status);
          return (
            <li key={`${s.step}-${i}`} className="flex items-start gap-2.5">
              <Icon
                aria-hidden
                className={cn("mt-0.5 size-4 shrink-0", className)}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span
                    className={cn(
                      "text-sm",
                      s.status === "PENDING" || s.status === "SKIPPED"
                        ? "text-zinc-500"
                        : "text-zinc-200"
                    )}
                  >
                    {s.label}
                  </span>
                  {s.durationMs != null && (
                    <span className="ml-auto shrink-0 font-mono text-[11px] text-zinc-600">
                      {s.durationMs} ms
                    </span>
                  )}
                </div>
                {s.detail && (
                  <p className="break-words font-mono text-xs text-zinc-500">{s.detail}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {running && (
        <p className="flex items-center gap-2 pt-1 text-xs text-amber-400">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          <span className="animate-pulse">Ejecutando…</span>
        </p>
      )}
    </div>
  );
}
