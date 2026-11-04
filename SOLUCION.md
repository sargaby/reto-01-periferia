# Solución · Reto 01

Estado: fase de configuración base y arquitectura. Los apartados siguientes
mantienen la estructura obligatoria del PRD; su desarrollo final está pendiente.

## 1. Problema en una frase y a quién le duele

La analista administrativa transcribe datos repetidos para registros como
proveedor y necesita preparar formularios y soportes con trazabilidad.
Pendiente: completar el planteamiento de la solución final.

## 2. Arquitectura

```text
web/ (HTML/CSS/JS) → src/server.ts (Express)
                     → src/llm/adapter.ts → proveedor LLM [pendiente]
                     → src/tools/proveedor.ts [pendiente]
                       → fixtures/ (lectura) / out/ (escritura futura)
```

Comportamiento: `agent/prompt.md`. Conocimiento:
`src/knowledge/registro-proveedor.md`. Ejecución: `src/tools/`.
Actualmente solo existe HTTP health y servicio de archivos estáticos.
Pendiente: completar el diagrama del flujo real del agente.

## 3. Ciclo del agente

Pendiente: implementar bucle, sesiones, límites de iteraciones/tokens,
trazabilidad y confirmación humana. El contrato LLM es preliminar.

## 4. Elección del modelo

Pendiente: seleccionar proveedor y modelo, justificar la elección y estimar
costo por caso. Todavía no se realizan llamadas ni se requieren claves.

## 5. Diseño del portal web

Pendiente: estrategia, CAPTCHA/MFA, cambios de interfaz, gestión de credenciales
y límites de automatización. Según el PRD, el humano ingresa credenciales y
realiza el clic final en Enviar. No se implementará un portal real.

## 6. Decisiones y trade-offs

1. Express con frontend estático en el mismo proceso simplifica el arranque;
   se descarta separar frontend y API en servicios durante esta fase.
2. HTML/CSS/JavaScript evita una compilación de frontend; se descarta React
   conforme al alcance solicitado.
3. Contrato propio para LLM permite aislar el proveedor; se descarta acoplar
   el servidor a un SDK concreto antes de seleccionar modelo.

Dependencias: Express sirve HTTP; Zod valida configuración y validará argumentos;
tsx ejecuta TypeScript en desarrollo; TypeScript compila con modo estricto;
dotenv carga configuración local; ExcelJS queda preparado para el Excel P0,
sin uso todavía. Pendiente: documentar decisiones finales y sus costes.

## 7. Supuestos

Los comandos se ejecutan desde la raíz del proyecto. Los fixtures se conservan
como entrada de solo lectura. Pendiente: registrar supuestos de negocio y
resolver las ambigüedades del PRD (rúbrica ausente y dos ubicaciones de logs).

## 8. Cobertura

| Historia | Estado | Pendiente |
|---|---|---|
| HU-1 Leer solicitud | No hecho | Herramienta y validación de fixtures |
| HU-2 Mapear campos | No hecho | Mapeo, trazabilidad y confirmación |
| HU-3 Generar formulario | No hecho | Excel, PDF y valores de portal |
| HU-4 Armar paquete | No hecho | Soportes, checklist, borrador y confirmación |
| HU-5 Manejo de errores | Parcial | Configuración y arranque controlados; herramientas/LLM pendientes |

Para producción faltan todas las capacidades de negocio, el agente, despliegue,
validación integral y controles operativos. Pendiente: actualizar esta tabla.

## 9. Uso de IA

Se usa Codex para inspeccionar PRD y fixtures y preparar esta base de proyecto,
documentación y verificaciones técnicas. Pendiente: completar el registro de
asistentes, tareas y propuestas descartadas con su justificación al cierre.

## 10. Riesgos de producción y mitigaciones

Pendiente: desarrollar el análisis. Riesgos previstos por el PRD: valores
inventados (herramientas como única fuente), soportes vencidos (validación por
fecha), exposición de claves (variables solo en backend) y gasto sin límite
(topes de tokens e iteraciones). Estos controles de agente aún no se implementan.
