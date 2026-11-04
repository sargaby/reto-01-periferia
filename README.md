# Reto 01 · Registro como proveedor

Fase 4: herramientas P0 y demo sin LLM. El servidor conserva únicamente
`GET /api/health`; chat, proveedor LLM y ciclo del agente siguen pendientes.

## Arranque y comandos

Requiere Node 20+ y npm. Ejecutar desde la raíz:

```powershell
npm.cmd install
npm.cmd run dev
```

Un proceso sirve API y frontend en http://localhost:3000. En PowerShell se usa
`npm.cmd`/`npx.cmd` para evitar el bloqueo de los scripts `.ps1`.

```powershell
npx.cmd tsc --noEmit
npx.cmd tsx demo.ts
```

También existen `npm run typecheck`, `npm run build`, `npm start` (tras compilar)
y `npm run demo`. La demo limpia **out/** al comenzar y no requiere API key.
Rechaza enlaces en esa carpeta antes de eliminarla.

## Configuración

`.env.example` describe `PORT` (3000 por defecto) y las variables LLM reservadas,
aún sin utilizar. Nunca incluir claves en frontend, repositorio o logs.
Las herramientas reciben `{ directory, sessionId, referenceDate? }` como contexto.
`directory` es la raíz del proyecto; `referenceDate` usa `YYYY-MM-DD`, o UTC actual
si se omite. La demo fija 2026-11-03 para resultados reproducibles; puede cambiarse:

```powershell
$env:REFERENCE_DATE = '2026-09-03'
npx.cmd tsx demo.ts
Remove-Item Env:REFERENCE_DATE
```

`REFERENCE_DATE` se lee del entorno del proceso de demo; no requiere `.env`.

## Herramientas disponibles

`src/tools/proveedor.ts` exporta objetos `leer_solicitud`, `mapear_campos`,
`generar_formulario` y `armar_paquete`. Sus nombres de modelo serán
`proveedor_<export>`. Tienen `description`, `args` con Zod y
`execute(args, ctx)` que devuelve JSON serializado `{ ok, data }` o
`{ ok: false, error }`. Validan también cuando se invocan directamente.

- Lectura de correo, plantilla y soportes, con validación de estructura.
- Mapeo por glosario, rutas del maestro, estados y confirmación tributaria.
  Rechaza campos ajenos a la plantilla, incluidos datos bancarios no solicitados.
- Excel real con ExcelJS, hojas/celdas exactas y faltantes vacíos. El mapeo
  completo se contrasta con el maestro antes de escribirlo.
- PDF P1 pendiente: devuelve error explícito, conserva reportes, no crea PDF.
- Portal: devuelve `formato no soportado`, crea `valores-portal.md` para copiar.
- Paquete con Excel cuando corresponde, soportes existentes (también vencidos),
  checklist y borrador sin información bancaria. Los soportes ausentes/vencidos
  bloquean la firma; los campos faltantes no la bloquean. Sin formulario
  soportado el paquete se indica incompleto y tampoco queda listo para firma.

Las rutas se resuelven desde el contexto y rechazan traversal y enlaces.
Se generan `out/log.jsonl` y `out/<caso>/log.jsonl`, con resumen sin valores de
negocio. Un caso inválido registra solo globalmente si su nombre es inseguro.
Un fallo de auditoría devuelve error, incluso si quedaron salidas parciales.

## Salidas y resultados comprobados

En `out/<caso>/`: `mapeo.json`, `faltantes.md`, `log.jsonl`, formulario Excel
cuando corresponde y `paquete/`. Panamá incluye `valores-portal.md`.
`out/pruebas/` contiene copias alteradas de fixtures para pruebas negativas.

Con fecha 2026-11-03:

| Caso | Llenos | Faltantes | Confirmación | Resultado |
|---|---:|---:|---:|---|
| co-industrias-delta | 17 | 0 | 0 | Excel; Cámara vencida |
| ec-corp-andina | 13 | 1 | 1 | PDF pendiente; Cámara vencida y soporte tributario ausente |
| hn-agroexport-sula | 9 | 1 | 1 | Excel; Cámara y parafiscales vencidos |
| pa-logistica-istmo | 8 | 0 | 1 | Valores de portal; Cámara vencida |

Ningún paquete queda listo para firma en esa fecha.

## Verificación ejecutada

`npx.cmd --no-install tsc --noEmit` pasó. `npx.cmd --no-install tsx demo.ts`
falló antes de cargar la aplicación con `uv_os_get_passwd ENOMEM` en tsx bajo
Node 26.13.0. No se cambiaron permisos ni dependencias para eludir ese fallo.
Se verificó la demo compilada con:

```powershell
npx.cmd tsc
node dist/demo.js
```

La ejecución pasó: reapertura y comprobación de todas las etiquetas/valores
Excel, copias del formulario, archivos de paquete, ausencia de datos bancarios
en borradores, logs, hashes de fixtures, caso inexistente, traversal, campo
faltante, fechas límite de vigencia, soporte ausente, JSON corrupto y rechazo
de mapeo alterado. Los fixtures corruptos se crean solo bajo `out/pruebas/`.
Node 20 está configurado como mínimo, pero la ejecución se verificó con Node 26.

## API, arquitectura y pendientes

`GET /api/health` devuelve `{ "ok": true, "provider": null, "model": null }`.
Las demás rutas API devuelven 404. No existe integración de herramientas al chat.
`agent/prompt.md`, `src/llm/adapter.ts` y `src/knowledge/` conservan su preparación
para fases posteriores. Las herramientas son importables sin servidor.

Pendientes: PDF P1, envío simulado P1 con confirmación, agente/chat y despliegue.
Link público: pendiente. Consultar `SOLUCION.md` para cobertura y decisiones.
