# Reto 01 · Agente de registro como proveedor

Aplicación del Reto Técnico 01 de Periferia IT Group. Prepara registros de
proveedor desde solicitudes normalizadas y un repositorio maestro ficticio.
La analista administrativa revisa campos, faltantes, soportes y el paquete para
firma. La aplicación no firma ni envía documentos.

Documentación auditada el **2026-11-04** contra PRD, código y pruebas existentes.
La arquitectura y decisiones se explican en [SOLUCION.md](SOLUCION.md).

## Estado y limitaciones

| Capacidad | Estado real |
|---|---|
| Chat, sesiones, procesamiento y llamadas visibles | Implementados; API local y recursos frontend probados |
| Lectura, mapeo, Excel P0 y armado de paquete | Implementados y probados con herramientas reales |
| OpenAI y Gemini | Tool calling implementado; conversación real no validada exitosamente |
| demo | Planificador determinista local sin claves ni API; ejecuta las herramientas reales |
| PDF P1 | No implementado; no genera un PDF ficticio |
| Portal P2 | Valores copiables; automatización real no implementada |
| Envío simulado P1 y módulo bonus | No implementados |

La autora reportó intentos reales fallidos: OpenAI devolvió
`credit_balance_exhausted` y Gemini `503 UNAVAILABLE`. La auditoría no repitió
esas llamadas; no son una conversación exitosa ni una medición de consumo.
Las pruebas automatizadas de proveedores utilizan respuestas controladas.

## Requisitos e instalación desde un clon limpio

- Node.js **20+**, según package.json. Auditoría ejecutada con Node 26.13.0 y npm
  11.20.0; no se ejecutó específicamente con Node 20.
- Git y npm. Backend TypeScript estricto y ESM; Express 5, Zod 3, ExcelJS 4,
  tsx 4 y Google Gen AI 2.x. package-lock.json fija las versiones instalables.
- No se requiere base de datos, React, Bun ni Docker.

PowerShell, desde la carpeta donde quieras clonar:

```powershell
git clone https://github.com/sargaby/reto-01-periferia.git
cd reto-01-periferia
npm.cmd ci
Copy-Item .env.example .env
notepad .env
```

El remoto corresponde al origin inspeccionado; el acceso depende de los permisos
del repositorio. No se cronometró una instalación limpia ni el arranque del PRD.
No sobrescribas un `.env` existente. Se usa `npm.cmd`/`npx.cmd` para evitar el
bloqueo de scripts `.ps1` de PowerShell; otras terminales pueden usar npm/npx.

## Configuración y arranque

Para demostrar sin servicios externos, establece en `.env`:

```dotenv
LLM_PROVIDER=demo
REFERENCE_DATE=2026-11-03
```

Frontend y backend se levantan desde la raíz con un solo proceso:

```powershell
npm.cmd run dev
```

Abre http://localhost:3000, salvo otro PORT. Si tsx falla con el error histórico
`uv_os_get_passwd ENOMEM`, usa la ruta compilada comprobada:

```powershell
npm.cmd run build
npm.cmd start
```

dev usa tsx watch, build ejecuta tsc y start ejecuta dist/src/server.js. No se
necesita otro servidor para el frontend. Se escucha en `0.0.0.0` y process.env.PORT.
Reinicia tras cambiar proveedor, variables o los Markdown de instrucciones.
Las variables del proceso prevalecen sobre `.env`: cambia o quita una variable
fijada con `$env:LLM_PROVIDER` para usar el valor del archivo.

| Variable real | Predeterminado | Uso |
|---|---|---|
| PORT | 3000 | Puerto HTTP, entero 1–65535 |
| LLM_PROVIDER | openai | demo, openai o gemini; vacío conserva openai |
| REFERENCE_DATE | Fecha UTC actual | Fecha válida YYYY-MM-DD para vigencias del chat |
| OPENAI_API_KEY | Sin valor | Solo necesaria al seleccionar openai |
| OPENAI_MODEL | Sin valor | Modelo OpenAI con herramientas, JSON y Chat Completions |
| GEMINI_API_KEY | Sin valor | Clave de Google AI Studio, solo al seleccionar gemini |
| GEMINI_MODEL | Sin valor | Modelo de Gemini Developer API |
| LLM_MAX_ITERATIONS | 25 | Llamadas máximas al adaptador por turno |
| LLM_MAX_SESSION_TOKENS | 100000 | Presupuesto conservador por sesión para proveedores reales |
| LLM_MAX_TOTAL_TOKENS | 1000000 | Presupuesto por instancia para proveedores reales |
| LLM_MAX_OUTPUT_TOKENS | 4096 | Salida máxima por petición real |
| LLM_TIMEOUT_MS | 30000 | Timeout por petición remota |
| MAX_SESSIONS | 100 | Sesiones acumuladas máximas en memoria |

Solo hacen falta la clave y el modelo del proveedor seleccionado. Las claves se
cargan exclusivamente en backend; no las publiques ni las pegues en el chat.
No hay modelo por defecto en código. La configuración local inspeccionada
selecciona demo y contiene gpt-4o-mini y gemini-3.8-flash como identificadores
alternativos; esto no prueba la configuración desplegada en Render.

## Proveedores, sesiones y límites

- **demo:** no es un LLM. Reconoce un identificador de caso por mensaje y emite
  lectura → mapeo → generación → paquete a través del registro Zod compartido.
  Los argumentos siguientes y el resumen se derivan de resultados reales. No
  interpreta preguntas generales ni corrige datos. PDF/portal mantienen sus
  limitaciones y continúan al paquete. No necesita claves, no hace peticiones
  externas y muestra cero tokens. Health y frontend indican demostración.
- **openai:** fetch a Chat Completions; conserva tool_calls e IDs, valida la
  respuesta y maneja errores de API y timeout.
- **gemini:** SDK @google/genai. Comprueba el modelo y fuerza una llamada de
  capacidad antes del primer procesamiento; no ejecuta esa herramienta de
  prueba. Conserva firmas de continuación y traduce functionCall/functionResponse.
  La ejecución de herramientas y los reintentos automáticos están desactivados.

Los límites de iteraciones y sesiones se mantienen en demo. En proveedores reales
se reserva antes de cada petición una cota por bytes UTF-8, margen y salida
máxima. No es consumo facturado ni un tokenizador; puede detenerse antes del
consumo real. Las reservas fallidas no se reintegran. La sonda inicial Gemini
tiene salida máxima de 1024 tokens y su consumo válido se suma al turno, con
reserva adicional mientras esté pendiente. Una prueba controlada Gemini usa
200000 de presupuesto por sesión; no implica consumo real ni garantía remota.

Las sesiones son UUID en memoria. Se comprueba un umbral de 500 eventos antes de
cada turno; un turno puede agregar varios. No hay caducidad ni borrado de sesión
en servidor: Nueva conversación solo cambia el estado del navegador. Hay una
sola solicitud en procesamiento por instancia para proteger archivos compartidos;
las concurrentes reciben 409. Reiniciar pierde sesiones y contadores.

## Ejemplo de chat y revisión humana

```text
Procesa el caso "co-industrias-delta". Dime qué campos faltan,
qué soportes debo actualizar y si el paquete está listo para firma.
No envíes nada todavía.
```

Al terminar el turno se muestran nombre, argumentos y resultados de cada llamada.
Preparar un paquete o un mapeo con advertencias obliga a preguntar por revisión.
Responder inmediatamente `Sí, confirmo` reconoce esa revisión, sin cambiar datos.
Otra intervención invalida esa oportunidad. `envía` informa que no está implementado:
no genera ENVIO-SIMULADO.md ni envía correo.

## Demo sin modelo y pruebas

**Detén primero el servidor con Ctrl+C.** demo.ts limpia out/ al comenzar; no la
ejecutes en un servicio activo ni en Render durante una demostración.

```powershell
$env:REFERENCE_DATE = '2026-11-03'
npm.cmd run demo
```

demo equivale a tsx demo.ts y no carga `.env`: lee la fecha del proceso. Sin esa
variable utiliza 2026-11-03, a diferencia del chat que usa UTC actual.
Alternativa sin tsx, también sin modelo:

```powershell
npm.cmd run build
node dist/demo.js
```

Validación estática y toda la suite:

```powershell
npm.cmd run typecheck
npm.cmd run build
node --test tests/*.test.mjs
node --check web/app.js
```

No existe un script npm test. La suite necesita compilar antes y utiliza copias
temporales de fixtures y puertos propios. No limpia out/ del proyecto ni requiere
claves externas.

### Evidencia revalidada el 2026-11-04

- `npx.cmd --no-install tsc --noEmit` y `npx.cmd --no-install tsc`: correctos.
- `node --test tests/*.test.mjs`: **17 aprobadas, 0 fallidas**: 7 de agente,
  5 de Gemini y 5 de demo. La suite demo procesó los cuatro casos por HTTP.
- demo.ts compilado: correcto con REFERENCE_DATE=2026-11-03 en una copia temporal
  de fixtures; no se limpió out/ ni se alteró un servidor activo del proyecto.
- Excel reabierto y comparado por hojas, celdas, etiquetas y valores del maestro;
  trazabilidad, faltantes, soportes, checklist, borradores sin datos bancarios,
  registros, sesiones y revisión comprobados.
- Negativos: inexistente, traversal, argumentos inválidos, JSON corrupto, mapeo
  alterado, soporte ausente/eliminado, fecha inválida y recuperación de sesión.
- JS sin errores de sintaxis y recursos HTML/JS/CSS comprobados por HTTP local.
  No se afirma revisión visual de navegador ni uso exitoso de un LLM remoto.
- No se midieron latencias, costo observado, porcentaje de cobertura ni arranque
  en menos de dos minutos. Las respuestas remotas de tests son controladas.

| Caso y país | Llenos | Faltantes | Requiere confirmación | Salida y observaciones |
|---|---:|---:|---:|---|
| co-industrias-delta · Colombia | 17 | 0 | 0 | Excel; Cámara vencida |
| ec-corp-andina · Ecuador | 13 | 1 | 1 | PDF pendiente; Cámara vencida y soporte tributario ausente |
| hn-agroexport-sula · Honduras | 9 | 1 | 1 | Excel; Cámara y parafiscales vencidos |
| pa-logistica-istmo · Panamá | 8 | 0 | 1 | Valores copiables; Cámara vencida |

Con fecha 2026-11-03 **ningún paquete queda listo para firma**. Cámara vence el
2026-09-30 y parafiscales el 2026-08-31; Ecuador exige un certificado tributario
ausente. Es un bloqueo esperado de negocio, no un fallo del programa. Además,
PDF/portal no aportan un formulario soportado y sus paquetes quedan incompletos.
Faltan número de contribuyente especial en Ecuador y referencias comerciales en
Honduras; esos campos no bloquean por sí solos la firma.

## Estructura y salidas

```text
agent/prompt.md                         comportamiento del agente
src/server.ts                          configuración y arranque
src/app.ts                             API y frontend estático
src/agent.ts                           ciclo, sesiones, límites y revisión
src/llm/                               contrato, selección y tres adaptadores
src/tools/proveedor.ts                  cuatro herramientas P0
src/tools/registry.ts                   esquemas, validación y allowlist
src/knowledge/registro-proveedor.md     conocimiento del proceso
web/                                   chat HTML/CSS/JavaScript
fixtures/reto-01/                       datos de entrada, no modificar
demo.ts                                herramientas sin modelo
tests/                                 suite Node.js
out/                                   salidas de ejecución
```

out/<caso>/ puede contener mapeo.json, faltantes.md, log.jsonl y formulario.xlsx.
Panamá incluye valores-portal.md. paquete/ contiene Excel cuando corresponde,
soportes disponibles, checklist.md y borrador-correo.md. Los soportes vencidos se
copian y marcan como tales. También existe out/log.jsonl global. Los registros
incluyen ts, herramienta, ok, resumen y sessionId, sin volcar datos bancarios.
La demo directa añade out/pruebas/ para negativos aislados.

Los archivos se generan en el servidor; **no hay endpoint de descarga** ni se
sirve out/ por HTTP. Para revisar Excel en la defensa, genera y abre los archivos
en local. Los soportes son placeholders .txt proporcionados por el reto.

## API

| Método y ruta | Contrato |
|---|---|
| GET /api/health | ok, provider, model, configured; demonstration:true solo en demo |
| POST /api/chat | message y sessionId opcional; omitirlo crea sesión |
| GET /api/sessions/:id | Historial visible, revisión y contadores |

El chat devuelve sessionId, reply, toolCalls, needsConfirmation, history y tokens.
Las llamadas son acumulativas por sesión. configured indica configuración presente,
no acceso remoto exitoso. No se acepta historial enviado por el cliente. Errores:
400 entrada/JSON inválidos, 404 sesión/ruta inexistente, 409 ocupación, 429 capacidad,
503 proveedor sin configurar y 502 error remoto o formato de respuesta. Un error
de herramienta puede aparecer en un turno HTTP 200 con ok:false: 200 no significa
que todas las operaciones hayan tenido éxito.

## Render: URL, configuración y persistencia

URL proporcionada por la autora:
[reto-01-periferia-7phu.onrender.com](https://reto-01-periferia-7phu.onrender.com/).
**Disponibilidad pendiente de verificación externa:** se intentó consultar / y
/api/health, pero las herramientas del entorno no pudieron acceder. No demuestra
que el servicio esté caído. No se realizó POST en el servicio publicado.

Configuración informada por la autora, no inspeccionada en el panel:

| Ajuste | Valor informado |
|---|---|
| Build Command | npm ci && npm run build |
| Start Command | npm start |

No hay render.yaml, Dockerfile ni configuración de despliegue versionada en el
árbol auditado. Los comandos son coherentes con package.json; el build requiere
las dependencias de desarrollo que incluyen tsc. El servidor usa PORT y 0.0.0.0.
Proveedor, modelo, fecha, versión de Node y plan remotos quedan por confirmar.
La ruta compatible de health es /api/health; no se verificó su ajuste en Render.

Render usa filesystem efímero por defecto: sin persistencia configurada, out/ y
logs se pierden en reinicios o redeploys. Las sesiones en memoria se pierden incluso
con disco. No se comprobó que exista un disco persistente; no se promete retención.
Fuentes: [Render Persistent Disks](https://render.com/docs/disks) y
[Render Web Services](https://render.com/docs/web-services).

## Defensa y pendientes

1. Comprobar health en el enlace público o en local y mostrar el proveedor activo.
   Si es demo, declarar que no utiliza un LLM.
2. Procesar Colombia; abrir las cuatro llamadas, checklist y Excel local.
3. Procesar Honduras para mostrar faltantes y RTN con revisión; Ecuador para PDF
   pendiente y soporte ausente; Panamá para los valores copiables.
4. Explicar los bloqueos de firma; responder Sí, confirmo y después envía para
   mostrar que no se realiza un envío.
5. Ejecutar tests y, solo con servidor detenido, demo.ts. La autora debe poder
   explicar el código y mantener el enlace disponible durante la defensa.

Pendientes de la autora: verificar URL/health y configuración de Render; aportar
fecha y evidencia sanitizada de errores externos; precisar el uso de ChatGPT;
completar revisión visual. PDF P1, envío simulado P1 y bonus no se implementaron.
No se garantiza una nota: el PRD anuncia 70/100, sin rúbrica detallada para calcularla.

Auditoría Git: .env, node_modules/ y out/ están ignorados y no están versionados.
Excluirlos también de cualquier ZIP. No incluir claves ni archivos de ejecución.
Esta auditoría no realiza commit ni push.
