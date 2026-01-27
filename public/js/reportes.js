// Report page logic: generate reports, export CSV, draw charts
document.addEventListener('DOMContentLoaded', () => {
    const ctx = document.getElementById('reportChart')?.getContext?.('2d');
    let currentChart = null;
    let currentCsv = '';

    async function fetchJsonArray(url) {
        try {
            const r = await fetch(url);
            if (!r.ok) return [];
            const j = await r.json().catch(() => null);
            if (!j) return [];
            if (Array.isArray(j)) return j;
            if (Array.isArray(j.rows)) return j.rows;
            if (Array.isArray(j.data)) return j.data;
            if (Array.isArray(j.result)) return j.result;
            if (Array.isArray(j.ventas)) return j.ventas;
            if (Array.isArray(j.clientes)) return j.clientes;
            const maybeArray = Object.values(j).filter(v => Array.isArray(v));
            if (maybeArray.length) return maybeArray[0];
            return [];
        } catch (e) { console.warn('fetchJsonArray error', url, e); return []; }
    }

    function downloadCsv(filename, csv) {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    // Recent exports persistence (localStorage)
    function saveRecentExport(filename, csv) {
        try {
            const max = 10;
            const now = new Date().toISOString();
            const size = new Blob([csv]).size;
            const entry = { filename, csv, date: now, size };
            const raw = localStorage.getItem('recentExports');
            const arr = raw ? JSON.parse(raw) : [];
            arr.unshift(entry);
            while (arr.length > max) arr.pop();
            localStorage.setItem('recentExports', JSON.stringify(arr));
            renderRecentExports();
        } catch (e) { console.warn('saveRecentExport error', e); }
    }

    function renderRecentExports() {
        const tbody = document.getElementById('recentExportsTbody');
        if (!tbody) return;
        const raw = localStorage.getItem('recentExports');
        const arr = raw ? JSON.parse(raw) : [];
        tbody.innerHTML = '';
        if (!arr.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-muted">No hay exportaciones recientes</td></tr>';
            return;
        }
        for (const e of arr) {
            const tr = document.createElement('tr');
            const tdName = document.createElement('td'); tdName.textContent = e.filename;
            const tdDate = document.createElement('td'); tdDate.textContent = (new Date(e.date)).toLocaleString();
            const tdSize = document.createElement('td'); tdSize.textContent = (e.size / 1024).toFixed(1) + ' KB';
            tr.appendChild(tdName); tr.appendChild(tdDate); tr.appendChild(tdSize);
            tbody.appendChild(tr);
        }
    }

    async function populateFilterSelects() {
        try {
            const provSel = document.getElementById('filterReportProvider');
            const prodSel = document.getElementById('filterReportProduct');
            if (provSel) {
                const prov = await fetchJsonArray('/proveedores');
                provSel.innerHTML = '<option value="">Todos los proveedores</option>' + (Array.isArray(prov) ? prov.map(p => `<option value="${p.id_proveedor ?? p.id ?? ''}">${(p.nombre_proveedor || p.nombre || p.empresa || 'Proveedor')}</option>`).join('') : '');
            }
            if (prodSel) {
                const prods = await fetchJsonArray('/productos');
                prodSel.innerHTML = '<option value="">Cualquier producto</option>' + (Array.isArray(prods) ? prods.map(p => `<option value="${p.id_producto ?? p.id ?? ''}">${(p.nombre_producto || p.nombre || 'Producto')}</option>`).join('') : '');
            }
        } catch (e) { console.warn('populateFilterSelects error', e); }
    }

    async function updateMetricCards() {
        try {
            const productos = await fetchJsonArray('/productos');
            const ventas = await fetchJsonArray('/ventas');
            let inventoryTotal = 0; let lowStockCount = 0;
            for (const p of (Array.isArray(productos) ? productos : [])) {
                const precio = parseFloat(p.precio_venta ?? p.precio ?? 0) || 0;
                const stock = Number(p.stock_actual ?? p.stock ?? 0) || 0;
                inventoryTotal += precio * stock;
                if (stock < 5) lowStockCount += 1;
            }
            const now = new Date();
            const past7 = new Date(now); past7.setDate(now.getDate() - 7);
            let sales7 = 0;
            for (const v of (Array.isArray(ventas) ? ventas : [])) {
                const f = v.fecha_venta || v.fecha || v.created_at || v.createdAt || null;
                if (!f) continue;
                const d = new Date(f);
                if (isNaN(d)) continue;
                if (d >= past7 && d <= now) sales7 += Number(v.total_pagar ?? v.total ?? v.total_pv ?? 0) || 0;
            }
            const invEl = document.getElementById('reportInventoryValue');
            const lowEl = document.getElementById('reportLowStockCount');
            const s7El = document.getElementById('reportSales7d');
            if (invEl) invEl.textContent = '$' + inventoryTotal.toFixed(2);
            if (lowEl) lowEl.textContent = String(lowStockCount);
            if (s7El) s7El.textContent = '$' + sales7.toFixed(2);
        } catch (e) { console.error('Error updating metric cards:', e); }
    }

    function buildCsvFromRows(headers, rows) {
        const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
        const lines = [headers.map(esc).join(',')];
        for (const r of rows) {
            lines.push(headers.map(h => esc(r[h] ?? '')).join(','));
        }
        return lines.join('\n');
    }

    function clearTable() {
        const tbody = document.querySelector('.card .table tbody');
        if (tbody) tbody.innerHTML = '';
    }

    function renderTable(headers, rows) {
        const thead = document.getElementById('reportTableHead');
        const tbody = document.getElementById('reportTableBody');
        const resultsSection = document.getElementById('reportResultsSection');
        const placeholder = document.getElementById('reportPlaceholder');

        if (!thead || !tbody) return;

        // Show results section, hide placeholder
        if (resultsSection) resultsSection.style.display = 'block';
        if (placeholder) placeholder.style.display = 'none';

        // Build header
        thead.innerHTML = '';
        const headerRow = document.createElement('tr');
        headerRow.className = 'text-muted';
        for (const h of headers) {
            const th = document.createElement('th');
            th.textContent = h.replace('_', ' ').toUpperCase();
            headerRow.appendChild(th);
        }
        thead.appendChild(headerRow);

        // Build body
        tbody.innerHTML = '';
        for (const r of rows) {
            const tr = document.createElement('tr');
            for (const h of headers) {
                const td = document.createElement('td');
                td.textContent = r[h] ?? '';
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }
    }

    function drawChart(config) {
        if (!ctx) return;
        if (currentChart) currentChart.destroy();
        currentChart = new Chart(ctx, config);
    }

    document.getElementById('btnExportCsv')?.addEventListener('click', () => {
        if (!currentCsv) return alert('No hay datos para exportar. Genera un reporte primero.');
        const filename = `reporte-${document.getElementById('reportType')?.value || 'report'}-${new Date().toISOString().slice(0, 10)}.csv`;
        downloadCsv(filename, currentCsv);
        saveRecentExport(filename, currentCsv);
    });

    document.getElementById('btnGenerateReport')?.addEventListener('click', async () => {
        const type = document.getElementById('reportType')?.value || 'ventas';
        const dateEls = Array.from(document.querySelectorAll('input[type="date"]'));
        const from = dateEls[0]?.value || null;
        const to = dateEls[1]?.value || null;

        if (type === 'ventas') {
            const ventas = await fetchJsonArray('/ventas');
            const filtered = ventas.filter(v => {
                const f = v.fecha_venta || v.fecha || v.created_at || v.createdAt || null;
                if (!f) return false;
                if (!from && !to) return true;
                const d = new Date(f).toISOString().slice(0, 10);
                if (from && d < from) return false;
                if (to && d > to) return false;
                return true;
            });

            // table rows
            const rows = filtered.map(v => ({
                numero_factura: v.numero_factura ?? v.id ?? '',
                fecha: (v.fecha_venta || v.fecha || v.created_at || v.createdAt || '').slice(0, 10),
                cliente: v.nombre_cliente ?? v.cliente_nombre ?? v.cliente ?? (v.cliente_nombre ?? ''),
                total: Number(v.total_pagar ?? v.total ?? v.total_pv ?? 0).toFixed(2)
            }));
            const headers = ['numero_factura', 'fecha', 'cliente', 'total'];
            renderTable(headers, rows);
            currentCsv = buildCsvFromRows(headers, rows);

            // Chart: ventas por día
            const byDay = Object.create(null);
            for (const v of filtered) {
                const d = (new Date(v.fecha_venta || v.fecha || v.created_at || v.createdAt)).toISOString().slice(0, 10);
                byDay[d] = (byDay[d] || 0) + Number(v.total_pagar ?? v.total ?? v.total_pv ?? 0) || 0;
            }
            const labels = Object.keys(byDay).sort();
            const data = labels.map(l => byDay[l]);
            drawChart({ type: 'bar', data: { labels, datasets: [{ label: 'Ventas (COP)', data, backgroundColor: '#198754' }] }, options: { responsive: true } });
            updateMetricCards();

        } else if (type === 'clientes') {
            const clientes = await fetchJsonArray('/clientes');
            const filtered = clientes.filter(c => {
                const f = c.fecha_creacion || c.fecha_creado || c.created_at || c.createdAt || c.fecha || null;
                if (!f) return false;
                if (!from && !to) return true;
                const d = new Date(f).toISOString().slice(0, 10);
                if (from && d < from) return false;
                if (to && d > to) return false;
                return true;
            });
            const rows = filtered.map(c => ({ id: c.id_cliente ?? c.id ?? '', nombre: c.nombre_completo ?? c.nombre ?? c.nombre_cliente ?? '', contacto: c.email ?? c.telefono ?? '' }));
            const headers = ['id', 'nombre', 'contacto'];
            renderTable(headers, rows);
            currentCsv = buildCsvFromRows(headers, rows);

            // Chart: nuevos clientes por día
            const byDay = Object.create(null);
            for (const c of filtered) {
                const d = (new Date(c.fecha_creacion || c.fecha_creado || c.created_at || c.createdAt || c.fecha)).toISOString().slice(0, 10);
                byDay[d] = (byDay[d] || 0) + 1;
            }
            const labels = Object.keys(byDay).sort();
            const data = labels.map(l => byDay[l]);
            drawChart({ type: 'line', data: { labels, datasets: [{ label: 'Nuevos clientes', data, borderColor: '#0d6efd', backgroundColor: 'rgba(13,110,253,0.1)', fill: true }] }, options: { responsive: true } });
            updateMetricCards();

        } else if (type === 'productos') {
            const productos = await fetchJsonArray('/productos');
            const rows = (Array.isArray(productos) ? productos : []).map(p => ({ id: p.id_producto ?? p.id ?? '', nombre: p.nombre_producto ?? p.nombre ?? '', stock: Number(p.stock_actual ?? p.stock ?? 0), precio: Number(p.precio_venta ?? p.precio ?? 0).toFixed(2) }));
            const headers = ['id', 'nombre', 'stock', 'precio'];
            renderTable(headers, rows);
            currentCsv = buildCsvFromRows(headers, rows);

            // Chart: stock top 10
            const sorted = rows.slice().sort((a, b) => b.stock - a.stock).slice(0, 10);
            const labels = sorted.map(r => r.nombre);
            const data = sorted.map(r => r.stock);
            drawChart({ type: 'bar', data: { labels, datasets: [{ label: 'Stock', data, backgroundColor: '#ffc107' }] }, options: { responsive: true } });
            updateMetricCards();
        } else if (type === 'vencidos') {
            // Reporte: productos vencidos (fecha_vencimiento < hoy)
            const productos = await fetchJsonArray('/productos');
            const hoy = new Date();
            const msPerDay = 24 * 60 * 60 * 1000;
            const expired = (Array.isArray(productos) ? productos : []).map(p => {
                const fechaRaw = p.fecha_vencimiento ?? p.fechaVencimiento ?? p.expiry ?? null;
                const date = fechaRaw ? new Date(fechaRaw) : null;
                const dias = (date && !isNaN(date.getTime())) ? Math.ceil((date - hoy) / msPerDay) : null;
                return { raw: p, date, dias };
            }).filter(it => it.date && it.dias < 0)
            .sort((a,b) => a.date - b.date);

            const rows = expired.map(e => ({ id: e.raw.id_producto ?? e.raw.id ?? '', nombre: e.raw.nombre_producto ?? e.raw.nombre ?? '', fecha_vencimiento: e.date ? e.date.toISOString().slice(0,10) : '', dias_vencido: e.dias === null ? '' : Math.abs(e.dias) }));
            const headers = ['id', 'nombre', 'fecha_vencimiento', 'dias_vencido'];
            renderTable(headers, rows);
            currentCsv = buildCsvFromRows(headers, rows);

            // Chart: cantidad vencida por día (últimos 30 días)
            const byDay = Object.create(null);
            for (const e of expired) {
                const d = e.date.toISOString().slice(0,10);
                byDay[d] = (byDay[d] || 0) + 1;
            }
            const labels = Object.keys(byDay).sort();
            const data = labels.map(l => byDay[l]);
            drawChart({ type: 'bar', data: { labels, datasets: [{ label: 'Productos vencidos', data, backgroundColor: '#dc3545' }] }, options: { responsive: true } });
            updateMetricCards();
        }
    });

    // init: populate filters, render recent exports, update cards
    (async function initReportPage() {
        try {
            await populateFilterSelects();
            renderRecentExports();
            await updateMetricCards();
        } catch (err) { console.error('Error inicializando página de reportes:', err); }
    })();

    // Filters: apply / clear
    document.getElementById('btnApplyFilters')?.addEventListener('click', () => {
        // currently, Apply triggers report generation using the date inputs
        document.getElementById('btnGenerateReport')?.click();
    });
    document.getElementById('btnClearFilters')?.addEventListener('click', () => {
        const dateEls = Array.from(document.querySelectorAll('input[type="date"]'));
        dateEls.forEach(i => i.value = '');
        const prov = document.getElementById('filterReportProvider'); if (prov) prov.value = '';
        const prod = document.getElementById('filterReportProduct'); if (prod) prod.value = '';
        const st = document.getElementById('filterReportState'); if (st) st.value = '';
    });
});
