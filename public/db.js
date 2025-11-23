import 'dotenv/config';
import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL;
let sql;

if (!connectionString) {
    console.warn('[DB] DATABASE_URL no definido. Operaciones SQL locales deshabilitadas. Configure .env.');
    // Función proxy que lanza error claro si se intenta usar sin configurar
    sql = async function disabledSql() {
        throw new Error('DATABASE_URL no configurado: cree un archivo .env con DATABASE_URL=postgres://user:pass@host:port/db');
    };
    sql.__disabled = true;
} else {
    // Permite deshabilitar SSL en entornos locales: set DATABASE_SSL=disable
    const sslSetting = process.env.DATABASE_SSL === 'disable' ? false : (process.env.DATABASE_SSL || 'require');
    try {
        sql = postgres(connectionString, { ssl: sslSetting });
        console.log('[DB] Conexión inicializada. SSL =', sslSetting);
    } catch (err) {
        console.error('[DB] Error inicializando conexión Postgres:', err?.message || err);
        throw err;
    }
}

export default sql;