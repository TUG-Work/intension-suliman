import { createClient } from '@libsql/client';

export default async function handler(req, res) {
  try {
    const url = process.env.TURSO_DATABASE_URL;
    const token = process.env.TURSO_AUTH_TOKEN;
    
    // Debug: show URL details
    const urlDebug = {
      raw: url,
      length: url?.length,
      trimmed: url?.trim(),
      trimmedLength: url?.trim().length,
      charCodes: url ? [...url].slice(-5).map(c => c.charCodeAt(0)) : null
    };
    
    const db = createClient({
      url: url?.trim(),
      authToken: token?.trim(),
    });
    
    const result = await db.execute('SELECT 1 as test');
    res.json({ ok: true, result: result.rows, urlDebug });
  } catch (err) {
    res.status(500).json({ 
      error: err.message, 
      urlDebug: {
        raw: process.env.TURSO_DATABASE_URL,
        length: process.env.TURSO_DATABASE_URL?.length,
        lastChars: process.env.TURSO_DATABASE_URL?.slice(-10)
      }
    });
  }
}
