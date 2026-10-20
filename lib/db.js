import pg from 'pg';
import { readFileSync } from 'node:fs';

let pool;
export function db() {
  if (!process.env.DATABASE_URL) throw Object.assign(new Error('Supabase 데이터베이스 연결이 설정되지 않았습니다.'), { status: 503 });
  const connection = new URL(process.env.DATABASE_URL);
  // pg connection-string SSL parameters override the ssl object. Apply the verified
  // policy explicitly so a copied provider URL cannot accidentally disable checks.
  for (const name of ['sslmode','sslcert','sslkey','sslrootcert','ssl','uselibpqcompat']) connection.searchParams.delete(name);
  return pool ??= new pg.Pool({
    connectionString: connection.toString(),
    max: 3,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 20000,
    ssl: {
      rejectUnauthorized: true,
      ...(process.env.DATABASE_CA_FILE ? { ca: readFileSync(process.env.DATABASE_CA_FILE, 'utf8') } : {})
    }
  });
}
export async function transaction(database, fn) {
  const client = database.connect ? await database.connect() : database;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { if (client !== database) client.release(); }
}
