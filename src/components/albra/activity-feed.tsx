"use client";

import { History } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDate } from "@/hooks/use-albra";
import type { AuditDTO, LifecycleRunDTO, RunStatus } from "@/lib/albra/api-types";
import { cn } from "@/lib/utils";

const RUN_STATUS_LABEL: Record<string, string> = {
  RUNNING: "En curso",
  SUCCESS: "Éxito",
  WARNING: "Con avisos",
  FAILURE: "Fallido",
  ROLLED_BACK: "Revertido",
};

const RUN_STATUS_STYLE: Record<RunStatus, string> = {
  RUNNING: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  SUCCESS: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  WARNING: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  FAILURE: "border-red-500/30 bg-red-500/10 text-red-400",
  ROLLED_BACK: "border-amber-500/30 bg-amber-500/10 text-amber-400",
};

const OP_LABEL: Record<string, string> = {
  INSTALL: "Instalación",
  UPDATE: "Actualización",
  REPAIR: "Reparación",
  UNINSTALL: "Desinstalación",
  START: "Arranque",
  STOP: "Detención",
  CERTIFICATION: "Certificación",
  CLEANROOM: "Clean-room",
};

const SEVERITY_DOT: Record<AuditDTO["severity"], string> = {
  INFO: "bg-zinc-500",
  WARN: "bg-amber-500",
  ERROR: "bg-red-500",
};

function timeAgo(iso?: string | null): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "hace instantes";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

export function ActivityFeed({
  runs,
  audits,
  loading,
}: {
  runs: LifecycleRunDTO[];
  audits: AuditDTO[];
  loading?: boolean;
}) {
  return (
    <Card className="gap-4 rounded-xl border-zinc-800 bg-zinc-900 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-sm text-zinc-100">
          <History className="size-4 text-emerald-400" aria-hidden />
          Actividad reciente
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 px-4">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full bg-zinc-800" />
            ))}
          </div>
        ) : runs.length === 0 && audits.length === 0 ? (
          <p className="py-2 text-sm text-zinc-500">Sin actividad todavía.</p>
        ) : (
          <>
            {/* Runs recientes */}
            {runs.length > 0 && (
              <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {runs.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-xs"
                  >
                    <span className="text-zinc-200">{OP_LABEL[r.operation] ?? r.operation}</span>
                    {r.productId && (
                      <span className="font-mono text-zinc-500">{r.productId}</span>
                    )}
                    <Badge
                      variant="outline"
                      className={cn("ml-auto border text-[10px]", RUN_STATUS_STYLE[r.status])}
                    >
                      {RUN_STATUS_LABEL[r.status] ?? r.status}
                    </Badge>
                    <span
                      className="shrink-0 text-zinc-600"
                      title={fmtDate(r.startedAt)}
                    >
                      {timeAgo(r.startedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {/* Auditoría reciente */}
            {audits.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-wide text-zinc-600">
                  Últimos eventos de auditoría
                </p>
                <ul className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
                  {audits.map((a) => (
                    <li
                      key={a.id}
                      className="flex flex-wrap items-center gap-2 text-xs"
                      title={fmtDate(a.createdAt)}
                    >
                      <span
                        aria-hidden
                        className={cn("size-1.5 shrink-0 rounded-full", SEVERITY_DOT[a.severity])}
                      />
                      <span className="font-mono text-zinc-400">{a.type}</span>
                      {a.productId && (
                        <span className="font-mono text-zinc-600">{a.productId}</span>
                      )}
                      <span className="ml-auto shrink-0 text-zinc-600">{timeAgo(a.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
