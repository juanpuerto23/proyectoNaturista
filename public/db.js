import 'dotenv/config'; // Esto carga automáticamente el archivo .env
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, {
    ssl: 'require'
});
console.log("URL de conexión cargada:", process.env.DATABASE_URL);
export default sql;