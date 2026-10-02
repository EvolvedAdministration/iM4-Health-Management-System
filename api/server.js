const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Middleware
app.use(cors());
app.use(express.json());
const path = require('path');
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// GET all companies, optionally filter by steward email
app.get('/api/companies', async (req, res) => {
  try {
    const { steward_email } = req.query;
    
    if (steward_email) {
      const query = `
        SELECT DISTINCT c.* FROM companies c
        JOIN assignments a ON c.id = a.company_id
        WHERE a.steward_email = $1
        ORDER BY c.company_name
      `;
      const result = await pool.query(query, [steward_email]);
      res.json(result.rows);
    } else {
      const result = await pool.query('SELECT * FROM companies ORDER BY company_name');
      res.json(result.rows);
    }
  } catch (error) {
    console.error('Error fetching companies:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST new company
app.post('/api/companies', async (req, res) => {
  try {
    const { company_code, company_name } = req.body;
    const result = await pool.query(
      'INSERT INTO companies (company_code, company_name) VALUES ($1, $2) RETURNING *',
      [company_code, company_name]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating company:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET all stewards
app.get('/api/stewards', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM stewards ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching stewards:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST new steward
app.post('/api/stewards', async (req, res) => {
  try {
    const { name, email } = req.body;
    const result = await pool.query(
      'INSERT INTO stewards (name, email) VALUES ($1, $2) RETURNING *',
      [name, email]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating steward:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET assignments with company and steward details
app.get('/api/assignments', async (req, res) => {
  try {
    const query = `
      SELECT a.*, c.company_name, s.name as steward_name, s.email as steward_email
      FROM assignments a
      JOIN companies c ON a.company_id = c.id
      JOIN stewards s ON a.steward_id = s.id
      ORDER BY c.company_name
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching assignments:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST new assignment
app.post('/api/assignments', async (req, res) => {
  try {
    const { company_id, steward_id } = req.body;
    const result = await pool.query(
      'INSERT INTO assignments (company_id, steward_id) VALUES ($1, $2) RETURNING *',
      [company_id, steward_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating assignment:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET implementations with optional company filter
app.get('/api/implementations', async (req, res) => {
  try {
    const { company_id } = req.query;
    
    if (company_id) {
      const query = 'SELECT * FROM implementations WHERE company_id = $1 ORDER BY created_at DESC';
      const result = await pool.query(query, [company_id]);
      res.json(result.rows);
    } else {
      const result = await pool.query('SELECT * FROM implementations ORDER BY created_at DESC');
      res.json(result.rows);
    }
  } catch (error) {
    console.error('Error fetching implementations:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST new implementation
app.post('/api/implementations', async (req, res) => {
  try {
    const { company_id, stage, status } = req.body;
    const result = await pool.query(
      'INSERT INTO implementations (company_id, stage, status) VALUES ($1, $2, $3) RETURNING *',
      [company_id, stage || 'Onboarding', status || 'In Progress']
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating implementation:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT update implementation stage
app.put('/api/implementations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { stage, status } = req.body;
    const result = await pool.query(
      'UPDATE implementations SET stage = $1, status = $2 WHERE id = $3 RETURNING *',
      [stage, status, id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating implementation:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST auth login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    const result = await pool.query(
      'SELECT * FROM stewards WHERE email = $1',
      [email]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Steward not found' });
    }
    
    const steward = result.rows[0];
    res.json({ id: steward.id, email: steward.email, name: steward.name });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
