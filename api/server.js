const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running' });
});

// Get all companies
app.get('/api/companies', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM companies ORDER BY company_code');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching companies:', error);
    res.status(500).json({ error: 'Failed to fetch companies' });
  }
});

// Add a new company
app.post('/api/companies', async (req, res) => {
  try {
    const { company_code, company_name } = req.body;
    
    if (!company_code || !company_name) {
      return res.status(400).json({ error: 'Company code and name are required' });
    }

    const result = await pool.query(
      'INSERT INTO companies (company_code, company_name) VALUES ($1, $2) RETURNING *',
      [company_code, company_name]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error adding company:', error);
    res.status(500).json({ error: 'Failed to add company' });
  }
});

// Get all stewards
app.get('/api/stewards', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM stewards ORDER BY email');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching stewards:', error);
    res.status(500).json({ error: 'Failed to fetch stewards' });
  }
});

// Add a new steward
app.post('/api/stewards', async (req, res) => {
  try {
    const { name, email } = req.body;
    
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const result = await pool.query(
      'INSERT INTO stewards (name, email) VALUES ($1, $2) RETURNING *',
      [name, email]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error adding steward:', error);
    res.status(500).json({ error: 'Failed to add steward' });
  }
});

// Get all assignments
app.get('/api/assignments', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT a.*, c.company_name, s.name as steward_name FROM assignments a JOIN companies c ON a.company_id = c.id JOIN stewards s ON a.steward_id = s.id ORDER BY a.created_at DESC'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching assignments:', error);
    res.status(500).json({ error: 'Failed to fetch assignments' });
  }
});

// Create an assignment
app.post('/api/assignments', async (req, res) => {
  try {
    const { company_id, steward_id } = req.body;
    
    if (!company_id || !steward_id) {
      return res.status(400).json({ error: 'Company ID and steward ID are required' });
    }

    const result = await pool.query(
      'INSERT INTO assignments (company_id, steward_id) VALUES ($1, $2) RETURNING *',
      [company_id, steward_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating assignment:', error);
    res.status(500).json({ error: 'Failed to create assignment' });
  }
});

// Get all implementations
app.get('/api/implementations', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT i.*, c.company_name, s.name as steward_name FROM implementations i JOIN companies c ON i.company_id = c.id JOIN stewards s ON i.steward_id = s.id ORDER BY i.created_at DESC'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching implementations:', error);
    res.status(500).json({ error: 'Failed to fetch implementations' });
  }
});

// Add a new implementation
app.post('/api/implementations', async (req, res) => {
  try {
    const { company_id, steward_id, implementation_name } = req.body;
    
    if (!company_id || !steward_id || !implementation_name) {
      return res.status(400).json({ error: 'Company ID, steward ID, and implementation name are required' });
    }

    const result = await pool.query(
      'INSERT INTO implementations (company_id, steward_id, implementation_name, stage) VALUES ($1, $2, $3, $4) RETURNING *',
      [company_id, steward_id, implementation_name, 'Planning']
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error adding implementation:', error);
    res.status(500).json({ error: 'Failed to add implementation' });
  }
});

// Update implementation stage
app.put('/api/implementations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { stage } = req.body;

    if (!stage) {
      return res.status(400).json({ error: 'Stage is required' });
    }

    const result = await pool.query(
      'UPDATE implementations SET stage = $1 WHERE id = $2 RETURNING *',
      [stage, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Implementation not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating implementation:', error);
    res.status(500).json({ error: 'Failed to update implementation' });
  }
});

// Login endpoint - case-insensitive email matching
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const result = await pool.query(
      'SELECT * FROM stewards WHERE LOWER(email) = LOWER($1)',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    res.json({ 
      success: true, 
      steward: result.rows[0],
      email: result.rows[0].email 
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Serve the main app
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Catch-all for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

module.exports = app;
