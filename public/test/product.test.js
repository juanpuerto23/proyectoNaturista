import { jest } from '@jest/globals';
import request from 'supertest';

// Mock de la BD: intercepta consultas y devuelve datos simulados
jest.unstable_mockModule('../db.js', () => ({
  default: (strings, ...values) => {
    const sql = strings.join('?');
    if (/SELECT \* FROM productos/i.test(sql)) {
      return Promise.resolve([
        { id_producto: 1, nombre_producto: 'Producto Test', stock_actual: 10, precio_venta: 5000 }
      ]);
    }
    if (/SELECT id_producto, nombre_producto FROM productos/i.test(sql)) {
      return Promise.resolve([
        { id_producto: 1, nombre_producto: 'Producto Test' }
      ]);
    }
    // Inserción producto
    if (/INSERT INTO productos/i.test(sql)) {
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  }
}));

// Supabase deshabilitado en pruebas
jest.unstable_mockModule('../supabaseClient.js', () => ({ default: null }));

// Importar app después de los mocks
const { app } = await import('../server.js');

describe('Endpoints Productos', () => {
  test('GET /productos retorna lista simulada', async () => {
    const res = await request(app).get('/productos');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('nombre_producto', 'Producto Test');
  });

  test('GET /productos/ids retorna columnas y datos', async () => {
    const res = await request(app).get('/productos/ids');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('columns');
    expect(res.body.columns).toContain('id_producto');
    expect(res.body.data[0]).toHaveProperty('nombre_producto');
  });

  test('POST /productos inserta producto (mock)', async () => {
    const payload = {
      nombre_producto: 'Nuevo Producto',
      descripcion_producto: 'Desc',
      id_categoria: 1,
      id_proveedor: 1,
      stock_actual: 5,
      precio_venta: 2000,
      fecha_vencimiento: '2026-01-01'
    };
    const res = await request(app).post('/productos').send(payload);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });
});
