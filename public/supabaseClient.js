import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;

function maskKey(k) {
  if (!k) return '';
  if (k.length <= 12) return '****';
  return k.slice(0, 6) + '...' + k.slice(-4);
}

let supabase = null;

if (!SUPABASE_URL) {
  console.warn('Supabase no configurado: falta SUPABASE_URL en el entorno.');
} else {
  // Preferir la service role key en entorno de servidor si está definida
  const keyToUse = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  if (!keyToUse) {
    console.warn('Supabase no configurado: falta SUPABASE_KEY o SUPABASE_SERVICE_ROLE_KEY en el entorno.');
  } else {
    // Persistir sesiones no deseado en backend
    supabase = createClient(SUPABASE_URL, keyToUse, { auth: { persistSession: false } });
    if (SUPABASE_SERVICE_ROLE_KEY) {
      console.log('Supabase cliente inicializado (service role):', maskKey(SUPABASE_SERVICE_ROLE_KEY));
    } else {
      console.log('Supabase cliente inicializado (anon):', maskKey(SUPABASE_ANON_KEY));
    }
  }
}

export default supabase;
