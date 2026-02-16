import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { createClient } from '@libsql/client';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors({ origin: true, credentials: true }));

const JWT_SECRET = process.env.JWT_SECRET || 'change_me_in_production';
const FRONTEND_BASE_URL = process.env.VERCEL_URL 
  ? `https://${process.env.VERCEL_URL}` 
  : process.env.FRONTEND_BASE_URL || 'http://localhost:3000';

// Turso/LibSQL connection
const db = createClient({
  url: process.env.TURSO_DATABASE_URL?.trim(),
  authToken: process.env.TURSO_AUTH_TOKEN?.trim(),
});

// Initialize schema on first request
let schemaInitialized = false;
async function ensureSchema() {
  if (schemaInitialized) return;
  
  await db.execute(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, min_value INTEGER NOT NULL DEFAULT -5, max_value INTEGER NOT NULL DEFAULT 5, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS continuums (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, left_aim TEXT, right_aim TEXT, left_desc TEXT, right_desc TEXT, sort_order INTEGER NOT NULL DEFAULT 0, is_hidden INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS invites (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, email TEXT NOT NULL, token TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS participants (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, name TEXT NOT NULL, email TEXT, joined_at TEXT NOT NULL)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS votes (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, participant_id TEXT NOT NULL, continuum_id TEXT NOT NULL, value INTEGER NOT NULL, submitted_at TEXT NOT NULL, UNIQUE(session_id, participant_id, continuum_id))`);
  
  schemaInitialized = true;
}

const now = () => new Date().toISOString();

function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

// Middleware to ensure schema
app.use(async (req, res, next) => {
  try {
    await ensureSchema();
    next();
  } catch (err) {
    console.error('Schema init error:', err);
    res.status(500).json({ error: 'Database initialization failed' });
  }
});

// Health check
app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    
    const exists = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email] });
    if (exists.rows.length > 0) return res.status(409).json({ error: 'Email exists' });

    const id = nanoid();
    await db.execute({
      sql: 'INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
      args: [id, email, bcrypt.hashSync(password, 10), now()]
    });

    const token = jwt.sign({ id, email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const result = await db.execute({ sql: 'SELECT * FROM users WHERE email = ?', args: [email] });
    const user = result.rows[0];
    if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user.id, email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/projects', authRequired, async (req, res) => {
  try {
    const result = await db.execute('SELECT * FROM projects ORDER BY updated_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Get projects error:', err);
    res.status(500).json({ error: 'Failed to get projects' });
  }
});

app.post('/api/projects', authRequired, async (req, res) => {
  try {
    const { name, minValue = -5, maxValue = 5 } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });
    const id = nanoid();
    await db.execute({
      sql: 'INSERT INTO projects (id, name, min_value, max_value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: [id, name, minValue, maxValue, now(), now()]
    });
    const result = await db.execute({ sql: 'SELECT * FROM projects WHERE id = ?', args: [id] });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Create project error:', err);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

app.delete('/api/projects/:id', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    await db.execute({ sql: 'DELETE FROM votes WHERE session_id IN (SELECT id FROM sessions WHERE project_id = ?)', args: [id] });
    await db.execute({ sql: 'DELETE FROM participants WHERE session_id IN (SELECT id FROM sessions WHERE project_id = ?)', args: [id] });
    await db.execute({ sql: 'DELETE FROM invites WHERE session_id IN (SELECT id FROM sessions WHERE project_id = ?)', args: [id] });
    await db.execute({ sql: 'DELETE FROM sessions WHERE project_id = ?', args: [id] });
    await db.execute({ sql: 'DELETE FROM continuums WHERE project_id = ?', args: [id] });
    await db.execute({ sql: 'DELETE FROM projects WHERE id = ?', args: [id] });
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete project error:', err);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

app.get('/api/projects/:id/continuums', authRequired, async (req, res) => {
  try {
    const result = await db.execute({
      sql: 'SELECT * FROM continuums WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC',
      args: [req.params.id]
    });
    res.json(result.rows);
  } catch (err) {
    console.error('Get continuums error:', err);
    res.status(500).json({ error: 'Failed to get continuums' });
  }
});

app.post('/api/projects/:id/continuums', authRequired, async (req, res) => {
  try {
    const { title, leftAim = '', rightAim = '', leftDesc = '', rightDesc = '' } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title required' });
    
    const sortResult = await db.execute({
      sql: 'SELECT COALESCE(MAX(sort_order),0) as v FROM continuums WHERE project_id = ?',
      args: [req.params.id]
    });
    const sort = (sortResult.rows[0]?.v || 0) + 1;
    
    const id = nanoid();
    await db.execute({
      sql: `INSERT INTO continuums (id, project_id, title, left_aim, right_aim, left_desc, right_desc, sort_order, is_hidden, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      args: [id, req.params.id, title, leftAim, rightAim, leftDesc, rightDesc, sort, now(), now()]
    });
    const result = await db.execute({ sql: 'SELECT * FROM continuums WHERE id = ?', args: [id] });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Create continuum error:', err);
    res.status(500).json({ error: 'Failed to create continuum' });
  }
});

app.put('/api/continuums/:id', authRequired, async (req, res) => {
  try {
    const { title, leftAim, rightAim, leftDesc, rightDesc, isHidden } = req.body || {};
    const current = await db.execute({ sql: 'SELECT * FROM continuums WHERE id = ?', args: [req.params.id] });
    if (current.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const c = current.rows[0];
    
    await db.execute({
      sql: `UPDATE continuums SET title = ?, left_aim = ?, right_aim = ?, left_desc = ?, right_desc = ?, is_hidden = ?, updated_at = ? WHERE id = ?`,
      args: [title ?? c.title, leftAim ?? c.left_aim, rightAim ?? c.right_aim, leftDesc ?? c.left_desc, rightDesc ?? c.right_desc, typeof isHidden === 'boolean' ? (isHidden ? 1 : 0) : c.is_hidden, now(), req.params.id]
    });
    const result = await db.execute({ sql: 'SELECT * FROM continuums WHERE id = ?', args: [req.params.id] });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update continuum error:', err);
    res.status(500).json({ error: 'Failed to update continuum' });
  }
});

app.delete('/api/continuums/:id', authRequired, async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM votes WHERE continuum_id = ?', args: [req.params.id] });
    await db.execute({ sql: 'DELETE FROM continuums WHERE id = ?', args: [req.params.id] });
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete continuum error:', err);
    res.status(500).json({ error: 'Failed to delete continuum' });
  }
});

app.get('/api/projects/:id/sessions', authRequired, async (req, res) => {
  try {
    const result = await db.execute({ sql: 'SELECT * FROM sessions WHERE project_id = ? ORDER BY created_at DESC', args: [req.params.id] });
    res.json(result.rows);
  } catch (err) {
    console.error('Get sessions error:', err);
    res.status(500).json({ error: 'Failed to get sessions' });
  }
});

app.post('/api/projects/:id/sessions', authRequired, async (req, res) => {
  try {
    const { type } = req.body || {};
    if (!['baseline', 'comparison'].includes(type)) return res.status(400).json({ error: 'Invalid type' });
    const id = nanoid();
    await db.execute({
      sql: 'INSERT INTO sessions (id, project_id, type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: [id, req.params.id, type, 'open', now(), now()]
    });
    const result = await db.execute({ sql: 'SELECT * FROM sessions WHERE id = ?', args: [id] });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Create session error:', err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

app.put('/api/sessions/:id/status', authRequired, async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!['open', 'closed'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    await db.execute({ sql: 'UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?', args: [status, now(), req.params.id] });
    const result = await db.execute({ sql: 'SELECT * FROM sessions WHERE id = ?', args: [req.params.id] });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update session error:', err);
    res.status(500).json({ error: 'Failed to update session' });
  }
});

app.post('/api/sessions/:id/invite', authRequired, async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email required' });

    const token = nanoid(24);
    await db.execute({
      sql: 'INSERT INTO invites (id, session_id, email, token, created_at) VALUES (?, ?, ?, ?, ?)',
      args: [nanoid(), req.params.id, email, token, now()]
    });

    const inviteUrl = `${FRONTEND_BASE_URL}/participant.html?token=${token}`;
    res.json({ ok: true, inviteUrl, mailStatus: 'manual' });
  } catch (err) {
    console.error('Create invite error:', err);
    res.status(500).json({ error: 'Failed to create invite' });
  }
});

app.get('/api/sessions/:id/participants', authRequired, async (req, res) => {
  try {
    const result = await db.execute({ sql: 'SELECT * FROM participants WHERE session_id = ? ORDER BY joined_at ASC', args: [req.params.id] });
    res.json(result.rows);
  } catch (err) {
    console.error('Get participants error:', err);
    res.status(500).json({ error: 'Failed to get participants' });
  }
});

app.get('/api/public/invite/:token', async (req, res) => {
  try {
    const inviteResult = await db.execute({ sql: 'SELECT * FROM invites WHERE token = ?', args: [req.params.token] });
    const invite = inviteResult.rows[0];
    if (!invite) return res.status(404).json({ error: 'Invalid invite' });
    
    const sessionResult = await db.execute({ sql: 'SELECT * FROM sessions WHERE id = ?', args: [invite.session_id] });
    const session = sessionResult.rows[0];
    if (!session) return res.status(404).json({ error: 'Invalid session' });
    if (session.status !== 'open') return res.status(403).json({ error: 'Session is closed' });
    
    const projectResult = await db.execute({ sql: 'SELECT * FROM projects WHERE id = ?', args: [session.project_id] });
    const project = projectResult.rows[0];
    
    const continuumsResult = await db.execute({ sql: 'SELECT * FROM continuums WHERE project_id = ? AND is_hidden = 0 ORDER BY sort_order ASC', args: [project.id] });
    
    res.json({
      session: { id: session.id, type: session.type, status: session.status },
      project: { id: project.id, name: project.name, minValue: project.min_value, maxValue: project.max_value },
      continuums: continuumsResult.rows,
      inviteEmail: invite.email
    });
  } catch (err) {
    console.error('Get invite error:', err);
    res.status(500).json({ error: 'Failed to get invite' });
  }
});

app.post('/api/public/invite/:token/join', async (req, res) => {
  try {
    const { name, email } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });
    
    const inviteResult = await db.execute({ sql: 'SELECT * FROM invites WHERE token = ?', args: [req.params.token] });
    const invite = inviteResult.rows[0];
    if (!invite) return res.status(404).json({ error: 'Invalid invite' });
    
    const sessionResult = await db.execute({ sql: 'SELECT * FROM sessions WHERE id = ?', args: [invite.session_id] });
    const session = sessionResult.rows[0];
    if (!session || session.status !== 'open') return res.status(403).json({ error: 'Session closed' });

    const pid = nanoid();
    await db.execute({ sql: 'INSERT INTO participants (id, session_id, name, email, joined_at) VALUES (?, ?, ?, ?, ?)', args: [pid, session.id, name, email || null, now()] });
    res.json({ participantId: pid });
  } catch (err) {
    console.error('Join error:', err);
    res.status(500).json({ error: 'Failed to join' });
  }
});

app.post('/api/public/invite/:token/submit', async (req, res) => {
  try {
    const { participantId, votes } = req.body || {};
    if (!participantId || !Array.isArray(votes)) return res.status(400).json({ error: 'Invalid payload' });

    const inviteResult = await db.execute({ sql: 'SELECT * FROM invites WHERE token = ?', args: [req.params.token] });
    const invite = inviteResult.rows[0];
    if (!invite) return res.status(404).json({ error: 'Invalid invite' });
    
    const sessionResult = await db.execute({ sql: 'SELECT * FROM sessions WHERE id = ?', args: [invite.session_id] });
    const session = sessionResult.rows[0];
    if (!session || session.status !== 'open') return res.status(403).json({ error: 'Session closed' });

    const participantResult = await db.execute({ sql: 'SELECT * FROM participants WHERE id = ? AND session_id = ?', args: [participantId, session.id] });
    if (participantResult.rows.length === 0) return res.status(400).json({ error: 'Invalid participant' });

    const projectResult = await db.execute({ sql: 'SELECT * FROM projects WHERE id = ?', args: [session.project_id] });
    const project = projectResult.rows[0];

    for (const vote of votes) {
      const contResult = await db.execute({ sql: 'SELECT id FROM continuums WHERE id = ? AND project_id = ?', args: [vote.continuumId, session.project_id] });
      if (contResult.rows.length === 0) continue;
      
      const value = clamp(vote.value, project.min_value, project.max_value);
      const existingResult = await db.execute({ sql: 'SELECT id FROM votes WHERE session_id = ? AND participant_id = ? AND continuum_id = ?', args: [session.id, participantId, vote.continuumId] });
      
      if (existingResult.rows.length > 0) {
        await db.execute({ sql: 'UPDATE votes SET value = ?, submitted_at = ? WHERE id = ?', args: [value, now(), existingResult.rows[0].id] });
      } else {
        await db.execute({ sql: 'INSERT INTO votes (id, session_id, participant_id, continuum_id, value, submitted_at) VALUES (?, ?, ?, ?, ?, ?)', args: [nanoid(), session.id, participantId, vote.continuumId, value, now()] });
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Submit error:', err);
    res.status(500).json({ error: 'Failed to submit' });
  }
});

app.get('/api/sessions/:id/results', authRequired, async (req, res) => {
  try {
    const sessionResult = await db.execute({ sql: 'SELECT * FROM sessions WHERE id = ?', args: [req.params.id] });
    const session = sessionResult.rows[0];
    if (!session) return res.status(404).json({ error: 'Session not found' });
    
    const contsResult = await db.execute({ sql: 'SELECT * FROM continuums WHERE project_id = ? AND is_hidden = 0 ORDER BY sort_order ASC', args: [session.project_id] });
    const votesResult = await db.execute({ sql: 'SELECT * FROM votes WHERE session_id = ?', args: [session.id] });

    const results = contsResult.rows.map((c) => {
      const vals = votesResult.rows.filter((v) => v.continuum_id === c.id).map((v) => v.value);
      const avg = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : 0;
      return { continuumId: c.id, title: c.title, values: vals, count: vals.length, avg };
    });

    res.json({ sessionId: session.id, results });
  } catch (err) {
    console.error('Get results error:', err);
    res.status(500).json({ error: 'Failed to get results' });
  }
});

app.get('/api/sessions/:id/export.csv', authRequired, async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT v.submitted_at, p.name AS participant, p.email, c.title AS continuum, v.value FROM votes v JOIN participants p ON p.id = v.participant_id JOIN continuums c ON c.id = v.continuum_id WHERE v.session_id = ? ORDER BY v.submitted_at ASC`,
      args: [req.params.id]
    });

    const esc = (s) => { const t = String(s || ''); return /[\",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const lines = ['submitted_at,participant,email,continuum,value'];
    for (const r of result.rows) lines.push(`${r.submitted_at},${esc(r.participant)},${esc(r.email || '')},${esc(r.continuum)},${r.value}`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="session.csv"');
    res.send(lines.join('\n'));
  } catch (err) {
    console.error('Export CSV error:', err);
    res.status(500).json({ error: 'Failed to export CSV' });
  }
});

// Catch-all for debugging
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path, method: req.method });
});

export default app;
