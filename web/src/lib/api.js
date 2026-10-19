// JSON calls to the worker. api('/api/x') is a GET; pass a body to POST.
// An answer of 先登录… means this page's sign-in no longer works: the session
// checks itself (session/SessionContext.jsx) and quietly signs back in, or asks
// for the PIN.
export async function api(path, method, body) {
  const r = await fetch(path, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json();
  if (data && data.ok === false && /先登录/.test(data.error || '')) signedOut();
  return data;
}
// Something (a request, a socket) was refused with 先登录…: ask the session to check itself.
export const signedOut = () => { try { window.dispatchEvent(new Event('session:check')); } catch (e) { /* not in a browser */ } };
