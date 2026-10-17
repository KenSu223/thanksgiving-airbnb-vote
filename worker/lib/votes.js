// Vote identity. A vote belongs to an ACCOUNT, and accounts are keyed by
// name (unique, case-insensitive). Tokens are NOT stable identity: setting
// a PIN rotates a user's token, and devices remember different tokens
// over time. Matching votes by token alone let one person hold two votes
// on the same item — one per token they ever had. Always match name OR
// token, and collapse duplicates when reading or writing.
export function isVoteBy(v, token, name) {
  if (!!token && v.token === token) return true;
  return !!name && String(v.name || '').toLowerCase() === String(name).toLowerCase();
}

// One vote per account: keep the earliest vote for each name.
export function dedupeVotes(votes) {
  const seen = new Set();
  return (votes || []).filter(v => {
    const k = String(v.name || '').toLowerCase();
    if (!k) return true;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
