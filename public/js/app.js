// iM4 Health Management System (Smart Hub) - v2 frontend
// Full-replacement SPA: hash routing, JWT auth, card UI.

(function () {
'use strict';

var STAGES = ['Data Gathering', 'Initiation', 'Onboarding IHIA', 'Implementation', 'Go Live', 'Complete'];

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDate(d) {
  if (!d) return '';
  var dt = new Date(d);
  return isNaN(dt.getTime()) ? '' : dt.toLocaleDateString();
}

function fmtDateTime(d) {
  if (!d) return '';
  var dt = new Date(d);
  return isNaN(dt.getTime()) ? '' : dt.toLocaleString();
}

function eligibleOf(c) {
  if (c.payroll_total === null || c.payroll_total === undefined) return null;
  var t = c.payroll_total || 0;
  return t - (c.payroll_ineligible || 0) - (c.payroll_opted_out || 0);
}

// ---------------------------------------------------------------- api
var api = {
  token: null,
  init: function () { this.token = localStorage.getItem('im4_token') || null; },
  setToken: function (t) {
    this.token = t;
    if (t) localStorage.setItem('im4_token', t); else localStorage.removeItem('im4_token');
  },
  call: function (method, url, body) {
    var self = this;
    var headers = { 'Content-Type': 'application/json' };
    if (self.token) headers['Authorization'] = 'Bearer ' + self.token;
    var opts = { method: method, headers: headers };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(url, opts).then(function (resp) {
      if (resp.status === 401 && self.token) {
        self.setToken(null);
        location.hash = '#/login';
        throw new Error('signed out');
      }
      return resp.json().then(function (data) {
        if (!resp.ok) throw new Error((data && data.error) || ('Request failed: ' + resp.status));
        return data;
      });
    });
  },
  get: function (url) { return this.call('GET', url); },
  post: function (url, body) { return this.call('POST', url, body); },
  put: function (url, body) { return this.call('PUT', url, body); },
  del: function (url) { return this.call('DELETE', url); }
};

var state = { user: null };

// ---------------------------------------------------------------- shell
function logoHtml(size) {
  size = size || 44;
  return '<span class="logo" style="height:' + size + 'px">' +
    '<svg width="' + size + '" height="' + size + '" viewBox="0 0 48 48" aria-hidden="true">' +
    '<rect x="2" y="2" width="44" height="44" rx="10" fill="#1a56db"/>' +
    '<text x="24" y="30" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="19" fill="#ffffff">iM4</text>' +
    '<rect x="10" y="35" width="28" height="4" rx="2" fill="#e02424"/>' +
    '<rect x="10" y="35" width="11" height="4" rx="2" fill="#f5b301"/>' +
    '</svg>' +
    '<span class="logo-text"><span class="logo-name">I AM 4 <b>HEALTH</b></span>' +
    '<span class="logo-sub">Management System</span></span></span>';
}

function shell(inner, active) {
  var u = state.user;
  var tabs = '';
  if (u) {
    tabs += navTab('#/clients', 'Clients', active === 'clients');
    tabs += navTab('#/implementations', 'Implementations', active === 'implementations');
    if (u.role === 'admin') {
      tabs += navTab('#/admin/stewards', 'Stewards', active === 'stewards');
      tabs += navTab('#/admin/companies', 'Companies', active === 'admin-companies');
      tabs += navTab('#/admin/assignments', 'Assignments', active === 'assignments');
      tabs += navTab('#/admin/import', 'Import', active === 'import');
    }
  }
  var userBox = u
    ? '<span class="user-email">' + esc(u.name || u.email) + ' <em>(' + esc(u.role) + ')</em></span>' +
      '<button class="btn btn-link" id="signout">Sign out</button>'
    : '';
  return '<header class="topbar">' + logoHtml(40) +
    '<nav class="tabs">' + tabs + '</nav>' +
    '<div class="userbox">' + userBox + '</div></header>' +
    '<main class="main">' + inner + '</main>';
}

function navTab(href, label, isActive) {
  return '<a class="tab' + (isActive ? ' active' : '') + '" href="' + href + '">' + label + '</a>';
}

function render(html) {
  document.getElementById('app').innerHTML = html;
  var so = document.getElementById('signout');
  if (so) so.onclick = function () { api.setToken(null); state.user = null; location.hash = '#/login'; };
  window.scrollTo(0, 0);
}

function errorHtml(msg) {
  return msg ? '<div class="alert alert-error">' + esc(msg) + '</div>' : '';
}

function okHtml(msg) {
  return msg ? '<div class="alert alert-ok">' + esc(msg) + '</div>' : '';
}

// ---------------------------------------------------------------- auth views
function viewLogin() {
  render('<div class="auth-wrap"><div class="auth-card">' + logoHtml(56) +
    '<h1>Sign in</h1><div id="err"></div>' +
    '<form id="f"><label>Email<input type="email" id="email" required autocomplete="username"></label>' +
    '<label>Password<input type="password" id="password" required autocomplete="current-password"></label>' +
    '<button class="btn btn-primary" type="submit">Sign in</button></form>' +
    '<p class="muted"><a href="#/forgot">Forgot your password?</a></p></div></div>');
  document.getElementById('f').onsubmit = function (e) {
    e.preventDefault();
    var email = document.getElementById('email').value;
    var password = document.getElementById('password').value;
    api.post('/api/auth/login', { email: email, password: password }).then(function (d) {
      api.setToken(d.token);
      state.user = d.user;
      location.hash = '#/clients';
    }).catch(function (err) {
      document.getElementById('err').innerHTML = errorHtml(err.message);
    });
  };
}

function viewForgot() {
  render('<div class="auth-wrap"><div class="auth-card">' + logoHtml(56) +
    '<h1>Reset password</h1><div id="msg"></div>' +
    '<form id="f"><label>Email<input type="email" id="email" required></label>' +
    '<button class="btn btn-primary" type="submit">Send reset link</button></form>' +
    '<p class="muted"><a href="#/login">Back to sign in</a></p></div></div>');
  document.getElementById('f').onsubmit = function (e) {
    e.preventDefault();
    api.post('/api/auth/forgot', { email: document.getElementById('email').value }).then(function (d) {
      document.getElementById('msg').innerHTML = okHtml(d.message);
    }).catch(function (err) {
      document.getElementById('msg').innerHTML = errorHtml(err.message);
    });
  };
}

function viewReset(token) {
  render('<div class="auth-wrap"><div class="auth-card">' + logoHtml(56) +
    '<h1>Set a new password</h1><div id="msg"></div>' +
    '<form id="f"><label>New password (8+ characters)<input type="password" id="pw" required minlength="8"></label>' +
    '<button class="btn btn-primary" type="submit">Set password</button></form></div></div>');
  document.getElementById('f').onsubmit = function (e) {
    e.preventDefault();
    api.post('/api/auth/reset', { token: token, password: document.getElementById('pw').value }).then(function () {
      document.getElementById('msg').innerHTML = okHtml('Password updated. <a href="#/login">Sign in</a>.');
      document.getElementById('f').style.display = 'none';
    }).catch(function (err) {
      document.getElementById('msg').innerHTML = errorHtml(err.message);
    });
  };
}

function requireUser(next) {
  if (!api.token) { location.hash = '#/login'; return; }
  if (state.user) { next(); return; }
  api.get('/api/me').then(function (u) { state.user = u; next(); })
    .catch(function () { location.hash = '#/login'; });
}

// ---------------------------------------------------------------- clients
function payrollLine(c) {
  var e = eligibleOf(c);
  var parts = [];
  if (c.payroll_enrolled !== null && c.payroll_enrolled !== undefined) parts.push('<span><b>' + c.payroll_enrolled + '</b> enrolled</span>');
  if (e !== null) parts.push('<span><b>' + e + '</b> eligible</span>');
  if (c.payroll_total !== null && c.payroll_total !== undefined) parts.push('<span><b>' + c.payroll_total + '</b> total</span>');
  if (parts.length === 0) return '<span class="muted">No payroll data yet</span>';
  return parts.join(' ');
}

function statusBadge(status) {
  var cls = 'badge';
  if (status === 'RUSH') cls += ' badge-rush';
  return '<span class="' + cls + '">' + esc(status || '') + '</span>';
}

function viewClients() {
  requireUser(function () {
    api.get('/api/clients').then(function (list) {
      var cards = list.map(function (c) {
        return '<a class="card" href="#/clients/' + c.id + '">' +
          '<div class="card-code">' + esc(c.company_code) + '</div>' +
          '<div class="card-title">' + esc(c.company_name) + '</div>' +
          '<div class="card-meta">' + statusBadge(c.status) +
          (c.stage ? ' <span class="muted">' + esc(c.stage) + '</span>' : '') + '</div>' +
          '<div class="card-numbers">' + payrollLine(c) + '</div></a>';
      }).join('');
      render(shell(
        '<h2>Clients</h2>' +
        (list.length === 0
          ? '<p class="muted">No clients assigned to you yet. Ask your administrator to assign companies to your account.</p>'
          : '<div class="card-grid">' + cards + '</div>'),
        'clients'));
    }).catch(function (err) { render(shell(errorHtml(err.message), 'clients')); });
  });
}

function viewClientDetail(id) {
  requireUser(function () {
    api.get('/api/clients/' + id).then(function (d) {
      var c = d.company;
      var implCards = d.implementations.map(function (i) {
        return '<a class="card" href="#/project/' + i.id + '">' +
          '<div class="card-title">' + esc(i.card_title || c.company_name) + '</div>' +
          '<div class="card-meta">' + statusBadge(i.status) + ' <span class="muted">' + esc(i.stage || '') + '</span></div>' +
          '<div class="card-numbers">' + payrollLine(c) + '</div>' +
          (i.message_count ? '<div class="muted">' + i.message_count + ' messages</div>' : '') + '</a>';
      }).join('');
      var stewardList = d.stewards.map(function (s) { return esc(s.name || s.email); }).join(', ');
      render(shell(
        '<p><a href="#/clients">&larr; Clients</a></p>' +
        '<h2><span class="code-chip">' + esc(c.company_code) + '</span> ' + esc(c.company_name) + '</h2>' +
        (stewardList ? '<p class="muted">Stewards: ' + stewardList + '</p>' : '') +
        (implCards ? '<div class="card-grid">' + implCards + '</div>' : '<p class="muted">No implementations for this client yet.</p>'),
        'clients'));
    }).catch(function (err) { render(shell(errorHtml(err.message), 'clients')); });
  });
}

// ---------------------------------------------------------------- implementations
function viewImplementations() {
  requireUser(function () {
    api.get('/api/implementations').then(function (list) {
      var groups = {};
      list.forEach(function (i) {
        var s = i.status || 'No status';
        if (!groups[s]) groups[s] = [];
        groups[s].push(i);
      });
      var html = '<h2>Implementations</h2>';
      var names = Object.keys(groups).sort();
      if (names.length === 0) html += '<p class="muted">No implementations assigned to you yet.</p>';
      names.forEach(function (s) {
        html += '<h3 class="group-title">' + esc(s) + ' <span class="muted">(' + groups[s].length + ')</span></h3><div class="card-grid">';
        groups[s].forEach(function (i) {
          html += '<a class="card" href="#/project/' + i.id + '">' +
            '<div class="card-code">' + esc(i.company_code) + '</div>' +
            '<div class="card-title">' + esc(i.company_name) + '</div>' +
            '<div class="card-meta"><span class="muted">' + esc(i.stage || '') + '</span>' +
            (i.days_in_stage !== null ? ' &middot; ' + i.days_in_stage + ' days in stage' : '') + '</div>' +
            (i.latest_summary ? '<div class="card-summary">' + esc(i.latest_summary.slice(0, 140)) + '&hellip;</div>' : '') +
            '</a>';
        });
        html += '</div>';
      });
      render(shell(html, 'implementations'));
    }).catch(function (err) { render(shell(errorHtml(err.message), 'implementations')); });
  });
}

// ---------------------------------------------------------------- project view
function stageVisual(current) {
  var idx = STAGES.indexOf(current);
  var html = '<div class="pipeline">';
  STAGES.forEach(function (s, i) {
    var cls = 'pipe-step';
    if (i < idx) cls += ' done';
    if (i === idx) cls += ' current';
    html += '<div class="' + cls + '"><span class="pipe-dot"></span><span class="pipe-label">' + esc(s) + '</span></div>';
  });
  html += '</div>';
  if (idx === -1 && current) html += '<p class="muted">Stage: ' + esc(current) + '</p>';
  return html;
}

function payrollTable(c) {
  function row(label, v) {
    return '<tr><td>' + label + '</td><td><b>' + (v === null || v === undefined ? '&mdash;' : esc(v)) + '</b></td></tr>';
  }
  return '<table class="data-table"><tbody>' +
    row('Total employees', c.payroll_total) +
    row('Ineligible', c.payroll_ineligible) +
    row('Opted out', c.payroll_opted_out) +
    row('Eligible', eligibleOf(c)) +
    row('Enrolled', c.payroll_enrolled) +
    row('Not enrolled', c.payroll_not_enrolled) +
    row('New qualified', c.payroll_new_qualified) +
    '</tbody></table>' +
    (c.payroll_dataset_date ? '<p class="muted">Last payroll data: ' + fmtDate(c.payroll_dataset_date) + '</p>' : '');
}

function viewProject(id) {
  requireUser(function () {
    api.get('/api/implementations/' + id).then(function (d) {
      var i = d.implementation;
      var msgs = d.messages.map(function (m) {
        var out = m.direction === 'out';
        return '<div class="msg' + (out ? ' msg-out' : '') + '">' +
          '<div class="msg-head"><b>' + esc(m.author_name || m.author_login || 'unknown') + '</b>' +
          (m.steward_name && out ? ' <span class="muted">(' + esc(m.steward_name) + ')</span>' : '') +
          ' <span class="muted">' + fmtDateTime(m.github_created_at || m.created_at) + '</span></div>' +
          '<div class="msg-body">' + esc(m.body) + '</div></div>';
      }).join('');
      var sums = d.summaries.map(function (s) {
        return '<div class="summary"><div class="muted">Summary &middot; ' + fmtDate(s.summary_date) + '</div>' +
          '<div class="summary-body">' + esc(s.body) + '</div></div>';
      }).join('');
      render(shell(
        '<p><a href="#/implementations">&larr; Implementations</a></p>' +
        '<h2><span class="code-chip">' + esc(i.company_code) + '</span> ' + esc(i.company_name) + '</h2>' +
        '<div class="proj-grid"><div>' +
        '<h3>Stage</h3>' + stageVisual(i.stage) +
        '<p>' + statusBadge(i.status) +
        (i.days_in_stage !== null ? ' <span class="muted">' + i.days_in_stage + ' days in this stage</span>' : '') + '</p>' +
        (i.card_title ? '<p class="muted">' + esc(i.card_title) + '</p>' : '') +
        '<h3>Latest payroll</h3>' + payrollTable(i) +
        (sums ? '<h3>Project summaries</h3>' + sums : '<h3>Project summaries</h3><p class="muted">No summaries yet.</p>') +
        '</div><div>' +
        '<h3>Messages</h3><div id="msglist">' +
        (msgs || '<p class="muted">No messages yet. Start the conversation below.</p>') +
        '</div><div id="merr"></div>' +
        '<form id="mform"><label>Post a message (goes to the GitHub card too)<textarea id="mbody" rows="3" required></textarea></label>' +
        '<button class="btn btn-primary" type="submit">Send message</button></form>' +
        '</div></div>',
        'implementations'));
      document.getElementById('mform').onsubmit = function (e) {
        e.preventDefault();
        var body = document.getElementById('mbody').value;
        api.post('/api/implementations/' + id + '/messages', { body: body }).then(function () {
          viewProject(id);
        }).catch(function (err) {
          document.getElementById('merr').innerHTML = errorHtml(err.message);
        });
      };
    }).catch(function (err) { render(shell(errorHtml(err.message), 'implementations')); });
  });
}

// ---------------------------------------------------------------- admin: stewards
function viewAdminStewards() {
  requireUser(function () {
    if (state.user.role !== 'admin') { location.hash = '#/clients'; return; }
    api.get('/api/admin/stewards').then(function (list) {
      var rows = list.map(function (s) {
        return '<tr><td>' + esc(s.name || '') + '</td><td>' + esc(s.email) + '</td>' +
          '<td>' + esc(s.role) + '</td><td class="row-actions">' +
          '<button class="btn btn-small" data-edit="' + s.id + '">Edit</button> ' +
          '<button class="btn btn-small btn-danger" data-del="' + s.id + '">Delete</button></td></tr>';
      }).join('');
      render(shell(
        '<h2>Stewards</h2><div id="msg"></div>' +
        '<h3>Add a person</h3><form id="addf" class="form-inline">' +
        '<input id="f-name" placeholder="Name" required> ' +
        '<input id="f-email" type="email" placeholder="Email" required> ' +
        '<input id="f-pw" type="password" placeholder="Password (8+ chars)" required minlength="8"> ' +
        '<select id="f-role"><option value="steward">Steward</option><option value="admin">Admin</option></select> ' +
        '<button class="btn btn-primary" type="submit">Add</button></form>' +
        '<table class="data-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>' +
        '<div id="editbox"></div>',
        'stewards'));
      document.getElementById('addf').onsubmit = function (e) {
        e.preventDefault();
        api.post('/api/admin/stewards', {
          name: document.getElementById('f-name').value,
          email: document.getElementById('f-email').value,
          password: document.getElementById('f-pw').value,
          role: document.getElementById('f-role').value
        }).then(function () { viewAdminStewards(); })
          .catch(function (err) { document.getElementById('msg').innerHTML = errorHtml(err.message); });
      };
      bindRowButtons('stewards');
    }).catch(function (err) { render(shell(errorHtml(err.message), 'stewards')); });
  });
}

function bindRowButtons(kind) {
  var btns = document.querySelectorAll('[data-del]');
  for (var i = 0; i < btns.length; i++) {
    (function (b) {
      b.onclick = function () {
        if (!confirm('Delete this record?')) return;
        var url = kind === 'stewards' ? '/api/admin/stewards/' + b.getAttribute('data-del')
          : kind === 'companies' ? '/api/admin/companies/' + b.getAttribute('data-del')
          : '/api/admin/assignments/' + b.getAttribute('data-del');
        api.del(url).then(function () {
          if (kind === 'stewards') viewAdminStewards();
          else if (kind === 'companies') viewAdminCompanies();
          else viewAdminAssignments();
        }).catch(function (err) { document.getElementById('msg').innerHTML = errorHtml(err.message); });
      };
    })(btns[i]);
  }
  var edits = document.querySelectorAll('[data-edit]');
  for (var j = 0; j < edits.length; j++) {
    (function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-edit');
        if (kind === 'stewards') editSteward(id); else editCompany(id);
      };
    })(edits[j]);
  }
}

function editSteward(id) {
  api.get('/api/admin/stewards').then(function (list) {
    var s = null;
    list.forEach(function (x) { if (String(x.id) === String(id)) s = x; });
    if (!s) return;
    document.getElementById('editbox').innerHTML =
      '<h3>Edit person</h3><form id="ef" class="form-inline">' +
      '<input id="e-name" value="' + esc(s.name || '') + '" placeholder="Name"> ' +
      '<input id="e-email" type="email" value="' + esc(s.email) + '" placeholder="Email"> ' +
      '<select id="e-role"><option value="steward"' + (s.role === 'steward' ? ' selected' : '') + '>Steward</option>' +
      '<option value="admin"' + (s.role === 'admin' ? ' selected' : '') + '>Admin</option></select> ' +
      '<input id="e-pw" type="password" placeholder="New password (leave blank to keep)"> ' +
      '<button class="btn btn-primary" type="submit">Save</button></form><div id="emsg"></div>';
    document.getElementById('ef').onsubmit = function (e) {
      e.preventDefault();
      var body = { name: document.getElementById('e-name').value, email: document.getElementById('e-email').value, role: document.getElementById('e-role').value };
      var pw = document.getElementById('e-pw').value;
      if (pw) body.password = pw;
      api.put('/api/admin/stewards/' + id, body).then(function () { viewAdminStewards(); })
        .catch(function (err) { document.getElementById('emsg').innerHTML = errorHtml(err.message); });
    };
  });
}

// ---------------------------------------------------------------- admin: companies
function viewAdminCompanies() {
  requireUser(function () {
    if (state.user.role !== 'admin') { location.hash = '#/clients'; return; }
    api.get('/api/admin/companies').then(function (list) {
      var rows = list.map(function (c) {
        return '<tr><td><b>' + esc(c.company_code) + '</b></td><td>' + esc(c.company_name) + '</td>' +
          '<td>' + (c.payroll_enrolled === null || c.payroll_enrolled === undefined ? '&mdash;' : esc(c.payroll_enrolled)) + '</td>' +
          '<td>' + c.steward_count + '</td><td class="row-actions">' +
          '<button class="btn btn-small" data-edit="' + c.id + '">Edit</button> ' +
          '<button class="btn btn-small btn-danger" data-del="' + c.id + '">Delete</button></td></tr>';
      }).join('');
      render(shell(
        '<h2>Companies</h2><div id="msg"></div>' +
        '<h3>Add a company</h3><form id="addf" class="form-grid">' +
        '<input id="f-code" placeholder="Company code (4-digit)" required> ' +
        '<input id="f-name" placeholder="Company name" required> ' +
        '<input id="f-total" type="number" placeholder="Total employees"> ' +
        '<input id="f-enrolled" type="number" placeholder="Enrolled"> ' +
        '<button class="btn btn-primary" type="submit">Add</button></form>' +
        '<table class="data-table"><thead><tr><th>Code</th><th>Name</th><th>Enrolled</th><th>Stewards</th><th></th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table><div id="editbox"></div>',
        'admin-companies'));
      document.getElementById('addf').onsubmit = function (e) {
        e.preventDefault();
        api.post('/api/admin/companies', {
          company_code: document.getElementById('f-code').value,
          company_name: document.getElementById('f-name').value,
          payroll_total: document.getElementById('f-total').value,
          payroll_enrolled: document.getElementById('f-enrolled').value
        }).then(function () { viewAdminCompanies(); })
          .catch(function (err) { document.getElementById('msg').innerHTML = errorHtml(err.message); });
      };
      bindRowButtons('companies');
    }).catch(function (err) { render(shell(errorHtml(err.message), 'admin-companies')); });
  });
}

function editCompany(id) {
  api.get('/api/admin/companies').then(function (list) {
    var c = null;
    list.forEach(function (x) { if (String(x.id) === String(id)) c = x; });
    if (!c) return;
    function fld(fid, label, val) {
      return '<label>' + label + '<input id="' + fid + '" type="number" value="' + esc(val === null || val === undefined ? '' : val) + '"></label>';
    }
    document.getElementById('editbox').innerHTML =
      '<h3>Edit company</h3><form id="ef" class="form-grid">' +
      '<label>Company code<input id="e-code" value="' + esc(c.company_code) + '"></label>' +
      '<label>Company name<input id="e-name" value="' + esc(c.company_name) + '"></label>' +
      fld('e-total', 'Total employees', c.payroll_total) +
      fld('e-inel', 'Ineligible', c.payroll_ineligible) +
      fld('e-opt', 'Opted out', c.payroll_opted_out) +
      fld('e-enr', 'Enrolled', c.payroll_enrolled) +
      fld('e-notenr', 'Not enrolled', c.payroll_not_enrolled) +
      fld('e-newq', 'New qualified', c.payroll_new_qualified) +
      '<label>Dataset date<input id="e-date" type="date" value="' + esc(c.payroll_dataset_date || '') + '"></label>' +
      '<button class="btn btn-primary" type="submit">Save</button></form><div id="emsg"></div>';
    document.getElementById('ef').onsubmit = function (e) {
      e.preventDefault();
      function gv(fid) { return document.getElementById(fid).value; }
      api.put('/api/admin/companies/' + id, {
        company_code: gv('e-code'), company_name: gv('e-name'),
        payroll_total: gv('e-total'), payroll_ineligible: gv('e-inel'), payroll_opted_out: gv('e-opt'),
        payroll_enrolled: gv('e-enr'), payroll_not_enrolled: gv('e-notenr'),
        payroll_new_qualified: gv('e-newq'), payroll_dataset_date: gv('e-date') || null
      }).then(function () { viewAdminCompanies(); })
        .catch(function (err) { document.getElementById('emsg').innerHTML = errorHtml(err.message); });
    };
  });
}

// ---------------------------------------------------------------- admin: assignments
function viewAdminAssignments() {
  requireUser(function () {
    if (state.user.role !== 'admin') { location.hash = '#/clients'; return; }
    Promise.all([api.get('/api/admin/assignments'), api.get('/api/admin/stewards'), api.get('/api/admin/companies')])
      .then(function (all) {
        var list = all[0], stewards = all[1], companies = all[2];
        var sOpts = stewards.map(function (s) { return '<option value="' + s.id + '">' + esc((s.name || s.email) + ' (' + s.role + ')') + '</option>'; }).join('');
        var cOpts = companies.map(function (c) { return '<option value="' + c.id + '">' + esc(c.company_code + ' - ' + c.company_name) + '</option>'; }).join('');
        var rows = list.map(function (a) {
          return '<tr><td>' + esc(a.steward_name || a.steward_email) + '</td>' +
            '<td>' + esc(a.company_code + ' - ' + a.company_name) + '</td>' +
            '<td class="row-actions"><button class="btn btn-small btn-danger" data-del="' + a.id + '">Remove</button></td></tr>';
        }).join('');
        render(shell(
          '<h2>Assignments</h2><div id="msg"></div>' +
          '<h3>Assign a steward to a company</h3><form id="addf" class="form-inline">' +
          '<select id="f-s">' + sOpts + '</select> <select id="f-c">' + cOpts + '</select> ' +
          '<button class="btn btn-primary" type="submit">Assign</button></form>' +
          '<table class="data-table"><thead><tr><th>Steward</th><th>Company</th><th></th></tr></thead>' +
          '<tbody>' + rows + '</tbody></table>',
          'assignments'));
        document.getElementById('addf').onsubmit = function (e) {
          e.preventDefault();
          api.post('/api/admin/assignments', {
            steward_id: document.getElementById('f-s').value,
            company_id: document.getElementById('f-c').value
          }).then(function () { viewAdminAssignments(); })
            .catch(function (err) { document.getElementById('msg').innerHTML = errorHtml(err.message); });
        };
        bindRowButtons('assignments');
      }).catch(function (err) { render(shell(errorHtml(err.message), 'assignments')); });
  });
}

// ---------------------------------------------------------------- admin: import
function parseCSV(text) {
  var lines = String(text).split(String.fromCharCode(10));
  var rows = [];
  var headers = null;
  lines.forEach(function (line) {
    if (!line.trim()) return;
    var cells = [];
    var cur = '';
    var inQ = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { cells.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur.trim());
    if (!headers) headers = cells;
    else {
      var obj = {};
      headers.forEach(function (h, idx) { obj[h] = cells[idx] !== undefined ? cells[idx] : ''; });
      rows.push(obj);
    }
  });
  return rows;
}

function viewAdminImport() {
  requireUser(function () {
    if (state.user.role !== 'admin') { location.hash = '#/clients'; return; }
    render(shell(
      '<h2>Import</h2><div id="msg"></div>' +
      '<p class="muted">Step 1: choose a type and paste CSV (first row = headers). Step 2: review validation, then confirm.</p>' +
      '<div class="form-inline"><select id="itype">' +
      '<option value="stewards">Stewards (email, name)</option>' +
      '<option value="companies">Companies (company_code, company_name, payroll_total, payroll_ineligible, payroll_opted_out, payroll_enrolled, payroll_not_enrolled, payroll_new_qualified, payroll_dataset_date)</option>' +
      '<option value="assignments">Assignments (steward_email, company_code)</option>' +
      '</select> <button class="btn btn-primary" id="validate">Validate</button></div>' +
      '<textarea id="csv" rows="10" class="csvbox" placeholder="email,name&#10;jane@example.com,Jane Doe"></textarea>' +
      '<div id="preview"></div>',
      'import'));
    document.getElementById('validate').onclick = function () {
      var type = document.getElementById('itype').value;
      var rows = parseCSV(document.getElementById('csv').value);
      if (rows.length === 0) { document.getElementById('msg').innerHTML = errorHtml('No data rows found.'); return; }
      api.post('/api/admin/import', { type: type, rows: rows, dry_run: true }).then(function (d) {
        var html = '<h3>Validation</h3>' + okHtml(d.valid_count + ' valid rows.') +
          (d.errors.length ? errorHtml(d.errors.join('<br>')) : '') +
          (d.errors.length === 0 ? '<button class="btn btn-primary" id="confirm">Confirm import of ' + d.valid_count + ' rows</button>' : '<p class="muted">Fix the errors above and validate again.</p>');
        document.getElementById('preview').innerHTML = html;
        var cb = document.getElementById('confirm');
        if (cb) cb.onclick = function () {
          api.post('/api/admin/import', { type: type, rows: rows, dry_run: false }).then(function (r) {
            document.getElementById('preview').innerHTML = '<h3>Done</h3>' + okHtml('Imported ' + r.imported + ' rows.') +
              (r.errors.length ? errorHtml(r.errors.join('<br>')) : '');
          }).catch(function (err) { document.getElementById('msg').innerHTML = errorHtml(err.message); });
        };
      }).catch(function (err) { document.getElementById('msg').innerHTML = errorHtml(err.message); });
    };
  });
}

// ---------------------------------------------------------------- router
function route() {
  var h = location.hash || '#/login';
  var noHash = h.slice(0, 2) === '#/' ? h.slice(2) : h;
  var parts = noHash.split('?');
  var pathParts = parts[0].split('/');
  var query = {};
  if (parts[1]) parts[1].split('&').forEach(function (kv) {
    var p = kv.split('=');
    query[p[0]] = decodeURIComponent(p[1] || '');
  });
  if (h === '#/login' || h === '') return viewLogin();
  if (h === '#/forgot') return viewForgot();
  if (pathParts[0] === 'reset') return viewReset(query.token || '');
  if (pathParts[0] === 'clients' && pathParts[1]) return viewClientDetail(pathParts[1]);
  if (pathParts[0] === 'clients') return viewClients();
  if (pathParts[0] === 'implementations') return viewImplementations();
  if (pathParts[0] === 'project' && pathParts[1]) return viewProject(pathParts[1]);
  if (pathParts[0] === 'admin' && pathParts[1] === 'stewards') return viewAdminStewards();
  if (pathParts[0] === 'admin' && pathParts[1] === 'companies') return viewAdminCompanies();
  if (pathParts[0] === 'admin' && pathParts[1] === 'assignments') return viewAdminAssignments();
  if (pathParts[0] === 'admin' && pathParts[1] === 'import') return viewAdminImport();
  location.hash = '#/login';
}

api.init();
window.addEventListener('hashchange', route);
route();

})();
