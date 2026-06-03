const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const API_KEY = import.meta.env.VITE_API_KEY || '';

export async function apiGet(path) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: API_KEY ? { 'X-API-Key': API_KEY } : {},
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function apiSend(path, { method = 'POST', body } = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
