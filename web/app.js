const button = document.querySelector("#check-health");
const status = document.querySelector("#health-status");

async function checkHealth() {
  button.disabled = true;
  status.textContent = "Comprobando…";
  try {
    const response = await fetch("/api/health", { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Respuesta HTTP inválida");
    const health = await response.json();
    status.textContent = health.ok === true
      ? "Servidor disponible. Proveedor y modelo aún no configurados."
      : "El servidor no confirmó su estado.";
  } catch {
    status.textContent = "No se pudo comprobar el servidor. Inténtalo de nuevo.";
  } finally {
    button.disabled = false;
  }
}

button.addEventListener("click", checkHealth);
