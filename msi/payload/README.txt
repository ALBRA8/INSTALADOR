ALBRA — Plano de control
========================

Contenido de esta carpeta:

  bin\      Servicios de Windows ALBRA (wrappers + configuración)
  core\     Núcleo del INSTALADOR  — API de operaciones 127.0.0.1:3000
  panel\    PANEL DE CONTROL       — consola del operador 127.0.0.1:3100
  runtime\  Node.js embebido (no requiere instalaciones adicionales)

Servicios instalados:
  AlbraCore   (automático)
  AlbraPanel  (automático)

Acceso: menú Inicio > ALBRA > "ALBRA Panel"

Datos y bóveda: C:\ProgramData\ALBRA   (ALBRA_HOME)

Requisito para instalar agentes: Docker Desktop.
Si no está presente, el PANEL lo informará honestamente
(DOCKER_PREFLIGHT_FAILED) en el momento de instalar un agente.

Desinstalación: Configuración de Windows > Aplicaciones > ALBRA
(se detienen y eliminan los servicios; ALBRA_HOME se conserva).
