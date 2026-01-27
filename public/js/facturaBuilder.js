// facturaBuilder.js

async function cargarPlantilla(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('No se pudo cargar la plantilla');
  return await res.text();
}

function normalizarCliente(cliente) {
  if (!cliente || !cliente.nombre_completo) {
    return {
      nombre: 'Consumidor Final',
      nit: '222222222222'
    };
  }

  return {
    nombre: cliente.nombre_completo,
    nit: cliente.numero_identificacion || '222222222222'
  };
}

function generarFilasProductos(productos) {
  return productos.map(p => `
    <tr>
      <td class="qty">${p.cantidad}</td>
      <td class="name">${p.nombre}</td>
      <td class="right">$${(p.precioUnitario || p.precio || 0).toFixed(2)}</td>
      <td class="right">$${(p.total || 0).toFixed(2)}</td>
    </tr>
  `).join('');
}

function calcularTotales(productos) {
  let subtotal = 0;
  let iva = 0;

  productos.forEach(p => {
    subtotal += p.baseGravable;
    iva += p.valorIva;
  });

  return {
    subtotal,
    iva,
    total: subtotal + iva
  };
}

export async function construirFacturaHTML({ tipoCopia, cliente, productos, pago, empleado }) {

  const plantillaBase = await cargarPlantilla('/templates/factura.html');
  const plantillaCopia = await cargarPlantilla(
    tipoCopia === 'cliente'
      ? '/templates/factura_cliente.html'
      : '/templates/factura_comercio.html'
  );

  const clienteFinal = normalizarCliente(cliente);
  const filasProductos = generarFilasProductos(productos);
  const totales = calcularTotales(productos);

  let html = plantillaBase;

  // Datos empresa (puedes moverlos a config si quieres)
  html = html.replace('{{EMPRESA_NOMBRE}}', 'SOLUCIONES NATURALES VIDA MAX')
             .replace('{{EMPRESA_NIT}}', '46666699-3')
             .replace('{{EMPRESA_DIRECCION}}', 'Duitama - Colombia');

  // Factura
  html = html.replace('{{NUMERO_FACTURA}}', Date.now())
             .replace('{{FECHA}}', new Date().toLocaleString('es-CO'));

  // Cliente
  html = html.replace('{{CLIENTE_NOMBRE}}', clienteFinal.nombre)
             .replace('{{CLIENTE_NIT}}', clienteFinal.nit);

  // Productos
  html = html.replace('{{PRODUCTOS}}', filasProductos);

  // Totales
  html = html.replace('{{SUBTOTAL}}', `$${totales.subtotal.toFixed(2)}`)
             .replace('{{IVA}}', `$${totales.iva.toFixed(2)}`)
             .replace('{{TOTAL}}', `$${totales.total.toFixed(2)}`);

  // Pago
  html = html.replace('{{FORMA_PAGO}}', pago?.forma || 'N/A')
             .replace('{{MEDIO_PAGO}}', pago?.medio || 'N/A')
             .replace('{{CAMBIO}}', (pago && pago.esEfectivo) ? `$${Number(pago.cambio || 0).toFixed(2)}` : '$0.00');

  // Empleado
  html = html.replace('{{EMPLEADO}}', empleado || 'N/A');


  // Copia
  html = html.replace('{{TITULO_FACTURA}}', plantillaCopia.match(/"(.*)"/)[1])
             .replace('{{TIPO_COPIA}}', plantillaCopia.split('=')[1].trim().replace(/"/g, ''));

  return html;
}
