"use client";

/**
 * ALBRA — Configuración del producto: USER (editable), SYSTEM (administrada), PRODUCT (read-only)
 * y proveedores externos.
 */

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Lock, Plug, Save, Settings2, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { api, ApiError } from "@/hooks/use-albra";
import type { ConfigFieldDTO, ProductDetail, ProviderDTO } from "@/lib/albra/api-types";

const PROVIDER_BADGE: Record<string, string> = {
  DISCOVERED: "border-zinc-700 bg-zinc-800 text-zinc-400",
  HEALTHY: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  CONNECTED: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
};

function providerBadgeClass(status: string): string {
  return PROVIDER_BADGE[status] ?? "border-amber-500/40 bg-amber-500/10 text-amber-400";
}

function renderReadOnlyValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

function ReadOnlyField({ field, value }: { field: ConfigFieldDTO; value: unknown }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-center gap-2">
        <Lock className="size-3.5 text-zinc-500" />
        <span className="text-sm font-medium text-zinc-200">{field.label}</span>
        <span className="font-mono text-[10px] text-zinc-600">{field.key}</span>
      </div>
      {field.description ? <p className="mt-1 text-xs text-zinc-500">{field.description}</p> : null}
      <p className="mt-2 font-mono text-xs break-all text-zinc-300">{renderReadOnlyValue(value)}</p>
    </div>
  );
}

export function ConfigPanel({ detail, onSaved }: { detail: ProductDetail; onSaved: () => void }) {
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [bools, setBools] = useState<Record<string, boolean>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<boolean>(false);
  const initializedFor = useRef<string | null>(null);

  const userFields = detail.configFields.filter((f) => f.scope === "USER");
  const systemFields = detail.configFields.filter((f) => f.scope === "SYSTEM");
  const productFields = detail.configFields.filter((f) => f.scope === "PRODUCT");

  // Hidratar el formulario una sola vez por producto (evita pisar lo que escribe el usuario en cada poll).
  useEffect(() => {
    if (!detail || initializedFor.current === detail.productId) return;
    initializedFor.current = detail.productId;
    const nextTexts: Record<string, string> = {};
    const nextBools: Record<string, boolean> = {};
    for (const f of userFields) {
      const v = detail.configValues?.USER?.[f.key];
      if (f.type === "boolean") {
        nextBools[f.key] = typeof v === "boolean" ? v : Boolean(f.defaultValue ?? false);
      } else if (f.type !== "secret") {
        nextTexts[f.key] =
          v !== undefined && v !== null && v !== ""
            ? String(v)
            : f.defaultValue !== undefined && f.defaultValue !== null
              ? String(f.defaultValue)
              : "";
      }
    }
    setTexts(nextTexts);
    setBools(nextBools);
    setSecrets({});
  }, [detail]);

  const save = async () => {
    setSaving(true);
    try {
      const values: Record<string, unknown> = {};
      for (const f of userFields) {
        if (f.type === "secret") {
          const s = secrets[f.key];
          if (s !== undefined && s.length > 0) values[f.key] = s;
          continue;
        }
        if (f.type === "boolean") {
          values[f.key] = bools[f.key] ?? false;
          continue;
        }
        if (f.type === "number") {
          const raw = texts[f.key] ?? "";
          const n = Number(raw);
          values[f.key] = raw !== "" && Number.isFinite(n) ? n : raw;
          continue;
        }
        values[f.key] = texts[f.key] ?? "";
      }
      await api(`/api/products/${detail.productId}/config`, {
        method: "PUT",
        body: JSON.stringify({ values }),
      });
      toast.success("Configuración guardada");
      onSaved();
    } catch (e) {
      const err = e as ApiError;
      toast.error(err instanceof ApiError ? (err.userMessage ?? err.message) : "No se pudo guardar la configuración");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* ── USER: editable ── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-6">
        <div className="flex items-center gap-2">
          <Settings2 className="size-5 text-emerald-400" />
          <h3 className="text-sm font-semibold text-zinc-100">Tu configuración</h3>
        </div>

        {userFields.length === 0 ? (
          <p className="mt-3 text-xs text-zinc-500">Este producto no expone configuración de usuario.</p>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {userFields.map((f) => {
              if (f.type === "boolean") {
                return (
                  <div key={f.key} className="flex items-start justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                    <div className="min-w-0">
                      <Label className="text-zinc-200">{f.label}</Label>
                      {f.description ? <p className="mt-1 text-xs text-zinc-500">{f.description}</p> : null}
                    </div>
                    <Switch
                      checked={bools[f.key] ?? false}
                      onCheckedChange={(v) => setBools((prev) => ({ ...prev, [f.key]: v }))}
                      className="data-[state=checked]:bg-emerald-500"
                    />
                  </div>
                );
              }
              if (f.type === "select") {
                return (
                  <div key={f.key} className="space-y-2">
                    <Label className="text-zinc-200">{f.label}</Label>
                    <Select
                      value={texts[f.key] ?? ""}
                      onValueChange={(v) => setTexts((prev) => ({ ...prev, [f.key]: v }))}
                    >
                      <SelectTrigger className="w-full border-zinc-700 bg-zinc-800 text-zinc-100">
                        <SelectValue placeholder="Selecciona…" />
                      </SelectTrigger>
                      <SelectContent className="border-zinc-700 bg-zinc-900 text-zinc-100">
                        {(f.options ?? []).map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {f.description ? <p className="text-xs text-zinc-500">{f.description}</p> : null}
                  </div>
                );
              }
              if (f.type === "secret") {
                const hasSecret = (() => {
                  const v = detail.configValues?.USER?.[f.key];
                  return v !== undefined && v !== null && v !== "";
                })();
                return (
                  <div key={f.key} className="space-y-2">
                    <Label className="text-zinc-200">
                      {f.label}
                      {f.required ? <span className="ml-1 text-red-400">*</span> : null}
                    </Label>
                    <Input
                      type="password"
                      autoComplete="off"
                      value={secrets[f.key] ?? ""}
                      onChange={(e) => setSecrets((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={
                        hasSecret ? "•••••••• (guardado — deja vacío para conservar)" : "Sin definir"
                      }
                      className="border-zinc-700 bg-zinc-800 text-zinc-100 placeholder:text-zinc-600"
                    />
                    <p className="text-xs text-zinc-500">
                      Se guarda cifrado en el SecretStore de ALBRA. Nunca se muestra ni se exporta.
                    </p>
                  </div>
                );
              }
              return (
                <div key={f.key} className="space-y-2">
                  <Label className="text-zinc-200">
                    {f.label}
                    {f.required ? <span className="ml-1 text-red-400">*</span> : null}
                  </Label>
                  <Input
                    type={f.type === "email" ? "email" : f.type === "number" ? "number" : "text"}
                    value={texts[f.key] ?? ""}
                    onChange={(e) => setTexts((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    className="border-zinc-700 bg-zinc-800 text-zinc-100"
                  />
                  {f.description ? <p className="text-xs text-zinc-500">{f.description}</p> : null}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-4">
          <Button
            onClick={save}
            disabled={saving || userFields.length === 0}
            className="bg-emerald-500 font-semibold text-zinc-950 hover:bg-emerald-600"
          >
            <Save className="size-4" />
            {saving ? "Guardando…" : "Guardar cambios"}
          </Button>
        </div>
      </div>

      {/* ── SYSTEM: administrada por ALBRA ── */}
      {systemFields.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-6">
          <div className="flex items-center gap-2">
            <Lock className="size-5 text-zinc-500" />
            <h3 className="text-sm font-semibold text-zinc-100">Sistema (administrado por ALBRA)</h3>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {systemFields.map((f) => (
              <ReadOnlyField key={f.key} field={f} value={detail.configValues?.SYSTEM?.[f.key]} />
            ))}
          </div>
        </div>
      )}

      {/* ── PRODUCT: read-only ── */}
      {productFields.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-6">
          <div className="flex items-center gap-2">
            <Tag className="size-5 text-zinc-500" />
            <h3 className="text-sm font-semibold text-zinc-100">Producto</h3>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {productFields.map((f) => (
              <ReadOnlyField key={f.key} field={f} value={detail.configValues?.PRODUCT?.[f.key]} />
            ))}
          </div>
        </div>
      )}

      {/* ── Proveedores externos ── */}
      {detail.providers.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-6">
          <div className="flex items-center gap-2">
            <Plug className="size-5 text-emerald-400" />
            <h3 className="text-sm font-semibold text-zinc-100">Proveedores</h3>
          </div>
          <Separator className="my-4 bg-zinc-800" />
          <div className="space-y-2">
            {detail.providers.map((p: ProviderDTO) => (
              <div
                key={p.providerId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-zinc-100">{p.label}</span>
                    <span className="rounded-full border border-zinc-700 bg-zinc-800 px-1.5 py-px font-mono text-[10px] text-zinc-400">
                      {p.kind}
                    </span>
                  </div>
                  {p.description ? <p className="mt-1 text-xs text-zinc-500">{p.description}</p> : null}
                </div>
                <Badge variant="outline" className={providerBadgeClass(p.status)}>
                  {p.status}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
