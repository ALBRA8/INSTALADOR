"use client";

import { useEffect, useState } from "react";
import { BookOpen, FileText } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/hooks/use-albra";
import type { ReportDocDTO } from "@/lib/albra/api-types";
import { cn } from "@/lib/utils";

export function ReportsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [reports, setReports] = useState<ReportDocDTO[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setReports([]);
      setActiveId(null);
    })();
    api<{ reports: ReportDocDTO[] }>("/api/reports")
      .then((data) => {
        if (cancelled) return;
        setReports(data.reports);
        setActiveId(data.reports[0]?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setReports([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const active = reports.find((r) => r.id === activeId) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl border-zinc-800 bg-zinc-950 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">Reportes técnicos</DialogTitle>
          <DialogDescription className="text-zinc-400">
            Arquitectura, contratos, seguridad y estado del proyecto ALBRA.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[240px_1fr]">
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full bg-zinc-800" />
              ))}
            </div>
            <Skeleton className="h-64 w-full bg-zinc-800" />
          </div>
        )}

        {!loading && reports.length === 0 && (
          <p className="flex items-center gap-2 py-6 text-sm text-zinc-500">
            <BookOpen className="size-4" aria-hidden />
            No hay reportes disponibles.
          </p>
        )}

        {!loading && reports.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[240px_1fr]">
            {/* Lista de reportes */}
            <nav
              aria-label="Lista de reportes"
              className="max-h-[70vh] space-y-1 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900 p-2"
            >
              {reports.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setActiveId(r.id)}
                  aria-current={r.id === activeId}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                    r.id === activeId
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                  )}
                >
                  <FileText className="size-3.5 shrink-0 text-emerald-400" aria-hidden />
                  <span className="truncate">{r.title}</span>
                </button>
              ))}
            </nav>

            {/* Contenido */}
            <article className="max-h-[70vh] overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900 p-4 sm:p-5">
              {active && (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <h2 className="text-base font-semibold text-zinc-100">{active.title}</h2>
                    <p className="text-sm text-zinc-400">{active.summary}</p>
                  </div>
                  <div className="space-y-5">
                    {active.sections.map((section, i) => (
                      <section key={`${active.id}-s-${i}`} className="space-y-1.5">
                        <h3 className="text-sm font-semibold text-zinc-100">{section.heading}</h3>
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">
                          {section.body}
                        </p>
                      </section>
                    ))}
                  </div>
                </div>
              )}
            </article>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
