const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();

// Validate DATABASE_URL is set
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  process.exit(1);
}

// Middleware - CORS and JSON parsing must come before API routes
app.use(cors());
app.use(express.json());

// Initialize database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Query stewards table with case-insensitive email matching
    const query = 'SELECT id, email, name FROM stewards WHERE LOWER(email) = LOWER($1) LIMIT 1';
    const result = await pool.query(query, [email]);

    // Return error if user not found
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Extract user data
    const user = result.rows[0];

    // For now, accept any password (in production, hash and compare)
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

// IMPORTANT: API routes MUST come BEFORE static file serving
// Otherwise, express.static will intercept requests and return 404 for non-existent files

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// Fallback route for SPA - serve index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

module.exports = app;
