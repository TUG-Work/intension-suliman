import { createClient } from '@libsql/client';

export default async function handler(req, res) {
  try {
    const db = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    
    const result = await db.execute('SELECT 1 as test');
    res.json({ ok: true, result: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
}
