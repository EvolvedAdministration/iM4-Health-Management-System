// iM4 Health Management System - Frontend Application

const API_BASE = '/api';

let currentUser = null;
let companies = [];
let stewards = [];
let assignments = [];
let implementations = [];

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
});

// Check if user is logged in
function checkAuth() {
  const storedUser = localStorage.getItem('currentUser');
  if (storedUser) {
    currentUser = JSON.parse(storedUser);
    showDashboard();
  } else {
    showLoginPage();
  }
}

// Show login page
function showLoginPage() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="login-container">
      <div class="login-card">
        <h1>iM4 Health Management</h1>
        <p>Steward Portal</p>
        <form id="loginForm">
          <div class="form-group">
            <label for="email">Email Address</label>
            <input
              type="email"
              id="email"
              name="email"
              required
              placeholder="your.email@example.com"
            />
          </div>
          <button type="submit" class="btn btn-primary">Login</button>
          <div id="loginError" class="error-message" style="display: none;"></div>
        </form>
      </div>
    </div>
  `;

  document.getElementById('loginForm').addEventListener('submit', handleLogin);
}

// Handle login
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('email').value;
  const errorDiv = document.getElementById('loginError');
  errorDiv.style.display = 'none';

  try {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    if (!response.ok) {
      throw new Error('Invalid email or authentication failed');
    }

    const data = await response.json();
    currentUser = { email, id: data.id };
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    showDashboard();
  } catch (error) {
    errorDiv.textContent = error.message;
    errorDiv.style.display = 'block';
  }
}

// Show dashboard
async function showDashboard() {
  const app = document.getElementById('app');

  // Loading state
  app.innerHTML = `
    <div class="dashboard">
      <div class="navbar">
        <h1>iM4 Health Management</h1>
        <div class="nav-right">
          <span>Logged in as: ${currentUser.email}</span>
          <button class="btn btn-secondary" onclick="handleLogout()">Logout</button>
        </div>
      </div>
      <div class="container">
        <p style="text-align: center; margin-top: 2rem;">Loading data...</p>
      </div>
    </div>
  `;

  // Load all data
  try {
    await Promise.all([
      loadCompanies(),
      loadStewards(),
      loadAssignments(),
      loadImplementations()
    ]);

    renderDashboard();
  } catch (error) {
    console.error('Error loading data:', error);
    app.innerHTML = `
      <div class="dashboard">
        <div class="navbar">
          <h1>iM4 Health Management</h1>
          <button class="btn btn-secondary" onclick="handleLogout()">Logout</button>
        </div>
        <div class="container">
          <div class="error-message">Error loading data: ${error.message}</div>
          <button class="btn btn-primary" onclick="location.reload()">Retry</button>
        </div>
      </div>
    `;
  }
}

// Load companies from API
async function loadCompanies() {
  const response = await fetch(`${API_BASE}/companies`);
  if (!response.ok) throw new Error('Failed to load companies');
  companies = await response.json();
}

// Load stewards from API
async function loadStewards() {
  const response = await fetch(`${API_BASE}/stewards`);
  if (!response.ok) throw new Error('Failed to load stewards');
  stewards = await response.json();
}

// Load assignments from API
async function loadAssignments() {
  const response = await fetch(`${API_BASE}/assignments`);
  if (!response.ok) throw new Error('Failed to load assignments');
  assignments = await response.json();
}

// Load implementations from API
async function loadImplementations() {
  const response = await fetch(`${API_BASE}/implementations`);
  if (!response.ok) throw new Error('Failed to load implementations');
  implementations = await response.json();
}

// Render the dashboard
function renderDashboard() {
  const app = document.getElementById('app');

  app.innerHTML = `
    <div class="dashboard">
      <div class="navbar">
        <h1>iM4 Health Management</h1>
        <div class="nav-right">
          <span>Logged in as: ${currentUser.email}</span>
          <button class="btn btn-secondary" onclick="handleLogout()">Logout</button>
        </div>
      </div>

      <div class="container">
        <div class="tabs">
          <button class="tab-button active" onclick="switchTab('companies')">Companies</button>
          <button class="tab-button" onclick="switchTab('implementations')">Implementations</button>
          <button class="tab-button" onclick="switchTab('admin')">Admin</button>
        </div>

        <!-- Companies Tab -->
        <div id="companies-tab" class="tab-content active">
          <h2>Companies</h2>
          <div class="filter-bar">
            <label for="stewardFilter">Filter by Steward:</label>
            <select id="stewardFilter" onchange="filterBysteward()">
              <option value="">All Companies</option>
              ${stewards.map(s => `<option value="${s.email}">${s.name} (${s.email})</option>`).join('')}
            </select>
          </div>

          <div id="companiesTable" style="margin-top: 1rem;">
            ${renderCompaniesTable()}
          </div>
        </div>

        <!-- Implementations Tab -->
        <div id="implementations-tab" class="tab-content">
          <h2>Implementation Status</h2>
          <div id="implementationsTable" style="margin-top: 1rem;">
            ${renderImplementationsTable()}
          </div>
        </div>

        <!-- Admin Tab -->
        <div id="admin-tab" class="tab-content">
          <h2>Admin Panel</h2>
          <div style="margin-bottom: 2rem;">
            <h3>Add New Company</h3>
            <form id="addCompanyForm" onsubmit="handleAddCompany(event)">
              <div class="form-group">
                <label for="companyCode">Company Code</label>
                <input type="text" id="companyCode" required placeholder="e.g., 1001" />
              </div>
              <div class="form-group">
                <label for="companyName">Company Name</label>
                <input type="text" id="companyName" required placeholder="e.g., ACME Corporation" />
              </div>
              <button type="submit" class="btn btn-primary">Add Company</button>
              <div id="companyMessage" class="message"></div>
            </form>
          </div>

          <hr>

          <div style="margin-bottom: 2rem;">
            <h3>Add New Steward</h3>
            <form id="addStewardForm" onsubmit="handleAddSteward(event)">
              <div class="form-group">
                <label for="stewardName">Steward Name</label>
                <input type="text" id="stewardName" required placeholder="e.g., Bob Gardner" />
              </div>
              <div class="form-group">
                <label for="stewardEmail">Email Address</label>
                <input type="email" id="stewardEmail" required placeholder="e.g., bob@example.com" />
              </div>
              <button type="submit" class="btn btn-primary">Add Steward</button>
              <div id="stewardMessage" class="message"></div>
            </form>
          </div>

          <hr>

          <div>
            <h3>Create Assignment</h3>
            <form id="assignmentForm" onsubmit="handleCreateAssignment(event)">
              <div class="form-group">
                <label for="assignCompany">Company</label>
                <select id="assignCompany" required>
                  <option value="">Select a company...</option>
                  ${companies.map(c => `<option value="${c.id}">${c.company_name}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label for="assignSteward">Steward</label>
                <select id="assignSteward" required>
                  <option value="">Select a steward...</option>
                  ${stewards.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
                </select>
              </div>
              <button type="submit" class="btn btn-primary">Create Assignment</button>
              <div id="assignmentMessage" class="message"></div>
            </form>
          </div>
        </div>
      </div>
    </div>
  `;
}

// Render companies table
function renderCompaniesTable() {
  const selectedSteward = document.getElementById('stewardFilter')?.value || '';

  let filtered = companies;
  if (selectedSteward) {
    // Filter by assignments
    const assignedCompanyIds = assignments
      .filter(a => a.steward_email === selectedSteward)
      .map(a => a.company_id);
    filtered = companies.filter(c => assignedCompanyIds.includes(c.id));
  }

  if (filtered.length === 0) {
    return '<p>No companies found.</p>';
  }

  return `
    <table class="data-table">
      <thead>
        <tr>
          <th>Code</th>
          <th>Company Name</th>
          <th>Assigned Stewards</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map(company => {
          const companyAssignments = assignments.filter(a => a.company_id === company.id);
          const companyImpls = implementations.filter(i => i.company_id === company.id);
          const latestStatus = companyImpls.length > 0 ? companyImpls[0].stage : 'Not Started';

          return `
            <tr>
              <td>${company.company_code}</td>
              <td>${company.company_name}</td>
              <td>
                ${companyAssignments.length > 0
                  ? companyAssignments.map(a => `<span class="badge badge-info">${a.steward_name}</span>`).join('')
                  : '<span class="badge badge-neutral">Unassigned</span>'}
              </td>
              <td>
                <span class="badge badge-${getStatusClass(latestStatus)}">${latestStatus}</span>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

// Render implementations table
function renderImplementationsTable() {
  if (implementations.length === 0) {
    return '<p>No implementations found.</p>';
  }

  const stages = ['Onboarding', 'Initiation', 'Gathering', 'Implementation', 'Go Live', 'Complete'];

  return `
    <table class="data-table">
      <thead>
        <tr>
          <th>Company</th>
          <th>Current Stage</th>
          <th>Status</th>
          <th>Progress</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        ${implementations.map(impl => {
          const company = companies.find(c => c.id === impl.company_id);
          const stageIndex = stages.indexOf(impl.stage);
          const progress = ((stageIndex + 1) / stages.length) * 100;

          return `
            <tr>
              <td>${company?.company_name || 'Unknown'}</td>
              <td>
                <span class="badge badge-${getStatusClass(impl.stage)}">${impl.stage}</span>
              </td>
              <td>${impl.status || 'In Progress'}</td>
              <td>
                <div class="progress-bar">
                  <div class="progress-fill" style="width: ${progress}%"></div>
                </div>
              </td>
              <td>
                <button class="btn btn-small" onclick="showAdvanceStageModal(${impl.id}, '${impl.stage}')">Advance</button>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

// Get status class for badge styling
function getStatusClass(stage) {
  const classMap = {
    'Onboarding': 'primary',
    'Initiation': 'secondary',
    'Gathering': 'secondary',
    'Implementation': 'warning',
    'Go Live': 'success',
    'Complete': 'success'
  };
  return classMap[stage] || 'neutral';
}

// Switch tabs
function switchTab(tabName) {
  // Hide all tabs
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.classList.remove('active');
  });

  // Show selected tab
  const tabEl = document.getElementById(`${tabName}-tab`);
  if (tabEl) {
    tabEl.classList.add('active');
    event.target.classList.add('active');
  }
}

// Filter companies by steward
function filterBysteward() {
  const companiesTable = document.getElementById('companiesTable');
  companiesTable.innerHTML = renderCompaniesTable();
}

// Handle add company
async function handleAddCompany(e) {
  e.preventDefault();
  const code = document.getElementById('companyCode').value;
  const name = document.getElementById('companyName').value;
  const messageDiv = document.getElementById('companyMessage');

  try {
    const response = await fetch(`${API_BASE}/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_code: code, company_name: name })
    });

    if (!response.ok) throw new Error('Failed to add company');

    messageDiv.textContent = 'Company added successfully!';
    messageDiv.className = 'message success';
    document.getElementById('addCompanyForm').reset();

    // Reload companies
    await loadCompanies();
    renderDashboard();
  } catch (error) {
    messageDiv.textContent = 'Error: ' + error.message;
    messageDiv.className = 'message error';
  }
}

// Handle add steward
async function handleAddSteward(e) {
  e.preventDefault();
  const name = document.getElementById('stewardName').value;
  const email = document.getElementById('stewardEmail').value;
  const messageDiv = document.getElementById('stewardMessage');

  try {
    const response = await fetch(`${API_BASE}/stewards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email })
    });

    if (!response.ok) throw new Error('Failed to add steward');

    messageDiv.textContent = 'Steward added successfully!';
    messageDiv.className = 'message success';
    document.getElementById('addStewardForm').reset();

    // Reload stewards
    await loadStewards();
    renderDashboard();
  } catch (error) {
    messageDiv.textContent = 'Error: ' + error.message;
    messageDiv.className = 'message error';
  }
}

// Handle create assignment
async function handleCreateAssignment(e) {
  e.preventDefault();
  const companyId = document.getElementById('assignCompany').value;
  const stewardId = document.getElementById('assignSteward').value;
  const messageDiv = document.getElementById('assignmentMessage');

  try {
    const response = await fetch(`${API_BASE}/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: parseInt(companyId), steward_id: parseInt(stewardId) })
    });

    if (!response.ok) throw new Error('Failed to create assignment');

    messageDiv.textContent = 'Assignment created successfully!';
    messageDiv.className = 'message success';
    document.getElementById('assignmentForm').reset();

    // Reload assignments
    await loadAssignments();
    renderDashboard();
  } catch (error) {
    messageDiv.textContent = 'Error: ' + error.message;
    messageDiv.className = 'message error';
  }
}

// Show modal to advance stage
function showAdvanceStageModal(implId, currentStage) {
  const stages = ['Onboarding', 'Initiation', 'Gathering', 'Implementation', 'Go Live', 'Complete'];
  const currentIndex = stages.indexOf(currentStage);
  const nextStage = currentIndex < stages.length - 1 ? stages[currentIndex + 1] : 'Complete';

  const confirmed = confirm(`Advance ${currentStage} to ${nextStage}?`);
  if (confirmed) {
    updateImplementationStage(implId, nextStage);
  }
}

// Update implementation stage
async function updateImplementationStage(implId, newStage) {
  try {
    const response = await fetch(`${API_BASE}/implementations/${implId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: newStage, status: 'In Progress' })
    });

    if (!response.ok) throw new Error('Failed to update stage');

    // Reload implementations
    await loadImplementations();
    renderDashboard();
    switchTab('implementations');
  } catch (error) {
    alert('Error updating stage: ' + error.message);
  }
}

// Handle logout
function handleLogout() {
  localStorage.removeItem('currentUser');
  currentUser = null;
  companies = [];
  stewards = [];
  assignments = [];
  implementations = [];
  showLoginPage();
}
