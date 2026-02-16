const token = localStorage.getItem('token');
if (!token) location.href = '/index.html';

const apiBaseInput = document.getElementById('api-base');
apiBaseInput.value = window.location.origin;
let projects = [];
let sessions = [];
let continuums = [];

const $ = (id) => document.getElementById(id);

function headers() {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function get(path) {
  const res = await fetch(`${apiBaseInput.value}/api${path}`, { headers: headers() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed');
  return data;
}

async function send(path, method, body) {
  const res = await fetch(`${apiBaseInput.value}/api${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed');
  return data;
}

function status(msg) { $('status').textContent = msg; }

async function loadProjects() {
  projects = await get('/projects');
  $('project-select').innerHTML = projects.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
  renderProjects();
  if (projects.length) {
    await loadContinuums();
    await loadSessions();
  }
}

async function loadContinuums() {
  const pid = $('project-select').value;
  if (!pid) return;
  continuums = await get(`/projects/${pid}/continuums`);
  renderContinuums();
}

async function loadSessions() {
  const pid = $('project-select').value;
  if (!pid) return;
  sessions = await get(`/projects/${pid}/sessions`);
  $('session-select').innerHTML = sessions.map((s) => `<option value="${s.id}">${s.type} (${s.status})</option>`).join('');
  renderSessions();
  await renderParticipants();
  await renderResults();
}

function renderProjects() {
  $('projects-list').innerHTML = projects.map((p) => `
    <div class="list-item">
      <b>${p.name}</b> (${p.min_value}..${p.max_value})
      <div class="row">
        <div class="col"><button data-id="${p.id}" class="pick">Select</button></div>
        <div class="col"><button data-id="${p.id}" class="del danger">Delete</button></div>
      </div>
    </div>
  `).join('');
  document.querySelectorAll('.pick').forEach((b) => b.onclick = async () => {
    $('project-select').value = b.dataset.id;
    await loadContinuums();
    await loadSessions();
  });
  document.querySelectorAll('.del').forEach((b) => b.onclick = async () => {
    await send(`/projects/${b.dataset.id}`, 'DELETE');
    await loadProjects();
  });
}

function renderContinuums() {
  $('continuums-list').innerHTML = continuums.map((c) => `
    <div class="list-item">
      <b>${c.title}</b> ${c.is_hidden ? '(hidden)' : ''}
      <div class="small">${c.left_aim || ''} <> ${c.right_aim || ''}</div>
      <div class="row">
        <div class="col"><button data-id="${c.id}" class="hide secondary">${c.is_hidden ? 'Unhide' : 'Hide'}</button></div>
        <div class="col"><button data-id="${c.id}" class="del-c danger">Delete</button></div>
      </div>
    </div>
  `).join('');
  document.querySelectorAll('.hide').forEach((b) => b.onclick = async () => {
    const c = continuums.find((x) => x.id === b.dataset.id);
    await send(`/continuums/${c.id}`, 'PUT', { isHidden: !c.is_hidden });
    await loadContinuums();
  });
  document.querySelectorAll('.del-c').forEach((b) => b.onclick = async () => {
    await send(`/continuums/${b.dataset.id}`, 'DELETE');
    await loadContinuums();
  });
}

function renderSessions() {
  $('sessions-list').innerHTML = sessions.map((s) => `
    <div class="list-item">
      <b>${s.type}</b> (${s.status})
      <div class="row">
        <div class="col"><button data-id="${s.id}" class="open">Open</button></div>
        <div class="col"><button data-id="${s.id}" class="close secondary">Close</button></div>
      </div>
    </div>
  `).join('');
  document.querySelectorAll('.open').forEach((b) => b.onclick = async () => {
    await send(`/sessions/${b.dataset.id}/status`, 'PUT', { status: 'open' });
    await loadSessions();
  });
  document.querySelectorAll('.close').forEach((b) => b.onclick = async () => {
    await send(`/sessions/${b.dataset.id}/status`, 'PUT', { status: 'closed' });
    await loadSessions();
  });
}

async function renderParticipants() {
  const sid = $('session-select').value;
  if (!sid) return;
  const rows = await get(`/sessions/${sid}/participants`);
  $('participants-list').innerHTML = rows.map((p) => `<div class="list-item"><b>${p.name}</b> ${p.email || ''}</div>`).join('');
}

async function renderResults() {
  const sid = $('session-select').value;
  if (!sid) return;
  const project = projects.find((p) => p.id === $('project-select').value);
  const data = await get(`/sessions/${sid}/results`);
  $('presenter-results').innerHTML = data.results.map((r) => {
    const pct = ((r.avg - project.min_value) / (project.max_value - project.min_value || 1)) * 100;
    return `<div class="list-item"><b>${r.title}</b> Avg ${r.avg} (${r.count})<div class="scale"><div class="dot avg" style="left:${pct}%"></div></div></div>`;
  }).join('');
}

$('create-project').onclick = async () => {
  await send('/projects', 'POST', {
    name: $('project-name').value.trim(),
    minValue: Number($('project-min').value || -5),
    maxValue: Number($('project-max').value || 5)
  });
  await loadProjects();
};

$('create-continuum').onclick = async () => {
  await send(`/projects/${$('project-select').value}/continuums`, 'POST', {
    title: $('c-title').value.trim(),
    leftAim: $('c-left').value.trim(),
    rightAim: $('c-right').value.trim(),
    leftDesc: $('c-left-desc').value.trim(),
    rightDesc: $('c-right-desc').value.trim()
  });
  await loadContinuums();
};

$('create-baseline').onclick = async () => { await send(`/projects/${$('project-select').value}/sessions`, 'POST', { type: 'baseline' }); await loadSessions(); };
$('create-comparison').onclick = async () => { await send(`/projects/${$('project-select').value}/sessions`, 'POST', { type: 'comparison' }); await loadSessions(); };

$('send-invite').onclick = async () => {
  try {
    const sid = $('session-select').value;
    const email = $('invite-email').value.trim();
    if (!sid) {
      $('invite-link').textContent = 'Select a session first.';
      return;
    }
    if (!email) {
      $('invite-link').textContent = 'Enter an email first.';
      return;
    }
    const data = await send(`/sessions/${sid}/invite`, 'POST', { email });
    if (data.ok) {
      const msg = `Invite sent by email. Link: ${data.inviteUrl}`;
      $('invite-link').textContent = msg;
      alert(msg);
    } else {
      const msg = `Email failed (${data.error}). Use this link manually: ${data.inviteUrl}`;
      $('invite-link').textContent = msg;
      alert(msg);
    }
  } catch (e) {
    const msg = `Invite failed: ${e.message}`;
    $('invite-link').textContent = msg;
    alert(msg);
  }
};

$('export-csv').onclick = () => window.open(`${apiBaseInput.value}/api/sessions/${$('session-select').value}/export.csv`, '_blank');
$('export-pdf').onclick = () => window.open(`${apiBaseInput.value}/api/projects/${$('project-select').value}/report.pdf`, '_blank');

$('project-select').onchange = async () => { await loadContinuums(); await loadSessions(); };
$('session-select').onchange = async () => { await renderParticipants(); await renderResults(); };
$('logout').onclick = () => { localStorage.removeItem('token'); location.href = '/index.html'; };

for (const t of document.querySelectorAll('.tab')) {
  t.onclick = () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    ['projects','continuums','sessions','participants','presenter','exports'].forEach((id) => {
      const el = document.getElementById(`tab-${id}`);
      if (id === t.dataset.tab) el.classList.remove('hidden');
      else el.classList.add('hidden');
    });
  };
}

apiBaseInput.onchange = () => localStorage.setItem('apiBase', apiBaseInput.value);

(async () => {
  try {
    status('Loading...');
    await loadProjects();
    status('Ready');
  } catch (e) {
    status(e.message);
  }
})();
