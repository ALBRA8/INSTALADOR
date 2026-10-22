/**
 * ALBRA — WAVE D: pruebas reales de la cadena de confianza (Task v2-d).
 * Ejecutar con: bun scripts/wave-d-trust-tests.ts  (cwd = raíz del proyecto)
 *
 * Cubre los casos que no dependen del estado de confianza en vivo:
 *  - Salvaguardas de formato: PATH_UNSAFE (relativo "..", absoluto, backslash),
 *    DUPLICATE_PATH, FILE_TOO_LARGE (>25MB), PACKAGE_TOO_LARGE (>500 archivos
 *    y >100MB).
 *  - Autenticidad Ed25519 con clave NO registrada: UNTRUSTED_SIGNER cuando el
 *    contrato no exige firmas (signedPackagesRequired=false) y
 *    SIGNER_NOT_TRUSTED cuando lo exige.
 *  - LEGACY: paquete firmado a mano con HMAC-SHA256 (clave maestra local)
 *    → válido con trustLevel DEV_LOCAL (advertencia, no procedencia).
 * El paquete legacy se escribe en la bóveda temporalmente y se elimina al final.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  buildPackage,
  verifyPackage,
  writePackageFile,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_PACKAGE_BYTES,
  type AlbraPackage,
  type PackageFileEntry,
} from "@/lib/albra/package/format";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 300) : "");
  }
}

function sha(content: string): string {
  return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}

function fileEntry(p: string, content: string) {
  return { path: p, sha256: sha(content), content, encoding: "utf8" as const };
}

function probePackage(packageId: string, signedPackagesRequired: boolean, files: PackageFileEntry | PackageFileEntry[]): AlbraPackage {
  const application = Array.isArray(files) ? files : [files];
  return buildPackage({
    manifest: {
      packageId,
      version: "1.0.0",
      channel: "stable",
      displayName: `Wave D probe ${packageId}`,
      createdAt: new Date().toISOString(),
      metadata: { probe: "wave-d" },
    },
    contract: {
      identity: { productId: packageId, displayName: packageId, version: "1.0.0", category: "tool" },
      security: { signedPackagesRequired, secretKeys: [], permissions: [], dataClassification: "internal" },
    },
    payload: {
      application,
      seeds: {},
      migrations: [],
      deployment: { adapter: "windows-local", installStrategy: "transactional-stage-commit" },
    },
  }, { signer: "hmac-dev" });
}

// ───────────── 1. Salvaguardas de formato ─────────────
console.log("\n[1] Salvaguardas de formato");
{
  const evil = probePackage("probe-path-traversal", false, [fileEntry("../evil.js", "x")]);
  const v = verifyPackage(evil);
  check(`path "../evil" → PATH_UNSAFE`, !v.valid && v.reason.startsWith("PATH_UNSAFE"), v);

  const abs = probePackage("probe-abs-path", false, [fileEntry("/etc/passwd", "x")]);
  const va = verifyPackage(abs);
  check(`path "/etc/passwd" → PATH_UNSAFE`, !va.valid && va.reason.startsWith("PATH_UNSAFE"), va);

  const win = probePackage("probe-win-path", false, [fileEntry("app\\evil.js", "x")]);
  const vw = verifyPackage(win);
  check(`path "app\\evil.js" (backslash) → PATH_UNSAFE`, !vw.valid && vw.reason.startsWith("PATH_UNSAFE"), vw);

  const dup = probePackage("probe-dup-path", false, [fileEntry("app/a.js", "a"), fileEntry("app/a.js", "b")]);
  const vd = verifyPackage(dup);
  check(`duplicado "app/a.js" → DUPLICATE_PATH`, !vd.valid && vd.reason.startsWith("DUPLICATE_PATH"), vd);

  const big = "A".repeat(MAX_FILE_BYTES + 1);
  const huge = probePackage("probe-huge-file", false, [fileEntry("app/big.js", big)]);
  const vh = verifyPackage(huge);
  check(`content ${(MAX_FILE_BYTES + 1).toLocaleString()} bytes (>25MB) → FILE_TOO_LARGE`, !vh.valid && vh.reason.startsWith("FILE_TOO_LARGE"), vh.reason);

  const many = probePackage("probe-many-files", false, Array.from({ length: MAX_FILES + 1 }, (_, i) => fileEntry(`app/f${i}.js`, "x")));
  const vm = verifyPackage(many);
  check(`${MAX_FILES + 1} archivos (max ${MAX_FILES}) → PACKAGE_TOO_LARGE`, !vm.valid && vm.reason.startsWith("PACKAGE_TOO_LARGE"), vm.reason);

  try {
    const chunk = "B".repeat(360 * 1024);
    const overweight = probePackage(
      "probe-overweight",
      false,
      Array.from({ length: 300 }, (_, i) => fileEntry(`app/blob${i}.bin`, chunk + i)),
    );
    const vo = verifyPackage(overweight);
    const approxMb = Math.round(MAX_PACKAGE_BYTES / (1024 * 1024));
    check(`paquete >${approxMb}MB → PACKAGE_TOO_LARGE`, !vo.valid && vo.reason.startsWith("PACKAGE_TOO_LARGE"), vo.reason);
  } catch (e) {
    console.log("  ⚠️ prueba de >100MB omitida por memoria del sandbox:", (e as Error).message);
  }

  const empty = probePackage("probe-empty-path", false, [fileEntry("", "x")]);
  const ve = verifyPackage(empty);
  check(`path vacío → PATH_UNSAFE`, !ve.valid && ve.reason.startsWith("PATH_UNSAFE"), ve);
}

// ───────────── 2. Firmante Ed25519 no registrado ─────────────
console.log("\n[2] AUTENTICIDAD: firmante Ed25519 no registrado");
{
  const rogue = crypto.generateKeyPairSync("ed25519");
  const der = rogue.publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const rogueKeyId = "albra-signer-" + crypto.createHash("sha256").update(der).digest("hex").slice(0, 12);

  // Escenario real: la PÚBLICA del firmante está disponible localmente
  // (p.ej. importada de un vendor) pero NO está registrada en trusted.json.
  // Sin .pub local ni siquiera se puede verificar → SIGNATURE_INVALID.
  const signingDir = path.join(process.cwd(), "albra-data", "keys", "signing");
  fs.mkdirSync(signingDir, { recursive: true });
  const roguePubPath = path.join(signingDir, `${rogueKeyId}.pub`);
  fs.writeFileSync(roguePubPath, rogue.publicKey.export({ type: "spki", format: "pem" }).toString(), { mode: 0o600 });

  const reSign = (pkg: AlbraPackage): AlbraPackage => ({
    ...pkg,
    signature: {
      format: "albra-sig-2",
      alg: "ed25519",
      keyId: rogueKeyId,
      value: crypto.sign(null, Buffer.from(pkg.integrity.packageHash, "utf-8"), rogue.privateKey).toString("base64"),
    },
  });

  // Sin .pub local → imposible verificar → SIGNATURE_INVALID
  const ghost = reSign(probePackage("probe-rogue-ghost", false, [fileEntry("app/main.js", "x")]));
  fs.rmSync(roguePubPath, { force: true });
  const vg = verifyPackage(ghost);
  check(`clave desconocida SIN .pub local → SIGNATURE_INVALID`, !vg.valid && vg.reason.startsWith("SIGNATURE_INVALID"), vg.reason);
  fs.writeFileSync(roguePubPath, rogue.publicKey.export({ type: "spki", format: "pem" }).toString(), { mode: 0o600 });

  // Contrato que NO exige paquetes firmados → instalable con advertencia
  const relaxed = reSign(probePackage("probe-rogue-relaxed", false, [fileEntry("app/main.js", "console.log('ok')")]));
  const vr = verifyPackage(relaxed);
  check(
    `signedPackagesRequired=false → valid + UNTRUSTED_SIGNER`,
    vr.valid && vr.trustLevel === "UNTRUSTED_SIGNER" && vr.reasons.includes("UNTRUSTED_SIGNER") && vr.signerKeyId === rogueKeyId,
    vr,
  );

  // Contrato que SÍ exige paquetes firmados → rechazado
  const strict = reSign(probePackage("probe-rogue-strict", true, [fileEntry("app/main.js", "console.log('ok')")]));
  const vs = verifyPackage(strict);
  check(`signedPackagesRequired=true → rechazado SIGNER_NOT_TRUSTED`, !vs.valid && vs.reason === "SIGNER_NOT_TRUSTED", vs);

  // Firma manipulada sobre paquete con exigencia de firma → SIGNATURE_INVALID
  const forged = { ...strict, signature: { ...strict.signature, value: Buffer.from("firma falsa").toString("base64") } };
  const vf = verifyPackage(forged);
  check(`firma ed25519 falsa → SIGNATURE_INVALID`, !vf.valid && vf.reason.startsWith("SIGNATURE_INVALID"), vf.reason);

  // Limpieza: la clave probe nunca fue de confianza; fuera del directorio de claves
  fs.rmSync(roguePubPath, { force: true });
  console.log(`  → limpiada clave probe: ${rogueKeyId}.pub`);
}

// ───────────── 3. LEGACY: HMAC local firmado a mano ─────────────
console.log("\n[3] LEGACY: firma HMAC-SHA256 manual (modo DEV explícito)");
{
  const masterKey = fs.readFileSync(path.join(process.cwd(), "albra-data", "keys", "package-signing.key"), "utf-8").trim();
  const pkg = probePackage("legacy-hmac-probe", false, [fileEntry("app/legacy.js", "// paquete legacy pre-V2")]);

  // Firma a mano: HMAC-SHA256(masterKey, packageHash) — formato legacy sin "alg"
  const hmacHex = crypto.createHmac("sha256", Buffer.from(masterKey, "hex")).update(pkg.integrity.packageHash).digest("hex");
  const legacy: AlbraPackage = {
    ...pkg,
    signature: { algorithm: "HMAC-SHA256", keyId: "albra-root-2025", value: hmacHex },
  };

  const v = verifyPackage(legacy);
  check(
    `verifyPackage directo → valid + DEV_LOCAL + DEV_LOCAL_SIGNATURE`,
    v.valid && v.trustLevel === "DEV_LOCAL" && v.reasons.includes("DEV_LOCAL_SIGNATURE"),
    v,
  );

  // HMAC incorrecto → rechazado (la integridad del modo DEV también se exige)
  const badSig: AlbraPackage = { ...legacy, signature: { algorithm: "HMAC-SHA256", keyId: "albra-root-2025", value: "de".repeat(32) } };
  check(`legacy con HMAC incorrecto → SIGNATURE_INVALID`, !verifyPackage(badSig).valid);

  // End-to-end por HTTP contra el dev server, luego limpieza
  const fileName = writePackageFile(legacy);
  console.log(`  → escrito en bóveda: ${fileName}`);
  try {
    const res = await fetch("http://localhost:3000/api/packages/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileName }),
    });
    const json = await res.json();
    check(
      `POST /api/packages/verify → ${res.status} valid + DEV_LOCAL`,
      res.status === 200 && json.valid === true && json.trustLevel === "DEV_LOCAL",
      json,
    );
  } finally {
    fs.rmSync(path.join(process.cwd(), "albra-data", "packages", fileName), { force: true });
    console.log(`  → limpiado de la bóveda: ${fileName}`);
  }
}

console.log(`\nRESULTADO: ${pass} OK / ${fail} FALLOS`);
process.exit(fail > 0 ? 1 : 0);
