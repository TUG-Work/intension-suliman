import express from 'express';

const app = express();

app.get('/api/expresstest', (req, res) => {
  res.json({ ok: true, express: true });
});

export default app;
