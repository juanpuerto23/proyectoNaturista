// Script para manejar inventario: cargar, buscar, filtrar, agregar, editar, eliminar
document.addEventListener('DOMContentLoaded', () => {
    // helpers
    const $ = id => document.getElementById(id);
    const safeLog = (...args) => console.log('[Inventario]', ...args);

    // elementos
    const tbody = document.querySelector('#tabla-productos tbody');
    const inputBusqueda = $('busquedaNombre');
    const inputCodigo = $('busquedaCodigo');
    const btnGuardar = $('btnGuardar');
    const selectCategorias = $('p_category');
    const selectProveedores = $('p_supplier');
    const filtroCategoria = $('filtroCategoria');
    const filtroProveedor = $('filtroProveedor');
    const btnBuscarTop = document.getElementById('btnBuscarTop');

    const categoryMap = Object.create(null);
    const supplierMap = Object.create(null);
    let suppliersList = [];

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
            const data = await fetchJson('/categorias');
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
            const data = await fetchJson('/proveedores');
            if (!selectProveedores) {
                console.warn('selectProveedores no encontrado en el DOM');
                return;
            }
            selectProveedores.innerHTML = '<option value="">Filtrar: proveedor</option>';
            suppliersList = Array.isArray(data) ? data : [];
            if (Array.isArray(suppliersList) && suppliersList.length) {
                suppliersList.forEach(p => {
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

    // -- Lot reception: provider autocomplete & inline create (MVP) --
    function populateProvidersDatalist() {
        try {
            const dl = document.getElementById('providersList');
            if (!dl) return;
            dl.innerHTML = '';
            suppliersList.forEach(p => {
                const name = p.nombre_proveedor ?? p.nombre ?? '';
                const opt = document.createElement('option');
                opt.value = name;
                dl.appendChild(opt);
            });
        } catch (e) { console.warn('populateProvidersDatalist error', e); }
    }

    function findSupplierByName(name) {
        if (!name) return null;
        const n = name.toString().trim().toLowerCase();
        return suppliersList.find(p => (p.nombre_proveedor ?? p.nombre ?? '').toString().toLowerCase() === n) || null;
    }

    // Handlers for modalReceiveLot
    function initReceiveLotModal() {
        const search = document.getElementById('lot_provider_search');
        const hid = document.getElementById('lot_provider_id');
        const info = document.getElementById('lot_provider_info');
        const createBtn = document.getElementById('lot_create_provider_btn');
        const newForm = document.getElementById('lot_new_provider_form');
        const cancelNew = document.getElementById('lot_cancel_create_provider');
        const saveNew = document.getElementById('lot_save_provider');
        const addRow = document.getElementById('lot_add_row');
        const lotCatSelects = () => Array.from(document.querySelectorAll('.lot-cat'));

        if (!search) return;

        // fill datalist initially
        populateProvidersDatalist();

        search.addEventListener('input', (e) => {
            const val = e.target.value || '';
            const found = findSupplierByName(val);
            if (found) {
                hid.value = String(found.id_proveedor ?? found.id ?? '');
                info.textContent = `Seleccionado: ${found.nombre_proveedor ?? found.nombre} — ${found.telefono_proveedor ?? found.telefono ?? ''}`;
                newForm.style.display = 'none';
            } else {
                hid.value = '';
                info.textContent = 'Proveedor no encontrado. Presiona "Crear proveedor" para agregar.';
            }
        });

        createBtn.addEventListener('click', () => {
            newForm.style.display = newForm.style.display === 'none' ? 'block' : 'none';
        });

        cancelNew.addEventListener('click', () => {
            newForm.style.display = 'none';
        });

        saveNew.addEventListener('click', async () => {
            const nombre = (document.getElementById('lot_prov_nombre')?.value || '').trim();
            const nit = (document.getElementById('lot_prov_nit')?.value || '').trim();
            const telefono = (document.getElementById('lot_prov_telefono')?.value || '').trim();
            const email = (document.getElementById('lot_prov_email')?.value || '').trim();
            const direccion = (document.getElementById('lot_prov_direccion')?.value || '').trim();
            const contacto = (document.getElementById('lot_prov_contacto')?.value || '').trim();
            if (!nombre) return alert('El nombre del proveedor es obligatorio');
            try {
                const res = await fetch('/proveedores', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre_proveedor: nombre, nit_proveedor: nit, telefono_proveedor: telefono, email_proveedor: email, direccion_proveedor: direccion, contacto_proveedor: contacto })
                });
                if (!res.ok) {
                    const txt = await res.text().catch(() => '');
                    console.error('POST /proveedores falló', res.status, txt);
                    return alert('Error al guardar proveedor (ver consola)');
                }
                const body = await res.json().catch(() => ({}));
                if (body.success && body.id) {
                    // reload suppliers list
                    await cargarProveedores();
                    populateProvidersDatalist();
                    // set selected
                    const createdId = body.id ?? body.insertId ?? body.id_proveedor ?? null;
                    document.getElementById('lot_provider_id').value = String(createdId);
                    document.getElementById('lot_provider_search').value = nombre;
                    document.getElementById('lot_provider_info').textContent = `Proveedor creado: ${nombre}`;
                    newForm.style.display = 'none';
                } else {
                    alert('Error al crear proveedor: ' + (body.error || JSON.stringify(body)));
                }
            } catch (err) {
                console.error('Error guardando proveedor inline:', err);
                alert('Error de conexión al guardar proveedor');
            }
        });

        // add row handler (simple append)
        if (addRow) addRow.addEventListener('click', () => {
            const tbodyLot = document.getElementById('lotLinesTbody');
            if (!tbodyLot) return;
            const tr = document.createElement('tr');
                        tr.innerHTML = `
                            <td><input class="form-control form-control-sm lot-sku"></td>
                            <td><input class="form-control form-control-sm lot-name"></td>
                            <td><input type="number" class="form-control form-control-sm lot-qty" min="0"></td>
                            <td><input type="date" class="form-control form-control-sm lot-exp"></td>
                            <td><select class="form-select form-select-sm lot-cat"><option value="">Categoría</option></select></td> 
                        `;
            tbodyLot.appendChild(tr);
            // populate category selects
            const catSelect = tr.querySelector('.lot-cat');
            if (catSelect) {
                catSelect.innerHTML = '<option value="">Categoría</option>' + Object.entries(categoryMap).map(([id, name]) => `<option value="${id}">${name}</option>`).join('');
            }
            // update remove-last button state
            try { updateRemoveLastButtonState(); } catch (e) {}
        });

        

        // open handler: populate categories select in existing row(s)
        const modalEl = document.getElementById('modalReceiveLot');
        if (modalEl) {
            modalEl.addEventListener('show.bs.modal', () => {
                populateProvidersDatalist();
                // fill categories in existing lot-cat selects
                document.querySelectorAll('.lot-cat').forEach(sel => {
                    if (sel.options.length <= 1) sel.innerHTML = '<option value="">Categoría</option>' + Object.entries(categoryMap).map(([id, name]) => `<option value="${id}">${name}</option>`).join('');
                });
                try { updateRemoveLastButtonState(); } catch (e) {}
            });

            // delegated click handler inside modal to catch 'Crear producto' buttons
            modalEl.addEventListener('click', (ev) => {
                const btn = ev.target.closest('.lot-create-link');
                if (!btn) return;
                const sku = btn.getAttribute('data-sku') || '';
                try {
                    const modal = document.getElementById('modalNuevo');
                    // hide receive-lot modal first
                    try { bootstrap.Modal.getInstance(modalEl)?.hide(); } catch (e) { }
                    try { document.getElementById('p_sku').value = sku; } catch (e) { }
                    try { document.getElementById('p_name').focus(); } catch (e) { }
                    try { bootstrap.Modal.getOrCreateInstance(modal).show(); } catch (e) { }
                } catch (e) { console.warn('open create product failed', e); }
            });
        }

        // bind footer buttons: clear rows, revert last
        const btnClear = document.getElementById('lot_clear_rows');
        const btnRevert = document.getElementById('lot_revert_last');
        if (btnClear) btnClear.addEventListener('click', () => { if (confirm('Limpiar todas las filas del lote?')) clearLotRows(); });
        if (btnRevert) btnRevert.addEventListener('click', () => { revertLastLote(); });

        // preview send button
        const sendBtn = document.getElementById('lotSendBtn');
        if (sendBtn) sendBtn.addEventListener('click', async () => {
            try {
                const payload = buildLotePayloadFromModal();
                sendBtn.disabled = true; sendBtn.textContent = 'Enviando...';
                const resp = await sendLotePayload(payload);
                sendBtn.disabled = false; sendBtn.textContent = 'Enviar lote';
                if (resp && (resp.success || resp.id_lote)) {
                    const loteId = resp.id_lote || resp.id || (resp.row && resp.row.id_lote) || null;
                    if (loteId) localStorage.setItem('lastLoteId', String(loteId));
                    alert('Lote creado correctamente: ' + JSON.stringify(resp));
                    try { bootstrap.Modal.getInstance(document.getElementById('modalLotPreview'))?.hide(); } catch (e) {}
                    try { bootstrap.Modal.getInstance(document.getElementById('modalReceiveLot'))?.hide(); } catch (e) {}
                    await cargarProductos();
                } else {
                    alert('Respuesta inesperada del servidor: ' + JSON.stringify(resp));
                }
            } catch (err) {
                console.error('Error enviando lote:', err);
                alert('Error enviando lote: ' + (err.message || err));
            } finally {
                sendBtn.disabled = false; sendBtn.textContent = 'Enviar lote';
            }
        });
        // delegated remove-row handler
        const tbodyLot = document.getElementById('lotLinesTbody');
        if (tbodyLot) {
            tbodyLot.addEventListener('click', (ev) => {
                const btn = ev.target.closest('.lot-remove-row');
                if (!btn) return;
                const tr = btn.closest('tr');
                if (!tr) return;
                if (!confirm('Eliminar esta fila del lote?')) return;
                // remove any inline hint associated to this row
                try { const h = tr.querySelector('.lot-hint'); if (h) h.remove(); } catch (e) {}
                tr.remove();
                try { updateRemoveLastButtonState(); } catch (e) {}
            });
        }
    }

    // enable/disable remove-last button depending on number of rows
    function updateRemoveLastButtonState() {
        const btn = document.getElementById('lot_remove_last');
        const tbodyLot = document.getElementById('lotLinesTbody');
        if (!btn || !tbodyLot) return;
        const rows = Array.from(tbodyLot.querySelectorAll('tr'));
        if (rows.length <= 1) {
            btn.disabled = true;
        } else {
            btn.disabled = false;
        }
    }

    // handler to remove last row
    function initRemoveLastHandler() {
        const btn = document.getElementById('lot_remove_last');
        if (!btn) return;
        btn.addEventListener('click', () => {
            const tbodyLot = document.getElementById('lotLinesTbody');
            if (!tbodyLot) return;
            const rows = Array.from(tbodyLot.querySelectorAll('tr'));
            if (rows.length <= 1) return; // safety
            const last = rows[rows.length - 1];
            if (!last) return;
            // eliminar la última fila directamente (sin confirmación)
            last.remove();
            try { updateRemoveLastButtonState(); } catch (e) {}
        });
    }

    // utility: build lote payload and preview text
    function buildLotePayloadFromModal() {
        const providerId = (document.getElementById('lot_provider_id')?.value || '').toString();
        const providerName = (document.getElementById('lot_provider_search')?.value || '').toString().trim();
        const providerNew = providerId ? null : { nombre_proveedor: providerName };
        const rows = Array.from(document.querySelectorAll('#lotLinesTbody tr'));
        const items = [];
        for (const r of rows) {
            const sku = (r.querySelector('.lot-sku')?.value || '').toString().trim();
            const qty = parseInt(r.querySelector('.lot-qty')?.value || '0', 10) || 0;
            if (!sku && qty === 0) continue;
            const prodId = r.getAttribute('data-product-id') || null;
            const nombre = (r.querySelector('.lot-name')?.value || '').toString().trim();
            const fecha_venc = (r.querySelector('.lot-exp')?.value || '') || null;
            const id_categoria = (r.querySelector('.lot-cat')?.value || '') || null;
            items.push({ sku, producto_id: prodId, nombre, id_categoria, cantidad: qty, fecha_vencimiento: fecha_venc });
        }
        return { proveedor_id: providerId || null, proveedor_nuevo: providerNew, items };
    }

    // send lote to server (used by preview send button)
    async function sendLotePayload(payload) {
        const resp = await fetch('/lotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!resp.ok) {
            const txt = await resp.text().catch(() => '');
            throw new Error(`HTTP ${resp.status} ${txt}`);
        }
        return await resp.json();
    }

    // clear lot rows helper
    function clearLotRows() {
        const tbodyLot = document.getElementById('lotLinesTbody');
        if (!tbodyLot) return;
        tbodyLot.innerHTML = '';
        // add one empty row
        const tr = document.createElement('tr');
        tr.innerHTML = `
                    <td><input class="form-control form-control-sm lot-sku"></td>
                    <td><input class="form-control form-control-sm lot-name"></td>
                    <td><input type="number" class="form-control form-control-sm lot-qty" min="0"></td>
                    <td><input type="date" class="form-control form-control-sm lot-exp"></td>
                    <td><select class="form-select form-select-sm lot-cat"><option value="">Categoría</option></select></td>
        `;
        tbodyLot.appendChild(tr);
        document.querySelectorAll('.lot-cat').forEach(sel => { if (sel.options.length <= 1) sel.innerHTML = '<option value="">Categoría</option>' + Object.entries(categoryMap).map(([id, name]) => `<option value="${id}">${name}</option>`).join(''); });
        try { updateRemoveLastButtonState(); } catch (e) {}
    }

    // revert last lote helper (calls server)
    async function revertLastLote() {
        const last = localStorage.getItem('lastLoteId');
        if (!last) return alert('No hay lote reciente para revertir');
        if (!confirm(`Revertir el lote ${last}? Esto intentará deshacer cambios (irreversible).`)) return;
        try {
            const res = await fetch(`/lotes/${encodeURIComponent(last)}/revert`, { method: 'POST' });
            if (!res.ok) {
                const txt = await res.text().catch(() => '');
                throw new Error(`HTTP ${res.status} ${txt}`);
            }
            const body = await res.json();
            alert('Revertido: ' + JSON.stringify(body));
            await cargarProductos();
            localStorage.removeItem('lastLoteId');
        } catch (err) {
            console.error('Error revertiendo lote:', err);
            alert('Error revertiendo lote: ' + (err.message || err));
        }
    }

    // SKU lookup within modal rows (debounced)
    function initLotSkuHandlers() {
        const tbodyLot = document.getElementById('lotLinesTbody');
        if (!tbodyLot) return;

        const debounce = (fn, wait) => {
            let t = null;
            return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
        };

        async function lookupSkuInRow(input) {
            const tr = input.closest('tr');
            if (!tr) return;
            const sku = (input.value || '').toString().trim();
            const nameInput = tr.querySelector('.lot-name');
            const catSelect = tr.querySelector('.lot-cat');
            const qtyInput = tr.querySelector('.lot-qty');
            const expInput = tr.querySelector('.lot-exp');

            if (!sku) {
                tr.removeAttribute('data-product-id');
                tr.removeAttribute('data-missing');
                if (nameInput) nameInput.value = '';
                const hint = tr.querySelector('.lot-hint'); if (hint) hint.remove();
                // do not show global error here; only when user clicks preview
                return;
            }

            // Match only when the entered value equals the product's id (exact match)
            let prod = productos.find(p => String(p.id_producto ?? p.id ?? '') === sku);
            if (!prod) {
                // try server-side query but accept result only if its id matches exactly
                try {
                    const resp = await fetch(`/productos?sku=${encodeURIComponent(sku)}`);
                    if (resp.ok) {
                        const j = await resp.json().catch(() => null);
                        let candidate = null;
                        if (j) {
                            if (Array.isArray(j) && j.length) candidate = j[0];
                            else candidate = j;
                        }
                        if (candidate && String(candidate.id_producto ?? candidate.id ?? '') === sku) prod = candidate;
                    }
                } catch (e) { /* ignore */ }
            }

            if (prod) {
                tr.setAttribute('data-product-id', String(prod.id_producto ?? prod.id ?? ''));
                tr.removeAttribute('data-missing');
                if (nameInput) nameInput.value = prod.nombre_producto ?? prod.nombre ?? '';
                if (catSelect) catSelect.value = String(prod.id_categoria ?? prod.id_categoria ?? prod.categoria_id ?? '');
                // show current stock as small hint (inline)
                let hint = tr.querySelector('.lot-hint');
                if (!hint) { hint = document.createElement('div'); hint.className = 'lot-hint small text-muted mt-1'; tr.querySelector('td')?.appendChild(hint); }
                hint.className = 'lot-hint small text-muted mt-1';
                hint.textContent = `Stock actual: ${prod.stock_actual ?? prod.stock ?? 0}`;
                // lock fields that should not change for existing products
                if (nameInput) nameInput.disabled = true;
                if (catSelect) catSelect.disabled = true;
                // do not show global error here; only when user clicks preview
            } else {
                tr.removeAttribute('data-product-id');
                tr.setAttribute('data-missing', '1');
                if (nameInput) { nameInput.value = ''; nameInput.disabled = false; }
                if (catSelect) catSelect.disabled = false;
                const hint = tr.querySelector('.lot-hint');
                if (!hint) { const h = document.createElement('div'); h.className = 'lot-hint small text-danger mt-1'; tr.querySelector('td')?.appendChild(h); }
                const hint2 = tr.querySelector('.lot-hint');
                // show inline red message and a create button
                hint2.className = 'lot-hint small text-danger mt-1';
                hint2.innerHTML = `No existe este producto en la base de datos. <button type="button" class="btn btn-sm btn-outline-primary ms-2 lot-create-link" data-sku="${sku}">Crear producto</button>`;
                // do not show form-level error here; it will be shown on preview click if needed
            }
        }

        tbodyLot.addEventListener('input', debounce((ev) => {
            const input = ev.target;
            if (!input) return;
            if (input.classList.contains('lot-sku')) lookupSkuInRow(input);
        }, 300));
    }

    // (missing-product row helpers removed — using inline hint element instead)

    // Confirm reception: validate rows, preview and attempt to save
    async function initLotConfirmHandler() {
        const btn = document.getElementById('lot_confirm_btn');
        if (!btn) return;

        // show preview modal and wait for user to click Send
        btn.addEventListener('click', async () => {
            try {
                // if any row is marked missing, block and show error
                const missingRows = Array.from(document.querySelectorAll('#lotLinesTbody tr[data-missing="1"]'));
                const formErr = document.getElementById('lot_form_error');
                if (missingRows.length > 0) {
                    if (formErr) { formErr.textContent = 'Hay filas con SKUs no encontrados. Crea los productos o elimínalas antes de continuar.'; formErr.classList.remove('d-none'); }
                    missingRows[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                    return;
                }

                const payload = buildLotePayloadFromModal();
                if (!payload.items || payload.items.length === 0) return alert('No hay líneas para procesar');
                if (!payload.proveedor_id && (!payload.proveedor_nuevo || !payload.proveedor_nuevo.nombre_proveedor)) return alert('Selecciona o crea un proveedor');
                // build preview text
                const preview = [];
                preview.push(payload.proveedor_id ? `Proveedor ID: ${payload.proveedor_id}` : `Crear proveedor: ${payload.proveedor_nuevo.nombre_proveedor}`);
                for (const it of payload.items) {
                    if (it.producto_id) preview.push(`Actualizar producto ${it.producto_id}: +${it.cantidad}`);
                    else preview.push(`Crear producto ${it.sku || ''} (${it.nombre}) con ${it.cantidad}`);
                }
                if (formErr) formErr.classList.add('d-none');
                document.getElementById('lotPreviewContent').textContent = preview.join('\n');
                const modal = new bootstrap.Modal(document.getElementById('modalLotPreview'));
                modal.show();
            } catch (err) {
                console.error('Error preparando preview:', err);
                alert('Error preparando vista previa: ' + (err.message || err));
            }
        });
    }

    // Cargar productos
    async function cargarProductos() {
        try {
            const data = await fetchJson('/productos');
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
                const res = await fetch(`/productos/${encodeURIComponent(id)}`, { method: 'DELETE' });
                if (!res.ok) {
                    const txt = await res.text().catch(() => '');
                    console.error('DELETE /productos falló', res.status, txt);
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

    // búsqueda por código/ID en tiempo real (opcional)
    if (inputCodigo) {
        inputCodigo.addEventListener('input', e => {
            const code = (e.target.value || '').toString().toLowerCase().trim();
            if (!code) return renderTabla(productos);
            const filtrados = productos.filter(p => {
                const fields = [p.id_producto, p.id, p.codigo_barras, p.codigo, p.sku].map(x => (x||'').toString().toLowerCase()).join(' ');
                return fields.includes(code);
            });
            renderTabla(filtrados);
        });
    }

    // Filtrado por botón superior (usa input + selects)
    if (btnBuscarTop) {
        btnBuscarTop.addEventListener('click', () => {
            const q = (inputBusqueda?.value || '').toString().toLowerCase().trim();
            const code = (inputCodigo?.value || '').toString().toLowerCase().trim();
            const cat = (filtroCategoria?.value || '').toString();
            const prov = (filtroProveedor?.value || '').toString();

            const filtered = productos.filter(p => {
                if (q) {
                    const name = (p.nombre_producto ?? p.nombre ?? '').toString().toLowerCase();
                    if (!name.includes(q)) return false;
                }
                if (code) {
                    const fields = [p.id_producto, p.id, p.codigo_barras, p.codigo, p.sku].map(x => (x||'').toString().toLowerCase()).join(' ');
                    if (!fields.includes(code)) return false;
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
                    // Validar que el código/ID no exista ya en productos
                    const exists = productos.find(p => String(p.id_producto ?? p.id ?? p.codigo_barras ?? p.codigo ?? p.sku ?? '') === String(idProducto));
                    if (exists) {
                        return alert('Ya existe un producto con ese código/ID. Por favor usa otro código o edita el producto existente.');
                    }
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
            // init receive lot modal handlers
            try { initReceiveLotModal(); } catch (e) { console.warn('initReceiveLotModal failed', e); }
            try { initLotSkuHandlers(); } catch (e) { console.warn('initLotSkuHandlers failed', e); }
            try { initLotConfirmHandler(); } catch (e) { console.warn('initLotConfirmHandler failed', e); }
            try { initRemoveLastHandler(); } catch (e) { console.warn('initRemoveLastHandler failed', e); }
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