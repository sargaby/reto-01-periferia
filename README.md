# Reto 01 · Registro como proveedor

Fase 6: chat HTML/CSS/JS, sesiones en memoria, ciclo compartido y modo demostración
local sin API. OpenAI y Google Gemini se conservan. Las herramientas P0 y demo.ts siguen intactas.
No se implementan PDF P1, envío simulado, firma, portal real ni bonus.

## Demostración funcional sin servicios externos

Desde PowerShell en la raíz, con el servidor detenido:

```powershell
npm.cmd run build
$env:REFERENCE_DATE = '2026-11-03'
node dist/demo.js
node --test tests/*.test.mjs
$env:LLM_PROVIDER = 'demo'
npm.cmd start
```

Abrir http://localhost:3000 (o el PORT configurado). No hacen falta claves ni
modelos configurados. Las variables del proceso prevalecen sobre `.env`. También
se puede guardar `LLM_PROVIDER=demo` y `REFERENCE_DATE=2026-11-03` en `.env`.
No ejecutar `demo.ts`/`dist/demo.js` mientras el servidor esté activo: limpia out/.

Solicitudes admitidas, una por mensaje:

- `Procesa el caso "co-industrias-delta"`
- `Procesa el caso "ec-corp-andina"`
- `Procesa el caso "hn-agroexport-sula"`
- `Procesa el caso "pa-logistica-istmo"`

El modo demo no es un LLM ni una conexión simulada a uno: es un planificador
determinista separado en `src/llm/demo.ts`. Emite las cuatro llamadas al registro
existente, tomando campos y mapeo de los resultados anteriores. Los archivos,
checklists y resúmenes proceden de las herramientas reales; no hay resultados
de negocio precargados. Si falla la lectura o el mapeo, lo informa; PDF/portal
continúan al paquete y conservan la limitación de formato. No interpreta lenguaje
general, no corrige datos y no procesa varios casos por mensaje.

La UI muestra **MODO DEMOSTRACIÓN · Sin LLM ni API externa**. Health devuelve
`provider:"demo", model:null, configured:true, demonstration:true`. El consumo y
la reserva de tokens son cero porque no existe un modelo externo. Se mantienen
los límites de iteraciones, sesiones, historial y serialización; los presupuestos
de tokens continúan aplicándose sin cambios a OpenAI/Gemini.

La confirmación solo reconoce revisión en el turno siguiente. `envía` informa
que no está implementado; no crea ENVIO-SIMULADO.md ni realiza acciones externas.
Para volver a un proveedor real, cambiar LLM_PROVIDER y reiniciar. Si lo fijaste
en PowerShell, cambiar `$env:LLM_PROVIDER` o quitarlo antes de usar `.env`.

Resultados comprobados con fecha 2026-11-03:

| Caso | Llenos / faltantes / confirmar | Archivo | Bloqueos |
|---|---|---|---|
| Colombia | 17 / 0 / 0 | Excel real | Cámara vencida |
| Ecuador | 13 / 1 / 1 | PDF pendiente | Cámara vencida y soporte tributario ausente |
| Honduras | 9 / 1 / 1 | Excel real | Cámara y parafiscales vencidos |
| Panamá | 8 / 0 / 1 | Valores de portal | Cámara vencida; formulario no soportado |

Todos los paquetes quedan con listo_para_firma:false. Ecuador carece de número
de contribuyente especial; Honduras de referencias comerciales. Esos campos
faltantes se informan y no constituyen por sí mismos un bloqueo.

## Verificación integral de la Fase 6

- TypeScript sin errores y compilación a dist/ correctos.
- Las 12 pruebas anteriores pasaron antes de modificar código. Al finalizar,
  `node --test tests/*.test.mjs` pasó **17 pruebas**; no se contactaron APIs reales.
- `demo.ts` se ejecutó compilado con referencia 2026-11-03, después de comprobar
  que no había servidor escuchando en los puertos de la aplicación. Pasó todas
  sus comprobaciones y confirmó hashes de fixtures intactos.
- Los cuatro casos se probaron de nuevo mediante HTTP en el servidor compilado,
  en modo demo, sin claves. Health, sesiones, HTML, JS y CSS respondieron 200.
- Las nuevas pruebas HTTP operan sobre copias temporales de fixtures y bloquean
  fetch a destinos externos. Reabren Excel, comprueban hojas, etiquetas y cada
  valor contra el maestro; verifican rutas de trazabilidad, faltantes, checklist,
  soportes copiados/vencidos/ausentes, auditoría y ausencia de datos bancarios en
  borradores. También comprueban redacción de un secreto de prueba en respuestas.
- Se probaron caso inexistente, traversal, JSON corrupto, soporte eliminado tras
  una ejecución previa, recuperación de sesión, confirmación y envío bloqueado.
- `node --check web/app.js` pasó. La validación visual está **pendiente**:
  el navegador integrado no estaba disponible y Computer Use detuvo el acceso a
  Chrome porque no pudo determinar su URL con suficiente confianza.

No se cambian OpenAI/Gemini, no se despliega ni se verifica el uso real de un LLM.
Las ejecuciones se hicieron con Node 26.13.0; Node 20 no se ejecutó directamente.
La ruta compilada evita el ENOMEM de tsx conocido en este entorno.

## Probar desde PowerShell

Requiere Node 20+ y npm. Ejecutar desde la raíz del repositorio:

```powershell
npm.cmd install
if (!(Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
```

En `.env`, seleccionar `LLM_PROVIDER=openai`, `LLM_PROVIDER=gemini` o `LLM_PROVIDER=demo`.
Solo hacen falta la clave y el modelo del proveedor seleccionado:

- OpenAI: `OPENAI_API_KEY` y `OPENAI_MODEL`; el modelo debe soportar Chat
  Completions, function tools, JSON mode y `max_completion_tokens`.
- Gemini: `GEMINI_API_KEY` de Google AI Studio y `GEMINI_MODEL`, con el nombre
  exacto del modelo accesible en tu proyecto. Se usa Gemini Developer API,
  sin Vertex AI ni credenciales de Google Cloud.

LLM_PROVIDER vacío o ausente mantiene OpenAI por compatibilidad. No hay modelo
seleccionado por defecto. Para cambiar proveedor, editar `.env`, detener el
proceso con Ctrl+C y volver a arrancarlo; las sesiones en memoria se reinician.
No publiques la clave ni la pegues en el chat. Solo el backend carga `.env`.

```powershell
npm.cmd run dev
```

Abrir http://localhost:3000. Frontend y backend se sirven desde el mismo proceso.
Si `tsx` falla con `uv_os_get_passwd ENOMEM`, usar la ruta compilada comprobada:

```powershell
npm.cmd run build
npm.cmd start
```

El proceso escucha en `0.0.0.0` y respeta `PORT`. Sin clave/modelo arranca, sirve
la UI y responde health; el chat devuelve 503 con instrucciones, sin fingir una
conversación. Reiniciar tras cambiar variables o instrucciones Markdown.

Ejemplo de mensaje: `Procesa el caso "co-industrias-delta". Dime qué campos
faltan, qué soportes debo actualizar y si el paquete está listo para firma.`
Las llamadas aparecen con nombre, argumentos y resultado al finalizar el turno.
El frontend muestra procesamiento y destaca revisión pendiente. Una confirmación
solo reconoce la revisión del turno inmediatamente anterior; nunca envía archivos.

## Variables de entorno

| Variable | Predeterminado | Uso |
|---|---:|---|
| PORT | 3000 | Puerto HTTP |
| LLM_PROVIDER | openai | Selección openai, gemini o demo |
| REFERENCE_DATE | UTC actual | Fecha YYYY-MM-DD opcional para las vigencias del chat |
| OPENAI_API_KEY | sin valor | Clave solo en backend |
| OPENAI_MODEL | sin valor | Modelo elegido por el usuario |
| GEMINI_API_KEY | sin valor | Clave de Google AI Studio, solo backend |
| GEMINI_MODEL | sin valor | Modelo Gemini elegido por el usuario |
| LLM_MAX_ITERATIONS | 25 | Máximo de llamadas al modelo por turno |
| LLM_MAX_SESSION_TOKENS | 100000 | Presupuesto conservador por sesión |
| LLM_MAX_TOTAL_TOKENS | 1000000 | Presupuesto compartido por toda la instancia |
| LLM_MAX_OUTPUT_TOKENS | 4096 | Salida máxima por llamada |
| LLM_TIMEOUT_MS | 30000 | Timeout de cada petición al proveedor |
| MAX_SESSIONS | 100 | Sesiones máximas en memoria |

Antes de cada petición se reserva el tamaño UTF-8 de mensajes y esquemas, más
margen de protocolo y salida máxima. Es una cota conservadora, no un tokenizador.
si un mensaje tiene continuación opaca, se cuenta la mayor representación en
lugar de duplicar la misma llamada en sus dos formatos.
Puede agotar el presupuesto antes del consumo real. Las reservas no se reintegran
si una petición falla. Se muestra también el consumo reportado en respuestas
válidas del proveedor. El límite global evita eludir el presupuesto creando sesiones.
Los contadores se reinician con el proceso; no sustituyen cuotas del proveedor.
Cada sesión admite hasta 500 eventos; no se persiste al reiniciar.

Gemini verifica el modelo al primer mensaje de la instancia: consulta `models.get`
y, si admite generateContent, fuerza una llamada de capacidad que no ejecuta
ninguna herramienta. Los metadatos por sí solos no prueban function calling.
La sonda tiene un máximo de 1024 tokens de salida y su consumo se suma al turno.
Se reservan 4096 tokens adicionales mientras esté pendiente esta comprobación;
se mantiene la política conservadora de no reintegrar reservas. El resultado
se cachea en la instancia si pasa. Una sonda fallida no declara el modelo válido.
Los timeouts se aplican por petición, también en la consulta y la sonda.
El límite existente de 100000 se conserva. La prueba Gemini de flujo completo
usa 200000: con 100000, la cota conservadora detuvo el caso tras las cuatro
herramientas y antes del resumen final. Para reproducir el flujo completo,
configurar `LLM_MAX_SESSION_TOKENS=200000` y reiniciar; el consumo real será
distinto con un modelo remoto. La prueba de corte también confirmó que
no se omite el presupuesto al utilizar el segundo proveedor.

## API

- `GET /api/health`: `{ ok, provider, model, configured }`, sin claves. `configured`
  solo indica configuración presente; no verifica acceso al proveedor.
- `POST /api/chat`: `{ message, sessionId? }`. Omitir sessionId crea una sesión;
  reutilizar el UUID recibido conserva contexto. Responde `{ sessionId, reply,
  toolCalls, needsConfirmation, history, tokens }`. toolCalls incluye el historial
  acumulado de llamadas de esa sesión. No se acepta historial aportado por el cliente.
- `GET /api/sessions/:id`: historial visible completo, confirmación y contadores;
  no devuelve el system prompt ni la configuración privada del adaptador.

Errores: 400 entrada inválida, 404 sesión inexistente, 409 procesamiento en curso,
429 capacidad de sesiones/historial, 503 proveedor sin configurar y 502 fallo de
proveedor/formato. Los errores de herramientas llegan al modelo para recuperación.
Los límites de iteraciones/tokens producen respuesta parcial y conservan resultados.
Se serializa el procesamiento en toda la instancia porque out/<caso> es compartido.
No se sirve out/ por HTTP ni se agrega envío alguno.

## Arquitectura

- `src/server.ts`: entorno, arranque y enlace del adaptador seleccionado.
- `src/app.ts`: Express, API y frontend estático.
- `src/agent.ts`: bucle, sesiones, presupuestos y revisión entre turnos.
- `src/llm/adapter.ts`: contrato propio, independiente del proveedor.
- `src/llm/openai.ts`: fetch nativo a OpenAI; timeout y errores sanitizados.
- `src/llm/gemini.ts`: SDK oficial @google/genai, comprobación de capacidades,
  declaraciones JSON Schema, functionCall/functionResponse y firmas de continuación.
- `src/llm/provider.ts`: selección de proveedor y lectura de sus variables.
- `src/llm/demo.ts`: planificador determinista local, sin peticiones de red.
- `src/tools/registry.ts`: esquemas JSON derivados de Zod, allowlist y validación
  previa; audita rechazos sin duplicar logs de ejecuciones P0.
- `src/tools/proveedor.ts`: herramientas P0 existentes, sin modificaciones.
- `agent/prompt.md`: comportamiento; `src/knowledge/`: reglas separadas.
- `web/`: chat sin framework, renderizado con textContent, sin interpretar HTML.

El protocolo conserva los mensajes assistant con tool_calls y las respuestas
tool correlacionadas por ID. Referencia:
[Function calling de OpenAI](https://developers.openai.com/api/docs/guides/function-calling).
Gemini utiliza `@google/genai` 2.32.0, que ya estaba instalado; se conserva el rango
2.x de package.json, compatible con el objetivo Node 20. No se cambia OpenAI ni
se incrustan datos del maestro en el prompt. El ciclo solo transporta una
continuación opaca y una reserva adicional; no interpreta datos de ningún SDK.
Las firmas y partes internas Gemini permanecen fuera de los logs y del historial
visible. AFC, continuaciones y reintentos automáticos del SDK están desactivados:
solo el ciclo común decide ejecutar herramientas.
Referencias: [SDK oficial](https://googleapis.github.io/js-genai/release_docs/index.html)
y [metadatos de modelos](https://ai.google.dev/api/models).

## Herramientas, salidas y demo P0

Las cuatro herramientas siguen siendo lectura, mapeo, generación Excel y paquete.
Validan Zod y devuelven JSON `{ ok, data }` o `{ ok: false, error }` sin propagar
excepciones. Rutas ancladas al contexto, fixtures de solo lectura y logs globales
y por caso en out/. Un rechazo de argumentos también queda auditado.

PDF devuelve pendiente explícito; portal genera valores-portal.md y formato no
soportado. Soportes ausentes/vencidos bloquean la firma; campos faltantes no.
Sin formulario soportado, el paquete se informa incompleto. Los borradores no
incluyen datos bancarios.

```powershell
npx.cmd tsc --noEmit
npx.cmd tsx demo.ts
```

La demo limpia out/; ejecutarla con el servidor detenido. No requiere API key.
Por defecto usa 2026-11-03; permite REFERENCE_DATE en el entorno del proceso.
En esa fecha: CO 17/0/0; EC 13/1/1; HN 9/1/1; PA 8/0/1 (llenos/faltantes/confirmar).
Todos los paquetes bloqueados por Cámara vencida; HN además por parafiscales y
EC por soporte tributario ausente. Solo CO y HN producen Excel.

## Verificación real de la Fase 5

Ejecutado en Node 26.13.0:

- `npx.cmd --no-install tsc --noEmit`: correcto.
- `npx.cmd --no-install tsc` y `node dist/demo.js`: demo P0 completa, sin regresión.
- `node --test tests/agent.test.mjs tests/gemini.test.mjs`: 12 pruebas correctas. Modelo/fetch controlados
  prueban el ciclo con las cuatro herramientas reales, revisión entre turnos,
  validación, límites, concurrencia, recuperación, protocolo OpenAI y errores.
- La prueba Gemini usa el SDK oficial con HTTP local controlado y el endpoint
  de chat: genera llamadas y ejecuta las cuatro herramientas reales, verifica
  las firmas de continuación y los logs. Prueba también llamadas paralelas sin
  IDs, modelos sin capacidad, errores y timeout. No contacta a Google.
- Se arrancó/detuvo el servidor compilado para openai y gemini: health mostró
  cada selección con configured:false. La fábrica admite una sola clave configurada.
- Servidor compilado en PORT=3017: frontend y health 200; chat sin clave 503;
  recuperación de historial 200. También se probaron rutas y JSON inválidos.
- `node --check web/app.js`: correcto. No se hizo una revisión visual en navegador.
- `npx.cmd --no-install tsx demo.ts`: continúa fallando antes de cargar la app
  con ENOMEM en os.userInfo. No se alteraron permisos para evitarlo.

Para repetir sin tsx:

```powershell
npx.cmd tsc
node dist/demo.js
node --test tests/agent.test.mjs tests/gemini.test.mjs
```

No había claves ni modelos configurados de OpenAI o Gemini: **no se probó una
conversación con ninguno de los dos proveedores reales**, ni se verificó un
modelo concreto de Google. Los tests controlados no prueban credenciales, cuota, modelo
ni la calidad de respuesta del proveedor. Tras configurar .env, enviar el ejemplo
anterior y comprobar las cuatro llamadas, el resumen y la pregunta de revisión.

Link público y despliegue: pendientes. PDF P1, envío simulado P1 y bonus pendientes.
