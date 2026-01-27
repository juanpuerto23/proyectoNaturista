# Print Agent (agente local de impresión)

Descripción
- Servicio Node pequeño que corre en la máquina de la caja y recibe HTML de factura, lo renderiza a PDF (Puppeteer) y lo envía a la impresora Windows conectada por USB.

Requisitos
- Node.js (LTS) instalado en la caja.
- Driver oficial de la impresora instalado (ya indicado: "XP-58C").

Instalación y uso

1. En la máquina de la caja (Windows):

```powershell
cd proyectoNaturista/print-agent
npm install
npm start
```

2. El agente escucha por defecto en `http://localhost:9101`.

Rutas útiles
- `GET /health` - ver estado del agente.
- `GET /printers` - lista impresoras visibles en Windows.
- `POST /imprimir` - body JSON: `{ html: '<html>...</html>', nombreImpresora: 'XP-58C' }`.

Notas
- Se usa Puppeteer para preservar la plantilla HTML.
- Si prefieres ESC/POS puro podemos adaptar para generar comandos en lugar de PDF.
