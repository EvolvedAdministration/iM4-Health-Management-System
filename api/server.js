const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());

// Lazy DB pool: created on first use, not at import time. The old code
// called process.exit(1) here when DATABASE_URL was missing, which
// crashes the Vercel serverless function on every cold start.
let pool = null;
function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
  }
  return pool;
}

// Health check (no database needed)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});


// TEMPORARY one-time database setup. Visit /api/admin/setup-db once in the
// browser, then this route gets removed. Safe to re-run: tables use IF NOT EXISTS.
app.get('/api/admin/setup-db', async (req, res) => {
  const statements = [
    'CREATE TABLE IF NOT EXISTS stewards (id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE)',
    'CREATE TABLE IF NOT EXISTS companies (id SERIAL PRIMARY KEY, company_code TEXT NOT NULL UNIQUE, company_name TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS assignments (id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id), steward_id INTEGER NOT NULL REFERENCES stewards(id))',
    "CREATE TABLE IF NOT EXISTS implementations (id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id), stage TEXT NOT NULL DEFAULT 'Onboarding', status TEXT NOT NULL DEFAULT 'Not Started')"
  ];
  try {
    const db = getPool();
    for (const sql of statements) {
      await db.query(sql);
    }
    const check = await db.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('stewards','companies','assignments','implementations') ORDER BY tablename"
    );
    res.json({ success: true, tables: check.rows.map((r) => r.tablename) });
  } catch (error) {
    console.error('Setup error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const query = 'SELECT id, email, name FROM stewards WHERE LOWER(email) = LOWER($1) LIMIT 1';
    const result = await getPool().query(query, [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // TODO: replace with a real password check (bcrypt) before production use.
    // Right now any password is accepted for a known email.
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Companies
app.get('/api/companies', async (req, res) => {
  try {
    const result = await getPool().query(
      'SELECT id, company_code, company_name FROM companies ORDER BY id'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Load companies error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/companies', async (req, res) => {
  try {
    const { company_code, company_name } = req.body;
    if (!company_code || !company_name) {
      return res.status(400).json({ error: 'company_code and company_name required' });
    }
    const result = await getPool().query(
      'INSERT INTO companies (company_code, company_name) VALUES ($1, $2) RETURNING id, company_code, company_name',
      [company_code, company_name]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Add company error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Stewards
app.get('/api/stewards', async (req, res) => {
  try {
    const result = await getPool().query(
      'SELECT id, name, email FROM stewards ORDER BY id'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Load stewards error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/stewards', async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'name and email required' });
    }
    const result = await getPool().query(
      'INSERT INTO stewards (name, email) VALUES ($1, $2) RETURNING id, name, email',
      [name, email]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Add steward error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Assignments
app.get('/api/assignments', async (req, res) => {
  try {
    const result = await getPool().query(
      'SELECT id, company_id, steward_id FROM assignments ORDER BY id'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Load assignments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/assignments', async (req, res) => {
  try {
    const { company_id, steward_id } = req.body;
    if (!company_id || !steward_id) {
      return res.status(400).json({ error: 'company_id and steward_id required' });
    }
    const result = await getPool().query(
      'INSERT INTO assignments (company_id, steward_id) VALUES ($1, $2) RETURNING id, company_id, steward_id',
      [company_id, steward_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create assignment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Implementations
app.get('/api/implementations', async (req, res) => {
  try {
    const result = await getPool().query(
      'SELECT id, company_id, stage, status FROM implementations ORDER BY id'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Load implementations error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/implementations/:id', async (req, res) => {
  try {
    const { stage, status } = req.body;
    const result = await getPool().query(
      'UPDATE implementations SET stage = COALESCE($1, stage), status = COALESCE($2, status) WHERE id = $3 RETURNING id, company_id, stage, status',
      [stage || null, status || null, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Implementation not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update implementation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Static files and SPA fallback. API routes are registered above,
// so they take priority over the static middleware.
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Local dev: `node api/server.js` starts listening. On Vercel the
// exported app is used as the serverless function handler instead,
// so listen() must NOT run there.
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log('iM4 Health Management System listening on port ' + port);
  });
}

module.exports = app;
