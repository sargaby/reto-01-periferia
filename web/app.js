const form = document.querySelector("#chat-form");
const input = document.querySelector("#message");
const history = document.querySelector("#history");
const error = document.querySelector("#error");
const processing = document.querySelector("#processing");
const confirmation = document.querySelector("#confirmation");
const connection = document.querySelector("#connection");
const info = document.querySelector("#session-info");
const send = document.querySelector("#send");
const newSession = document.querySelector("#new-session");
let sessionId = sessionStorage.getItem("reto01-session") || undefined;
let sending = false;
let demoMode = false;

function block(value) {
  sending = value;
  send.disabled = value;
  newSession.disabled = value;
  input.disabled = value;
  processing.hidden = !value;
}
function paragraph(text) { const p = document.createElement("p"); p.textContent = text; return p; }
function jsonText(text) { try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; } }
function render(data) {
  if (data.sessionId) { sessionId = data.sessionId; sessionStorage.setItem("reto01-session", sessionId); }
  history.replaceChildren();
  for (const event of data.history || []) {
    const article = document.createElement("article");
    article.className = `event ${event.role}${event.needsConfirmation ? " confirmation" : ""}`;
    if (event.role === "tool" && event.toolCall) {
      const tool = event.toolCall;
      const title = document.createElement("strong"); title.textContent = tool.name;
      article.append(title);
      let result;
      try { result = JSON.parse(tool.result); } catch { result = { ok: false }; }
      article.append(paragraph(result.ok ? "Herramienta completada. Consulta el resultado." : `Herramienta fallida: ${result.error || "Error de respuesta"}`));
      const details = document.createElement("details");
      const summary = document.createElement("summary"); summary.textContent = "Ver argumentos y resultado";
      const pre = document.createElement("pre"); pre.textContent = `Argumentos:\n${jsonText(tool.arguments)}\n\nResultado:\n${jsonText(tool.result)}`;
      details.append(summary, pre); article.append(details);
    } else {
      const title = document.createElement("strong"); title.textContent = event.role === "user" ? "Tú" : "Agente";
      article.append(title, paragraph(event.content));
    }
    history.append(article);
  }
  confirmation.hidden = !data.needsConfirmation;
  info.textContent = sessionId ? `Sesión: ${sessionId}${data.tokens ? ` · Tokens registrados: ${data.tokens.actual} · Presupuesto reservado: ${data.tokens.reserved}/${data.tokens.limit}` : ""}` : "";
  history.scrollTop = history.scrollHeight;
}
form.addEventListener("submit", async event => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message || sending) return;
  block(true); error.textContent = "";
  try {
    const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(sessionId ? { sessionId } : {}), message }) });
    const data = await response.json();
    if (data.history) { render(data); input.value = ""; }
    if (!response.ok) error.textContent = data.error || data.reply || "No se pudo completar el turno.";
  } catch { error.textContent = "Se perdió la conexión. Recarga para recuperar el historial antes de repetir la solicitud."; }
  finally { block(false); input.focus(); }
});
newSession.addEventListener("click", () => {
  sessionStorage.removeItem("reto01-session"); sessionId = undefined;
  history.replaceChildren(); confirmation.hidden = true; info.textContent = ""; error.textContent = ""; input.focus();
});
async function initialize() {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) throw new Error();
    const health = await response.json();
    demoMode = health.provider === "demo";
    connection.textContent = demoMode ? "MODO DEMOSTRACIÓN · Sin LLM ni API externa. Se ejecutan herramientas reales en orden determinista." : health.configured ? `Servidor disponible · ${health.provider} · ${health.model}. La conexión al modelo se verifica al enviar un mensaje.` : `Servidor disponible · ${health.provider}. Falta configurar la clave y el modelo de ese proveedor en el backend.`;
    connection.classList.toggle("confirmation", demoMode);
    if (sessionId) {
      const saved = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
      if (saved.ok) render(await saved.json());
      else if (saved.status === 404 || saved.status === 400) { sessionStorage.removeItem("reto01-session"); sessionId = undefined; }
    }
  } catch { connection.textContent = "No se pudo conectar con el servidor."; }
}
initialize();
