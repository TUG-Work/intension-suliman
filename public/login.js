const apiBase = window.location.origin;

async function auth(path, body) {
  const res = await fetch(`${apiBase}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed');
  return data;
}

document.getElementById('login-btn').onclick = async () => {
  try {
    const data = await auth('/auth/login', {
      email: document.getElementById('login-email').value.trim(),
      password: document.getElementById('login-password').value.trim()
    });
    localStorage.setItem('token', data.token);
    location.href = '/app.html';
  } catch (e) {
    document.getElementById('login-msg').textContent = e.message;
  }
};

document.getElementById('reg-btn').onclick = async () => {
  try {
    const data = await auth('/auth/register', {
      email: document.getElementById('reg-email').value.trim(),
      password: document.getElementById('reg-password').value.trim()
    });
    localStorage.setItem('token', data.token);
    location.href = '/app.html';
  } catch (e) {
    document.getElementById('reg-msg').textContent = e.message;
  }
};
