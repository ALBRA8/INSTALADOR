"use client";

/**
 * ALBRA — Pane de producto CRM.
 * Se renderiza cuando el producto está RUNNING (el gating lo hace el workspace);
 * si no, o si la API responde 503 SERVICE_STOPPED, muestra la compuerta.
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Users } from "lucide-react";

import { api, ApiError } from "@/hooks/use-albra";
import type { CrmContactDTO, CrmDealDTO } from "@/lib/albra/api-types";
import { cn } from "@/lib/utils";

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

type DealStage = CrmDealDTO["stage"];

const DEAL_STAGES: readonly DealStage[] = [
  "NUEVO",
  "CONTACTADO",
  "PROPUESTA",
  "GANADO",
  "PERDIDO",
];

const STAGE_LABELS: Record<DealStage, string> = {
  NUEVO: "Nuevo",
  CONTACTADO: "Contactado",
  PROPUESTA: "Propuesta",
  GANADO: "Ganado",
  PERDIDO: "Perdido",
};

const fmtCOP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

interface ContactPayload {
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  tags?: string;
}

interface DealPayload {
  title: string;
  value: number;
  contactId?: string | null;
}

// ───────────── Helpers ─────────────

function parseTags(raw?: string | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/** Compara semver: >= 0 significa que `a` es igual o superior a `b`. */
function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// ───────────── Compuerta (servicio detenido) ─────────────

function CrmGate() {
  return (
    <Card className="mx-auto w-full max-w-md items-center justify-center border-zinc-800 bg-zinc-900/70 text-center">
      <CardContent className="flex flex-col items-center gap-4 py-10">
        <div className="flex size-12 items-center justify-center rounded-xl bg-zinc-800 text-zinc-400">
          <Users className="size-6" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <p className="text-base font-semibold text-zinc-100">ALBRA CRM está detenido</p>
          <p className="mx-auto max-w-sm text-sm text-zinc-500">
            Inicia el servicio desde el encabezado o la pestaña Resumen para gestionar
            tus contactos y oportunidades.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ───────────── Diálogo: nuevo contacto ─────────────

function NewContactDialog({
  open,
  onOpenChange,
  showTags,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  showTags: boolean;
  onSubmit: (payload: ContactPayload) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      setName("");
      setCompany("");
      setEmail("");
      setPhone("");
      setTags("");
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
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      tags: showTags && tags.trim() ? tags.trim() : undefined,
    });
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-zinc-800 bg-zinc-900 text-zinc-100 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo contacto</DialogTitle>
          <DialogDescription className="text-zinc-500">
            Registra una persona en tu agenda comercial de ALBRA CRM.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => void handleSubmit(event)}>
          <div className="grid gap-2">
            <Label htmlFor="crm-contact-name" className="text-zinc-300">
              Nombre <span className="text-emerald-400">*</span>
            </Label>
            <Input
              id="crm-contact-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="María Gómez"
              className="border-zinc-700 bg-zinc-950/40 text-zinc-100 placeholder:text-zinc-600"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="crm-contact-company" className="text-zinc-300">Empresa</Label>
            <Input
              id="crm-contact-company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Acme S.A.S."
              className="border-zinc-700 bg-zinc-950/40 text-zinc-100 placeholder:text-zinc-600"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="crm-contact-email" className="text-zinc-300">Email</Label>
              <Input
                id="crm-contact-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="maria@acme.co"
                className="border-zinc-700 bg-zinc-950/40 text-zinc-100 placeholder:text-zinc-600"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="crm-contact-phone" className="text-zinc-300">Teléfono</Label>
              <Input
                id="crm-contact-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+57 300 000 0000"
                className="border-zinc-700 bg-zinc-950/40 text-zinc-100 placeholder:text-zinc-600"
              />
            </div>
          </div>
          {showTags ? (
            <div className="grid gap-2">
              <Label htmlFor="crm-contact-tags" className="text-zinc-300">
                Etiquetas (separadas por coma)
                <Badge
                  variant="outline"
                  className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                >
                  Nuevo en 1.1.0
                </Badge>
              </Label>
              <Input
                id="crm-contact-tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="vip, proveedor, seguimiento"
                className="border-zinc-700 bg-zinc-950/40 text-zinc-100 placeholder:text-zinc-600"
              />
            </div>
          ) : null}
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
              {saving ? "Guardando…" : "Crear contacto"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Diálogo: nueva oportunidad ─────────────

function NewDealDialog({
  open,
  onOpenChange,
  contacts,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contacts: CrmContactDTO[];
  onSubmit: (payload: DealPayload) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [contactId, setContactId] = useState("none");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      setTitle("");
      setValue("");
      setContactId("none");
    })();
  }, [open]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    const parsedValue = value.trim() === "" ? 0 : Number(value);
    if (Number.isNaN(parsedValue) || parsedValue < 0) {
      toast.error("El valor debe ser un número válido");
      return;
    }
    setSaving(true);
    const ok = await onSubmit({
      title: trimmed,
      value: parsedValue,
      contactId: contactId === "none" ? null : contactId,
    });
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-zinc-800 bg-zinc-900 text-zinc-100 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva oportunidad</DialogTitle>
          <DialogDescription className="text-zinc-500">
            Añade un negocio al pipeline. Nacerá en la etapa Nuevo.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => void handleSubmit(event)}>
          <div className="grid gap-2">
            <Label htmlFor="crm-deal-title" className="text-zinc-300">
              Título <span className="text-emerald-400">*</span>
            </Label>
            <Input
              id="crm-deal-title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Licencia anual Acme"
              className="border-zinc-700 bg-zinc-950/40 text-zinc-100 placeholder:text-zinc-600"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="crm-deal-value" className="text-zinc-300">Valor (COP)</Label>
            <Input
              id="crm-deal-value"
              type="number"
              min={0}
              step={1000}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="4800000"
              className="border-zinc-700 bg-zinc-950/40 text-zinc-100 placeholder:text-zinc-600"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="crm-deal-contact" className="text-zinc-300">Contacto</Label>
            <Select value={contactId} onValueChange={setContactId}>
              <SelectTrigger
                id="crm-deal-contact"
                className="w-full border-zinc-700 bg-zinc-950/40 text-zinc-100"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-zinc-700 bg-zinc-900 text-zinc-100">
                <SelectItem value="none">Sin contacto</SelectItem>
                {contacts.map((contact) => (
                  <SelectItem key={contact.id} value={contact.id}>
                    {contact.name}
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
              {saving ? "Guardando…" : "Crear oportunidad"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Tarjeta de oportunidad (kanban) ─────────────

function DealCard({
  deal,
  contactName,
  busy,
  onMove,
  onDelete,
}: {
  deal: CrmDealDTO;
  contactName?: string;
  busy: boolean;
  onMove: (stage: DealStage) => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-zinc-700/70 bg-zinc-800/70 p-3 transition-colors hover:bg-zinc-800",
        deal.stage === "GANADO" && "border-emerald-500/60",
        deal.stage === "PERDIDO" && "opacity-60"
      )}
    >
      <p className="text-sm font-medium text-zinc-100">{deal.title}</p>
      <p className="mt-1 text-xs text-zinc-400">{fmtCOP.format(deal.value)}</p>
      {contactName ? (
        <p className="mt-0.5 truncate text-xs text-zinc-500">{contactName}</p>
      ) : null}
      <div className="mt-2 flex items-center gap-1.5">
        <Select
          value={deal.stage}
          onValueChange={(next) => onMove(next as DealStage)}
          disabled={busy}
        >
          <SelectTrigger
            size="sm"
            aria-label={`Mover etapa de ${deal.title}`}
            className="h-7 min-w-0 flex-1 border-zinc-700 bg-zinc-900 text-xs text-zinc-300"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-zinc-700 bg-zinc-900 text-zinc-100">
            {DEAL_STAGES.map((stage) => (
              <SelectItem key={stage} value={stage} className="text-xs">
                {STAGE_LABELS[stage]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Eliminar oportunidad"
          disabled={busy}
          onClick={onDelete}
          className="size-7 shrink-0 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-red-400"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ───────────── Pane principal ─────────────

export function CrmPane({
  productId,
  running,
  version,
}: {
  productId: string;
  running: boolean;
  version: string;
}) {
  const [contacts, setContacts] = useState<CrmContactDTO[] | null>(null);
  const [deals, setDeals] = useState<CrmDealDTO[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [dealDialogOpen, setDealDialogOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const tagsEnabled = useMemo(() => compareSemver(version, "1.1.0") >= 0, [version]);

  const load = useCallback(async () => {
    if (!running) return;
    setLoading(true);
    try {
      const [contactsRes, dealsRes] = await Promise.all([
        api<{ contacts: CrmContactDTO[] }>(`/api/products/${productId}/crm/contacts`),
        api<{ deals: CrmDealDTO[] }>(`/api/products/${productId}/crm/deals`),
      ]);
      setContacts(contactsRes.contacts);
      setDeals(dealsRes.deals);
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

  // Si el servicio se cae en medio de una mutación, cerramos diálogos y mostramos compuerta.
  useEffect(() => {
    if (stopped) {
      setContactDialogOpen(false);
      setDealDialogOpen(false);
    }
  }, [stopped]);

  const contactNamesById = useMemo(() => {
    const map = new Map<string, string>();
    for (const contact of contacts ?? []) map.set(contact.id, contact.name);
    return map;
  }, [contacts]);

  /** Errores de mutación: 503 → compuerta + toast; resto → toast. */
  const handleMutationError = useCallback((error: unknown, fallback: string): void => {
    if (error instanceof ApiError && error.status === 503) {
      setStopped(true);
      toast.error(error.userMessage ?? "ALBRA CRM está detenido");
      return;
    }
    if (error instanceof ApiError) {
      toast.error(error.userMessage ?? error.message);
      return;
    }
    toast.error(fallback);
  }, []);

  const createContact = useCallback(
    async (payload: ContactPayload): Promise<boolean> => {
      try {
        await api(`/api/products/${productId}/crm/contacts`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast.success("Contacto creado");
        await load();
        return true;
      } catch (error) {
        handleMutationError(error, "No se pudo crear el contacto");
        return false;
      }
    },
    [productId, load, handleMutationError]
  );

  const createDeal = useCallback(
    async (payload: DealPayload): Promise<boolean> => {
      try {
        await api(`/api/products/${productId}/crm/deals`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast.success("Oportunidad creada");
        await load();
        return true;
      } catch (error) {
        handleMutationError(error, "No se pudo crear la oportunidad");
        return false;
      }
    },
    [productId, load, handleMutationError]
  );

  const deleteContact = useCallback(
    async (contact: CrmContactDTO): Promise<void> => {
      setBusyId(contact.id);
      try {
        await api(`/api/products/${productId}/crm/contacts/${contact.id}`, {
          method: "DELETE",
        });
        toast.success("Contacto eliminado");
        await load();
      } catch (error) {
        handleMutationError(error, "No se pudo eliminar el contacto");
      } finally {
        setBusyId(null);
      }
    },
    [productId, load, handleMutationError]
  );

  const deleteDeal = useCallback(
    async (deal: CrmDealDTO): Promise<void> => {
      setBusyId(deal.id);
      try {
        await api(`/api/products/${productId}/crm/deals/${deal.id}`, {
          method: "DELETE",
        });
        toast.success("Oportunidad eliminada");
        await load();
      } catch (error) {
        handleMutationError(error, "No se pudo eliminar la oportunidad");
      } finally {
        setBusyId(null);
      }
    },
    [productId, load, handleMutationError]
  );

  const moveDeal = useCallback(
    async (deal: CrmDealDTO, stage: DealStage): Promise<void> => {
      if (deal.stage === stage) return;
      setBusyId(deal.id);
      try {
        await api(`/api/products/${productId}/crm/deals/${deal.id}`, {
          method: "PATCH",
          body: JSON.stringify({ stage }),
        });
        toast.success(`Oportunidad movida a ${STAGE_LABELS[stage]}`);
        await load();
      } catch (error) {
        handleMutationError(error, "No se pudo actualizar la oportunidad");
      } finally {
        setBusyId(null);
      }
    },
    [productId, load, handleMutationError]
  );

  // ── Compuerta: producto no running o servicio caído (503) ──
  if (!running || stopped) return <CrmGate />;

  // ── Carga inicial ──
  if (loading && contacts === null && deals === null) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="border-zinc-800 bg-zinc-900 py-4 lg:col-span-3">
          <CardContent className="space-y-3 px-4">
            <Skeleton className="h-8 w-1/3 bg-zinc-800" />
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full bg-zinc-800" />
            ))}
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900 py-4 lg:col-span-2">
          <CardContent className="space-y-3 px-4">
            <Skeleton className="h-8 w-1/2 bg-zinc-800" />
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full bg-zinc-800" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  const contactList = contacts ?? [];
  const dealList = deals ?? [];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      {/* ── CONTACTOS ── */}
      <Card className="border-zinc-800 bg-zinc-900 py-4 gap-4 lg:col-span-3">
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2 text-zinc-100">
            Contactos
            <Badge
              variant="secondary"
              className="border-zinc-700 bg-zinc-800 text-zinc-300"
            >
              {contactList.length}
            </Badge>
          </CardTitle>
          <CardDescription className="text-zinc-500">
            Tu agenda comercial del CRM.
          </CardDescription>
          <CardAction>
            <Button
              type="button"
              size="sm"
              onClick={() => setContactDialogOpen(true)}
              className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
            >
              <Plus className="size-4" />
              Nuevo contacto
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="px-4">
          <div className="max-h-80 overflow-y-auto rounded-lg border border-zinc-800">
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
                    Email
                  </TableHead>
                  {tagsEnabled ? (
                    <TableHead className="text-xs uppercase tracking-wide text-zinc-500">
                      Etiquetas
                    </TableHead>
                  ) : null}
                  <TableHead className="w-12 text-right text-xs uppercase tracking-wide text-zinc-500">
                    <span className="sr-only">Acciones</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contactList.length === 0 ? (
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableCell
                      colSpan={tagsEnabled ? 5 : 4}
                      className="h-24 text-center text-sm text-zinc-500"
                    >
                      Sin contactos todavía — crea el primero
                    </TableCell>
                  </TableRow>
                ) : (
                  contactList.map((contact) => (
                    <TableRow
                      key={contact.id}
                      className="border-zinc-800 transition-colors hover:bg-zinc-800/50"
                    >
                      <TableCell className="font-medium text-zinc-100">
                        {contact.name}
                      </TableCell>
                      <TableCell className="text-zinc-400">{contact.company ?? "—"}</TableCell>
                      <TableCell className="max-w-48 truncate text-zinc-400">
                        {contact.email ?? "—"}
                      </TableCell>
                      {tagsEnabled ? (
                        <TableCell>
                          {parseTags(contact.tags).length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {parseTags(contact.tags).map((tag) => (
                                <Badge
                                  key={tag}
                                  variant="outline"
                                  className="border-zinc-700 bg-zinc-800 text-zinc-300"
                                >
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <span className="text-zinc-600">—</span>
                          )}
                        </TableCell>
                      ) : null}
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Eliminar contacto"
                          disabled={busyId === contact.id}
                          onClick={() => void deleteContact(contact)}
                          className="size-8 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-red-400"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ── OPORTUNIDADES (pipeline kanban) ── */}
      <Card className="border-zinc-800 bg-zinc-900 py-4 gap-4 lg:col-span-2">
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2 text-zinc-100">
            Pipeline
            <Badge
              variant="secondary"
              className="border-zinc-700 bg-zinc-800 text-zinc-300"
            >
              {dealList.length}
            </Badge>
          </CardTitle>
          <CardDescription className="text-zinc-500">
            Oportunidades por etapa.
          </CardDescription>
          <CardAction>
            <Button
              type="button"
              size="sm"
              onClick={() => setDealDialogOpen(true)}
              className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
            >
              <Plus className="size-4" />
              Nueva
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="px-4">
          {dealList.length === 0 ? (
            <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-zinc-800 text-sm text-zinc-500">
              Sin oportunidades todavía — crea la primera
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto pr-1">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                {DEAL_STAGES.map((stage) => {
                  const stageDeals = dealList.filter((deal) => deal.stage === stage);
                  return (
                    <div
                      key={stage}
                      className="flex min-h-32 flex-col gap-2 rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-2"
                    >
                      <div className="flex items-center justify-between px-1 pt-1">
                        <span className="text-xs uppercase tracking-wide text-zinc-500">
                          {STAGE_LABELS[stage]}
                        </span>
                        <span className="text-xs tabular-nums text-zinc-600">
                          {stageDeals.length}
                        </span>
                      </div>
                      {stageDeals.map((deal) => (
                        <DealCard
                          key={deal.id}
                          deal={deal}
                          contactName={
                            deal.contactId
                              ? contactNamesById.get(deal.contactId)
                              : undefined
                          }
                          busy={busyId === deal.id}
                          onMove={(next) => void moveDeal(deal, next)}
                          onDelete={() => void deleteDeal(deal)}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <NewContactDialog
        open={contactDialogOpen}
        onOpenChange={setContactDialogOpen}
        showTags={tagsEnabled}
        onSubmit={createContact}
      />
      <NewDealDialog
        open={dealDialogOpen}
        onOpenChange={setDealDialogOpen}
        contacts={contactList}
        onSubmit={createDeal}
      />
    </div>
  );
}
