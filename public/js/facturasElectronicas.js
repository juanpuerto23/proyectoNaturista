import { construirFacturaHTML } from './facturaBuilder.js';

const tabla = document.querySelector('#tablaProductos tbody');
const productosListEl = document.getElementById('productosList');
let productosCache = [];
let clientesCache = [];
let clienteSeleccionado = null;
let metodosPagoCache = [];
let empleadosCache = [];

async function loadInitialData() {
    try {
        const [pRes, cRes] = await Promise.all([
            fetch('/productos').then(r => r.ok ? r.json() : []),
            fetch('/clientes').then(r => r.ok ? r.json() : [])
        ]);
        productosCache = Array.isArray(pRes) ? pRes : [];
        clientesCache = Array.isArray(cRes) ? cRes : [];
        populateProductosDatalist();
        // load payment methods and employees for the invoice modal
        try { await Promise.all([loadMetodosPago(), loadEmpleados()]); } catch (e) { console.warn('Error cargando metodos/empleados', e); }
    } catch (err) {
        console.warn('No se pudieron cargar productos/clientes:', err);
    }
}

async function loadMetodosPago() {
    try {
        const res = await fetch('/metodos_pago');
        if (!res.ok) return;
        const data = await res.json();
        metodosPagoCache = Array.isArray(data) ? data : [];
        const sel = document.getElementById('selectMetodoPago');
        if (!sel) return;
        sel.innerHTML = '<option value="">Seleccione método de pago</option>' + metodosPagoCache.map(m => `<option value="${m.id_metodo_pago || m.id || ''}">${m.nombre_metodo || m.nombre || ''}</option>`).join('');
    } catch (e) { console.warn('loadMetodosPago error', e); }
}

async function loadEmpleados() {
    try {
        // Prefer the `empleados` table because ventas.id_empleado FK references id_empleado
        const res = await fetch('/empleados');
        if (!res.ok) {
            console.warn('/empleados returned not ok', res.status);
            // Clear select if exists
            const selEmpty = document.getElementById('selectEmpleado'); if (selEmpty) selEmpty.innerHTML = '<option value="">Seleccione empleado (opcional)</option>';
            return;
        }
        const data = await res.json();
        empleadosCache = Array.isArray(data) ? data : [];
        const sel = document.getElementById('selectEmpleado');
        if (!sel) return;
        sel.innerHTML = '<option value="">Seleccione empleado (opcional)</option>' + empleadosCache.map(e => `<option value="${e.id_empleado || e.id || ''}">${e.nombre_completo || e.nombre || e.username || e.email || ''}</option>`).join('');
        // try auto-select current user by matching email/username if possible
        const cur = getCurrentUser();
        if (cur) {
            const match = empleadosCache.find(x => String(x.email || x.username || '').toLowerCase() === String(cur.email || cur.username || '').toLowerCase());
            if (match) sel.value = String(match.id_empleado || match.id || '');
        }
    } catch (e) {
        console.warn('loadEmpleados error', e);
        const selEmpty = document.getElementById('selectEmpleado'); if (selEmpty) selEmpty.innerHTML = '<option value="">Seleccione empleado (opcional)</option>';
    }
}

function populateProductosDatalist() {
    productosListEl.innerHTML = '';
    productosCache.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.nombre_producto || p.nombre || '';
        opt.dataset.id = p.id_producto || p.id || '';
        opt.dataset.stock = p.stock_actual || 0;
        opt.dataset.precio = p.precio_venta || p.precio || 0;
        productosListEl.appendChild(opt);
    });
}

// Eventos de tabla
tabla.addEventListener('input', e => {
    const fila = e.target.closest('tr');
    if (!fila) return;
    // si cambió el código, intentar autocompletar id/nombre/precio
    if (e.target.classList.contains('codigo')) onCodigoChange(fila);
    actualizarFila(fila);

    // Sólo agregar una nueva fila si estamos editando la última fila
    // y ésta tiene los campos requeridos válidos (producto seleccionado, cantidad entero > 0, precio >= 0)
    const lastRow = tabla.rows[tabla.rows.length - 1];
    if (fila === lastRow) {
        const idProd = fila.querySelector('.idProducto')?.value?.trim();
        const cantidadRaw = fila.querySelector('.cantidad')?.value;
        const precioRaw = fila.querySelector('.precioUnitario')?.value;
        const cantidadVal = cantidadRaw === undefined || cantidadRaw === '' ? NaN : parseInt(cantidadRaw, 10);
        const precioVal = precioRaw === undefined || precioRaw === '' ? NaN : parseFloat(precioRaw);
        const validCantidad = Number.isInteger(cantidadVal) && cantidadVal > 0;
        const validPrecio = !isNaN(precioVal) && precioVal >= 0;
        if (idProd && validCantidad && validPrecio) agregarFila();
    }

    calcularTotales();
});

function onNombreChange(fila) {
    const nombre = fila.querySelector('.nombre')?.value || '';
    const match = productosCache.find(p => String(p.nombre_producto || p.nombre || '').toLowerCase() === nombre.toLowerCase());
    if (match) {
        fila.querySelector('.idProducto').value = match.id_producto || match.id || '';
        fila.querySelector('.precioUnitario').value = match.precio_venta || match.precio || 0;
        fila.dataset.stock = match.stock_actual || 0;
    } else {
        fila.querySelector('.idProducto').value = '';
        fila.dataset.stock = '';
    }
}

function onCodigoChange(fila) {
    const codigo = fila.querySelector('.codigo')?.value?.trim() || '';
    if (!codigo) {
        fila.querySelector('.idProducto').value = '';
        fila.querySelector('.nombre').value = '';
        fila.querySelector('.precioUnitario').value = '';
        fila.dataset.stock = '';
        return;
    }
    
    // Buscar por id_producto (que es el código que lee la pistola laser)
    const match = productosCache.find(p => String(p.id_producto || '').toLowerCase() === codigo.toLowerCase());
    if (match) {
        fila.querySelector('.idProducto').value = match.id_producto || '';
        fila.querySelector('.nombre').value = match.nombre_producto || match.nombre || '';
        fila.querySelector('.precioUnitario').value = match.precio_venta || match.precio || 0;
        fila.dataset.stock = match.stock_actual || 0;
    } else {
        fila.querySelector('.idProducto').value = '';
        fila.querySelector('.nombre').value = '';
        fila.querySelector('.precioUnitario').value = '';
        fila.dataset.stock = '';
    }
}

function agregarFila() {
    // clone the last row to preserve structure and listeners
    const source = tabla.rows[tabla.rows.length - 1] || tabla.rows[0];
    const filaNueva = source.cloneNode(true);
    filaNueva.querySelectorAll('input').forEach(i => {
        i.value = '';
        // ensure proper min/step attributes remain
        if (i.classList.contains('cantidad')) {
            i.min = '1';
            i.step = '1';
        }
        if (i.classList.contains('precioUnitario')) {
            i.min = '0';
            i.step = '0.01';
            i.readOnly = true;
        }
        if (i.classList.contains('descuento')) {
            i.min = '0';
            i.step = '0.01';
        }
        if (i.classList.contains('nombre')) {
            i.readOnly = true;
        }
    });
    // show delete button on new rows (first row keeps it hidden)
    const delBtn = filaNueva.querySelector('button');
    if (delBtn) delBtn.classList.remove('d-none');
    tabla.appendChild(filaNueva);
}

window.eliminarFila = function (btn) {
    if (tabla.rows.length > 1) btn.closest('tr').remove();
    calcularTotales();
};

function actualizarFila(fila) {
    // coerce and clamp values to avoid negatives and force integer quantities
    const rawP = fila.querySelector('.precioUnitario')?.value;
    const rawC = fila.querySelector('.cantidad')?.value;
    const rawD = fila.querySelector('.descuento')?.value;
    const p = Math.max(0, isNaN(parseFloat(rawP)) ? 0 : parseFloat(rawP));
    const c = Math.max(0, Number.isInteger(parseInt(rawC, 10)) ? parseInt(rawC, 10) : (isNaN(Number(rawC)) ? 0 : Math.floor(Number(rawC))));
    const d = Math.max(0, isNaN(parseFloat(rawD)) ? 0 : parseFloat(rawD));
    const subtotal = p * c;
    const descuento = subtotal * (d / 100);
    const totalFila = subtotal - descuento;
    fila.querySelector('.valorTotal').value = totalFila.toFixed(2);
    const btn = fila.querySelector('button');
    if (btn) btn.classList.toggle('d-none', subtotal === 0);
}

function calcularTotales() {
    let subtotal = 0, descuento = 0;
    tabla.querySelectorAll('tr').forEach(fila => {
        const p = parseFloat(fila.querySelector('.precioUnitario')?.value) || 0;
        const c = parseFloat(fila.querySelector('.cantidad')?.value) || 0;
        const d = parseFloat(fila.querySelector('.descuento')?.value) || 0;
        const sub = p * c;
        subtotal += sub;
        descuento += sub * (d / 100);
    });
    const totalFinal = subtotal - descuento;

    const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    setText('subtotal', `$${subtotal.toFixed(2)}`);
    setText('iva', `$0.00`);
    setText('descuento', `$${descuento.toFixed(2)}`);
    setText('totalFinal', `$${totalFinal.toFixed(2)}`);
    return { subtotal, descuento, iva: 0, totalFinal };
}

// Buscar cliente por número de identificación (usa cache cargada inicialmente)
document.getElementById('btnBuscarCliente').addEventListener('click', () => {
    const num = document.getElementById('numeroIdentificacion').value.trim();
    if (!num) return alert('Ingrese número de identificación');
    const found = clientesCache.find(c => String(c.numero_identificacion || '') === num);
    if (found) {
        clienteSeleccionado = found;
        document.getElementById('nombreCompleto').value = found.nombre_completo || '';
        document.getElementById('telefonoCliente').value = found.telefono || '';
        document.getElementById('tipoDocumento').value = found.tipo_identificacion || 'CC';
        document.getElementById('clienteInfo').textContent = `Cliente encontrado: id=${found.id_cliente}`;
    } else {
        clienteSeleccionado = null;
        document.getElementById('clienteInfo').textContent = 'Cliente no encontrado. Se creará uno nuevo al generar la factura.';
    }
});

// Obtener usuario actual (intentar varias fuentes)
function getCurrentUser() {
    try {
        const winUser = window.currentUser || window.user || null;
        if (winUser) return winUser;
        const keys = ['user', 'currentUser', 'usuario', 'authUser'];
        for (const k of keys) {
            const s = sessionStorage.getItem(k) || localStorage.getItem(k);
            if (!s) continue;
            try { return JSON.parse(s); } catch (e) { }
        }
        const cookieMatch = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('user='));
        if (cookieMatch) {
            const val = decodeURIComponent(cookieMatch.split('=')[1] || '');
            try { return JSON.parse(val); } catch (e) { }
        }
    } catch (err) { console.warn('getCurrentUser error', err); }
    return null;
}

// Generar factura -> crear cliente si necesario, luego POST /ventas
// Show modal to pick payment method and employee, then process the sale
document.getElementById('btnGenerar').addEventListener('click', async () => {
    const modalEl = document.getElementById('modalPagoEmpleado');
    if (!modalEl) return alert('No se encontró el modal de método de pago');
    // refresh lists before showing
    try { await Promise.all([loadMetodosPago(), loadEmpleados()]); } catch (e) { /* ignore */ }
    const modal = new bootstrap.Modal(modalEl);
    modal.show();
});

// Confirm button in modal: gather selections and run the same sale flow
document.getElementById('btnConfirmVenta').addEventListener('click', async () => {
    const selMetodo = document.getElementById('selectMetodoPago');
    const selEmpleado = document.getElementById('selectEmpleado');
    const metodo = selMetodo ? selMetodo.value : null;
    const empleado = selEmpleado && selEmpleado.value ? selEmpleado.value : null;
    if (!metodo) return alert('Seleccione un método de pago');
    // hide modal
    // Validación si es efectivo
    const metodoObj = metodosPagoCache.find(m =>
        String(m.id_metodo_pago || m.id) === String(metodo)
    );

    if (metodoObj && metodoObj.nombre_metodo?.toLowerCase().includes('efectivo')) {
        const pagado = parseFloat(valorPagadoInput.value);
        const total = calcularTotales().totalFinal;

        if (isNaN(pagado) || pagado < total) {
            return alert('El valor pagado no puede ser menor al total');
        }
    }
    try { bootstrap.Modal.getInstance(document.getElementById('modalPagoEmpleado'))?.hide(); } catch (e) {}

    // call existing generation flow but injecting metodo and empleado
    try {
        // copia la lógica original para construir detalles y cliente
        const rows = Array.from(tabla.querySelectorAll('tr'));
        const detalles = [];
        for (const fila of rows) {
            const idProducto = fila.querySelector('.idProducto')?.value || '';
            const cantidad = Number(fila.querySelector('.cantidad')?.value || 0);
            const precio = Number(fila.querySelector('.precioUnitario')?.value || 0);
            const descuento = Number(fila.querySelector('.descuento')?.value || 0);
            const subtotal_detalle = Number(fila.querySelector('.valorTotal')?.value || 0);
            if (!idProducto && (fila.querySelector('.nombre')?.value || '').trim() === '') continue;
            if (!idProducto) return alert('Debe seleccionar productos válidos desde el código o la lista');
            if (cantidad <= 0) return alert('Cantidad debe ser mayor a 0');
            detalles.push({ id_producto: Number(idProducto), cantidad, precio_unitario: precio, descuento_detalle: descuento, subtotal_detalle });
        }
        if (detalles.length === 0) return alert('Agregue al menos un producto con cantidad > 0');

        let idCliente = clienteSeleccionado ? clienteSeleccionado.id_cliente : null;
        if (!idCliente) {
            const clientePayload = {
                nombre_completo: document.getElementById('nombreCompleto').value || 'Cliente ocasional',
                tipo_identificacion: document.getElementById('tipoDocumento').value || null,
                numero_identificacion: document.getElementById('numeroIdentificacion').value || null,
                telefono: document.getElementById('telefonoCliente').value || null,
            };
            const resp = await fetch('/clientes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clientePayload) });
            if (resp.status === 409) {
                const body = await resp.json();
                if (body && body.existing) {
                    idCliente = body.existing.id_cliente;
                } else if (body && body.detail) {
                    await loadInitialData();
                    const found = clientesCache.find(c => String(c.numero_identificacion || '') === String(clientePayload.numero_identificacion || ''));
                    if (found) idCliente = found.id_cliente;
                }
            } else if (resp.ok) {
                const created = await resp.json();
                idCliente = created && created.row ? created.row.id_cliente : (created && created.success && created.row && created.row.id_cliente ? created.row.id_cliente : null);
            } else {
                const txt = await resp.text();
                return alert('Error creando cliente: ' + txt);
            }
            if (!idCliente) return alert('No se pudo obtener id del cliente');
        }

        const tot = calcularTotales();
        const currentUser = getCurrentUser();
        const ventaPayload = {
            id_cliente: idCliente,
            id_empleado: empleado ? Number(empleado) : ((currentUser && (currentUser.id_usuario || currentUser.id)) && String((currentUser.rol || currentUser.role || '').toLowerCase()) === 'empleado' ? (currentUser.id_usuario || currentUser.id) : null),
            id_metodo_pago: Number(metodo),
            subtotal: tot.subtotal,
            descuento_porcentaje: 0,
            descuento_valor: tot.descuento,
            iva_porcentaje: 0,
            iva_valor: tot.iva,
            total_pagar: tot.totalFinal,
            observaciones: null,
            detalles
        };

        const ventasResp = await fetch('/ventas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ventaPayload) });
        let ventasBody = null;
        try {
            const ct = ventasResp.headers.get('content-type') || '';
            if (ct.includes('application/json')) ventasBody = await ventasResp.json();
            else ventasBody = await ventasResp.text();
        } catch (e) { ventasBody = null; }

        if (ventasResp.status === 409) {
            if (ventasBody && ventasBody.error === 'stock_insuficiente') {
                return alert(`Stock insuficiente para producto id=${ventasBody.id_producto}. Disponible: ${ventasBody.disponible}`);
            }
            return alert('Error al crear venta: ' + (typeof ventasBody === 'string' ? ventasBody : JSON.stringify(ventasBody)));
        }
        if (!ventasResp.ok) {
            return alert('Error al crear venta: ' + (typeof ventasBody === 'string' ? ventasBody : JSON.stringify(ventasBody)));
        }
        const ventaResult = (ventasBody && typeof ventasBody === 'object') ? ventasBody : (ventasBody ? JSON.parse(ventasBody) : {});
        const modalCopias = new bootstrap.Modal(document.getElementById('modalCopias'));
        modalCopias.show();
    } catch (err) {
        console.error('Error generando factura:', err);
        alert('Error generando factura: ' + (err.message || err));
    }
});

function detectIsAdmin() {
    try {
        // 1) window.currentUser
        const winUser = window.currentUser || window.user || null;
        if (winUser && (winUser.rol || winUser.role)) {
            const r = String(winUser.rol || winUser.role || '').toLowerCase();
            return r === 'admin' || r === 'administrator';
        }

        // 2) sessionStorage/localStorage common keys
        const keys = ['user', 'currentUser', 'usuario', 'authUser'];
        for (const k of keys) {
            const s = sessionStorage.getItem(k) || localStorage.getItem(k);
            if (!s) continue;
            try {
                const obj = JSON.parse(s);
                const r = String(obj && (obj.rol || obj.role || obj.role_name || obj.roleName) || '').toLowerCase();
                if (r === 'admin' || r === 'administrator') return true;
            } catch (e) {
                // ignore parse errors
            }
        }

        // 3) cookie named 'user' (JSON)
        const cookieMatch = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('user='));
        if (cookieMatch) {
            const val = decodeURIComponent(cookieMatch.split('=')[1] || '');
            try {
                const obj = JSON.parse(val);
                const r = String(obj && (obj.rol || obj.role) || '').toLowerCase();
                if (r === 'admin' || r === 'administrator') return true;
            } catch (e) { }
        }

    } catch (err) {
        console.warn('detectIsAdmin error', err);
    }
    return false;
}

// inicializar
loadInitialData().then(() => {
    const isAdmin = detectIsAdmin();
    const infoEl = document.getElementById('clienteInfo');
    if (isAdmin) {
        infoEl.style.display = '';
    } else {
        infoEl.style.display = 'none';
    }
});

// Detectar metodo de pago para mostrar campo de valor pagado y calcular cambio
const selectMetodoPago = document.getElementById('selectMetodoPago');
const grupoEfectivo = document.getElementById('grupoEfectivo');
const valorPagadoInput = document.getElementById('valorPagado');
const textoCambio = document.getElementById('textoCambio');

if (selectMetodoPago) {
    selectMetodoPago.addEventListener('change', () => {
        const metodoId = selectMetodoPago.value;
        const metodo = metodosPagoCache.find(m =>
            String(m.id_metodo_pago || m.id) === String(metodoId)
        );

        if (metodo && metodo.nombre_metodo?.toLowerCase().includes('efectivo')) {
            grupoEfectivo.classList.remove('d-none');
        } else {
            grupoEfectivo.classList.add('d-none');
            valorPagadoInput.value = '';
            textoCambio.textContent = '$0.00';
        }
    });
}
// Calcular cambio al ingresar valor pagado
if (valorPagadoInput) {
    valorPagadoInput.addEventListener('input', () => {
        const pagado = parseFloat(valorPagadoInput.value) || 0;
        const total = calcularTotales().totalFinal;
        const cambio = pagado - total;

        textoCambio.textContent = `$${(cambio >= 0 ? cambio : 0).toFixed(2)}`;
    });
}

function obtenerProductosDesdeTabla() {
  const filas = document.querySelectorAll('#tablaProductos tbody tr');
  const productos = [];

  filas.forEach((fila, index) => {
    const nombre = fila.querySelector('.nombre')?.value?.trim();
    const codigo = fila.querySelector('.codigo')?.value?.trim();
    const precioUnitario = parseFloat(fila.querySelector('.precioUnitario')?.value) || 0;
    const cantidad = parseFloat(fila.querySelector('.cantidad')?.value) || 0;
    const descuento = parseFloat(fila.querySelector('.descuento')?.value) || 0;
    const ivaPorcentaje = parseFloat(fila.querySelector('.iva')?.value) || 0;

    // Ignorar filas vacías
    if (!nombre || cantidad <= 0 || precioUnitario <= 0) return;

    // Precio ya incluye IVA
    const subtotalConIva = precioUnitario * cantidad;

    // IVA incluido dentro del precio
    const valorIva = ivaPorcentaje > 0
      ? subtotalConIva - (subtotalConIva / (1 + ivaPorcentaje / 100))
      : 0;

    const baseGravable = subtotalConIva - valorIva;

    productos.push({
      index: index + 1,
      codigo,
      nombre,
      cantidad,
      precioUnitario,
      ivaPorcentaje,
      baseGravable,
      valorIva,
      total: subtotalConIva
    });
  });

  return productos;
}


// Botones de impresion (frontend -> backend -> impresora)
document.getElementById('btnCopiaCliente').addEventListener('click', () => {
  imprimirFactura('cliente');
});

document.getElementById('btnCopiaComercio').addEventListener('click', () => {
  imprimirFactura('comercio');
});

// Preview buttons: generate PDF preview via print-agent /preview and open in new tab
const btnPreviewCliente = document.getElementById('btnPreviewCliente');
const btnPreviewComercio = document.getElementById('btnPreviewComercio');
async function previewFactura(tipo) {
    try {
        const productos = obtenerProductosDesdeTabla();
        if (productos.length === 0) return alert('No hay productos para previsualizar');

        const clientePayload = clienteSeleccionado || {
            nombre_completo: document.getElementById('nombreCompleto')?.value || 'Consumidor Final',
            numero_identificacion: document.getElementById('numeroIdentificacion')?.value || ''
        };

        const selMetodo = document.getElementById('selectMetodoPago');
        const selEmpleado = document.getElementById('selectEmpleado');
        const metodoVal = selMetodo ? selMetodo.value : null;
        const metodoObj = metodosPagoCache.find(m => String(m.id_metodo_pago || m.id) === String(metodoVal));
        const formaPago = metodoObj ? (metodoObj.nombre_metodo || metodoObj.nombre || 'N/A') : (selMetodo ? selMetodo.options[selMetodo.selectedIndex]?.text : 'N/A');
        const medioPago = /credito|cr[eé]dito/i.test(formaPago) ? 'Credito' : 'Contado';
        const valorPagadoEl = document.getElementById('valorPagado');
        const isEfectivo = (metodoObj && metodoObj.nombre_metodo && String(metodoObj.nombre_metodo).toLowerCase().includes('efectivo')) || String(formaPago).toLowerCase().includes('efectivo');
        let cambioVal = 0;
        if (isEfectivo && valorPagadoEl) {
            const pagado = parseFloat(valorPagadoEl.value) || 0;
            const total = calcularTotales().totalFinal;
            cambioVal = Math.max(0, pagado - total);
        }

        const htmlFactura = await construirFacturaHTML({
            tipoCopia: tipo,
            cliente: clientePayload,
            productos,
            pago: { forma: formaPago, medio: medioPago, cambio: cambioVal, esEfectivo: isEfectivo },
            empleado: (selEmpleado && selEmpleado.value) ? (empleadosCache.find(e => String(e.id_empleado || e.id) === String(selEmpleado.value))?.nombre_completo || selEmpleado.options[selEmpleado.selectedIndex]?.text) : 'Caja'
        });

        const resp = await fetch('http://localhost:9101/preview', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ html: htmlFactura, offsetMm: 8 })
        });
        if (!resp.ok) {
            const txt = await resp.text();
            return alert('Error preview: ' + txt);
        }
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
    } catch (err) {
        console.error('Error previsualizando factura:', err);
        alert('No se pudo generar previsualización: ' + (err.message || err));
    }
}

if (btnPreviewCliente) btnPreviewCliente.addEventListener('click', () => previewFactura('cliente'));
if (btnPreviewComercio) btnPreviewComercio.addEventListener('click', () => previewFactura('comercio'));

async function imprimirFactura(tipo) {
  try {
    const productos = obtenerProductosDesdeTabla();
    if (productos.length === 0) {
      alert('No hay productos para imprimir');
      return;
    }

        // Construir datos del cliente (usar clienteSeleccionado si existe, sino tomar del formulario)
        const clientePayload = clienteSeleccionado || {
            nombre_completo: document.getElementById('nombreCompleto')?.value || 'Consumidor Final',
            numero_identificacion: document.getElementById('numeroIdentificacion')?.value || '',
            telefono: document.getElementById('telefonoCliente')?.value || ''
        };

        // Obtener método y empleado seleccionados si existen en el DOM
        const selMetodo = document.getElementById('selectMetodoPago');
        const selEmpleado = document.getElementById('selectEmpleado');
        const metodoVal = selMetodo ? selMetodo.value : null;
        const metodoObj = metodosPagoCache.find(m => String(m.id_metodo_pago || m.id) === String(metodoVal));
        const formaPago = metodoObj ? (metodoObj.nombre_metodo || metodoObj.nombre || 'N/A') : (selMetodo ? selMetodo.options[selMetodo.selectedIndex]?.text : 'N/A');
        // Detect if the selected payment method is cash-like (efectivo)
        const isEfectivo = (metodoObj && metodoObj.nombre_metodo && String(metodoObj.nombre_metodo).toLowerCase().includes('efectivo')) || String(formaPago).toLowerCase().includes('efectivo');
        // Normalize medio: 'Credito' or 'Contado' (treat efectivo as Contado)
        const medioPago = /credito|cr[eé]dito/i.test(formaPago) ? 'Credito' : 'Contado';
        // Compute cambio only when efectivo
        let cambioVal = 0;
        const valorPagadoEl = document.getElementById('valorPagado');
        if (isEfectivo && valorPagadoEl) {
            const pagado = parseFloat(valorPagadoEl.value) || 0;
            const total = calcularTotales().totalFinal;
            cambioVal = Math.max(0, pagado - total);
        }
        const empleadoName = (selEmpleado && selEmpleado.value) ? (empleadosCache.find(e => String(e.id_empleado || e.id) === String(selEmpleado.value))?.nombre_completo || selEmpleado.options[selEmpleado.selectedIndex]?.text) : 'Caja';

        const htmlFactura = await construirFacturaHTML({
            tipoCopia: tipo,
            cliente: clientePayload,
            productos,
            pago: {
                forma: formaPago,
                medio: medioPago,
                cambio: cambioVal,
                esEfectivo: isEfectivo
            },
            empleado: empleadoName
        });

        // enviar al agente local de impresión (corre en la caja)
        const resp = await fetch('http://localhost:9101/imprimir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ html: htmlFactura, nombreImpresora: 'XP-58C', offsetMm: 8 })
        });

    const result = await resp.json();
    console.log('Resultado impresión:', result);

  } catch (err) {
    console.error('Error imprimiendo factura:', err);
    alert(err.message);
  }
}
