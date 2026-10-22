"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ScrollText } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, fmtDate } from "@/hooks/use-albra";
import type { AuditDTO } from "@/lib/albra/api-types";
import { cn } from "@/lib/utils";

const SEVERITY_DOT: Record<AuditDTO["severity"], string> = {
  INFO: "bg-zinc-500",
  WARN: "bg-amber-500",
  ERROR: "bg-red-500",
};

type Filter = "todos" | "install" | "update" | "repair" | "uninstall" | "certification";

export function AuditDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [events, setEvents] = useState<AuditDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("todos");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ events: AuditDTO[] }>("/api/audit?limit=100");
      setEvents(data.events);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setExpandedId(null);
    setFilter("todos");
    void load();
  }, [open, load]);

  const filtered = events.filter(
    (e) => filter === "todos" || e.type.toLowerCase() === filter
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl border-zinc-800 bg-zinc-950 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">Auditoría</DialogTitle>
          <DialogDescription className="text-zinc-400">
            Registro inmutable de operaciones de la plataforma (últimos 100 eventos).
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3">
          <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <SelectTrigger
              className="w-48 border-zinc-800 bg-zinc-900 text-zinc-200"
              aria-label="Filtrar por tipo de evento"
            >
              <SelectValue placeholder="Tipo de evento" />
            </SelectTrigger>
            <SelectContent className="border-zinc-800 bg-zinc-900 text-zinc-200">
              <SelectItem value="todos">Todos los eventos</SelectItem>
              <SelectItem value="install">Instalación</SelectItem>
              <SelectItem value="update">Actualización</SelectItem>
              <SelectItem value="repair">Reparación</SelectItem>
              <SelectItem value="uninstall">Desinstalación</SelectItem>
              <SelectItem value="certification">Certificación</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-zinc-600">{filtered.length} eventos</span>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full bg-zinc-800" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="flex items-center gap-2 py-6 text-sm text-zinc-500">
            <ScrollText className="size-4" aria-hidden />
            Sin eventos para este filtro.
          </p>
        ) : (
          <ul className="max-h-96 space-y-2 overflow-y-auto pr-1">
            {filtered.map((a) => {
              const hasDetail = a.detail != null;
              const expanded = expandedId === a.id;
              return (
                <li
                  key={a.id}
                  className="rounded-lg border border-zinc-800 bg-zinc-900 p-3"
                >
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className={cn("size-2 shrink-0 rounded-full", SEVERITY_DOT[a.severity])}
                    />
                    <span className="font-mono text-xs text-zinc-200">{a.type}</span>
                    {a.productId && (
                      <span className="font-mono text-xs text-zinc-500">{a.productId}</span>
                    )}
                    <span className="ml-auto shrink-0 text-[11px] text-zinc-600">
                      {fmtDate(a.createdAt)}
                    </span>
                    {hasDetail && (
                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : a.id)}
                        aria-label={expanded ? "Ocultar detalle" : "Ver detalle"}
                        className="rounded p-0.5 text-zinc-500 transition-colors hover:text-zinc-200"
                      >
                        <ChevronDown
                          className={cn(
                            "size-3.5 transition-transform",
                            expanded && "rotate-180"
                          )}
                          aria-hidden
                        />
                      </button>
                    )}
                  </div>
                  {hasDetail && expanded && (
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950 p-2 text-xs text-zinc-400">
                      {JSON.stringify(a.detail, null, 2)}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
