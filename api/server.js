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

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email } = req.body;

    // NOTE: the frontend login form sends email only (no password field),
    // so login is email-only for now. Real password authentication is
    // still TODO before production use.
    if (!email) {
      return res.status(400).json({ error: 'Email required' });
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


// GitHub kanban mirror: pulls cards from the im4health-implementation org's
// "iM4 Implementation" project board and mirrors them as companies +
// implementations. Cards with Status Hold/Dead are skipped. Protected by
// the SYNC_SECRET env var (send as x-sync-secret header).
async function fetchProjectItems() {
  const query = 'query($after: String) { organization(login: "im4health-implementation") { projectV2(number: 3) { items(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { id content { __typename ... on DraftIssue { title } ... on Issue { title } ... on PullRequest { title } } fieldValues(first: 20) { nodes { __typename ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2SingleSelectField { name } } } } } } } } } }';
  const all = [];
  let after = null;
  for (;;) {
    const resp = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.GITHUB_TOKEN,
        'Content-Type': 'application/json',
        'User-Agent': 'im4-sync'
      },
      body: JSON.stringify({ query: query, variables: { after: after } })
    });
    if (!resp.ok) throw new Error('GitHub API returned ' + resp.status);
    const data = await resp.json();
    if (data.errors) throw new Error('GitHub API: ' + data.errors[0].message);
    const items = data.data.organization.projectV2.items;
    for (const n of items.nodes) all.push(n);
    if (!items.pageInfo.hasNextPage) break;
    after = items.pageInfo.endCursor;
  }
  return all;
}

function slugify(name) {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return s || 'company';
}

app.post('/api/admin/sync-github', async (req, res) => {
  if (!process.env.SYNC_SECRET || req.headers['x-sync-secret'] !== process.env.SYNC_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!process.env.GITHUB_TOKEN) {
    return res.status(500).json({ error: 'GITHUB_TOKEN is not set' });
  }
  try {
    const db = getPool();
    await db.query('ALTER TABLE implementations ADD COLUMN IF NOT EXISTS github_item_id TEXT UNIQUE');
    await db.query('ALTER TABLE implementations ADD COLUMN IF NOT EXISTS card_title TEXT');
    await db.query('ALTER TABLE implementations ADD COLUMN IF NOT EXISTS payroll_provider TEXT');
    await db.query('ALTER TABLE implementations ADD COLUMN IF NOT EXISTS payroll_frequency TEXT');

    const items = await fetchProjectItems();
    let synced = 0;
    let skipped = 0;
    const activeIds = [];
    for (const item of items) {
      const fields = {};
      for (const v of item.fieldValues.nodes) {
        if (v.__typename === 'ProjectV2ItemFieldSingleSelectValue') fields[v.field.name] = v.name;
      }
      const status = fields['Status'] || '';
      if (status === 'Hold' || status === 'Dead') { skipped++; continue; }
      const fullTitle = (item.content && item.content.title) ? item.content.title : 'Untitled';
      const companyName = fullTitle.split(';')[0].trim() || 'Unnamed Company';
      const comp = await db.query(
        'INSERT INTO companies (company_code, company_name) VALUES ($1, $2) ON CONFLICT (company_code) DO UPDATE SET company_name = EXCLUDED.company_name RETURNING id',
        [slugify(companyName), companyName]
      );
      await db.query(
        'INSERT INTO implementations (company_id, stage, status, github_item_id, card_title, payroll_provider, payroll_frequency) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (github_item_id) DO UPDATE SET company_id = EXCLUDED.company_id, stage = EXCLUDED.stage, status = EXCLUDED.status, card_title = EXCLUDED.card_title, payroll_provider = EXCLUDED.payroll_provider, payroll_frequency = EXCLUDED.payroll_frequency',
        [comp.rows[0].id, status || 'No Status', fields['Priority'] || 'NORMAL', item.id, fullTitle, fields['Payroll Provider'] || null, fields['Payroll Frequency'] || null]
      );
      activeIds.push(item.id);
      synced++;
    }
    if (activeIds.length > 0) {
      await db.query('DELETE FROM implementations WHERE github_item_id IS NOT NULL AND NOT (github_item_id = ANY($1))', [activeIds]);
    }
    const compCount = await db.query('SELECT COUNT(*)::int AS c FROM companies');
    res.json({ success: true, synced: synced, skipped_hold_dead: skipped, companies: compCount.rows[0].c });
  } catch (error) {
    console.error('GitHub sync error:', error);
    res.status(500).json({ success: false, error: error.message });
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
