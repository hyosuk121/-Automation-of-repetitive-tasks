import pg from 'pg';
import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';

let pool;
export function databaseOptions(env = process.env) {
  if (!env.DATABASE_URL) throw Object.assign(new Error('Supabase 데이터베이스 연결이 설정되지 않았습니다.'), { status: 503 });
  const connection = new URL(env.DATABASE_URL);
  let ca;
  if (env.DATABASE_CA_CERT?.trim()) {
    ca = env.DATABASE_CA_CERT.replaceAll('\\n','\n').replaceAll('\r\n','\n').trim();
  } else if (env.DATABASE_CA_FILE) {
    ca = readFileSync(env.DATABASE_CA_FILE, 'utf8').trim();
  }
  if (ca !== undefined) {
    const pattern = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
    const certificates = ca.match(pattern);
    try {
      if (!certificates?.length || ca.replace(pattern,'').trim()) throw new Error('Invalid PEM');
      for (const certificate of certificates) {
        if (!new X509Certificate(certificate).ca) throw new Error('Not a CA certificate');
      }
    } catch {
      throw Object.assign(new Error('DB 인증서 형식이 올바르지 않습니다. DATABASE_CA_CERT에 Supabase에서 다운로드한 CA 인증서 전체를 입력해 주세요.'),{status:503});
    }
  }
  // pg connection-string SSL parameters override the ssl object. Apply the verified
  // policy explicitly so a copied provider URL cannot accidentally disable checks.
  for (const name of ['sslmode','sslcert','sslkey','sslrootcert','ssl','uselibpqcompat']) connection.searchParams.delete(name);
  return {
    connectionString: connection.toString(),
    max: 3,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 20000,
    ssl: {
      rejectUnauthorized: true,
      ...(ca ? { ca } : {})
    }
  };
}
export function db() {
  return pool ??= new pg.Pool(databaseOptions());
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
