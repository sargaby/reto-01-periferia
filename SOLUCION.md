# Solución · Reto 01

Fase 6: agente y chat integrados a P0 con demostración local determinista, sin API.
OpenAI y Gemini se conservan; no se verifica el uso real de ninguno en esta fase.

## 1. Problema en una frase y a quién le duele

La analista administrativa necesita preparar registros de proveedor y soportes
sin transcribir datos repetidos ni ocultar faltantes o vencimientos.

## 2. Arquitectura

```text
web/ → Express (src/app.ts) → Agent (src/agent.ts)
                              → LlmAdapter → OpenAI / Gemini / planificador demo
                              → registro Zod → herramientas P0
                                                  → fixtures/ lectura
                                                  → out/ archivos y logs
```

src/server.ts carga configuración privada y construye las dependencias. El
comportamiento está en agent/prompt.md y las reglas en src/knowledge/. Ambos se
leen al arrancar, sin incrustar valores empresariales. El adaptador no depende
de Express ni ejecuta herramientas. El servidor no contiene reglas tributarias.
src/llm/provider.ts selecciona el adaptador al arrancar mediante LLM_PROVIDER;
solo la clave y el modelo de esa selección hacen falta. OpenAI conserva su
implementación. Gemini usa el SDK oficial @google/genai ya instalado.
La opción demo no requiere clave ni modelo. Su adaptador separado no lee valores
del maestro ni ejecuta herramientas: emite llamadas al mismo registro Zod, y
construye los argumentos siguientes y el resumen exclusivamente desde resultados.

## 3. Ciclo del agente

Por turno se agrega el mensaje del usuario y se solicita al modelo con el
historial y esquemas derivados de los contratos Zod. El modelo devuelve llamadas;
el backend valida argumentos, ejecuta herramientas permitidas, conserva sus
resultados correlacionados por ID y vuelve a llamar al modelo hasta la respuesta
final JSON. El frontend muestra el contenido sin ejecutar HTML y permite
inspeccionar argumentos/resultados. Las sesiones viven en memoria, con UUID.

Los límites de iteraciones y presupuesto son configurables. Antes de cada llamada
se reserva una cota conservadora por bytes de entrada, protocolo y salida máxima.
Las reservas incluyen peticiones fallidas y existe presupuesto global, además
del de sesión. Se registra el consumo reportado en respuestas válidas. Hay tope
de sesiones e historial y procesamiento serializado para proteger out/<caso>.

La preparación de un paquete o un mapeo con advertencias obliga al backend a
cerrar con pregunta de revisión. Solo una respuesta afirmativa explícita en el
turno inmediatamente siguiente cuenta como revisión; una intervención distinta
invalida esa oportunidad. No se modifica el maestro ni se ejecutan envíos. El
registro de herramientas no incluye envío simulado, firma ni portal real.

Las herramientas P0 conservan su auditoría global y por caso. El registro audita
además JSON/argumentos inválidos y herramientas rechazadas. Los errores se envían
al modelo como resultados estructurados o al chat con mensajes claros. Un fallo
de proveedor mantiene la sesión y permite reintentar dentro del presupuesto.
El contrato admite continuación serializada opaca: el bucle la conserva sin
conocer proveedores. Gemini la usa para reproducir partes y firmas originales,
y traduce resultados comunes a functionResponse por nombre e ID cuando exista.
No se publica esa continuación en el historial visible. El adaptador añade una
reserva genérica de 4096 tokens mientras esté pendiente la comprobación de capacidad.
El contrato distingue el cómputo local sin tokens: demo reporta cero consumo y no
reserva un presupuesto de API inexistente. Los límites de iteraciones, sesiones,
historial y serialización siguen vigentes. Los proveedores reales conservan sus
presupuestos. REFERENCE_DATE permite controlar vigencias también en el chat;
vacío usa UTC actual. La fecha se transmite a las herramientas en su contexto.

## 4. Elección del modelo

Para demostrar sin servicios se usa LLM_PROVIDER=demo: no es un modelo de lenguaje,
no razona libremente y no utiliza respuestas de negocio prefabricadas. Admite un
identificador de caso por mensaje y la secuencia lectura → mapeo → generación →
paquete, usando los resultados obtenidos. Los formatos P1/P2 siguen sus errores
y salidas reales. Health y UI identifican la demostración, sin atribuirla a un LLM.

Se conserva OpenAI con OPENAI_API_KEY/OPENAI_MODEL y se añade Gemini de Google
AI Studio con GEMINI_API_KEY/GEMINI_MODEL. LLM_PROVIDER admite openai o gemini
y por compatibilidad usa openai si está ausente. Las claves permanecen en el
backend, fuera de frontend, prompt, logs y health. OpenAI usa fetch; Gemini usa
@google/genai 2.32.0 existente. No hay modelos elegidos por defecto.

OpenAI requiere Chat Completions, herramientas, JSON mode y max_completion_tokens.
Gemini consulta el modelo con models.get y verifica generateContent; después
fuerza una llamada verificar_capacidad, sin ejecutarla, pues los metadatos no
demuestran function calling. La sonda tiene salida máxima de 1024 tokens, se
incluye en el consumo y usa timeout. El éxito se cachea en la instancia; las
reservas adicionales incluyen peticiones fallidas. No hay AFC, reintentos ni
continuaciones automáticas que omitan los límites del ciclo compartido.
El prompt exige JSON final; Gemini no fuerza JSON MIME junto con herramientas.
No se verificó ningún modelo real por falta de claves. Una sonda truncada o
rechazada informa un error: no equivale a verificar la capacidad del modelo.
El presupuesto predeterminado se conserva en 100000. En la prueba controlada
Gemini se comprobó su corte antes del resumen tras las cuatro herramientas;
el flujo completo se verificó con 200000. La representación común y la
continuación opaca no se cuentan dos veces: se toma el mayor tamaño. Los
presupuestos siguen siendo conservadores y pueden requerir ajuste por modelo.

Costo por caso: pendiente de elegir modelo y medir una conversación real. La
fórmula será entrada facturada × tarifa de entrada + salida × tarifa de salida
(según unidades de la tarifa). Las pruebas controladas no permiten inferir costos.
Referencia del protocolo implementado:
[OpenAI Function calling](https://developers.openai.com/api/docs/guides/function-calling).
[SDK Google Gen AI](https://googleapis.github.io/js-genai/release_docs/index.html)
y [Modelos Gemini](https://ai.google.dev/api/models).

## 5. Diseño del portal web

El agente genera valores copiables, informa formato no soportado y no opera el
portal. Una futura automatización podría detectar campos mediante navegador,
con pausa ante CAPTCHA/MFA o cambios de interfaz. El humano ingresaría las
credenciales y realizaría el clic final en Enviar. Secretos en gestor seguro o
sesión efímera, nunca en repo/prompt/logs. No se implementa esa integración.

## 6. Decisiones y trade-offs

1. Un proceso Express sirve frontend HTML/CSS/JS y API; evita servicios y React.
2. El contrato LlmAdapter conserva mensajes y llamadas sin tipos del proveedor;
   se descarta acoplar el bucle a un SDK específico.
3. Chat Completions ofrece un protocolo explícito ajustado al contrato existente;
   se descarta migrar también a otra API durante esta fase. Se envía store:false.
4. Esquemas JSON derivados de Zod y validación previa evitan mantener dos contratos.
   La conversión cubre los tipos usados en P0 y falla ante tipos no soportados.
5. Sesiones en memoria simplifican el reto frente a una base de datos; se pierden
   al reiniciar. Un bloqueo global evita carreras sobre salidas compartidas,
   sacrificando concurrencia hasta implementar aislamiento por sesión.
6. Reserva conservadora de tokens evita depender de estimaciones optimistas; puede
   detener una sesión antes de su consumo real. No se hacen reintentos automáticos.
7. Se reutilizan las herramientas P0 sin cambios; PDF y envío simulado permanecen
   explícitamente pendientes en lugar de declarar una finalización ficticia.
8. Un planificador demo separado permite comprobar frontend, ciclo y herramientas
   sin servicios externos. Se descarta simular respuestas de un proveedor o
   incrustar resultados de los cuatro casos. Las limitaciones de lenguaje y la
   ausencia de un LLM se muestran al usuario.

Dependencias: se conservan Express, Zod, ExcelJS, dotenv, TypeScript y tsx. La
petición OpenAI y las pruebas usan fetch y node:test incluidos en Node.
Gemini usa el SDK oficial ya presente; no se modifica package.json ni su lock
durante esta ampliación. El rango 2.x evita adoptar la próxima versión mayor
del SDK con otro requisito de Node. No se reemplaza el agente ni las herramientas.

## 7. Supuestos

Se ejecuta desde la raíz. Las vigencias usan fecha UTC inclusiva. RUC/RTN usan
NIT colombiano con advertencia; datos bancarios solo si la plantilla los pide.
Un faltante no bloquea firma, un soporte ausente/vencido sí, y un formulario no
soportado mantiene incompleto el paquete. Se cubren ambos logs del PRD. La rúbrica
numérica sigue ausente del material recibido. Confirmar revisión no equivale a
corregir los campos ni a enviar documentos. Los archivos out/ no se exponen por HTTP.

## 8. Cobertura

Verificación integral Fase 6: compilación TypeScript correcta, 12 pruebas previas
pasadas antes del cambio y 17 pruebas pasadas al terminar. La demo compilada
se ejecutó con fecha 2026-11-03 y servidor detenido. Los cuatro casos se probaron
también por HTTP en un servidor real con LLM_PROVIDER=demo y sin claves.

Los nuevos tests usan fixtures copiados en un directorio temporal y bloquean
peticiones fetch fuera del servidor local. Se comprueban todas las hojas/celdas
Excel, valores frente al maestro, trazabilidad, soportes, faltantes, checklist,
ausencia de datos bancarios en borradores, logs, sesiones, errores de lectura,
traversal, soporte eliminado y no conservado en un paquete anterior, redacción de
secreto de prueba y confirmaciones sin ejecución de envío. Los fixtures originales
y las herramientas P0 no se modificaron. Las APIs de proveedores reales no se
contactaron; sus pruebas existentes siguen usando respuestas controladas.

Frontend: HTML/JS/CSS y endpoints verificados por HTTP, sintaxis JS correcta.
La revisión visual no se pudo completar: el navegador integrado estaba ausente y
Computer Use detuvo Chrome al no determinar su URL con suficiente confianza.
No se afirma verificación visual ni uso real de LLM. El servidor de prueba quedó
detenido. No se hicieron despliegue, push, PDF P1 ni bonus.

| Historia | Estado | Evidencia y pendiente |
|---|---|---|
| HU-1 Leer solicitud | Hecho en código | P0 integrada al agente; falta conversación con proveedor real |
| HU-2 Mapear campos | Hecho en código | Trazabilidad y advertencias P0 intactas; validación previa del backend |
| HU-3 Generar formulario | Parcial | Excel probado; PDF P1 pendiente; portal manual |
| HU-4 Armar paquete | Parcial | Paquete probado y revisión entre turnos; envío simulado P1 pendiente |
| HU-5 Manejo de errores | Implementado | Pruebas de validación, herramientas y proveedor controlado; errores HTTP |

Antecedentes de Fase 5: TypeScript pasó; demo P0 compilada pasó sin modificar sus pruebas;
12 pruebas node:test pasaron con cuatro P0 reales y adaptadores/HTTP controlados.
Incluyen confirmación, recuperación, límites, concurrencia, contrato OpenAI y API.
La prueba Gemini atraviesa el SDK oficial y HTTP del chat contra un servidor
local controlado: verifica declaraciones, llamadas/respuestas, IDs/falta de IDs,
firmas internas preservadas y ejecución de las cuatro P0, con logs y Excel.
Se reinició el servidor compilado con ambos LLM_PROVIDER sin claves; health
mostró la selección correcta. Las pruebas de fábrica cubren una sola clave
configurada y ausencia de la clave del proveedor no seleccionado.
Servidor compilado en PORT=3017: UI/health 200, chat sin clave 503, sesiones 200.
JavaScript frontend pasó chequeo sintáctico; no se verificó visualmente en navegador.

La demo conserva resultados 2026-11-03: CO 17/0/0, EC 13/1/1, HN 9/1/1 y PA 8/0/1.
Todos bloqueados por soportes vencidos/ausentes; únicamente CO/HN generan Excel.
No hubo claves ni modelos OpenAI/Gemini configurados: no se ejecutaron conversaciones
reales ni se verificó un modelo concreto de Google. Quedan pendientes pruebas
de acceso, cuota y llamadas de negocio contra los proveedores reales.
Node disponible: 26.13.0; no se ejecutó específicamente en Node 20. tsx sigue
fallando con uv_os_get_passwd ENOMEM; se verificó vía tsc + node compilado.

## 9. Uso de IA

Codex revisó PRD y código, implementó base, herramientas, agente, frontend y
pruebas, y actualizó documentación. Se usó OpenAI Docs para consultar el protocolo
oficial. Se descartó inferir éxito por compilación: se ejecutaron P0 y endpoints.
Para Gemini se consultaron documentación oficial y tipos del SDK instalado;
las pruebas controladas ejercitan su serialización HTTP y la traducción común.
No se usan datos inventados ni se presentan respuestas controladas como proveedor
real. Los asistentes y propuestas de fases futuras se añadirán cuando se utilicen.

## 10. Riesgos de producción y mitigaciones

La regla de fuente única se establece en el prompt y en herramientas que validan
fuentes; la prosa libre del modelo no tiene un verificador semántico independiente.
Se necesita evaluación con modelo real y revisión humana antes de producción.
Las entradas de correos se tratan como datos no confiables en las instrucciones.
El modo demo produce resúmenes deterministas desde resultados reales, pero no
valida la calidad, credenciales ni disponibilidad de los proveedores externos;
tampoco sustituye la conversación con LLM exigida para una defensa completa.

Las sesiones no tienen autenticación y sus UUID no sustituyen control de acceso.
No se exponen claves ni archivos por HTTP; los resultados sí contienen datos del
maestro, por lo que un despliegue productivo requiere autenticación y retención.
Los presupuestos son por proceso y se reinician: faltan cuotas persistentes y
controles de acceso para despliegues con múltiples instancias.

Se conservan límites conocidos de P0: no hay escritura atómica ni protección
contra carreras de cambios externos al filesystem. La serialización evita que
las peticiones de esta instancia escriban simultáneamente. Un fallo de auditoría
puede dejar salidas parciales. Faltan despliegue público, PDF P1 y envío simulado;
no se implementa bonus ni se afirma que el reto completo esté terminado.
