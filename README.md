# Reto 01 · Registro como proveedor

Estado: configuración base. Solo están disponibles el frontend inicial y
`GET /api/health`. No hay chat, ciclo del agente, proveedor LLM ni herramientas
de negocio implementados. No se generan formularios ni paquetes.

## Requisitos y arranque

Node.js 20+ y npm. Desde la raíz del proyecto:

```sh
npm install
npm run dev
```

Un único proceso Node sirve Express y el frontend en http://localhost:3000.
En PowerShell con scripts bloqueados, usar `npm.cmd` en lugar de `npm`.
No hace falta una clave de modelo para esta fase.

## Configuración

`.env.example` enumera las variables. Opcionalmente copiarlo a `.env`:

- `PORT`: puerto HTTP; vacío o ausente usa 3000.
- `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`: reservadas para una fase posterior;
  todavía no se utilizan. Las claves solo deberán existir en el backend.

## Comandos

- `npm run dev`: servidor con recarga ante cambios de TypeScript.
- `npm run typecheck`: validación TypeScript sin generar archivos.
- `npm run build`: compila a `dist/`.
- `npm start`: ejecuta la compilación; requiere `npm run build` previo.
- `npm run demo`: informa que la demo está pendiente; aún no procesa casos.

## API actual

`GET /api/health` devuelve HTTP 200:

```json
{ "ok": true, "provider": null, "model": null }
```

Este endpoint comprueba el servidor HTTP, no la disponibilidad de un LLM.
Las demás rutas API devuelven 404. Las rutas de chat y sesiones están pendientes.

## Arquitectura

- `agent/prompt.md`: espacio reservado para comportamiento del agente.
- `src/server.ts`: servidor HTTP y frontend estático desde `web/`.
- `src/llm/adapter.ts`: contrato preliminar del adaptador, sin implementación.
- `src/tools/proveedor.ts`: espacio reservado para herramientas.
- `src/knowledge/registro-proveedor.md`: espacio reservado para reglas del proceso.
- `demo.ts`: entrada futura de ejecución sin modelo.
- `fixtures/`: datos de entrada, sin modificaciones.
- `out/`: salidas futuras, todavía no generadas.

Link de prueba y despliegue: pendientes. El alcance completo y su estado están
documentados en `SOLUCION.md`.

## Verificación de esta fase

Entorno disponible: Node 26.13.0 y npm 11.20.0. La instalación falló con
`EACCES` al acceder a `registry.npmjs.org`; el intento offline falló por falta
de dependencias en caché. Por tanto, aún no están verificados el arranque HTTP
ni la compilación: `npm run dev` y `npm run typecheck` fallaron por ausencia
de `tsx` y `tsc`. Tampoco se generó `package-lock.json`.

Pendiente al disponer de acceso al registro: `npm install`, `npm run typecheck`,
`npm run build` y `npm run dev`; comprobar `/` y `/api/health`. La compatibilidad
con Node 20 está configurada, pero no se ha ejecutado con esa versión.
