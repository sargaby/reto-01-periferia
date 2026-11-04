import "dotenv/config";
import express from "express";
import { resolve } from "node:path";
import { z } from "zod";

const config = z.object({
  PORT: z.preprocess(
    (value) => value === "" || value === undefined ? 3000 : value,
    z.coerce.number().int().min(1).max(65535),
  ),
}).safeParse(process.env);

if (!config.success) {
  console.error("Configuración inválida: PORT debe ser un entero entre 1 y 65535.");
  process.exit(1);
}

const app = express();
const webDirectory = resolve("web");
app.disable("x-powered-by");

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, provider: null, model: null });
});

app.use(express.static(webDirectory));

app.use((_request, response) => {
  response.status(404).json({ error: "Ruta no encontrada" });
});

const server = app.listen(config.data.PORT, () => {
  console.log(`Servidor disponible en http://localhost:${config.data.PORT}`);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  console.error(error.code === "EADDRINUSE"
    ? "No se pudo iniciar: el puerto ya está ocupado. Configura otro PORT."
    : "No se pudo iniciar el servidor HTTP.");
  process.exitCode = 1;
});
