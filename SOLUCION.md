# Solución · Reto 01

Estado real: Fase 4, herramientas P0 verificadas mediante demo compilada sin LLM.
El chat y el ciclo del agente no están implementados.

## 1. Problema en una frase y a quién le duele

La analista administrativa repite la transcripción de datos del proveedor y
necesita formularios y soportes con trazabilidad para revisión y firma humana.

## 2. Arquitectura

```text
web/ → Express (solo health; sin conexión a herramientas todavía)
         → contrato src/llm/adapter.ts (proveedor pendiente)
demo.ts → src/tools/proveedor.ts → fixtures/ (lectura)
                                → out/ (reportes, Excel, paquetes y logs)
```

El comportamiento futuro vive en `agent/prompt.md`, el conocimiento en
`src/knowledge/` y la ejecución en `src/tools/`. Las herramientas se importan
sin iniciar el servidor y validan sus entradas Zod en cada llamada directa.

## 3. Ciclo del agente

Pendiente: bucle, sesiones, límites de iteraciones/tokens y confirmación humana.
La demo llama directamente lectura → mapeo → generación → paquete, maneja
formatos pendientes sin detener los demás casos y ejecuta comprobaciones.
No hay firma, envío ni llamada externa implementados.

## 4. Elección del modelo

Pendiente de selección y estimación del costo por caso. Esta fase no consume
un modelo ni requiere API key. El adaptador sigue siendo un contrato preliminar.

## 5. Diseño del portal web

La herramienta genera valores copiables e informa formato no soportado;
no opera el portal. En una implementación futura se podrían detectar campos
con un navegador controlado, pausando ante CAPTCHA, MFA o cambios de layout.
El humano ingresa credenciales y realiza el clic final en Enviar. Las claves
vivirían en un gestor de secretos o sesión efímera, fuera de repo/prompt/logs.
Pendiente: diseño operativo completo para producción.

## 6. Decisiones y trade-offs

1. Mantener Express y HTML estático evita servicios separados; no se añade React.
2. Glosario determinista y rutas del maestro permiten auditar valores; se descarta
   inferir datos con un modelo. Sin coincidencia segura, el campo queda faltante.
3. La generación recalcula y contrasta el mapeo completo; se descarta confiar en
   valores recibidos del futuro agente, aunque implique volver a leer fixtures.
4. PDF permanece P1 explícitamente pendiente; se descarta presentar Markdown
   o archivos renombrados como PDF completado. Portal ofrece solo valores copiables.
5. El paquete se regenera desde fuentes y elimina sus archivos anteriores para
   no conservar soportes obsoletos; no se toma un Excel previo como fuente fiable.

ExcelJS escribe los XLSX reales; Zod valida argumentos y entradas. No se agregan
nuevas dependencias. Las herramientas nunca ejecutan comandos shell.

## 7. Supuestos

La vigencia es inclusiva: solo una fecha anterior a la referencia está vencida.
Sin referencia explícita se usa fecha UTC; la demo fija 2026-11-03 por defecto.
RUC/RTN usan el NIT colombiano con nota identificador extranjero, sin inventar
identificadores locales. Los campos bancarios deben estar en la plantilla.
Los faltantes no bloquean; un formulario no disponible sí deja incompleto el paquete.
Se registran ambos logs citados por el PRD. La rúbrica numérica no fue adjuntada.
Las herramientas se ejecutan secuencialmente; concurrencia sobre un mismo caso
queda pendiente para una futura integración con sesiones.

## 8. Cobertura

| Historia | Estado | Evidencia o pendiente |
|---|---|---|
| HU-1 Leer solicitud | Hecho en herramientas | Fixtures validados; chat pendiente |
| HU-2 Mapear campos | Hecho en herramientas | Glosario, trazabilidad, faltantes y confirmación tributaria |
| HU-3 Generar formulario | Parcial | Excel P0 verificado; PDF P1 pendiente; valores portal disponibles |
| HU-4 Armar paquete | Parcial | Archivos y bloqueos verificados; confirmación en chat y envío pendientes |
| HU-5 Manejo de errores | Parcial | Herramientas encapsulan errores; proveedor/chat pendientes |

Fecha 2026-11-03: CO 17 llenos; EC 13 llenos/1 faltante/1 confirmación;
HN 9/1/1; PA 8/0/1. Todos bloqueados por Cámara vencida; HN además por
parafiscales y EC por soporte tributario ausente. PDF no generado, portal manual.

Verificación: TypeScript sin errores y demo compilada exitosa con reapertura de
Excel, paquetes, logs y hashes de fixtures. Casos negativos: inexistente,
traversal, datos bancarios no pedidos, mapeo alterado, campo faltante, soporte
ausente, JSON corrupto, fecha inválida y vencimiento inclusivo. Con referencia
2026-08-31, HN queda listo pese a referencias comerciales faltantes; el día
siguiente parafiscales bloquea. `tsx` falló antes de cargar el código por
`uv_os_get_passwd ENOMEM`; se usó `tsc` y `node dist/demo.js` sin cambiar permisos.
La ejecución se verificó con Node 26.13.0, no con Node 20.

## 9. Uso de IA

Codex se utiliza para revisión del PRD/fixtures, configuración inicial,
implementación de herramientas, demo, documentación y ejecución de verificaciones.
Se descarta confiar en éxito de generación sin inspección: la demo reabre Excel
y valida las salidas. No se emplea IA para inventar datos del negocio.
Pendiente: completar el registro de asistentes si se usan otros en nuevas fases.

## 10. Riesgos de producción y mitigaciones

Rutas: se rechaza traversal y enlaces simbólicos/junctions en los componentes
recorridos; el directorio de trabajo debe ser administrado y no escribible por
usuarios externos (no hay protección contra carreras de cambios del filesystem).
Los logs no incluyen valores bancarios ni contenido de argumentos. Las salidas
sí contienen datos del maestro y requerirán control de acceso y retención.
Un fallo de auditoría devuelve error y puede dejar archivos parciales; la
publicación atómica y el aislamiento por sesión quedan pendientes.

Faltan controles del agente, costos, secretos del proveedor, despliegue y la
integración con confirmación humana. No se declara la solución completa ni lista
para producción y no se avanza a la Fase 5.
