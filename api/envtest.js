export default function handler(req, res) {
  res.json({
    TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL ? `${process.env.TURSO_DATABASE_URL.substring(0, 30)}...` : 'NOT SET',
    TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN ? 'SET (hidden)' : 'NOT SET',
    JWT_SECRET: process.env.JWT_SECRET ? 'SET (hidden)' : 'NOT SET',
    NODE_ENV: process.env.NODE_ENV || 'not set'
  });
}
