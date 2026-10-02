const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

// Validate environment variables at startup
const requiredEnvVars = ['DATABASE_URL'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error(`❌ FATAL: Missing required environment variables: ${missingEnvVars.join(', ')}`);
  console.error('Please set these in your Vercel project settings under Environment Variables');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Middleware - Order is CRITICAL
app.use(cors());
app.use(express.json());

// IMPORTANT: API routes MUST come BEFORE static file serving
// Otherwise, static middleware will intercept and return 404 for non-existent files

// ============================================
// API ROUTES
// ============================================

// Health check endpoint (for monitoring)
app.get('/api/health', (req, res) => {
  console.log('[GET /api/health] Health check requested');
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: 'checking...'
  });
});

// Login endpoint - CASE INSENSITIVE EMAIL MATCHING
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email } = req.body;

    console.log(`[POST /api/auth/login] Login attempt for email: ${email}`);

    if (!email) {
      console.warn('[POST /api/auth/login] Missing email in request body');
      return res.status(400).json({ error: 'Email is required' });
    }

    // CASE-INSENSITIVE query using LOWER() function
    // Database stores emails in UPPERCASE (MCCARTYLEROY@GMAIL.COM)
    // User might enter lowercase (mccartyleroy@gmail.com)
    // LOWER() makes both sides lowercase for comparison
    const result = await pool.query(
      'SELECT id, email, name FROM stewards WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [email]
    );

    console.log(`[POST /api/auth/login] Query returned ${result.rows.length} row(s)`);

    if (result.rows.length === 0) {
      console.warn(`[POST /api/auth/login] No steward found for email: ${email}`);
      return res.status(401).json({ error: 'Invalid email' });
    }

    const steward = result.rows[0];
    console.log(`[POST /api/auth/login] ✅ Login successful for: ${steward.name} (${steward.email})`);

    res.json({
      success: true,
      steward: {
        id: steward.id,
        name: steward.name,
        email: steward.email
      }
    });

  } catch (error) {
    console.error('[POST /api/auth/login] Database error:', error.message);
    res.status(500).json({
      error: 'Server error',
      message: error.message
    });
  }
});

// Get all stewards
app.get('/api/stewards', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, email, name FROM stewards');
    res.json(result.rows);
  } catch (error) {
    console.error('[GET /api/stewards] Error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add new steward
app.post('/api/stewards', async (req, res) => {
  try {
    const { email, name } = req.body;

    if (!email || !name) {
      return res.status(400).json({ error: 'Email and name are required' });
    }

    const result = await pool.query(
      'INSERT INTO stewards (email, name) VALUES ($1, $2) RETURNING id, email, name',
      [email.toUpperCase(), name]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('[POST /api/stewards] Error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all companies
app.get('/api/companies', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM companies');
    res.json(result.rows);
  } catch (error) {
    console.error('[GET /api/companies] Error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add new company
app.post('/api/companies', async (req, res) => {
  try {
    const { code, name } = req.body;

    if (!code || !name) {
      return res.status(400).json({ error: 'Code and name are required' });
    }

    const result = await pool.query(
      'INSERT INTO companies (code, name) VALUES ($1, $2) RETURNING *',
      [code, name]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('[POST /api/companies] Error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all assignments
app.get('/api/assignments', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM assignments');
    res.json(result.rows);
  } catch (error) {
    console.error('[GET /api/assignments] Error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add new assignment
app.post('/api/assignments', async (req, res) => {
  try {
    const { company_id, steward_id } = req.body;

    if (!company_id || !steward_id) {
      return res.status(400).json({ error: 'Company ID and Steward ID are required' });
    }

    const result = await pool.query(
      'INSERT INTO assignments (company_id, steward_id) VALUES ($1, $2) RETURNING *',
      [company_id, steward_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('[POST /api/assignments] Error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all implementations
app.get('/api/implementations', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM implementations');
    res.json(result.rows);
  } catch (error) {
    console.error('[GET /api/implementations] Error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add new implementation
app.post('/api/implementations', async (req, res) => {
  try {
    const { assignment_id, status, date_started } = req.body;

    if (!assignment_id) {
      return res.status(400).json({ error: 'Assignment ID is required' });
    }

    const result = await pool.query(
      'INSERT INTO implementations (assignment_id, status, date_started) VALUES ($1, $2, $3) RETURNING *',
      [assignment_id, status || 'pending', date_started || new Date()]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('[POST /api/implementations] Error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update implementation
app.put('/api/implementations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, date_completed } = req.body;

    const result = await pool.query(
      'UPDATE implementations SET status = $1, date_completed = $2 WHERE id = $3 RETURNING *',
      [status, date_completed, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Implementation not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('[PUT /api/implementations/:id] Error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================
// STATIC FILE SERVING (must come AFTER API routes)
// ============================================

// For Vercel serverless, resolve the public directory correctly
const publicPath = path.join(__dirname, 'public');
console.log(`📁 Serving static files from: ${publicPath}`);

app.use(express.static(publicPath, {
  maxAge: '1h',
  etag: false
}));

// SPA fallback - serve index.html for all routes not handled above
app.get('*', (req, res) => {
  console.log(`[GET ${req.path}] Serving index.html (SPA fallback)`);
  res.sendFile(path.join(publicPath, 'index.html'));
});

// ============================================
// ERROR HANDLING
// ============================================

app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing database pool...');
  pool.end(() => {
    console.log('Database pool closed');
    process.exit(0);
  });
});

// ============================================
// EXPORT FOR VERCEL SERVERLESS
// ============================================

// CRITICAL: This is how Vercel's Node.js runtime invokes your app
module.exports = app;

// For local development only (ignored on Vercel)
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}
