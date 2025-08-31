import { SUPABASE_URL, ANON_KEY } from "./config.js";

const headers = () => ({
  "content-type": "application/json",
  "apikey": ANON_KEY,
  "authorization": `Bearer ${ANON_KEY}`,
});

export async function loginOrRegister(url, username, pin) {
  const r = await fetch(`${url}/functions/v1/login_or_register`, {
    method: "POST", headers: headers(),
    body: JSON.stringify({ username, pin }),
  });
  const body = await r.json();
  return { status: r.status, body };
}

export async function startMatch(url, token, mode, rules) {
  const r = await fetch(`${url}/functions/v1/start_match`, {
    method: "POST", headers: headers(),
    body: JSON.stringify({ token, mode, rules }),
  });
  const body = await r.json();
  return { status: r.status, body };
}

export async function finishMatch(url, token, match_id, stats) {
  const r = await fetch(`${url}/functions/v1/finish_match`, {
    method: "POST", headers: headers(),
    body: JSON.stringify({ token, match_id, ...stats }),
  });
  const body = await r.json();
  return { status: r.status, body };
}

export async function fetchLeaderboard(url) {
  const q = "select=username,best_score,best_time,when_scored";
  const r = await fetch(`${url}/rest/v1/leaderboard_public?select=${encodeURIComponent(q)}`, {
    headers: headers(),
  });
  return r.json();
}

export function defaultUrl() { return SUPABASE_URL; }
