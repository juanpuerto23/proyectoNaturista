import { jest } from '@jest/globals';
import request from 'supertest';
import crypto from 'crypto';
import bcrypt from 'bcrypt';

// Mock de BD para /login, /clientes y conteos
jest.unstable_mockModule('../db.js', () => ({
  default: (strings, ...values) => {
    const sql = strings.join('?');
    // Selección usuario inexistente
    if (/FROM usuarios WHERE username/i.test(sql)) {
      return Promise.resolve([]);
    }
    // Conteo ventas del cliente para delete -> fuerza soft delete
    if (/SELECT COUNT\(1\)::int AS cnt FROM ventas WHERE id_cliente/i.test(sql)) {
      return Promise.resolve([{ cnt: 2 }]);
    }
    // UPDATE clientes SET activo = false
    if (/UPDATE clientes SET activo = false/i.test(sql)) {
      return Promise.resolve([{ id_cliente: 5 }]);
    }
    // DELETE FROM clientes (simular violación FK)
    if (/DELETE FROM clientes WHERE id_cliente/i.test(sql)) {
      const err = new Error('foreign key constraint');
      err.code = '23503';
      return Promise.reject(err);
    }
    return Promise.resolve([]);
  }
}));

// Supabase deshabilitado
jest.unstable_mockModule('../supabaseClient.js', () => ({ default: null }));

// Importar app y función de verificación tras mocks
const { app, verifyPasswordHash } = await import('../server.js');

describe('Login y Clientes', () => {
  test('POST /login con credenciales inválidas retorna 401', async () => {
    const res = await request(app).post('/login').send({ username: 'noexiste', password: 'x' });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  test('DELETE /clientes/:id realiza soft delete cuando hay ventas', async () => {
    const res = await request(app).delete('/clientes/5');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('softDeleted', true);
    expect(res.body).toHaveProperty('message');
  });
});

describe('verifyPasswordHash', () => {
  test('Verifica hash bcrypt válido', () => {
    const hash = bcrypt.hashSync('secreto', 10);
    expect(verifyPasswordHash(hash, 'secreto')).toBe(true);
    expect(verifyPasswordHash(hash, 'otro')).toBe(false);
  });

  test('Verifica hash pbkdf2_sha256 estilo Django', () => {
    // Generar hash similar a Django: pbkdf2_sha256$iterations$salt$hashbase64
    const password = 'clave123';
    const iterations = 260000;
    const salt = 'salsita';
    const derived = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
    const hashB64 = derived.toString('base64');
    const stored = `pbkdf2_sha256$${iterations}$${salt}$${hashB64}`;
    expect(verifyPasswordHash(stored, password)).toBe(true);
    expect(verifyPasswordHash(stored, 'mala')).toBe(false);
  });

  test('Fallback compara texto plano legacy', () => {
    expect(verifyPasswordHash('plainSecret', 'plainSecret')).toBe(true);
    expect(verifyPasswordHash('plainSecret', 'otro')).toBe(false);
  });
});
