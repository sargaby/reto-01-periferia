# Registro como proveedor

Los fixtures son entrada de solo lectura; las salidas viven en out/<caso>/.
Las herramientas leen maestro y glosario. No dupliques sus valores aquí.

- CO usa NIT; EC, PE y PA usan RUC; HN usa RTN. La empresa solo tiene NIT
  colombiano: se utiliza para otros países con requiere_confirmacion y nota
  identificador extranjero. Los campos ambiguos también requieren revisión.
- Un campo sin fuente queda faltante; los sinónimos se resuelven por glosario.
- Datos bancarios solo si la plantilla los pide; nunca en borrador-correo.md.
- Un soporte exigido ausente o vencido bloquea listo_para_firma. Está vencido
  si vigencia_hasta es anterior a la fecha UTC de ejecución; el último día de
  vigencia sigue válido. Un campo faltante aparece en checklist sin bloquear.
- Excel es P0. PDF P1 está pendiente: no se genera un PDF. Portal no se automatiza;
  se prepara valores-portal.md para copia manual.
- Un formulario no soportado deja incompleto el paquete. Se copian los soportes
  vencidos disponibles y se identifican en el checklist.
- Firma, envío y carga a portales son humanos y están fuera de las herramientas
  disponibles en esta fase. No hay envío simulado implementado.

Fuente de reglas: PRD.md, HU-1 a HU-5 y RN1 a RN5.
