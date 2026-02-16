const apiBase = window.location.origin;
const token = new URLSearchParams(location.search).get('token');

const state = {
  participantId: null,
  session: null,
  project: null,
  continuums: [],
  i: 0,
  votes: {}
};

const $ = (id) => document.getElementById(id);

async function get(path) {
  const res = await fetch(`${apiBase}/api${path}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed');
  return data;
}

async function post(path, body) {
  const res = await fetch(`${apiBase}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed');
  return data;
}

function render() {
  const c = state.continuums[state.i];
  $('title').textContent = c.title;
  $('aims').textContent = `${c.left_aim || ''} <> ${c.right_aim || ''}`;
  $('progress').textContent = `Continuum ${state.i + 1} / ${state.continuums.length}`;
  const selected = state.votes[c.id];
  document.querySelectorAll('#grid button').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.value) === selected);
  });
}

function makeGrid() {
  $('grid').innerHTML = '';
  for (let v = state.project.minValue; v <= state.project.maxValue; v++) {
    const b = document.createElement('button');
    b.textContent = String(v);
    b.dataset.value = String(v);
    b.onclick = () => {
      state.votes[state.continuums[state.i].id] = v;
      render();
    };
    $('grid').appendChild(b);
  }
}

$('join').onclick = async () => {
  try {
    const data = await post(`/public/invite/${token}/join`, {
      name: $('name').value.trim(),
      email: $('email').value.trim()
    });
    state.participantId = data.participantId;
    $('join-card').classList.add('hidden');
    $('vote-card').classList.remove('hidden');
    render();
  } catch (e) {
    $('join-msg').textContent = e.message;
  }
};

$('prev').onclick = () => { if (state.i > 0) { state.i--; render(); } };
$('next').onclick = () => { if (state.i < state.continuums.length - 1) { state.i++; render(); } };

$('submit').onclick = async () => {
  try {
    const payload = Object.entries(state.votes).map(([continuumId, value]) => ({ continuumId, value }));
    await post(`/public/invite/${token}/submit`, { participantId: state.participantId, votes: payload });
    $('vote-msg').textContent = 'Submitted successfully.';
  } catch (e) {
    $('vote-msg').textContent = e.message;
  }
};

(async () => {
  try {
    const data = await get(`/public/invite/${token}`);
    state.session = data.session;
    state.project = data.project;
    state.continuums = data.continuums;
    $('meta').textContent = `${data.project.name} / ${data.session.type}`;
    makeGrid();
  } catch (e) {
    $('meta').textContent = e.message;
  }
})();
