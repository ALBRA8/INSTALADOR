"use client";

/**
 * ALBRA V3 — Campo de CLAVE ÚNICA DE ACCESO (puerta de licenciamiento).
 * Usado por el asistente de instalación y por el panel de actualización.
 * Incluye emisión de clave de demostración vía el portal incluido
 * (POST /api/access/issue): la clave emitida igualmente pasa por la
 * validación de la API externa antes de descargar cualquier paquete.
 */
import { useState } from "react";
import { KeyRound, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/hooks/use-albra";

const KEY_PATTERN = /^ALBRA-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export function AccessKeyField({
  packageId,
  value,
  onChange,
  disabled,
  id = "access-key",
}: {
  packageId: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  id?: string;
}) {
  const [issuing, setIssuing] = useState(false);
  const valid = KEY_PATTERN.test(value.trim().toUpperCase());
  const touched = value.trim().length > 0;

  const issueDemo = async () => {
    setIssuing(true);
    try {
      const res = await api<{ accessKey: string; expiresAt: string | null }>("/api/access/issue", {
        method: "POST",
        body: JSON.stringify({ packageId }),
      });
      onChange(res.accessKey);
      toast.success("Clave de demostración emitida por el portal de licenciamiento", {
        description: "Se validará vía la API externa antes de descargar el paquete.",
      });
    } catch (e) {
      const err = e as ApiError;
      toast.error(err.userMessage ?? err.message);
    } finally {
      setIssuing(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="flex items-center gap-1.5 text-zinc-300">
        <KeyRound className="size-3.5 text-amber-400" aria-hidden />
        Clave única de acceso del proyecto
      </Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          placeholder="ALBRA-XXXX-XXXX-XXXX"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={touched && !valid}
          className={
            "font-mono text-sm " +
            (touched && !valid ? "border-red-500/50 focus-visible:ring-red-500/30" : "")
          }
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void issueDemo()}
          disabled={disabled || issuing}
          title="Emitir clave de demostración desde el portal de licenciamiento"
          className="shrink-0 gap-1.5 border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
        >
          {issuing ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
          Demo
        </Button>
      </div>
      <p className="text-[11px] leading-relaxed text-zinc-500">
        Obligatoria: el instalador la valida mediante la API externa de licenciamiento{" "}
        <span className="text-zinc-400">antes de descargar cualquier paquete</span>. Sin validación positiva, la descarga queda bloqueada.
        {touched && !valid && (
          <span className="ml-1 text-red-400">Formato inválido (ALBRA-XXXX-XXXX-XXXX).</span>
        )}
      </p>
    </div>
  );
}
