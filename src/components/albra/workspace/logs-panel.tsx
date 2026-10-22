"use client";

/**
 * ALBRA — Registros del producto con filtro de nivel, refresco manual y auto-refresh (5s).
 */

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw, ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/hooks/use-albra";

interface LogEntry {
  id?: string;
  level: string;
  channel: string;
  message: string;
  data?: unknown;
  createdAt: string;
}

type LevelFilter = "todos" | "debug" | "info" | "warn" | "error";

const LEVEL_BADGE: Record<string, string> = {
  error: "border-red-500/40 bg-red-500/10 text-red-400",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  info: "border-emerald-700/50 bg-emerald-700/10 text-emerald-400",
  debug: "border-zinc-700 bg-zinc-800 text-zinc-400",
};

function fmtTimeShort(value?: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function LogsPanel({ productId }: { productId: string }) {
  const [level, setLevel] = useState<LevelFilter>("todos");
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const load = useCallback(
    async (lvl: LevelFilter) => {
      try {
        const qs = new URLSearchParams({ limit: "100" });
        if (lvl !== "todos") qs.set("level", lvl);
        const data = await api<{ logs?: LogEntry[]; entries?: LogEntry[] }>(
          `/api/products/${productId}/logs?${qs.toString()}`,
        );
        setEntries(data.logs ?? data.entries ?? []);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [productId],
  );

  useEffect(() => {
    setLoading(true);
    void load(level);
  }, [level, load]);

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load(level);
    }, 5000);
    return () => clearInterval(t);
  }, [level, load]);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ScrollText className="size-5 text-emerald-400" />
          <h3 className="text-sm font-semibold text-zinc-100">Registros</h3>
        </div>
        <div className="flex items-center gap-2">
          <Select value={level} onValueChange={(v) => setLevel(v as LevelFilter)}>
            <SelectTrigger size="sm" className="w-32 border-zinc-700 bg-zinc-800 text-zinc-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-zinc-700 bg-zinc-900 text-zinc-100">
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="debug">Debug</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="warn">Warn</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void load(level)}
            disabled={loading}
            className="border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-800 hover:text-zinc-50"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin text-amber-400" : ""}`} />
            Refrescar
          </Button>
        </div>
      </div>

      {error ? (
        <p className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-400">
          No se pudieron cargar los registros: {error}
        </p>
      ) : entries.length === 0 && !loading ? (
        <p className="mt-4 text-xs text-zinc-500">Sin registros para este nivel.</p>
      ) : (
        <div className="mt-4 max-h-96 space-y-1 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs">
          {(loading && entries.length === 0 ? [] : entries).map((log, i) => (
            <div key={log.id ?? `${log.createdAt}-${i}`} className="border-b border-zinc-900 py-1.5 last:border-b-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-zinc-600">{fmtTimeShort(log.createdAt)}</span>
                <Badge variant="outline" className={`px-1.5 py-0 text-[10px] ${LEVEL_BADGE[log.level] ?? LEVEL_BADGE.debug}`}>
                  {log.level}
                </Badge>
                <span className="rounded bg-zinc-800 px-1.5 py-px text-[10px] text-zinc-400">{log.channel}</span>
                <span className="min-w-0 flex-1 break-words text-zinc-200">{log.message}</span>
                {log.data !== undefined && log.data !== null ? (
                  <button
                    type="button"
                    onClick={() => setExpanded((prev) => ({ ...prev, [i]: !prev[i] }))}
                    className="flex items-center gap-0.5 text-[10px] text-zinc-500 hover:text-zinc-300"
                  >
                    {expanded[i] ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                    data
                  </button>
                ) : null}
              </div>
              {expanded[i] && log.data !== undefined && log.data !== null ? (
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-zinc-900 p-2 text-[10px] text-zinc-500">
                  {JSON.stringify(log.data, null, 2)}
                </pre>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <p className="mt-3 text-[11px] text-zinc-600">
        Auto-refresco cada 5 s (solo con la pestaña visible) · últimos 100 eventos · {entries.length} entradas
      </p>
    </div>
  );
}
