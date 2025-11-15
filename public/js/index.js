console.log('Estoy funcionando');

// Usa el índice idx_productos_nombre
const productos = await ProductoService.buscarPorNombre('homeo');

// Usa el índice idx_ventas_fecha  
const ventas = await VentaService.ventasDelDia();

// Al crear una venta, automáticamente:
// - Se genera el número de factura (trigger)
// - Se actualiza el stock de productos (trigger)
const venta = await VentaService.crearVenta(nuevaVenta, detalles);

const { Pool } = require('pg');
require('dotenv').config();

// Configurar pool de conexiones
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    max: 10, // máximo 10 conexiones en el pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// Función para probar conexión
async function testConnection() {
    try {
        const client = await pool.connect();
        console.log('✅ Conexión exitosa a PostgreSQL');
        client.release();
    } catch (err) {
        console.error('❌ Error de conexión:', err);
    }
}

module.exports = { pool, testConnection };

// =================================================
// 3. FUNCIONES PARA USAR LOS ÍNDICES OPTIMIZADOS
// =================================================

// Archivo: productoService.js
const { pool } = require('./database');

class ProductoService {
    
    // Buscar productos por nombre (usa índice idx_productos_nombre)
    static async buscarPorNombre(nombre) {
        try {
            const query = `
                SELECT * FROM vista_productos_completa 
                WHERE nombre_producto ILIKE $1
                ORDER BY nombre_producto
            `;
            const result = await pool.query(query, [`%${nombre}%`]);
            return result.rows;
        } catch (error) {
            console.error('Error buscando productos:', error);
            throw error;
        }
    }

    // Buscar productos por categoría (usa índice idx_productos_categoria)
    static async buscarPorCategoria(idCategoria) {
        try {
            const query = `
                SELECT * FROM vista_productos_completa 
                WHERE id_categoria = $1 AND activo = true
                ORDER BY nombre_producto
            `;
            const result = await pool.query(query, [idCategoria]);
            return result.rows;
        } catch (error) {
            console.error('Error buscando por categoría:', error);
            throw error;
        }
    }

    // Productos con stock bajo (usa índice idx_productos_stock)
    static async productosStockBajo() {
        try {
            const query = `
                SELECT * FROM vista_productos_completa 
                WHERE estado_stock = 'STOCK_BAJO'
                ORDER BY stock_actual ASC
            `;
            const result = await pool.query(query);
            return result.rows;
        } catch (error) {
            console.error('Error obteniendo stock bajo:', error);
            throw error;
        }
    }

    // Productos próximos a vencer (usa índice idx_productos_vencimiento)
    static async productosProximosVencer(dias = 30) {
        try {
            const query = `
                SELECT * FROM vista_productos_completa 
                WHERE fecha_vencimiento BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '${dias} days'
                ORDER BY fecha_vencimiento ASC
            `;
            const result = await pool.query(query);
            return result.rows;
        } catch (error) {
            console.error('Error productos próximos a vencer:', error);
            throw error;
        }
    }

    // Agregar nuevo producto (activa trigger de stock)
    static async agregarProducto(producto) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const query = `
                INSERT INTO productos (
                    nombre_producto, id_categoria, descripcion_producto, 
                    fecha_vencimiento, id_lote, precio_venta, precio_compra, 
                    stock_actual, stock_minimo, codigo_barras, unidad_medida
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                RETURNING id_producto
            `;
            
            const values = [
                producto.nombre, producto.categoria, producto.descripcion,
                producto.fechaVencimiento, producto.lote, producto.precioVenta,
                producto.precioCompra, producto.stock, producto.stockMinimo,
                producto.codigoBarras, producto.unidadMedida
            ];
            
            const result = await client.query(query, values);
            await client.query('COMMIT');
            
            return result.rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error agregando producto:', error);
            throw error;
        } finally {
            client.release();
        }
    }
}

// =================================================
// 4. FUNCIONES PARA VENTAS (USA TRIGGERS AUTOMÁTICOS)
// =================================================

// Archivo: ventaService.js
class VentaService {
    
    // Crear nueva venta (activa triggers automáticos)
    static async crearVenta(venta, detalles) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            // 1. Crear la venta (trigger genera número de factura automáticamente)
            const ventaQuery = `
                INSERT INTO ventas (
                    id_cliente, id_empleado, subtotal, descuento_porcentaje,
                    descuento_valor, iva_valor, total_pagar, id_metodo_pago, observaciones
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING id_venta, numero_factura
            `;
            
            const ventaValues = [
                venta.cliente, venta.empleado, venta.subtotal, venta.descuentoPorcentaje,
                venta.descuentoValor, venta.ivaValor, venta.totalPagar, venta.metodoPago, venta.observaciones
            ];
            
            const ventaResult = await client.query(ventaQuery, ventaValues);
            const idVenta = ventaResult.rows[0].id_venta;
            
            // 2. Agregar detalles de venta (trigger actualiza stock automáticamente)
            for (const detalle of detalles) {
                const detalleQuery = `
                    INSERT INTO detalle_ventas (
                        id_venta, id_producto, cantidad, precio_unitario, 
                        subtotal_detalle, descuento_detalle
                    ) VALUES ($1, $2, $3, $4, $5, $6)
                `;
                
                const detalleValues = [
                    idVenta, detalle.producto, detalle.cantidad, detalle.precio,
                    detalle.subtotal, detalle.descuento || 0
                ];
                
                await client.query(detalleQuery, detalleValues);
            }
            
            await client.query('COMMIT');
            return ventaResult.rows[0];
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error creando venta:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // Ventas del día (usa índice idx_ventas_fecha)
    static async ventasDelDia(fecha = null) {
        try {
            let query;
            let values = [];
            
            if (fecha) {
                query = `
                    SELECT * FROM vista_ventas_hoy 
                    WHERE DATE(fecha_venta) = $1
                    ORDER BY fecha_venta DESC
                `;
                values = [fecha];
            } else {
                query = `SELECT * FROM vista_ventas_hoy`;
            }
            
            const result = await pool.query(query, values);
            return result.rows;
        } catch (error) {
            console.error('Error obteniendo ventas del día:', error);
            throw error;
        }
    }

    // Buscar ventas por cliente (usa índice idx_ventas_cliente)
    static async ventasPorCliente(idCliente) {
        try {
            const query = `
                SELECT v.*, c.nombre_completo as cliente_nombre
                FROM ventas v
                JOIN clientes c ON v.id_cliente = c.id_cliente
                WHERE v.id_cliente = $1
                ORDER BY v.fecha_venta DESC
            `;
            const result = await pool.query(query, [idCliente]);
            return result.rows;
        } catch (error) {
            console.error('Error obteniendo ventas por cliente:', error);
            throw error;
        }
    }
}

// =================================================
// 5. FUNCIONES PARA LOTES (USA TRIGGERS AUTOMÁTICOS)
// =================================================

// Archivo: loteService.js
class LoteService {
    
    // Crear nuevo lote (trigger genera número automáticamente)
    static async crearLote(lote) {
        try {
            const query = `
                INSERT INTO lotes (
                    id_proveedor, fecha_recepcion, costo_envio, 
                    total_lote, observaciones, estado
                ) VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id_lote, numero_lote
            `;
            
            const values = [
                lote.proveedor, lote.fechaRecepcion, lote.costoEnvio,
                lote.totalLote, lote.observaciones, lote.estado || 'RECIBIDO'
            ];
            
            const result = await pool.query(query, values);
            return result.rows[0];
        } catch (error) {
            console.error('Error creando lote:', error);
            throw error;
        }
    }

    // Obtener lotes por proveedor (usa índice idx_lotes_proveedor)
    static async lotesPorProveedor(idProveedor) {
        try {
            const query = `
                SELECT l.*, p.nombre_proveedor
                FROM lotes l
                JOIN proveedores p ON l.id_proveedor = p.id_proveedor
                WHERE l.id_proveedor = $1
                ORDER BY l.fecha_recepcion DESC
            `;
            const result = await pool.query(query, [idProveedor]);
            return result.rows;
        } catch (error) {
            console.error('Error obteniendo lotes por proveedor:', error);
            throw error;
        }
    }
}