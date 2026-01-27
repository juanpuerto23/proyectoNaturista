const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer');
const { print } = require('pdf-to-printer');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 9101;

app.use(express.json({ limit: '10mb' }));

// Simple CORS middleware to allow requests from the POS frontend (localhost:3000)
app.use((req, res, next) => {
  // adjust origin as needed
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Simple request logger to help debug incoming calls
app.use((req, res, next) => {
  try {
    console.log(new Date().toISOString(), req.method, req.url, 'from', req.ip || req.connection.remoteAddress);
  } catch (e) { }
  next();
});

// Endpoint para generar y devolver el PDF sin imprimir (útil para previsualizar)
app.post('/preview', async (req, res) => {
  const { html, offsetMm } = req.body || {};
  if (!html) return res.status(400).json({ ok: false, message: 'HTML vacío' });

  let browser = null;
  try {
    browser = await puppeteer.launch(getPuppeteerLaunchOptions());
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    // inject same simple CSS used for printing
    await page.addStyleTag({ content: `
      @page { size: 80mm auto; margin: 0; }
      html, body { margin: 0; padding: 4px; }
      /* global font reduced by ~10px for thermal readability */
      body { font-family: Arial, Helvetica, sans-serif; font-size: 30px; color: #000; }
      .center { text-align: center; }
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: 6px 2px; font-size: 30px; }
      /* products table (first table) should be smaller to fit columns */
      table:first-of-type th, table:first-of-type td { font-size: 22px; }
      .right { text-align: right; }
      .bold { font-weight: 700; }
      hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
    `});

    // prepend logo if available
    if (logoDataUrl) {
      await page.evaluate((logo) => {
        try {
          const img = document.createElement('img');
          img.src = logo;
          img.style.width = '58mm';
          img.style.display = 'block';
          img.style.margin = '0 auto 2px';
          img.style.padding = '0';
          img.style.border = '0';
          const first = document.body.firstChild;
          document.body.insertBefore(img, first);
        } catch (e) { }
      }, logoDataUrl);
    }

    // optional offset handling (same conversion as /imprimir)
    const offsetValue = parseFloat(offsetMm || 0);
    const MM_TO_PX = 96 / 25.4;
    let extraHeightPx = 0;
    if (!isNaN(offsetValue) && Math.abs(offsetValue) > 0) {
      await page.addStyleTag({ content: `body { transform: translateY(-${offsetValue}mm); }` });
      extraHeightPx = Math.round(Math.abs(offsetValue) * MM_TO_PX);
    }

    const bodyHeight = await page.evaluate(() => {
      try {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        const texts = [];
        while (walker.nextNode()) texts.push(walker.currentNode);
        for (let i = texts.length - 1; i >= 0; i--) {
          const t = texts[i];
          if (t && t.textContent && t.textContent.trim() === '') {
            if (t.parentNode) t.parentNode.removeChild(t);
          } else break;
        }
      } catch (e) { }
      const children = Array.from(document.body.children).filter(el => {
        try { const st = window.getComputedStyle(el); return st && st.display !== 'none' && st.visibility !== 'hidden' && el.offsetHeight > 0; } catch (e) { return true; }
      });
      const bodyTop = document.body.getBoundingClientRect().top;
      let maxBottom = 0;
      children.forEach(el => { try { const r = el.getBoundingClientRect(); if (r.bottom > maxBottom) maxBottom = r.bottom; } catch (e) { } });
      if (maxBottom > 0) return Math.ceil(maxBottom - bodyTop);
      return document.body.scrollHeight || document.documentElement.scrollHeight || 0;
    });

    const totalHeightPx = Math.max(1, Math.ceil(bodyHeight + extraHeightPx));
    const pdfBuffer = await page.pdf({ printBackground: true, width: '80mm', height: `${totalHeightPx}px` });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="preview.pdf"');
    return res.send(pdfBuffer);
  } catch (err) {
    console.error('Error generating preview PDF:', err);
    return res.status(500).json({ ok: false, message: String(err) });
  } finally {
    try { if (browser) await browser.close(); } catch (e) { }
  }
});

// Load logo from project's public folder (optional). This will be embedded as base64
const logoPath = path.join(__dirname, '..', 'public', 'logo.png');
let logoDataUrl = null;
if (fs.existsSync(logoPath)) {
  try {
    const buf = fs.readFileSync(logoPath);
    logoDataUrl = `data:image/png;base64,${buf.toString('base64')}`;
    console.log('Print agent: logo loaded from', logoPath);
  } catch (e) {
    console.warn('Print agent: could not read logo file', logoPath, e);
  }
} else {
  console.warn('Print agent: logo not found at', logoPath);
}

app.get('/health', (req, res) => res.json({ ok: true, pid: process.pid }));

function getPuppeteerLaunchOptions() {
  const args = ['--no-sandbox', '--disable-setuid-sandbox'];
  const opts = { args, headless: true };
  // Allow overriding with env var
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath && fs.existsSync(envPath)) {
    opts.executablePath = envPath;
    console.log('Using Chrome executable from PUPPETEER_EXECUTABLE_PATH:', envPath);
    return opts;
  }

  // Try common Windows paths
  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Chromium\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Chromium\\Application\\chrome.exe'
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        opts.executablePath = p;
        console.log('Found Chrome executable at', p);
        return opts;
      }
    }
  }

  // On other OSes or if not found, return basic opts (Puppeteer will try to use bundled chromium)
  console.warn('No Chrome executable found via env or common paths. Puppeteer will attempt bundled Chromium (may require install).');
  return opts;
}

app.get('/printers', (req, res) => {
  // Intentamos obtener impresoras en Windows usando PowerShell
  // Devolvemos array de nombres.
  const listCmd = process.platform === 'win32'
    ? 'powershell -NoProfile -Command "Get-Printer | Select-Object -ExpandProperty Name | ConvertTo-Json"'
    : 'lpstat -p';
  exec(listCmd, { maxBuffer: 1024 * 500 }, (err, stdout) => {
    if (err) return res.status(500).json({ ok: false, message: String(err) });
    try {
      let printers = [];
      if (process.platform === 'win32') {
        printers = JSON.parse(stdout);
        if (typeof printers === 'string') printers = [printers];
      } else {
        // Fallback: split lines
        printers = stdout.split('\n').map(s => s.trim()).filter(Boolean);
      }
      res.json({ ok: true, printers });
    } catch (e) {
      // Fallback: try to parse lines
      const printers = stdout.split('\n').map(s => s.trim()).filter(Boolean);
      res.json({ ok: true, printers });
    }
  });
});



app.post('/imprimir', async (req, res) => {
  const { html, nombreImpresora, offsetMm } = req.body || {};
  if (!html) return res.status(400).json({ ok: false, message: 'HTML vacío' });

  let tmpPath = null;
  let browser = null;
  try {
    browser = await puppeteer.launch(getPuppeteerLaunchOptions());
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    // Minimal, simple CSS for receipts. Keep it simple and reduce global font size.
    await page.addStyleTag({ content: `
      @page { size: 80mm auto; margin: 0; }
      html, body { margin: 0; padding: 4px; }
      /* reduce global size by ~10px for thermal printer */
      body { font-family: Arial, Helvetica, sans-serif; font-size: 30px; color: #000; }
      .center { text-align: center; }
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: 6px 2px; font-size: 30px; }
      /* products table (first table) should be smaller to better fit columns */
      table:first-of-type th, table:first-of-type td { font-size: 22px; }
      .right { text-align: right; }
      .bold { font-weight: 700; }
      hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
    `});

    // Prepend logo (embedded) if available so it appears in the top blank area.
    if (logoDataUrl) {
      await page.evaluate((logo) => {
        try {
          const img = document.createElement('img');
          img.src = logo;
          img.style.width = '58mm';
          img.style.display = 'block';
          img.style.margin = '0 auto 2px';
          img.style.padding = '0';
          img.style.border = '0';
          img.style.maxHeight = '60mm';
          const first = document.body.firstChild;
          document.body.insertBefore(img, first);
        } catch (e) {
          // ignore DOM errors
        }
      }, logoDataUrl);
    }

    // NOTE: removed the previous `transform: translateY(...)` approach because it could
    // shift content out of the printable area and cut text (eg. "FARMACIA"). If you still
    // need an offset to compensate paper feed, we can expose a safer mechanism (adjust
    // PDF height / add spacer) — tell me and I will add an adjustable option.

    tmpPath = path.join(os.tmpdir(), `factura-${Date.now()}.pdf`);

    // Remove leading/trailing empty nodes and compute precise content height
    const bodyHeight = await page.evaluate(() => {
      try {
        // remove leading empty text nodes/elements
        function removeLeadingEmpty(node) {
          let changed = false;
          while (node && node.firstChild) {
            const fc = node.firstChild;
            if (fc.nodeType === Node.TEXT_NODE && fc.textContent.trim() === '') {
              node.removeChild(fc); changed = true; continue;
            }
            if (fc.nodeType === Node.ELEMENT_NODE) {
              const el = fc;
              // don't remove images or elements that likely contain the logo
              try {
                const tag = (el.tagName || '').toLowerCase();
                if (tag === 'img' || el.querySelector && el.querySelector('img')) {
                  break;
                }
              } catch (e) {}
              const txt = el.textContent || '';
              const st = window.getComputedStyle(el);
              if ((txt.trim() === '' || (el.children.length === 0 && el.innerHTML.trim() === '')) && (st.display === 'block' || st.display === 'inline')) {
                node.removeChild(fc); changed = true; continue;
              }
            }
            break;
          }
          return changed;
        }
        try { while (removeLeadingEmpty(document.body)); } catch (e) { }

        // remove trailing empty text nodes
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        const texts = [];
        while (walker.nextNode()) texts.push(walker.currentNode);
        for (let i = texts.length - 1; i >= 0; i--) {
          const t = texts[i];
          if (t && t.textContent && t.textContent.trim() === '') {
            if (t.parentNode) t.parentNode.removeChild(t);
          } else break;
        }
      } catch (e) { }

      const children = Array.from(document.body.children).filter(el => {
        try { const st = window.getComputedStyle(el); return st && st.display !== 'none' && st.visibility !== 'hidden' && el.offsetHeight > 0; } catch (e) { return true; }
      });
      const bodyTop = document.body.getBoundingClientRect().top;
      let maxBottom = 0;
      children.forEach(el => { try { const r = el.getBoundingClientRect(); if (r.bottom > maxBottom) maxBottom = r.bottom; } catch (e) { } });
      if (maxBottom > 0) return Math.ceil(maxBottom - bodyTop);
      return document.body.scrollHeight || document.documentElement.scrollHeight || 0;
    });
    const pdfOptions = { path: tmpPath, printBackground: true, width: '80mm', height: `${Math.max(1, bodyHeight)}px` };
    await page.pdf(pdfOptions);

    // Enviar a la impresora usando pdf-to-printer (usa la cola de Windows)
    await print(tmpPath, nombreImpresora ? { printer: nombreImpresora } : {});

    res.json({ ok: true });
  } catch (err) {
    console.error('Error en print-agent:', err);
    res.status(500).json({ ok: false, message: String(err) });
  } finally {
    try { if (browser) await browser.close(); } catch (e) { }
    if (tmpPath) {
      fs.unlink(tmpPath, () => { });
    }
  }
});

app.listen(PORT, () => console.log(`Print agent escuchando en http://localhost:${PORT}`));
