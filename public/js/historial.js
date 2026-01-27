// Historial de productos vendidos
document.addEventListener('DOMContentLoaded', () => {
  const tbody = document.querySelector('#historial-table tbody');
  const filterInput = document.getElementById('hist_filter');

  async function fetchHistory() {
    try {
      // Obtener ventas y detalles (limitado para rendimiento)
      const [ventasRes, detallesRes] = await Promise.all([
        fetch('/ventas').then(r => r.ok ? r.json() : []),
        fetch('/detalle_ventas').then(r => r.ok ? r.json() : [])
      ]);
      const ventas = Array.isArray(ventasRes) ? ventasRes : [];
      const detalles = Array.isArray(detallesRes) ? detallesRes : [];

      // Mapear ventas por id para obtener numero_factura, fecha, cliente, empleado
      const ventasMap = new Map();
      for (const v of ventas) ventasMap.set(v.id_venta || v.id || v.venta_id, v);

      // Necesitamos también obtener productos y clientes/empleados para nombres
      const [productosRes, clientesRes, empleadosRes] = await Promise.all([
        fetch('/productos').then(r => r.ok ? r.json() : []),
        fetch('/clientes').then(r => r.ok ? r.json() : []),
        fetch('/empleados').then(r => r.ok ? r.json() : [])
      ]);
      const productos = Array.isArray(productosRes) ? productosRes : [];
      const clientes = Array.isArray(clientesRes) ? clientesRes : [];
      const empleados = Array.isArray(empleadosRes) ? empleadosRes : [];

      const prodMap = new Map(productos.map(p => [p.id_producto ?? p.id, p]));
      const cliMap = new Map(clientes.map(c => [c.id_cliente ?? c.id, c]));
      const empMap = new Map(empleados.map(e => [e.id_empleado ?? e.id, e]));

      // combinar detalles con info
      const rows = detalles.map(d => {
        const venta = ventasMap.get(d.id_venta) || {};
        const prod = prodMap.get(d.id_producto) || {};
        const cliente = cliMap.get(venta.id_cliente) || {};
        const empleado = empMap.get(venta.id_empleado) || {};
        return {
          fecha: venta.fecha_venta || venta.fecha || '',
          factura: venta.numero_factura || venta.id_venta || venta.venta_id || '',
          producto: prod.nombre_producto || prod.nombre || d.nombre || '',
          codigo: prod.codigo_barras || prod.id_producto || prod.id || '',
          cantidad: d.cantidad || d.cant || 0,
          precio: Number(d.precio_unitario || d.precio || 0),
          subtotal: Number(d.subtotal_detalle || 0),
          cliente: cliente.nombre_completo || cliente.nombre || venta.cliente_nombre || '',
          empleado: empleado.nombre_completo || empleado.nombre || venta.empleado_nombre || ''
        };
      }).sort((a,b) => new Date(b.fecha) - new Date(a.fecha));

      renderRows(rows);
      // filter handler
      filterInput.addEventListener('input', () => renderRows(rows, filterInput.value));
    } catch (err) {
      console.error('Error cargando historial:', err);
      tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted">No se pudo cargar historial</td></tr>';
    }
  }

  function renderRows(rows, filter = '') {
    const q = (filter || '').toString().toLowerCase().trim();
    const shown = q ? rows.filter(r => (r.producto || '').toLowerCase().includes(q) || String(r.codigo || '').toLowerCase().includes(q) || String(r.factura || '').toLowerCase().includes(q)) : rows;
    if (!shown || shown.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted">Sin resultados</td></tr>';
      return;
    }
    tbody.innerHTML = shown.map(r => `
      <tr>
        <td class="small">${r.fecha ? new Date(r.fecha).toLocaleString() : '-'}</td>
        <td class="small">${r.factura}</td>
        <td>${escapeHtml(r.producto)}</td>
        <td>${escapeHtml(String(r.codigo))}</td>
        <td>${r.cantidad}</td>
        <td>$${Number(r.precio || 0).toFixed(2)}</td>
        <td>$${Number(r.subtotal || 0).toFixed(2)}</td>
        <td>${escapeHtml(r.cliente)}</td>
        <td>${escapeHtml(r.empleado)}</td>
      </tr>
    `).join('');
  }

  function escapeHtml(s) { return String(s || '').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  fetchHistory();
});
