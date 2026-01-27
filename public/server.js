import express from 'express';
import sql from './db.js';
import dotenv from 'dotenv';
import cors from 'cors';
import supabase from './supabaseClient.js';
import crypto from 'crypto';
import bcrypt from 'bcrypt';

dotenv.config();

const app = express();
const port = 3000;

// Helper: verifica contraseñas (bcrypt $2b$... o formato Django pbkdf2_sha256) o comparación directa legacy
export function verifyPasswordHash(storedPassword, providedPassword) {
  if (!storedPassword) return false;
  // bcrypt-style: $2b$... (bcrypt)
  if (storedPassword.startsWith('$2a$') || storedPassword.startsWith('$2b$') || storedPassword.startsWith('$2y$')) {
    try {
      return bcrypt.compareSync(providedPassword, storedPassword);
    } catch (e) {
      console.error('Error verificando bcrypt hash:', e);
      return false;
    }
  }
  // Django-style: pbkdf2_sha256$<iterations>$<salt>$<hash_b64>
  if (storedPassword.startsWith('pbkdf2_sha256$')) {
    const parts = storedPassword.split('$');
    if (parts.length !== 4) return false;
    const iterations = parseInt(parts[1], 10);
    const salt = parts[2];
    const hashB64 = parts[3];
    try {
      const derived = crypto.pbkdf2Sync(providedPassword, salt, iterations, 32, 'sha256');
      const hashBuf = Buffer.from(hashB64, 'base64');
      if (hashBuf.length !== derived.length) return false;
      return crypto.timingSafeEqual(derived, hashBuf);
    } catch (e) {
      console.error('Error verificando pbkdf2 hash:', e);
      return false;
    }
  }
  // Fallback: comparación directa (legacy)
  return storedPassword === providedPassword;
}

app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Sirve tu inventario.html

// Obtener todos los productos (solo activos por defecto, ?inactivos=1 para incluirlos)
app.get('/productos', async (req, res) => {
  try {
    const includeInactive = req.query.inactivos === '1';
    if (supabase) {
      let builder = supabase.from('productos').select('*');
      if (!includeInactive) builder = builder.eq('activo', true);
      const { data, error } = await builder;
      if (error) throw error;
      return res.json(data);
    }
    const productos = includeInactive
      ? await sql`SELECT * FROM productos`
      : await sql`SELECT * FROM productos WHERE activo = true`;
    res.json(productos);
  } catch (err) {
    console.error('Error al obtener productos:', err);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// -----------------------------
// CREAR VENTA (facturación)
// Body: { id_cliente, id_empleado (optional), subtotal, descuento_porcentaje, descuento_valor, iva_porcentaje, iva_valor, total_pagar, observaciones, detalles: [{ id_producto, cantidad, precio_unitario, descuento_detalle, subtotal_detalle }] }
app.post('/ventas', async (req, res) => {
  const body = req.body || {};
  const detalles = Array.isArray(body.detalles) ? body.detalles : [];
  if (!body.id_cliente || !Array.isArray(detalles) || detalles.length === 0) {
    return res.status(400).json({ error: 'id_cliente y detalles son requeridos' });
  }

  try {
    // 1) Validar stock para todos los productos
    for (const d of detalles) {
      const pid = d.id_producto;
      const qty = Number(d.cantidad || 0);
      if (!pid || qty <= 0) return res.status(400).json({ error: 'Detalle con id_producto y cantidad válida requeridos' });
      if (supabase) {
        const { data: prod, error } = await supabase.from('productos').select('id_producto,stock_actual,nombre_producto').eq('id_producto', pid).limit(1).single();
        if (error || !prod) return res.status(400).json({ error: 'Producto no encontrado', id_producto: pid });
        if ((prod.stock_actual || 0) < qty) return res.status(409).json({ error: 'stock_insuficiente', id_producto: pid, disponible: prod.stock_actual });
      } else {
        const rows = await sql`SELECT stock_actual FROM productos WHERE id_producto = ${pid}`;
        const prod = Array.isArray(rows) && rows.length ? rows[0] : null;
        if (!prod) return res.status(400).json({ error: 'Producto no encontrado', id_producto: pid });
        if ((prod.stock_actual || 0) < qty) return res.status(409).json({ error: 'stock_insuficiente', id_producto: pid, disponible: prod.stock_actual });
      }
    }

    // 2) Insertar venta y detalles, luego decrementar stock
    if (supabase) {
      // Nuevo enfoque: dejar que el trigger en la base genere numero_factura.
      // Sólo enviar numero_factura si el cliente lo provee explícitamente (body.numero_factura definido).
      const MAX_RETRIES = 5;
      let ventaRow = null;
      let attempt = 0;
      let lastError = null;
      while (attempt < MAX_RETRIES) {
        attempt += 1;
        const ventaObj = {
          id_cliente: body.id_cliente,
          id_empleado: body.id_empleado || null,
          id_metodo_pago: typeof body.id_metodo_pago !== 'undefined' ? body.id_metodo_pago : 1,
          subtotal: body.subtotal || 0,
          descuento_porcentaje: body.descuento_porcentaje || 0,
          descuento_valor: body.descuento_valor || 0,
          iva_porcentaje: body.iva_porcentaje || 0,
          iva_valor: body.iva_valor || 0,
          total_pagar: body.total_pagar || 0,
          observaciones: body.observaciones || null
        };
        if (typeof body.numero_factura !== 'undefined' && body.numero_factura !== null && body.numero_factura !== '') {
          ventaObj.numero_factura = body.numero_factura; // usar valor explícito proporcionado
        }

        const { data: vdata, error: verr } = await supabase.from('ventas').insert([ventaObj]).select();
        if (!verr && vdata && vdata[0]) {
          ventaRow = vdata[0];
          break;
        }
        lastError = verr || new Error('Unknown insert error');
        const msg = String((verr && (verr.message || verr.details || verr.code)) || '').toLowerCase();
        // Reintentar sólo si conflicto duplicado sobre numero_factura
        if (msg.includes('duplicate') || (verr && verr.code === '23505') || msg.includes('numero_factura')) {
          // limpiar numero_factura para permitir que el trigger genere uno distinto en siguiente intento
          body.numero_factura = undefined;
          continue;
        }
        // otro error: salir del loop
        break;
      }
      if (!ventaRow) {
        const isDup = lastError && (String(lastError.message || '').toLowerCase().includes('duplicate') || (lastError && lastError.code === '23505'));
        if (isDup) return res.status(409).json({ error: 'duplicate_numero_factura', detail: String(lastError.message || lastError) });
        throw lastError || new Error('Error inserting venta via Supabase');
      }

      // insertar detalles y decrementar stock uno a uno
      for (const d of detalles) {
        const detObj = { id_venta: ventaRow.id_venta, id_producto: d.id_producto, cantidad: d.cantidad, precio_unitario: d.precio_unitario, subtotal_detalle: d.subtotal_detalle, descuento_detalle: d.descuento_detalle };
        const { error: detErr } = await supabase.from('detalle_ventas').insert([detObj]);
        if (detErr) throw detErr;
        // decrementar stock
        const { data: prodData, error: updErr } = await supabase.from('productos').select('stock_actual').eq('id_producto', d.id_producto).limit(1).single();
        if (updErr) throw updErr;
        const newStock = (prodData.stock_actual || 0) - Number(d.cantidad || 0);
        const { error: uerr } = await supabase.from('productos').update({ stock_actual: newStock }).eq('id_producto', d.id_producto);
        if (uerr) throw uerr;
      }

      return res.json({ success: true, venta: ventaRow });
    }

    // SQL fallback: pre-check already done; insert venta
    // Intentar insertar venta en SQL con reintentos si numero_factura ya existe (race condition)
    let idVenta = null;
    let returnedNumeroFactura = null;
    let lastSqlErr = null;
    const MAX_SQL_RETRIES = 5;
    for (let attemptSql = 0; attemptSql < MAX_SQL_RETRIES; attemptSql++) {
      try {
        // calcular numero_factura actual
        const nextNumRows = await sql`SELECT COALESCE(MAX(numero_factura),0) + 1 AS next_num FROM ventas`;
        const nextNumero = Array.isArray(nextNumRows) && nextNumRows.length ? nextNumRows[0].next_num : 1;

        const insertVenta = await sql`
          INSERT INTO ventas (id_cliente, id_empleado, id_metodo_pago, numero_factura, subtotal, descuento_porcentaje, descuento_valor, iva_porcentaje, iva_valor, total_pagar, observaciones, fecha_venta)
          VALUES (
            ${body.id_cliente},
            ${body.id_empleado || null},
            ${typeof body.id_metodo_pago !== 'undefined' ? body.id_metodo_pago : 1},
            ${nextNumero},
            ${body.subtotal || 0}, ${body.descuento_porcentaje || 0}, ${body.descuento_valor || 0}, ${body.iva_porcentaje || 0}, ${body.iva_valor || 0}, ${body.total_pagar || 0}, ${body.observaciones || null}, now()
          )
          RETURNING id_venta, numero_factura
        `;
        idVenta = Array.isArray(insertVenta) && insertVenta.length ? insertVenta[0].id_venta : null;
        returnedNumeroFactura = Array.isArray(insertVenta) && insertVenta.length ? insertVenta[0].numero_factura : null;
        if (!idVenta) throw new Error('No se pudo crear venta');
        // éxito
        break;
      } catch (sqlErr) {
        lastSqlErr = sqlErr;
        const msg = String(sqlErr?.message || '').toLowerCase();
        if (msg.includes('duplicate') || String(sqlErr?.detail || '').toLowerCase().includes('numero_factura') || (sqlErr && sqlErr.code === '23505')) {
          // intentar nuevamente (otra iteración recalculará next numero)
          continue;
        }
        // otro error: no reintentar
        break;
      }
    }
    if (!idVenta) {
      const isDup = lastSqlErr && (String(lastSqlErr.message || '').toLowerCase().includes('duplicate') || (lastSqlErr && lastSqlErr.code === '23505'));
      if (isDup) return res.status(409).json({ error: 'duplicate_numero_factura', detail: String(lastSqlErr.message || lastSqlErr) });
      throw lastSqlErr || new Error('Error inserting venta (sql)');
    }

    // insertar detalles
    for (const d of detalles) {
      await sql`
        INSERT INTO detalle_ventas (id_venta, id_producto, cantidad, precio_unitario, subtotal_detalle, descuento_detalle, fecha_creacion)
        VALUES (${idVenta}, ${d.id_producto}, ${d.cantidad}, ${d.precio_unitario}, ${d.subtotal_detalle}, ${d.descuento_detalle || 0}, now())
      `;
      // decrementar stock
      await sql`UPDATE productos SET stock_actual = stock_actual - ${d.cantidad} WHERE id_producto = ${d.id_producto}`;
    }

    return res.json({ success: true, venta_id: idVenta, numero_factura: returnedNumeroFactura });
  } catch (err) {
    console.error('Error al crear venta:', err?.message ?? err);
    res.status(500).json({ error: 'Error al crear venta', detail: err?.message ?? String(err) });
  }
});

// Rutas compatibles con el frontend antiguo (/categorias y /proveedores)
app.get('/categorias', async (req, res) => {
  try {
    // intentar obtener desde Supabase si está configurado
    if (supabase) {
      const { data, error } = await supabase.from('categorias').select('*');
      if (error) throw error;
      return res.json(data);
    }
    // fallback: intentar desde la DB local (si existe tabla categorias)
    const cats = await sql`SELECT * FROM categorias`;
    res.json(cats);
  } catch (err) {
    console.error('Error al obtener categorias:', err);
    res.status(500).json({ error: 'Error al obtener categorias' });
  }
});

app.get('/proveedores', async (req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase.from('proveedores').select('*');
      if (error) throw error;
      return res.json(data);
    }
    const prov = await sql`SELECT * FROM proveedores`;
    res.json(prov);
  } catch (err) {
    console.error('Error al obtener proveedores:', err);
    res.status(500).json({ error: 'Error al obtener proveedores' });
  }
});

// Lista métodos de pago
app.get('/metodos_pago', async (req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase.from('metodos_pago').select('*').order('id_metodo_pago', { ascending: true });
      if (error) throw error;
      return res.json(data);
    }
    const rows = await sql`SELECT * FROM metodos_pago ORDER BY id_metodo_pago`;
    res.json(rows);
  } catch (err) {
    console.error('Error al obtener métodos de pago:', err?.message ?? err);
    res.status(500).json({ error: 'Error al obtener métodos de pago', detail: err?.message ?? String(err) });
  }
});

// Lista usuarios (para obtener empleados/usuarios)
app.get('/usuarios', async (req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase.from('usuarios').select('*').order('id_usuario', { ascending: true });
      if (error) throw error;
      return res.json(data);
    }
    const rows = await sql`SELECT * FROM usuarios ORDER BY id_usuario`;
    res.json(rows);
  } catch (err) {
    console.error('Error al obtener usuarios:', err?.message ?? err);
    res.status(500).json({ error: 'Error al obtener usuarios', detail: err?.message ?? String(err) });
  }
});

// Endpoint de diagnóstico: listar id_producto y nombre (o mostrar sample si columnas distintas)
app.get('/productos/ids', async (req, res) => {
  try {
    if (supabase) {
      // Intentamos seleccionar las columnas esperadas
      let { data, error } = await supabase.from('productos').select('id_producto,nombre_producto').limit(100);
      if (error) throw error;
      // Si no hay id_producto en la respuesta, devolvemos un sample completo para inspección
      if (!data || data.length === 0 || typeof data[0].id_producto === 'undefined') {
        const { data: allData, error: errAll } = await supabase.from('productos').select('*').limit(100);
        if (errAll) throw errAll;
        return res.json({ columns: allData && allData[0] ? Object.keys(allData[0]) : [], sample: allData || [] });
      }
      return res.json({ columns: Object.keys(data[0] || {}), data });
    }

    // Fallback SQL
    const rows = await sql`SELECT id_producto, nombre_producto FROM productos LIMIT 100`;
    return res.json({ columns: rows && rows[0] ? Object.keys(rows[0]) : [], data: rows });
  } catch (err) {
    console.error('Error en /productos/ids:', err?.message ?? err);
    res.status(500).json({ error: 'Error al listar ids', detail: err?.message ?? String(err) });
  }
});

// --- RUTAS NAMESPACEADAS PARA SUPABASE ---
// Obtener categorías (usa el cliente de Supabase)
app.get('/api/supabase/categorias', async (req, res) => {
  try {
    const { data, error } = await supabase.from('categorias').select('*');
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Error obteniendo categorías desde Supabase:', err);
    res.status(500).json({ message: 'Error al obtener categorías' });
  }
});

// Ejemplo: obtener clientes
app.get('/api/supabase/clientes', async (req, res) => {
  try {
    const { data, error } = await supabase.from('clientes').select('*').limit(100);
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Error obteniendo clientes desde Supabase:', err);
    res.status(500).json({ message: 'Error al obtener clientes' });
  }
});

// POST /api/supabase/query -> body: { table: string, select?: string, filter?: { column, op, value } }
// Nota: endpoint sencillo para casos de uso interno; validar/escapar inputs antes de usar en producción.
app.post('/api/supabase/query', async (req, res) => {
  const { table, select = '*', filter } = req.body || {};
  if (!table) return res.status(400).json({ message: 'table is required' });

  try {
    let builder = supabase.from(table).select(select);
    if (filter && filter.column && filter.op && typeof filter.value !== 'undefined') {
      // Ejemplo: { column: 'id_categoria', op: 'eq', value: 2 }
      builder = builder.filter(filter.column, filter.op, filter.value);
    }
    const { data, error } = await builder;
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Error en /api/supabase/query:', err);
    res.status(500).json({ message: 'Error en query' });
  }
});


// Insertar producto nuevo
app.post('/productos', async (req, res) => {
  const { nombre_producto, descripcion_producto, id_categoria, id_proveedor, stock_actual, precio_venta, fecha_vencimiento } = req.body;
  try {
    // Preferir cliente Supabase cuando esté disponible (consistencia con otras rutas)
    if (supabase) {
      const insertObj = { nombre_producto, descripcion_producto, id_categoria, id_proveedor, stock_actual, precio_venta, fecha_vencimiento };
      const { data, error } = await supabase.from('productos').insert([insertObj]).select();
      if (error) throw error;
      return res.json({ success: true, message: 'Producto agregado correctamente', row: data && data[0] });
    }

    await sql`
      INSERT INTO productos (nombre_producto, descripcion_producto, id_categoria, id_proveedor, stock_actual, precio_venta, fecha_vencimiento)
      VALUES (${nombre_producto}, ${descripcion_producto}, ${id_categoria}, ${id_proveedor}, ${stock_actual}, ${precio_venta}, ${fecha_vencimiento})
    `;
    res.json({ success: true, message: 'Producto agregado correctamente' });
  } catch (err) {
    console.error('Error al agregar producto:', err);
    res.status(500).json({ error: 'Error de conexión con el servidor', detail: err?.message ?? String(err) });
  }
});

// Crear categoría
app.post('/categorias', async (req, res) => {
  const { nombre_categoria, descripcion_categoria, activo = true } = req.body || {};
  if (!nombre_categoria) return res.status(400).json({ error: 'nombre_categoria requerido' });
  try {
    if (supabase) {
      const { data, error } = await supabase.from('categorias').insert([{ nombre_categoria, descripcion_categoria, activo }]).select();
      if (error) throw error;
      return res.json({ success: true, row: data && data[0] });
    }

    const result = await sql`
      INSERT INTO categorias (nombre_categoria, descripcion_categoria, activo)
      VALUES (${nombre_categoria}, ${descripcion_categoria}, ${activo})
      RETURNING *
    `;
    const row = Array.isArray(result) && result.length ? result[0] : null;
    return res.json({ success: true, row });
  } catch (err) {
    console.error('Error creando categoría:', err?.message ?? err);
    // Postgres unique violation (duplicate key)
    if (err && (err.code === '23505' || String(err.message || '').toLowerCase().includes('duplicate key'))) {
      return res.status(409).json({ error: 'Clave duplicada: posible secuencia desincronizada o registro existente', detail: err?.message ?? String(err) });
    }
    res.status(500).json({ error: 'Error al crear categoría', detail: err?.message ?? String(err) });
  }
});

// Crear proveedor
app.post('/proveedores', async (req, res) => {
  const { nombre_proveedor, nit_proveedor, telefono_proveedor, email_proveedor, direccion_proveedor, contacto_proveedor, activo = true } = req.body || {};
  if (!nombre_proveedor) return res.status(400).json({ error: 'nombre_proveedor requerido' });
  try {
    if (supabase) {
      const { data, error } = await supabase.from('proveedores').insert([{ nombre_proveedor, nit_proveedor, telefono_proveedor, email_proveedor, direccion_proveedor, contacto_proveedor, activo }]).select();
      if (error) throw error;
      return res.json({ success: true, row: data && data[0] });
    }

    const result = await sql`
      INSERT INTO proveedores (nombre_proveedor, nit_proveedor, telefono_proveedor, email_proveedor, direccion_proveedor, contacto_proveedor, activo)
      VALUES (${nombre_proveedor}, ${nit_proveedor}, ${telefono_proveedor}, ${email_proveedor}, ${direccion_proveedor}, ${contacto_proveedor}, ${activo})
      RETURNING *
    `;
    const row = Array.isArray(result) && result.length ? result[0] : null;
    return res.json({ success: true, row });
  } catch (err) {
    console.error('Error creando proveedor:', err?.message ?? err);
    if (err && (err.code === '23505' || String(err.message || '').toLowerCase().includes('duplicate key'))) {
      return res.status(409).json({ error: 'Clave duplicada: posible secuencia desincronizada o registro existente', detail: err?.message ?? String(err) });
    }
    res.status(500).json({ error: 'Error al crear proveedor', detail: err?.message ?? String(err) });
  }
});

// Crear lote y procesar items (crear/actualizar productos). Body: { proveedor_id, proveedor_nuevo?, items: [{ sku, producto_id, nombre, id_categoria, cantidad, fecha_vencimiento }] }
app.post('/lotes', async (req, res) => {
  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items requeridos' });

  try {
    // Supabase path
    if (supabase) {
      // 1) resolver/crear proveedor
      let proveedorId = body.proveedor_id || null;
      if (!proveedorId && body.proveedor_nuevo && (body.proveedor_nuevo.nombre_proveedor || body.proveedor_nuevo.nombre)) {
        const provObj = {
          nombre_proveedor: body.proveedor_nuevo.nombre_proveedor || body.proveedor_nuevo.nombre,
          nit_proveedor: body.proveedor_nuevo.nit_proveedor || body.proveedor_nuevo.nit || null,
          telefono_proveedor: body.proveedor_nuevo.telefono_proveedor || body.proveedor_nuevo.telefono || null,
          email_proveedor: body.proveedor_nuevo.email_proveedor || body.proveedor_nuevo.email || null,
          direccion_proveedor: body.proveedor_nuevo.direccion_proveedor || null,
          contacto_proveedor: body.proveedor_nuevo.contacto_proveedor || null,
          activo: true
        };
        const { data: pd, error: perr } = await supabase.from('proveedores').insert([provObj]).select();
        if (perr) throw perr;
        proveedorId = pd && pd[0] ? pd[0].id_proveedor ?? pd[0].id : proveedorId;
      }

      // 2) crear lote (guardaremos en observaciones el detalle para poder revertir si es necesario)
      const createdItemsMeta = [];
      // create lote row first to get id and attach to products
      const loteObj = { id_proveedor: proveedorId || null, fecha_recepcion: body.fecha_recepcion || new Date().toISOString().slice(0,10), costo_envio: body.costo_envio || 0, total_lote: body.total_lote || 0, observaciones: null, estado: body.estado || 'RECIBIDO' };
      const { data: loteData, error: loteErr } = await supabase.from('lotes').insert([loteObj]).select();
      if (loteErr) throw loteErr;
      const loteRow = loteData && loteData[0] ? loteData[0] : null;
      const loteId = loteRow ? (loteRow.id_lote ?? loteRow.id) : null;

      // 3) process each item: update existing or create new product; store prev_stock
      for (const it of items) {
        const sku = it.sku || null;
        const prodId = it.producto_id || null;
        const cantidad = Number(it.cantidad || 0) || 0;
        const fecha_venc = it.fecha_vencimiento || null;
        if (prodId) {
          // fetch current
          const { data: prodData, error: pGetErr } = await supabase.from('productos').select('*').eq('id_producto', prodId).limit(1).single();
          if (pGetErr || !prodData) throw pGetErr || new Error('Producto no encontrado ' + prodId);
          const prev = prodData.stock_actual || 0;
          const newStock = prev + cantidad;
          const updObj = { stock_actual: newStock, id_lote: loteId };
          if (fecha_venc) updObj.fecha_vencimiento = fecha_venc;
          const { error: updErr } = await supabase.from('productos').update(updObj).eq('id_producto', prodId);
          if (updErr) throw updErr;
          createdItemsMeta.push({ producto_id: prodId, cantidad, prev_stock: prev, created: false });
        } else {
          // create product
          const createObj = { nombre_producto: it.nombre || ('Producto ' + (sku || '')), codigo_barras: sku || null, id_categoria: it.id_categoria || null, id_proveedor: proveedorId || null, stock_actual: cantidad, fecha_vencimiento: fecha_venc, id_lote: loteId, precio_venta: it.precio_venta || 0 };
          const { data: newP, error: newPErr } = await supabase.from('productos').insert([createObj]).select();
          if (newPErr) throw newPErr;
          const newId = newP && newP[0] ? newP[0].id_producto ?? newP[0].id : null;
          createdItemsMeta.push({ producto_id: newId, cantidad, prev_stock: 0, created: true });
        }
      }

      // 4) update lote.observaciones with JSON of items meta
      try {
        const obs = { items: createdItemsMeta, meta: { created_at: new Date().toISOString(), user: req.ip } };
        await supabase.from('lotes').update({ observaciones: JSON.stringify(obs) }).eq('id_lote', loteId);
      } catch (e) { console.warn('No se pudo guardar observaciones del lote:', e); }

      return res.json({ success: true, id_lote: loteId, items: createdItemsMeta });
    }

    // SQL fallback with transaction
    if (!sql || sql.__disabled) return res.status(500).json({ error: 'DB no configurada para operaciones de lotes' });

    const result = await sql.begin(async sqlTx => {
      // 1) proveedor
      let proveedorId = body.proveedor_id || null;
      if (!proveedorId && body.proveedor_nuevo && (body.proveedor_nuevo.nombre_proveedor || body.proveedor_nuevo.nombre)) {
        const prov = await sqlTx`INSERT INTO proveedores (nombre_proveedor, nit_proveedor, telefono_proveedor, email_proveedor, direccion_proveedor, contacto_proveedor, activo, fecha_creacion) VALUES (${body.proveedor_nuevo.nombre_proveedor || body.proveedor_nuevo.nombre}, ${body.proveedor_nuevo.nit_proveedor || null}, ${body.proveedor_nuevo.telefono_proveedor || null}, ${body.proveedor_nuevo.email_proveedor || null}, ${body.proveedor_nuevo.direccion_proveedor || null}, ${body.proveedor_nuevo.contacto_proveedor || null}, true, now()) RETURNING id_proveedor`;
        proveedorId = prov && prov[0] ? prov[0].id_proveedor : proveedorId;
      }

      // 2) crear lote
      const loteIns = await sqlTx`INSERT INTO lotes (id_proveedor, fecha_recepcion, costo_envio, total_lote, observaciones, estado, fecha_creacion) VALUES (${proveedorId}, ${body.fecha_recepcion || new Date().toISOString().slice(0,10)}, ${body.costo_envio || 0}, ${body.total_lote || 0}, ${null}, ${body.estado || 'RECIBIDO'}, now()) RETURNING id_lote`;
      const loteId = loteIns && loteIns[0] ? loteIns[0].id_lote : null;
      if (!loteId) throw new Error('No se pudo crear lote');

      const itemsMeta = [];
      for (const it of items) {
        const sku = it.sku || null;
        const prodId = it.producto_id || null;
        const cantidad = Number(it.cantidad || 0) || 0;
        const fecha_venc = it.fecha_vencimiento || null;
        if (prodId) {
          const rows = await sqlTx`SELECT stock_actual FROM productos WHERE id_producto = ${prodId} FOR UPDATE`;
          const prev = Array.isArray(rows) && rows.length ? (rows[0].stock_actual || 0) : 0;
          const newStock = prev + cantidad;
          await sqlTx`UPDATE productos SET stock_actual = ${newStock}, fecha_vencimiento = COALESCE(${fecha_venc}, fecha_vencimiento), id_lote = ${loteId} WHERE id_producto = ${prodId}`;
          itemsMeta.push({ producto_id: prodId, cantidad, prev_stock: prev, created: false });
        } else {
          const insertP = await sqlTx`INSERT INTO productos (nombre_producto, descripcion_producto, fecha_vencimiento, fecha_recepcion, precio_venta, precio_compra, stock_actual, stock_minimo, codigo_barras, unidad_medida, activo, fecha_creacion, id_categoria, id_lote, id_proveedor) VALUES (${it.nombre || ('Producto ' + (it.sku || ''))}, ${it.descripcion_producto || null}, ${it.fecha_vencimiento || null}, now(), ${it.precio_venta || 0}, ${it.precio_compra || null}, ${cantidad}, ${it.stock_minimo || 1}, ${it.sku || null}, ${it.unidad_medida || 'UNIDAD'}, true, now(), ${it.id_categoria || null}, ${loteId}, ${proveedorId}) RETURNING id_producto`;
          const newId = insertP && insertP[0] ? insertP[0].id_producto : null;
          itemsMeta.push({ producto_id: newId, cantidad, prev_stock: 0, created: true });
        }
      }

      // guardar observaciones con itemsMeta
      await sqlTx`UPDATE lotes SET observaciones = ${JSON.stringify({ items: itemsMeta, meta: { created_at: new Date().toISOString(), user: req.ip } })} WHERE id_lote = ${loteId}`;

      return { success: true, id_lote: loteId, items: itemsMeta };
    });

    return res.json(result);
  } catch (err) {
    console.error('Error procesando /lotes:', err?.message ?? err);
    res.status(500).json({ error: 'Error procesando lote', detail: err?.message ?? String(err) });
  }
});

// Revertir lote (usar observaciones para conocer cambios). Body optional: { force: true }
app.post('/lotes/:id/revert', async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: 'id requerido' });
  try {
    if (supabase) {
      const { data: lote, error: lerr } = await supabase.from('lotes').select('*').eq('id_lote', id).limit(1).single();
      if (lerr || !lote) return res.status(404).json({ error: 'Lote no encontrado' });
      let obs = null;
      try { obs = JSON.parse(lote.observaciones || '{}'); } catch (e) { obs = null; }
      const items = (obs && Array.isArray(obs.items)) ? obs.items : [];
      // revert each
      for (const it of items) {
        const pid = it.producto_id;
        if (!pid) continue;
        if (it.created) {
          // delete product created
          await supabase.from('productos').delete().match({ id_producto: pid });
        } else {
          // restore previous stock and unset id_lote
          await supabase.from('productos').update({ stock_actual: it.prev_stock }).eq('id_producto', pid);
          await supabase.from('productos').update({ id_lote: null }).eq('id_producto', pid);
        }
      }
      // delete lote
      await supabase.from('lotes').delete().match({ id_lote: id });
      return res.json({ success: true, reverted: items.length });
    }

    if (!sql || sql.__disabled) return res.status(500).json({ error: 'DB no configurada' });
    const result = await sql.begin(async sqlTx => {
      const lr = await sqlTx`SELECT * FROM lotes WHERE id_lote = ${id}`;
      const lote = Array.isArray(lr) && lr.length ? lr[0] : null;
      if (!lote) throw new Error('Lote no encontrado');
      let obs = null;
      try { obs = JSON.parse(lote.observaciones || '{}'); } catch (e) { obs = null; }
      const items = (obs && Array.isArray(obs.items)) ? obs.items : [];
      for (const it of items) {
        const pid = it.producto_id;
        if (!pid) continue;
        if (it.created) {
          await sqlTx`DELETE FROM productos WHERE id_producto = ${pid}`;
        } else {
          await sqlTx`UPDATE productos SET stock_actual = ${it.prev_stock}, id_lote = NULL WHERE id_producto = ${pid}`;
        }
      }
      await sqlTx`DELETE FROM lotes WHERE id_lote = ${id}`;
      return { success: true, reverted: items.length };
    });
    return res.json(result);
  } catch (err) {
    console.error('Error revirtiendo lote:', err?.message ?? err);
    res.status(500).json({ error: 'Error revirtiendo lote', detail: err?.message ?? String(err) });
  }
});

// LOGIN: verificar credenciales contra accounts_usuario en Supabase
app.post('/login', async (req, res) => {
  const { username, password, role } = req.body || {};

  if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

  try {
    // Si hay Supabase configurado, usarlo
    if (supabase) {
      const { data: users, error } = await supabase
        .from('usuarios')
        .select('id_usuario, username, password_hash, rol, email, activo')
        .eq('username', username)
        .single();

      if (error || !users) {
        console.log('Usuario no encontrado en Supabase:', username);
        return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
      }

      if (!users.activo) return res.status(403).json({ error: 'Usuario inactivo' });
      if (!verifyPasswordHash(users.password_hash, password)) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

      // Si el cliente solicitó un rol específico, verificar que coincida
      if (role && String(role).toLowerCase() !== String(users.rol).toLowerCase()) {
        console.log(`Acceso denegado para ${username}: rol solicitado=${role} rol_real=${users.rol}`);
        return res.status(403).json({ error: 'Acceso denegado: rol no coincide' });
      }

      console.log(`Login exitoso (supabase) para ${username} con rol ${users.rol}`);
      return res.json({ success: true, user: { id_usuario: users.id_usuario, user_login: users.username, email: users.email || null, rol: users.rol } });
    }

    // Si no hay Supabase, intentar con la DB local
    console.log('Supabase no configurado, usando DB local para login');
    const rows = await sql`SELECT id_usuario, username, password_hash, rol, email, activo FROM usuarios WHERE username = ${username}`;
    const user = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!user) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    if (!user.activo) return res.status(403).json({ error: 'Usuario inactivo' });
    if (!verifyPasswordHash(user.password_hash, password)) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

    if (role && String(role).toLowerCase() !== String(user.rol).toLowerCase()) {
      console.log(`Acceso denegado (db) para ${username}: rol solicitado=${role} rol_real=${user.rol}`);
      return res.status(403).json({ error: 'Acceso denegado: rol no coincide' });
    }

    console.log(`Login exitoso (db) para ${username} con rol ${user.rol}`);
    return res.json({ success: true, user: { id_usuario: user.id_usuario, user_login: user.username, email: user.email || null, rol: user.rol } });
  } catch (err) {
    console.error('Error en login:', err?.message ?? err);
    return res.status(500).json({ error: 'Error al procesar login', detail: err?.message ?? String(err) });
  }
});

// Ruta para DELETE sin id -> devolver 400
app.delete('/productos', (req, res) => {
  res.status(400).json({ error: 'Debe especificar id en la ruta: DELETE /productos/:id' });
});

// Eliminar un producto por id o id_producto
app.delete('/productos/:id', async (req, res) => {
  const idParam = req.params.id;
  if (!idParam) return res.status(400).json({ error: 'id requerido en la ruta' });

  try {
    const numericId = /^\d+$/.test(idParam) ? parseInt(idParam, 10) : null;
    const filterVal = numericId !== null ? numericId : idParam;

    // 1. Verificar si el producto está referenciado en detalle_ventas
    let referencias = 0;
    if (supabase) {
      try {
        const { count, error: cntErr } = await supabase
          .from('detalle_ventas')
          .select('id_detalle_venta', { count: 'exact', head: true })
          .eq('id_producto', filterVal);
        if (!cntErr && typeof count === 'number') referencias = count;
      } catch (_) { referencias = 0; }
    } else {
      try {
        const rows = await sql`SELECT COUNT(1)::int AS cnt FROM detalle_ventas WHERE id_producto = ${filterVal}`;
        referencias = Array.isArray(rows) && rows.length ? rows[0].cnt : 0;
      } catch (_) { referencias = 0; }
    }

    // 2. Si hay referencias -> soft delete (activo = false)
    if (referencias > 0) {
      if (supabase) {
        const { data, error: updErr } = await supabase
          .from('productos')
          .update({ activo: false })
          .match({ id_producto: filterVal })
          .select();
        if (updErr) throw updErr;
        return res.json({ success: true, softDeleted: true, ventasReferenciadas: referencias, message: 'Producto con ventas: marcado como inactivo.', updated: data?.length ?? 0 });
      }
      const upd = await sql`UPDATE productos SET activo = false WHERE id_producto = ${filterVal} RETURNING id_producto`;
      return res.json({ success: true, softDeleted: true, ventasReferenciadas: referencias, updated: Array.isArray(upd) ? upd.length : 0, message: 'Producto con ventas: marcado como inactivo.' });
    }

    // 3. No referenciado -> intentar eliminación física
    if (supabase) {
      try {
        const { data, error } = await supabase.from('productos').delete().match({ id_producto: filterVal });
        if (error) throw error;
        return res.json({ success: true, deleted: data?.length ?? 0, message: 'Producto eliminado.' });
      } catch (delErr) {
        const msg = String(delErr?.message || '').toLowerCase();
        if (msg.includes('foreign key') || delErr?.code === '23503') {
          // fallback soft delete
            const { data: upd2, error: updErr2 } = await supabase
              .from('productos')
              .update({ activo: false })
              .match({ id_producto: filterVal })
              .select();
            if (updErr2) return res.status(409).json({ error: 'producto_referenciado', detail: 'FK y no se pudo marcar inactivo', fk: true });
            return res.json({ success: true, softDeleted: true, ventasReferenciadas: 'desconocido', message: 'Producto referenciado: marcado como inactivo.' });
        }
        throw delErr;
      }
    }

    try {
      const result = await sql`DELETE FROM productos WHERE id_producto = ${filterVal} RETURNING id_producto`;
      const deleted = Array.isArray(result) ? result.length : 0;
      return res.json({ success: true, deleted, message: 'Producto eliminado.' });
    } catch (delSqlErr) {
      const msg = String(delSqlErr?.message || '').toLowerCase();
      if (msg.includes('foreign key') || delSqlErr?.code === '23503') {
        // fallback soft delete
        try {
          const upd3 = await sql`UPDATE productos SET activo = false WHERE id_producto = ${filterVal} RETURNING id_producto`;
          return res.json({ success: true, softDeleted: true, ventasReferenciadas: 'desconocido', updated: Array.isArray(upd3) ? upd3.length : 0, message: 'Producto referenciado: marcado como inactivo.' });
        } catch (updFail) {
          return res.status(409).json({ error: 'producto_referenciado', detail: 'FK y no se pudo marcar inactivo', fk: true });
        }
      }
      throw delSqlErr;
    }
  } catch (err) {
    console.error('Error al eliminar producto:', err?.message ?? err);
    const msg = String(err?.message || '').toLowerCase();
    if (msg.includes('foreign key') || err?.code === '23503') {
      return res.status(409).json({ error: 'producto_referenciado', detail: 'Tiene ventas asociadas. Use desactivación.', fk: true });
    }
    res.status(500).json({ error: 'Error al eliminar producto', detail: err?.message ?? String(err) });
  }
});

// -----------------------------
// RUTAS CRUD PARA CLIENTES
// -----------------------------
// Listar clientes
app.get('/clientes', async (req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase.from('clientes').select('*').order('id_cliente', { ascending: true });
      if (error) throw error;
      return res.json(data);
    }

    const rows = await sql`SELECT * FROM clientes ORDER BY id_cliente`;
    res.json(rows);
  } catch (err) {
    console.error('Error al obtener clientes:', err?.message ?? err);
    res.status(500).json({ error: 'Error al obtener clientes', detail: err?.message ?? String(err) });
  }
});

// Listar ventas (para dashboard)
app.get('/ventas', async (req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase.from('ventas').select('*').order('fecha_venta', { ascending: false }).limit(1000);
      if (error) throw error;
      return res.json(data);
    }

    const rows = await sql`SELECT * FROM ventas ORDER BY fecha_venta DESC LIMIT 1000`;
    res.json(rows);
  } catch (err) {
    console.error('Error al obtener ventas:', err?.message ?? err);
    res.status(500).json({ error: 'Error al obtener ventas', detail: err?.message ?? String(err) });
  }
});

// Listar detalle_ventas (para historial/detalles)
app.get('/detalle_ventas', async (req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase.from('detalle_ventas').select('*').order('id_detalle_venta', { ascending: false }).limit(2000);
      if (error) throw error;
      return res.json(data);
    }
    const rows = await sql`SELECT * FROM detalle_ventas ORDER BY id_detalle_venta DESC LIMIT 2000`;
    res.json(rows);
  } catch (err) {
    console.error('Error al obtener detalle_ventas:', err?.message ?? err);
    res.status(500).json({ error: 'Error al obtener detalle_ventas', detail: err?.message ?? String(err) });
  }
});

// Listar empleados (para selects en facturación)
app.get('/empleados', async (req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase.from('empleados').select('*').order('id_empleado', { ascending: true });
      if (error) throw error;
      return res.json(data);
    }
    const rows = await sql`SELECT * FROM empleados ORDER BY id_empleado`;
    res.json(rows);
  } catch (err) {
    console.error('Error al obtener empleados:', err?.message ?? err);
    res.status(500).json({ error: 'Error al obtener empleados', detail: err?.message ?? String(err) });
  }
});

// Obtener un cliente por id
app.get('/clientes/:id', async (req, res) => {
  const idParam = req.params.id;
  if (!idParam) return res.status(400).json({ error: 'id requerido en la ruta' });
  try {
    const numericId = /^\d+$/.test(idParam) ? parseInt(idParam, 10) : idParam;
    if (supabase) {
      const { data, error } = await supabase.from('clientes').select('*').eq('id_cliente', numericId).single();
      if (error) {
        // Supabase devuelve error cuando no existe
        return res.status(404).json({ error: 'Cliente no encontrado' });
      }
      return res.json(data);
    }
    const rows = await sql`SELECT * FROM clientes WHERE id_cliente = ${numericId}`;
    const cliente = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
    return res.json(cliente);
  } catch (err) {
    console.error('Error al obtener cliente:', err?.message ?? err);
    res.status(500).json({ error: 'Error al obtener cliente', detail: err?.message ?? String(err) });
  }
});

// Crear cliente
app.post('/clientes', async (req, res) => {
  const {
    nombre_completo,
    tipo_identificacion = null,
    numero_identificacion = null,
    telefono = null,
    email = null,
    direccion = null,
    fecha_nacimiento = null,
    activo = true,
  } = req.body || {};

  if (!nombre_completo) return res.status(400).json({ error: 'nombre_completo requerido' });

  try {
    console.log('POST /clientes payload:', JSON.stringify(req.body || {}));
    if (supabase) {
      // incluir fecha_creacion si no viene
      const payload = { nombre_completo, tipo_identificacion, numero_identificacion, telefono, email, direccion, fecha_nacimiento, activo, fecha_creacion: (req.body && req.body.fecha_creacion) ? req.body.fecha_creacion : new Date().toISOString() };
      const { data, error } = await supabase.from('clientes').insert([payload]).select();
      if (error) {
        console.error('Supabase insert error (clientes):', error);
        return res.status(500).json({ error: 'Error creando cliente (supabase)', detail: error.message || error?.msg || JSON.stringify(error) });
      }
      return res.json({ success: true, row: data && data[0] });
    }

    const result = await sql`
      INSERT INTO clientes (nombre_completo, tipo_identificacion, numero_identificacion, telefono, email, direccion, fecha_nacimiento, activo, fecha_creacion)
      VALUES (${nombre_completo}, ${tipo_identificacion}, ${numero_identificacion}, ${telefono}, ${email}, ${direccion}, ${fecha_nacimiento}, ${activo}, now())
      RETURNING *
    `;
    const row = Array.isArray(result) && result.length ? result[0] : null;
    return res.json({ success: true, row });
  } catch (err) {
    console.error('Error creando cliente:', err?.message ?? err);
    try {
      const raw = JSON.stringify(err, Object.getOwnPropertyNames(err));
      console.error('Full error object:', raw);
    } catch (e) {
      console.error('Error serializing error object', e);
    }
    // Detectar violación de constraint (duplicate key)
    const isDuplicate = err && (err.code === '23505' || String(err.message || '').toLowerCase().includes('duplicate key') || String(err?.detail || '').toLowerCase().includes('already exists'));
    if (isDuplicate) {
      try {
        // Si tenemos numero_identificacion, intentar devolver el registro existente para que el frontend pueda mostrarlo
        if (numero_identificacion) {
          if (supabase) {
            const { data: existing, error: fetchErr } = await supabase.from('clientes').select('*').eq('numero_identificacion', numero_identificacion).limit(1).single();
            if (!fetchErr && existing) return res.status(409).json({ error: 'duplicate', field: 'numero_identificacion', existing });
          } else {
            const rows = await sql`SELECT * FROM clientes WHERE numero_identificacion = ${numero_identificacion} LIMIT 1`;
            if (Array.isArray(rows) && rows.length) return res.status(409).json({ error: 'duplicate', field: 'numero_identificacion', existing: rows[0] });
          }
        }
      } catch (fetchExistingErr) {
        console.warn('No se pudo obtener registro existente tras duplicate key:', fetchExistingErr?.message ?? fetchExistingErr);
      }
      return res.status(409).json({ error: 'Clave duplicada: posible registro existente', detail: err?.message ?? String(err) });
    }
    // devolver detalle adicional para debug en desarrollo
    let errDetail = err?.message ?? String(err);
    try {
      const extra = JSON.stringify(err, Object.getOwnPropertyNames(err));
      errDetail = errDetail + ' | extra: ' + extra;
    } catch (e) { }
    res.status(500).json({ error: 'Error al crear cliente', detail: errDetail });
  }
});

// Actualizar cliente (parcial)
app.patch('/clientes/:id', async (req, res) => {
  const idParam = req.params.id;
  if (!idParam) return res.status(400).json({ error: 'id requerido en la ruta' });

  const {
    nombre_completo,
    tipo_identificacion,
    numero_identificacion,
    telefono,
    email,
    direccion,
    fecha_nacimiento,
    activo,
  } = req.body || {};

  if (
    typeof nombre_completo === 'undefined' &&
    typeof tipo_identificacion === 'undefined' &&
    typeof numero_identificacion === 'undefined' &&
    typeof telefono === 'undefined' &&
    typeof email === 'undefined' &&
    typeof direccion === 'undefined' &&
    typeof fecha_nacimiento === 'undefined' &&
    typeof activo === 'undefined'
  ) {
    return res.status(400).json({ error: 'Al menos un campo para actualizar es requerido en body' });
  }

  try {
    const numericId = /^\d+$/.test(idParam) ? parseInt(idParam, 10) : idParam;
    if (supabase) {
      const updateObj = {};
      if (typeof nombre_completo !== 'undefined') updateObj.nombre_completo = nombre_completo;
      if (typeof tipo_identificacion !== 'undefined') updateObj.tipo_identificacion = tipo_identificacion;
      if (typeof numero_identificacion !== 'undefined') updateObj.numero_identificacion = numero_identificacion;
      if (typeof telefono !== 'undefined') updateObj.telefono = telefono;
      if (typeof email !== 'undefined') updateObj.email = email;
      if (typeof direccion !== 'undefined') updateObj.direccion = direccion;
      if (typeof fecha_nacimiento !== 'undefined') updateObj.fecha_nacimiento = fecha_nacimiento;
      if (typeof activo !== 'undefined') updateObj.activo = activo;

      const { data, error } = await supabase.from('clientes').update(updateObj).match({ id_cliente: numericId }).select();
      if (error) throw error;
      return res.json({ success: true, updated: data?.length ?? 0, row: data && data[0] });
    }

    const result = await sql`
      UPDATE clientes
      SET
        nombre_completo = COALESCE(${nombre_completo}, nombre_completo),
        tipo_identificacion = COALESCE(${tipo_identificacion}, tipo_identificacion),
        numero_identificacion = COALESCE(${numero_identificacion}, numero_identificacion),
        telefono = COALESCE(${telefono}, telefono),
        email = COALESCE(${email}, email),
        direccion = COALESCE(${direccion}, direccion),
        fecha_nacimiento = COALESCE(${fecha_nacimiento}, fecha_nacimiento),
        activo = COALESCE(${activo}, activo)
      WHERE id_cliente = ${numericId}
      RETURNING *
    `;
    const updated = Array.isArray(result) && result.length ? result[0] : null;
    return res.json({ success: true, updated: updated ? 1 : 0, row: updated });
  } catch (err) {
    console.error('Error actualizando cliente:', err?.message ?? err);
    res.status(500).json({ error: 'Error al actualizar cliente', detail: err?.message ?? String(err) });
  }
});

// Eliminar cliente
app.delete('/clientes/:id', async (req, res) => {
  const idParam = req.params.id;
  if (!idParam) return res.status(400).json({ error: 'id requerido en la ruta' });
  try {
    const numericId = /^\d+$/.test(idParam) ? parseInt(idParam, 10) : idParam;

    // 1. Verificar si el cliente tiene ventas asociadas
    let ventasCount = 0;
    if (supabase) {
      try {
        const { count, error: ventasErr } = await supabase
          .from('ventas')
          .select('id_venta', { count: 'exact', head: true })
          .eq('id_cliente', numericId);
        if (!ventasErr && typeof count === 'number') ventasCount = count;
      } catch (e) { /* ignorar y asumir 0 */ }
    } else {
      try {
        const rows = await sql`SELECT COUNT(1)::int AS cnt FROM ventas WHERE id_cliente = ${numericId}`;
        ventasCount = Array.isArray(rows) && rows.length ? rows[0].cnt : 0;
      } catch (e) { ventasCount = 0; }
    }

    // 2. Si hay ventas, realizar "soft delete" (activo=false) en lugar de borrar
    if (ventasCount > 0) {
      if (supabase) {
        const { data: upd, error: updErr } = await supabase
          .from('clientes')
          .update({ activo: false })
          .match({ id_cliente: numericId })
          .select();
        if (updErr) throw updErr;
        return res.json({ success: true, softDeleted: true, ventasReferenciadas: ventasCount, message: 'Cliente con ventas: marcado como inactivo.' });
      }
      const upd = await sql`UPDATE clientes SET activo = false WHERE id_cliente = ${numericId} RETURNING id_cliente`;
      const updated = Array.isArray(upd) ? upd.length : 0;
      return res.json({ success: true, softDeleted: true, ventasReferenciadas: ventasCount, updated, message: 'Cliente con ventas: marcado como inactivo.' });
    }

    // 3. No tiene ventas -> eliminar definitivo (si falla por FK, fallback soft delete)
    if (supabase) {
      try {
        const { data, error } = await supabase.from('clientes').delete().match({ id_cliente: numericId });
        if (error) throw error;
        return res.json({ success: true, deleted: data?.length ?? 0, message: 'Cliente eliminado.' });
      } catch (delErr) {
        const msgDel = String(delErr?.message || '').toLowerCase();
        if (msgDel.includes('foreign key') || delErr?.code === '23503') {
          // Realizar soft delete como fallback
          const { data: upd2, error: updErr2 } = await supabase.from('clientes').update({ activo: false }).match({ id_cliente: numericId }).select();
          if (updErr2) {
            return res.status(409).json({ error: 'cliente_referenciado', detail: 'FK ventas y no se pudo marcar inactivo', fk: true });
          }
            return res.json({ success: true, softDeleted: true, ventasReferenciadas: 'desconocido', message: 'Cliente referenciado: marcado como inactivo.' });
        }
        throw delErr;
      }
    }
    try {
      const result = await sql`DELETE FROM clientes WHERE id_cliente = ${numericId} RETURNING id_cliente`;
      const deleted = Array.isArray(result) ? result.length : 0;
      return res.json({ success: true, deleted, message: 'Cliente eliminado.' });
    } catch (delSqlErr) {
      const msgDel = String(delSqlErr?.message || '').toLowerCase();
      if (msgDel.includes('foreign key') || delSqlErr?.code === '23503') {
        // fallback soft delete
        try {
          const upd3 = await sql`UPDATE clientes SET activo = false WHERE id_cliente = ${numericId} RETURNING id_cliente`;
          const updated = Array.isArray(upd3) ? upd3.length : 0;
          return res.json({ success: true, softDeleted: true, ventasReferenciadas: 'desconocido', updated, message: 'Cliente referenciado: marcado como inactivo.' });
        } catch (updFail) {
          return res.status(409).json({ error: 'cliente_referenciado', detail: 'FK ventas y no se pudo marcar inactivo', fk: true });
        }
      }
      throw delSqlErr;
    }
  } catch (err) {
    console.error('Error eliminando cliente:', err?.message ?? err);
    // Si el error es violación de FK pero no se alcanzó soft delete, informar claramente
    const msg = String(err?.message || '').toLowerCase();
    if (msg.includes('foreign key') || err?.code === '23503') {
      return res.status(409).json({ error: 'cliente_referenciado', detail: 'El cliente tiene ventas asociadas. Use desactivación (activo=false).', fk: true });
    }
    res.status(500).json({ error: 'Error al eliminar cliente', detail: err?.message ?? String(err) });
  }
});

// Actualizar un producto (p. ej. stock_actual)
app.patch('/productos/:id', async (req, res) => {
  const idParam = req.params.id;
  if (!idParam) return res.status(400).json({ error: 'id requerido en la ruta' });

  // Campos permitidos para actualizar. Si vienen undefined, no se modificarán.
  const {
    nombre_producto,
    descripcion_producto,
    id_categoria,
    id_proveedor,
    stock_actual,
    precio_venta,
    fecha_vencimiento,
  } = req.body || {};

  // require at least one field to update
  if (
    typeof nombre_producto === 'undefined' &&
    typeof descripcion_producto === 'undefined' &&
    typeof id_categoria === 'undefined' &&
    typeof id_proveedor === 'undefined' &&
    typeof stock_actual === 'undefined' &&
    typeof precio_venta === 'undefined' &&
    typeof fecha_vencimiento === 'undefined'
  ) {
    return res.status(400).json({ error: 'Al menos un campo para actualizar es requerido en body' });
  }

  try {
    const numericId = /^\d+$/.test(idParam) ? parseInt(idParam, 10) : idParam;

    if (supabase) {
      const updateObj = {};
      if (typeof nombre_producto !== 'undefined') updateObj.nombre_producto = nombre_producto;
      if (typeof descripcion_producto !== 'undefined') updateObj.descripcion_producto = descripcion_producto;
      if (typeof id_categoria !== 'undefined') updateObj.id_categoria = id_categoria;
      if (typeof id_proveedor !== 'undefined') updateObj.id_proveedor = id_proveedor;
      if (typeof stock_actual !== 'undefined') updateObj.stock_actual = stock_actual;
      if (typeof precio_venta !== 'undefined') updateObj.precio_venta = precio_venta;
      if (typeof fecha_vencimiento !== 'undefined') updateObj.fecha_vencimiento = fecha_vencimiento;

      const filterVal = numericId;
      const { data, error } = await supabase.from('productos').update(updateObj).match({ id_producto: filterVal }).select();
      if (error) throw error;
      return res.json({ success: true, updated: data?.length ?? 0, row: data && data[0] });
    }

    // SQL fallback: usar COALESCE para mantener valores actuales cuando body no provee el campo
    const result = await sql`
      UPDATE productos
      SET
        nombre_producto = COALESCE(${nombre_producto}, nombre_producto),
        descripcion_producto = COALESCE(${descripcion_producto}, descripcion_producto),
        id_categoria = COALESCE(${id_categoria}, id_categoria),
        id_proveedor = COALESCE(${id_proveedor}, id_proveedor),
        stock_actual = COALESCE(${stock_actual}, stock_actual),
        precio_venta = COALESCE(${precio_venta}, precio_venta),
        fecha_vencimiento = COALESCE(${fecha_vencimiento}, fecha_vencimiento)
      WHERE id_producto = ${numericId}
      RETURNING *
    `;

    const updated = Array.isArray(result) && result.length ? result[0] : null;
    return res.json({ success: true, updated: updated ? 1 : 0, row: updated });
  } catch (err) {
    console.error('Error actualizando producto:', err?.message ?? err);
    res.status(500).json({ error: 'Error al actualizar producto', detail: err?.message ?? String(err) });
  }
});

// Exportar app para pruebas con supertest
export { app };

// Sólo iniciar el listener si no estamos en entorno de test
if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`Servidor corriendo en http://localhost:${port}`);
  });
}

// RUTA ADMIN: sincronizar secuencias de tablas (solo para desarrollo)
// Si se define ADMIN_SECRET en .env, la petición debe incluir header 'x-admin-secret'
app.post('/admin/sync-sequences', async (req, res) => {
  try {
    const adminSecret = process.env.ADMIN_SECRET;
    if (adminSecret) {
      const provided = req.headers['x-admin-secret'] || req.query.admin_secret;
      if (!provided || String(provided) !== String(adminSecret)) {
        return res.status(403).json({ error: 'Forbidden: admin secret required' });
      }
    }

    // sincronizar categorias
    const cat = await sql`
      SELECT setval(pg_get_serial_sequence('categorias','id_categoria'), COALESCE((SELECT MAX(id_categoria) FROM categorias), 0) + 1, false) AS new_val
    `;
    // sincronizar proveedores
    const prov = await sql`
      SELECT setval(pg_get_serial_sequence('proveedores','id_proveedor'), COALESCE((SELECT MAX(id_proveedor) FROM proveedores), 0) + 1, false) AS new_val
    `;

    return res.json({ success: true, categorias_next: cat?.[0]?.new_val ?? null, proveedores_next: prov?.[0]?.new_val ?? null });
  } catch (err) {
    console.error('Error sincronizando secuencias:', err?.message ?? err);
    return res.status(500).json({ error: 'Error sincronizando secuencias', detail: err?.message ?? String(err) });
  }
});

// Comunicacion para imprimir facturas
app.use(express.json());

app.post('/imprimir', async (req, res) => {
  try {
    const { html, nombreImpresora } = req.body;

    if (!html) {
      return res.status(400).json({ ok: false, message: 'HTML vacío' });
    }

    const respuestaPlugin = await fetch("http://localhost:3000/imprimir", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        nombreImpresora: nombreImpresora || "XPrinter",
        serial: "",
        operaciones: [
          {
            nombre: "GenerarImagenAPartirDeHtmlEImprimir",
            argumentos: [
              html,   // 🔥 ESTE HTML ES TU FACTURA
              380,
              380,
              0,
              false
            ]
          }
        ]
      })
    });

    const resultado = await respuestaPlugin.json();
    if (!resultado.ok) {
    return res.status(500).json(resultado);
    }
    res.json({ ok: true });

  } catch (error) {
    console.error("Error backend impresión:", error);
    res.status(500).json({ ok: false, message: error.message });
  }
});


app.listen(3000, () => {
  console.log('Servidor de impresión corriendo en http://localhost:3000');
});


