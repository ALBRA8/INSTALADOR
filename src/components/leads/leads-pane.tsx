"use client";

/**
 * ALBRA — Pane de producto Agente Leads.
 * Se renderiza cuando el producto está RUNNING (el gating lo hace el workspace);
 * si no, o si la API responde 503 SERVICE_STOPPED, muestra la compuerta.
 */

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Plus, Target, Trash2 } from "lucide-react";

import { api, ApiError } from "@/hooks/use-albra";
import type { LeadDTO } from "@/lib/albra/api-types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ───────────── Tipos y constantes ─────────────

type LeadStatus = LeadDTO["status"];
type LeadSource = "WEB" | "REFERRAL" | "ADS" | "MANUAL";

const LEAD_SOURCES: readonly LeadSource[] = ["WEB", "REFERRAL", "ADS", "MANUAL"];

const SOURCE_LABELS: Record<LeadSource, string> = {
  WEB: "Web",
  REFERRAL: "Referido",
  ADS: "Ads",
  MANUAL: "Manual",
};

const STATUS_LABELS: Record<LeadStatus, string> = {
  NUEVO: "Nuevo",
  CALIFICADO: "Calificado",
  CONTACTADO: "Contactado",
  DESCARTADO: "Descartado",
};

const LEAD_STATUSES: readonly LeadStatus[] = [
  "NUEVO",
  "CALIFICADO",
  "CONTACTADO",
  "DESCARTADO",
];

interface LeadPayload {
  name: string;
  company?: string;
  source: LeadSource;
}

/** Score → variante visual: >= 70 Caliente, >= 40 Tibio, < 40 Frío. */
function scoreBadge(score: number): { label: string; className: string } {
  if (score >= 70) {
    return {
      label: "Caliente",
      className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    };
  }
  if (score >= 40) {
    return {
      label: "Tibio",
      className: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    };
  }
  return {
    label: "Frío",
    className: "border-zinc-700 bg-zinc-800 text-zinc-300",
  };
}

// ───────────── Compuerta (servicio detenido) ─────────────

function LeadsGate() {
  return (
    <Card className="mx-auto w-full max-w-md items-center justify-center border-zinc-800 bg-zinc-900/70 text-center">
      <CardContent className="flex flex-col items-center gap-4 py-10">
        <div className="flex size-12 items-center justify-center rounded-xl bg-zinc-800 text-zinc-400">
          <Target className="size-6" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <p className="text-base font-semibold text-zinc-100">
            ALBRA Agente Leads está detenido
          </p>
          <p className="mx-auto max-w-sm text-sm text-zinc-500">
            Inicia el servicio desde el encabezado o la pestaña Resumen para capturar
            y calificar tus leads.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ───────────── Diálogo: nuevo lead ─────────────

function NewLeadDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: LeadPayload) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [source, setSource] = useState<LeadSource>("WEB");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      setName("");
      setCompany("");
      setSource("WEB");
    })();
  }, [open]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    const ok = await onSubmit({
      name: trimmed,
      company: company.trim() || undefined,
      source,
    });
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-zinc-800 bg-zinc-900 text-zinc-100 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo lead</DialogTitle>
          <DialogDescription className="text-zinc-500">
            Registra un prospecto en la bandeja del agente.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => void handleSubmit(event)}>
          <div className="grid gap-2">
            <Label htmlFor="leads-name" className="text-zinc-300">
              Nombre <span className="text-emerald-400">*</span>
            </Label>
            <Input
              id="leads-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Juan Pérez"
              className="border-zinc-700 bg-zinc-950/40 text-zinc-100 placeholder:text-zinc-600"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="leads-company" className="text-zinc-300">Empresa</Label>
            <Input
              id="leads-company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Globex Ltda."
              className="border-zinc-700 bg-zinc-950/40 text-zinc-100 placeholder:text-zinc-600"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="leads-source" className="text-zinc-300">Origen</Label>
            <Select value={source} onValueChange={(next) => setSource(next as LeadSource)}>
              <SelectTrigger
                id="leads-source"
                className="w-full border-zinc-700 bg-zinc-950/40 text-zinc-100"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-zinc-700 bg-zinc-900 text-zinc-100">
                {LEAD_SOURCES.map((item) => (
                  <SelectItem key={item} value={item}>
                    {SOURCE_LABELS[item]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
            >
              {saving ? "Guardando…" : "Crear lead"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Pane principal ─────────────

export function LeadsPane({
  productId,
  running,
}: {
  productId: string;
  running: boolean;
}) {
  const [leads, setLeads] = useState<LeadDTO[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!running) return;
    setLoading(true);
    try {
      const data = await api<{ leads: LeadDTO[] }>(`/api/products/${productId}/leads`);
      setLeads(data.leads);
      setStopped(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) {
        setStopped(true);
        return;
      }
      const message =
        error instanceof ApiError ? (error.userMessage ?? error.message) : "Error de red";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [productId, running]);

  useEffect(() => {
    if (running) void load();
  }, [running, load]);

  // Si el servicio se cae en medio de una mutación, cerramos el diálogo y mostramos compuerta.
  useEffect(() => {
    if (stopped) setDialogOpen(false);
  }, [stopped]);

  /** Errores de mutación: 503 → compuerta + toast; resto → toast. */
  const handleMutationError = useCallback((error: unknown, fallback: string): void => {
    if (error instanceof ApiError && error.status === 503) {
      setStopped(true);
      toast.error(error.userMessage ?? "ALBRA Agente Leads está detenido");
      return;
    }
    if (error instanceof ApiError) {
      toast.error(error.userMessage ?? error.message);
      return;
    }
    toast.error(fallback);
  }, []);

  const createLead = useCallback(
    async (payload: LeadPayload): Promise<boolean> => {
      try {
        await api(`/api/products/${productId}/leads`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast.success("Lead creado");
        await load();
        return true;
      } catch (error) {
        handleMutationError(error, "No se pudo crear el lead");
        return false;
      }
    },
    [productId, load, handleMutationError]
  );

  const updateStatus = useCallback(
    async (lead: LeadDTO, status: LeadStatus): Promise<void> => {
      if (lead.status === status) return;
      setBusyId(lead.id);
      try {
        await api(`/api/products/${productId}/leads/${lead.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status }),
        });
        toast.success(`Lead marcado como ${STATUS_LABELS[status]}`);
        await load();
      } catch (error) {
        handleMutationError(error, "No se pudo actualizar el lead");
      } finally {
        setBusyId(null);
      }
    },
    [productId, load, handleMutationError]
  );

  const deleteLead = useCallback(
    async (lead: LeadDTO): Promise<void> => {
      setBusyId(lead.id);
      try {
        await api(`/api/products/${productId}/leads/${lead.id}`, {
          method: "DELETE",
        });
        toast.success("Lead eliminado");
        await load();
      } catch (error) {
        handleMutationError(error, "No se pudo eliminar el lead");
      } finally {
        setBusyId(null);
      }
    },
    [productId, load, handleMutationError]
  );

  // ── Compuerta: producto no running o servicio caído (503) ──
  if (!running || stopped) return <LeadsGate />;

  // ── Carga inicial ──
  if (loading && leads === null) {
    return (
      <Card className="border-zinc-800 bg-zinc-900 py-4">
        <CardContent className="space-y-3 px-4">
          <Skeleton className="h-8 w-1/3 bg-zinc-800" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full bg-zinc-800" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const leadList = leads ?? [];

  return (
    <>
      <Card className="border-zinc-800 bg-zinc-900 py-4 gap-4">
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2 text-zinc-100">
            Leads
            <Badge
              variant="secondary"
              className="border-zinc-700 bg-zinc-800 text-zinc-300"
            >
              {leadList.length}
            </Badge>
          </CardTitle>
          <CardDescription className="text-zinc-500">
            Prospectos capturados y calificados por el agente.
          </CardDescription>
          <CardAction>
            <Button
              type="button"
              size="sm"
              onClick={() => setDialogOpen(true)}
              className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
            >
              <Plus className="size-4" />
              Nuevo lead
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="px-4">
          <div className="max-h-96 overflow-y-auto rounded-lg border border-zinc-800">
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-xs uppercase tracking-wide text-zinc-500">
                    Nombre
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wide text-zinc-500">
                    Empresa
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wide text-zinc-500">
                    Origen
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wide text-zinc-500">
                    Estado
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wide text-zinc-500">
                    Score
                  </TableHead>
                  <TableHead className="w-12 text-right text-xs uppercase tracking-wide text-zinc-500">
                    <span className="sr-only">Acciones</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leadList.length === 0 ? (
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableCell
                      colSpan={6}
                      className="h-24 text-center text-sm text-zinc-500"
                    >
                      Sin leads todavía — crea el primero
                    </TableCell>
                  </TableRow>
                ) : (
                  leadList.map((lead) => {
                    const badge = scoreBadge(lead.score);
                    return (
                      <TableRow
                        key={lead.id}
                        className="border-zinc-800 transition-colors hover:bg-zinc-800/50"
                      >
                        <TableCell className="font-medium text-zinc-100">
                          {lead.name}
                        </TableCell>
                        <TableCell className="text-zinc-400">
                          {lead.company ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className="border-zinc-700 bg-zinc-800 text-zinc-300"
                          >
                            {SOURCE_LABELS[lead.source as LeadSource] ?? lead.source}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={lead.status}
                            onValueChange={(next) => void updateStatus(lead, next as LeadStatus)}
                            disabled={busyId === lead.id}
                          >
                            <SelectTrigger
                              size="sm"
                              aria-label={`Estado de ${lead.name}`}
                              className="h-7 w-32 border-zinc-700 bg-zinc-900 text-xs text-zinc-300"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="border-zinc-700 bg-zinc-900 text-zinc-100">
                              {LEAD_STATUSES.map((status) => (
                                <SelectItem key={status} value={status} className="text-xs">
                                  {STATUS_LABELS[status]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={badge.className}>
                            {badge.label} · {lead.score}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Eliminar lead"
                            disabled={busyId === lead.id}
                            onClick={() => void deleteLead(lead)}
                            className="size-8 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-red-400"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <NewLeadDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={createLead}
      />
    </>
  );
}
