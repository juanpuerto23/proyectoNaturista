// Script para manejar inventario: cargar, buscar, filtrar, agregar, editar, eliminar
document.addEventListener('DOMContentLoaded', () => {
    // helpers
    const $ = id => document.getElementById(id);
    const safeLog = (...args) => console.log('[Inventario]', ...args);

    // elementos
    const tbody = document.querySelector('#tabla-productos tbody');
    const inputBusqueda = $('busquedaNombre');
    const btnGuardar = $('btnGuardar');
    const selectCategorias = $('p_category');
    const selectProveedores = $('p_supplier');
    const filtroCategoria = $('filtroCategoria');
    const filtroProveedor = $('filtroProveedor');
    const btnBuscarTop = document.getElementById('btnBuscarTop');

    const categoryMap = Object.create(null);
    const supplierMap = Object.create(null);

    let productos = [];

    // fetch seguro que revisa status y JSON
    async function fetchJson(url) {
        try {
            const res = await fetch(url);
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                console.error(`Error al pedir ${url}: ${res.status}`, text);
                throw new Error(`HTTP ${res.status} - ${url}`);
            }

            // intentar parsear JSON; si falla mostramos el texto (posible HTML de error)
            const contentType = res.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
                const txt = await res.text();
                console.error(`Respuesta no JSON en ${url}:`, txt.slice(0, 200));
                throw new Error('Respuesta no JSON');
            }

            return await res.json();
        } catch (err) {
            console.error('fetchJson fallo para', url, err);
            throw err;
        }
    }

    // Cargar categorías (con manejo de errores)
    async function cargarCategorias() {
        try {
            const data = await fetchJson('http://localhost:3000/categorias');
            // si select no existe, avisar y salir
            if (!selectCategorias) {
                console.warn('selectCategorias no encontrado en el DOM');
                return;
            }
            selectCategorias.innerHTML = '<option value="">Filtrar: categoría</option>';
            if (Array.isArray(data) && data.length) {
                data.forEach(c => {
                    const id = (c.id_categoria ?? c.id ?? c.id_categoria)?.toString() ?? '';
                    const nombre = c.nombre_categoria ?? c.nombre ?? c.nombre_categoria;
                    selectCategorias.insertAdjacentHTML('beforeend', `<option value="${id}">${nombre}</option>`);
                    if (id) categoryMap[id] = nombre;
                });
            } else {
                selectCategorias.insertAdjacentHTML('beforeend', `<option value="">No hay categorías</option>`);
            }
            // actualizar filtro si existe
            if (filtroCategoria) filtroCategoria.innerHTML = selectCategorias.innerHTML;
        } catch (err) {
            if (selectCategorias) selectCategorias.innerHTML = '<option value="">Error al cargar</option>';
        }
    }

    // Cargar proveedores
    async function cargarProveedores() {
        try {
            const data = await fetchJson('http://localhost:3000/proveedores');
            if (!selectProveedores) {
                console.warn('selectProveedores no encontrado en el DOM');
                return;
            }
            selectProveedores.innerHTML = '<option value="">Filtrar: proveedor</option>';
            if (Array.isArray(data) && data.length) {
                data.forEach(p => {
                    const id = (p.id_proveedor ?? p.id ?? p.id_proveedor)?.toString() ?? '';
                    const nombre = p.nombre_proveedor ?? p.nombre ?? p.nombre_proveedor;
                    selectProveedores.insertAdjacentHTML('beforeend', `<option value="${id}">${nombre}</option>`);
                    if (id) supplierMap[id] = nombre;
                });
            } else {
                selectProveedores.insertAdjacentHTML('beforeend', `<option value="">No hay proveedores</option>`);
            }
            if (filtroProveedor) filtroProveedor.innerHTML = selectProveedores.innerHTML;
        } catch (err) {
            if (selectProveedores) selectProveedores.innerHTML = '<option value="">Error al cargar</option>';
        }
    }

    // Cargar productos
    async function cargarProductos() {
        try {
            const data = await fetchJson('http://localhost:3000/productos');
            if (!Array.isArray(data)) {
                console.error('Respuesta de /productos no es array:', data);
                productos = [];
            } else {
                productos = data;
            }
            renderTabla(productos);
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No se pudo cargar productos</td></tr>`;
        }
    }

    // Render tabla
    function renderTabla(lista) {
        if (!tbody) {
            console.warn('tbody de la tabla no encontrado');
            return;
        }
        tbody.innerHTML = '';
        if (!Array.isArray(lista) || lista.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">Sin productos</td></tr>`;
            return;
        }
        lista.forEach(prod => {
            // resolver categoria/proveedor por nombre o por id usando mapas
            const nombre = prod.nombre_producto ?? prod.nombre ?? '';
            const id = prod.id_producto ?? prod.id ?? '';
            const catId = (prod.id_categoria ?? prod.idCategoria ?? prod.categoria_id ?? '')?.toString() ?? '';
            const provId = (prod.id_proveedor ?? prod.idProveedor ?? prod.proveedor_id ?? '')?.toString() ?? '';
            let nombreCat = prod.nombre_categoria ?? prod.categoria_nombre ?? '';
            if (!nombreCat && catId) nombreCat = categoryMap[catId] ?? '';
            let nombreProv = prod.nombre_proveedor ?? prod.proveedor_nombre ?? '';
            if (!nombreProv && provId) nombreProv = supplierMap[provId] ?? '';
            const stock = prod.stock_actual ?? prod.stock ?? 0;
            const fecha = prod.fecha_vencimiento ?? '-';
            const pv = prod.precio_venta ?? prod.precio ?? 0;
            const pcRaw = prod.precio_compra ?? prod.costo ?? null;
            const pc = (pcRaw === null || pcRaw === '' || typeof pcRaw === 'undefined') ? null : Number(pcRaw);
            const desc = prod.descripcion_producto ?? prod.descripcion ?? prod.descripcion ?? '';

            const pcDisplay = pc === null ? '-' : '$' + pc.toFixed(2);

            tbody.insertAdjacentHTML('beforeend', `
        <tr>
          <td>${nombre}</td>
          <td>${id}</td>
          <td>${nombreCat}</td>
          <td>${stock}</td>
          <td>${fecha}</td>
          <td>$${Number(pv || 0).toFixed(2)}</td>
          <td>${desc}</td>
          <td class="text-end">
            <button class="btn btn-sm" data-edit-id="${id}" title="Editar" aria-label="Editar" style="min-width:44px; padding:6px 8px; background:#e9f7ec; color:#0f5132; border:1px solid #c7ecc7;">
              <span style="font-size:14px; line-height:1">✏️</span>
            </button>
            <button class="btn btn-sm" data-id="${id}" title="Eliminar" aria-label="Eliminar" style="min-width:44px; padding:6px 8px; margin-left:6px; background:#ffecec; color:#842029; border:1px solid #f5c2c7;">
              <span style="font-size:14px; line-height:1">🗑️</span>
            </button>
          </td>
        </tr>
      `);
        });
    }

    // Delegated handler para editar/eliminar
    if (tbody) {
        tbody.addEventListener('click', async (ev) => {
            const btn = ev.target.closest('button[data-id], button[data-edit-id]');
            if (!btn) return;

            const editId = btn.getAttribute('data-edit-id');
            if (editId) {
                // editar: cargar selects primero
                try { await Promise.all([cargarCategorias(), cargarProveedores()]); } catch (e) { }
                const prod = productos.find(p => String(p.id_producto ?? p.id ?? '') === String(editId));
                if (!prod) return alert('No se encontró el producto para editar');
                try {
                    document.getElementById('p_name').value = prod.nombre_producto ?? prod.nombre ?? '';
                    document.getElementById('p_sku').value = prod.id_producto ?? prod.id ?? '';
                    document.getElementById('p_stock').value = prod.stock_actual ?? prod.stock ?? 0;
                    document.getElementById('p_exp').value = prod.fecha_vencimiento ?? '';
                    document.getElementById('p_pv').value = prod.precio_venta ?? prod.precio ?? 0;
                    document.getElementById('p_pc').value = prod.precio_compra ?? '';
                    document.getElementById('p_desc').value = prod.descripcion_producto ?? prod.descripcion ?? '';
                    const catSel = document.getElementById('p_category'); if (catSel) catSel.value = prod.id_categoria ?? prod.id_categoria ?? '';
                    const provSel = document.getElementById('p_supplier'); if (provSel) provSel.value = prod.id_proveedor ?? prod.id_proveedor ?? '';
                    // No permitir editar la descripción desde el modal en modo edición
                    try { document.getElementById('p_desc').disabled = true; } catch (e) { }
                } catch (e) { console.warn('Error prefilling modal', e); }
                // marcar modo edición y deshabilitar id/fecha
                const modal = document.getElementById('modalNuevo');
                try { modal.dataset.editId = String(editId); } catch (e) { }
                try { document.getElementById('p_sku').disabled = true; } catch (e) { }
                try { document.getElementById('p_exp').disabled = true; } catch (e) { }
                // No permitir cambiar el proveedor en modo edición
                try { document.getElementById('p_supplier').disabled = true; } catch (e) { }
                try { document.querySelector('#modalNuevo .modal-title').textContent = 'Editar Producto'; } catch (e) { }
                try { document.getElementById('btnGuardar').textContent = 'Guardar cambios'; } catch (e) { }
                try { bootstrap.Modal.getOrCreateInstance(modal).show(); } catch (e) { }
                return;
            }

            // eliminar
            const id = btn.getAttribute('data-id');
            if (!id) return;
            if (!confirm(`¿Eliminar producto con ID ${id}?`)) return;
            try {
                const res = await fetch(`http://localhost:3000/productos/${encodeURIComponent(id)}`, { method: 'DELETE' });
                if (!res.ok) {
                    const txt = await res.text().catch(() => '');
                    console.error('DELETE http://localhost:3000/productos falló', res.status, txt);
                    alert('Error al eliminar producto (ver consola).');
                    return;
                }
                const body = await res.json().catch(() => ({}));
                if (body.success) {
                    // recargar lista
                    cargarProductos();
                } else {
                    alert('No se pudo eliminar: ' + (body.error || JSON.stringify(body)));
                }
            } catch (err) {
                console.error('Error al eliminar producto:', err);
                alert('Error de conexión al eliminar producto (ver consola).');
            }
        });
    }

    // BUSCADOR: proteger si input no existe
    if (inputBusqueda) {
        inputBusqueda.addEventListener('input', e => {
            const filtro = e.target.value.toLowerCase();
            const filtrados = productos.filter(p => (p.nombre_producto ?? '').toString().toLowerCase().includes(filtro));
            renderTabla(filtrados);
        });
    } else {
        console.warn('Input de búsqueda no encontrado (id=busquedaNombre).');
    }

    // Filtrado por botón superior (usa input + selects)
    if (btnBuscarTop) {
        btnBuscarTop.addEventListener('click', () => {
            const q = (inputBusqueda?.value || '').toString().toLowerCase().trim();
            const cat = (filtroCategoria?.value || '').toString();
            const prov = (filtroProveedor?.value || '').toString();

            const filtered = productos.filter(p => {
                if (q) {
                    const name = (p.nombre_producto ?? p.nombre ?? '').toString().toLowerCase();
                    if (!name.includes(q)) return false;
                }
                if (cat) {
                    const pidCat = (p.id_categoria ?? p.idCategoria ?? p.categoria_id ?? '')?.toString() ?? '';
                    if (String(pidCat) !== cat) return false;
                }
                if (prov) {
                    const pidProv = (p.id_proveedor ?? p.idProveedor ?? p.proveedor_id ?? '')?.toString() ?? '';
                    if (String(pidProv) !== prov) return false;
                }
                return true;
            });

            renderTabla(filtered);
        });
    }

    // GUARDAR: proteger si btnGuardar no existe
    if (btnGuardar) {
        btnGuardar.addEventListener('click', async () => {
            // armar objeto con validaciones básicas
            const nombre = (document.querySelector('#p_name')?.value || '').trim();
            const idProducto = (document.querySelector('#p_sku')?.value || '').trim();
            const id_categoria = (document.querySelector('#p_category')?.value) || null;
            const id_proveedor = (document.querySelector('#p_supplier')?.value) || null;
            const stock_actual = parseInt(document.querySelector('#p_stock')?.value) || 0;
            const precio_venta = parseFloat(document.querySelector('#p_pv')?.value) || 0;
            const precio_compra = parseFloat(document.querySelector('#p_pc')?.value) || null;
            const fecha_vencimiento = document.querySelector('#p_exp')?.value || null;
            const descripcion_producto = (document.querySelector('#p_desc')?.value || '').trim();

            if (!nombre || !idProducto) {
                alert('Nombre y Código/ID son obligatorios.');
                return;
            }

            const payload = {
                nombre_producto: nombre,
                id_producto: idProducto,
                id_categoria,
                id_proveedor,
                stock_actual,
                precio_venta,
                precio_compra,
                fecha_vencimiento,
                descripcion_producto
            };

            // detectar si estamos en modo edición
            const modal = document.getElementById('modalNuevo');
            const editId = modal?.dataset?.editId ?? null;

            try {
                if (editId) {
                    // PATCH
                    // No enviar id_proveedor ni descripcion_producto desde el frontend en modo edición
                    try { delete payload.id_proveedor; } catch (e) { }
                    try { delete payload.descripcion_producto; } catch (e) { }

                    const res = await fetch(`http://localhost:3000/productos/${encodeURIComponent(editId)}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    if (!res.ok) {
                        const txt = await res.text().catch(() => '');
                        console.error('PATCH /productos falló', res.status, txt);
                        alert('Error al actualizar producto (ver consola).');
                        return;
                    }
                    const body = await res.json().catch(() => ({}));
                    if (body.success) {
                        alert('Producto actualizado correctamente');
                        try { bootstrap.Modal.getInstance(modal)?.hide(); } catch (e) { }
                        // limpiar modo edición
                        try { delete modal.dataset.editId; } catch (e) { }
                        // re-habilitar campos
                        try { document.getElementById('p_sku').disabled = false; } catch (e) { }
                        try { document.getElementById('p_exp').disabled = false; } catch (e) { }
                        try { document.getElementById('p_supplier').disabled = false; } catch (e) { }
                        try { document.getElementById('p_desc').disabled = false; } catch (e) { }
                        cargarProductos();
                    } else {
                        alert('Error al actualizar: ' + (body.error || 'Desconocido'));
                    }
                } else {
                    // POST nuevo
                    const res = await fetch('http://localhost:3000/productos', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    if (!res.ok) {
                        const txt = await res.text().catch(() => '');
                        console.error('POST /productos falló', res.status, txt);
                        alert('Error al guardar producto (ver consola).');
                        return;
                    }
                    const body = await res.json().catch(() => ({}));
                    if (body.success) {
                        alert('Producto agregado correctamente ✅');
                        document.querySelector('#productForm')?.reset();
                        try { bootstrap.Modal.getInstance(document.querySelector('#modalNuevo'))?.hide(); } catch (e) { }
                        cargarProductos();
                    } else {
                        alert('Error al guardar: ' + (body.error || 'Desconocido'));
                    }
                }
            } catch (err) {
                console.error('Error enviando producto:', err);
                alert('Error de conexión con el servidor (ver consola).');
            }
        });
    } else {
        console.warn('Botón Guardar no encontrado (id=btnGuardar).');
    }

    // Inicialización: cargar todo con manejo de errores
    (async () => {
        try {
            await Promise.all([cargarCategorias(), cargarProveedores(), cargarProductos()]);
            safeLog('Inicialización completa');
        } catch (err) {
            safeLog('Inicialización parcial con errores', err);
        }
    })();
    // --- Manejo de agregar proveedor / categoría desde modales ---
    const btnSaveProveedor = document.getElementById('btnSaveProveedor');
    const btnSaveCategoria = document.getElementById('btnSaveCategoria');

    if (btnSaveProveedor) {
        btnSaveProveedor.addEventListener('click', async () => {
            const nombre = (document.getElementById('prov_nombre')?.value || '').trim();
            const nit = (document.getElementById('prov_nit')?.value || '').trim();
            const telefono = (document.getElementById('prov_telefono')?.value || '').trim();
            const email = (document.getElementById('prov_email')?.value || '').trim();
            const direccion = (document.getElementById('prov_direccion')?.value || '').trim();
            const contacto = (document.getElementById('prov_contacto')?.value || '').trim();
            if (!nombre) return alert('El nombre del proveedor es obligatorio');
            try {
                const res = await fetch('/proveedores', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre_proveedor: nombre, nit_proveedor: nit, telefono_proveedor: telefono, email_proveedor: email, direccion_proveedor: direccion, contacto_proveedor: contacto })
                });
                if (!res.ok) {
                    const txt = await res.text().catch(() => '');
                    console.error('POST /proveedores falló', res.status, txt);
                    return alert('Error al guardar proveedor (ver consola)');
                }
                const body = await res.json().catch(() => ({}));
                if (body.success) {
                    alert('Proveedor agregado correctamente');
                    // recargar selects
                    await cargarProveedores();
                    try { bootstrap.Modal.getInstance(document.getElementById('modalProveedor'))?.hide(); } catch (e) { }
                } else {
                    alert('Error al guardar proveedor: ' + (body.error || JSON.stringify(body)));
                }
            } catch (err) {
                console.error('Error guardando proveedor:', err);
                alert('Error de conexión al guardar proveedor (ver consola)');
            }
        });
    }

    if (btnSaveCategoria) {
        btnSaveCategoria.addEventListener('click', async () => {
            const nombre = (document.getElementById('cat_nombre')?.value || '').trim();
            const descripcion = (document.getElementById('cat_desc')?.value || '').trim();
            if (!nombre) return alert('El nombre de la categoría es obligatorio');
            try {
                const res = await fetch('/categorias', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre_categoria: nombre, descripcion_categoria: descripcion })
                });
                if (!res.ok) {
                    const txt = await res.text().catch(() => '');
                    console.error('POST /categorias falló', res.status, txt);
                    return alert('Error al guardar categoría (ver consola)');
                }
                const body = await res.json().catch(() => ({}));
                if (body.success) {
                    alert('Categoría agregada correctamente');
                    await cargarCategorias();
                    try { bootstrap.Modal.getInstance(document.getElementById('modalCategoria'))?.hide(); } catch (e) { }
                } else {
                    alert('Error al guardar categoría: ' + (body.error || JSON.stringify(body)));
                }
            } catch (err) {
                console.error('Error guardando categoría:', err);
                alert('Error de conexión al guardar categoría (ver consola)');
            }
        });
    }
    // cuando se oculta el modal, limpiar modo edición y re-habilitar campos
    const modalNuevo = document.getElementById('modalNuevo');
    if (modalNuevo) {
        modalNuevo.addEventListener('hidden.bs.modal', () => {
            try { delete modalNuevo.dataset.editId; } catch (e) { }
            try { document.getElementById('p_sku').disabled = false; } catch (e) { }
            try { document.getElementById('p_exp').disabled = false; } catch (e) { }
            try { document.getElementById('p_supplier').disabled = false; } catch (e) { }
            try { document.getElementById('p_desc').disabled = false; } catch (e) { }
            try { document.querySelector('#modalNuevo .modal-title').textContent = 'Añadir Producto'; } catch (e) { }
            try { document.getElementById('btnGuardar').textContent = 'Guardar'; } catch (e) { }
        });
    }
});