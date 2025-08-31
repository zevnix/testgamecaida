// /src/main.js
import { defaultUrl, loginOrRegister, startMatch, finishMatch, fetchLeaderboard } from "./api.js";
import { Game } from "./game/engine.js";

const el  = (id) => document.getElementById(id);
const log = (m) => { const p = el("log"); if (!p) return; p.textContent += m + "\n"; p.scrollTop = p.scrollHeight; };
const show = (node, v) => node && (node.style.display = v ? "flex" : "none");

const cv = el("canvas");

// --- ayuda ---
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const isTyping = () => {
  const a = document.activeElement;
  if (!a) return false;
  const tag = a.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || a.isContentEditable === true;
};

// --- estado global ---
let session = { user: null, token: null, match_id: null };
let game = null;

let currentLevel = 0;
let lastFinish   = null;
let isStarting   = false;

// reloj servidor
let serverStartMs = null;
// ¡OJO! ya no capamos el elapsed del cliente; lo decide el servidor
// (para evitar "elapsed_not_coherent" si el usuario deja el juego en pausa mucho tiempo).
function elapsedFromServerRaw() {
  return Math.max(0, Date.now() - (serverStartMs ?? Date.now()));
}

// -------------------- UI de estado --------------------
function uiState() {
  el("state").textContent = JSON.stringify({
    user: session.user?.id?.slice(0, 8) ?? null,
    match_id: session.match_id,
    level: currentLevel + 1,
  }, null, 2);
}

async function refreshLb() {
  const url = el("url").value;
  const data = await fetchLeaderboard(url);
  el("lb").textContent = JSON.stringify(data, null, 2);
}

// -------------------- Auth --------------------
async function doLogin() {
  const url = el("url").value;
  const username = el("username").value.trim();
  const pin = el("pin").value.trim();
  const r = await loginOrRegister(url, username, pin);
  log(`POST login_or_register ...\nlogin status: ${r.status}\n${JSON.stringify(r.body, null, 2)}\n`);
  if (r.status === 200) {
    session.user  = r.body.user;
    session.token = r.body.token;
    uiState();
  }
}

// -------------------- Partida --------------------
async function startNewMatch(levelIdx = 0) {
  if (!session.token) { log("start: missing token"); return; }
  if (isStarting) return;
  isStarting = true;

  if (document.activeElement) document.activeElement.blur();

  const url  = el("url").value;
  const mode = el("mode").value;

  currentLevel = levelIdx;

  const rules = { MATCH_SECONDS: 60 };

  const r = await startMatch(url, session.token, mode, rules);
  log(`POST start_match ...\nstart status: ${r.status}\n${JSON.stringify(r.body, null, 2)}\n`);
  if (r.status !== 200 || !r.body?.match) { isStarting = false; return; }

  const m = r.body.match;
  session.match_id  = m.id;
  serverStartMs     = Date.parse(m.started_at);
  lastFinish        = null;
  uiState();

  game?.stop();
  game = new Game(cv);
  game.loadLevel(currentLevel);
  game.start({ onFinish: handleFinishFromGame });

  cv.focus();
  isStarting = false;
}

function setOverlayWin(reason) {
  const title = el("ovWinTitle");
  const txt   = el("ovWinText");
  if (title) title.textContent = "¡Victoria!";
  if (txt) {
    txt.textContent = (reason === "bunker")
      ? "¡Encontraste a Maduro y fue enviado a la cárcel de Bukele!"
      : "Has completado el objetivo.";
  }
}
function setOverlayLose(reason) {
  const title = el("ovLoseTitle");
  const txt   = el("ovLoseText");
  if (title) title.textContent = "Game Over";
  if (txt) txt.textContent = (reason === "timeout") ? "Se acabó el tiempo." : "Se acabaron las vidas.";
}

async function handleFinishFromGame({ victory, reason, stats }) {
  if (lastFinish) return;

  const url = el("url").value;
  // IMPORTANTE: enviamos el elapsed según el reloj del servidor (sin capar)
  const elapsed_ms = elapsedFromServerRaw();
  const payload = { ...stats, elapsed_ms };

  const r = await finishMatch(url, session.token, session.match_id, payload);
  log(`POST finish_match ...\nfinish status: ${r.status}\n${JSON.stringify(r.body, null, 2)}\n`);

  lastFinish = { victory, status: r.status, body: r.body };
  session.match_id = null;
  serverStartMs = null;
  uiState();

  if (victory && r.status === 200) {
    setOverlayWin(reason);
    show(el("ovWin"), true);
  } else {
    setOverlayLose(reason);
    show(el("ovLose"), true);
  }
}

// -------------------- Overlays --------------------
function onResume() {
  show(el("ovPause"), false);
  if (game?.state === "paused") game.pauseToggle();
  cv.focus();
}
function onRestart() {
  show(el("ovPause"), false);
  show(el("ovWin"), false);
  show(el("ovLose"), false);
  startNewMatch(currentLevel);
}
function onExit() {
  show(el("ovPause"), false);
  show(el("ovWin"), false);
  show(el("ovLose"), false);
  game?.stop();
}
function onNextLevel() {
  show(el("ovWin"), false);
  startNewMatch(currentLevel + 1);
}
function onRetry() {
  show(el("ovLose"), false);
  startNewMatch(currentLevel);
}

// -------------------- Teclado global --------------------
window.addEventListener("keydown", (ev) => {
  if (isTyping()) return;

  const playingOrPaused = !!game && (game.state === "playing" || game.state === "paused");
  const blockKeys = [" ", "Spacebar", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown"];
  if (playingOrPaused && blockKeys.includes(ev.key)) ev.preventDefault();

  if (ev.key === "r" || ev.key === "R") {
    if (game || lastFinish) { ev.preventDefault(); onRestart(); }
  }
  if (ev.key === "n" || ev.key === "N") {
    if (lastFinish?.victory) { ev.preventDefault(); onNextLevel(); }
  }
  if (ev.key === "Escape" || ev.key === "p" || ev.key === "P") {
    // dejamos que el engine haga toggle, luego mostramos/ocultamos modal
    setTimeout(() => {
      if (!game) return;
      if (game.state === "paused") show(el("ovPause"), true);
      else show(el("ovPause"), false);
    }, 0);
  }
});

cv.addEventListener("mousedown", () => cv.focus());
cv.addEventListener("touchstart", () => cv.focus(), { passive: true });

// -------------------- Wiring UI --------------------
el("url").value = defaultUrl();
el("btnLogin").onclick  = doLogin;
el("btnStart").onclick  = () => startNewMatch(0);
el("btnFinish").onclick = () => log("Tip: termina por victoria/derrota o deja que llegue el tiempo 😉");
el("btnLb").onclick     = refreshLb;

// overlays
el("btnResume").onclick  = onResume;
el("btnRestart").onclick = onRestart;
el("btnExit").onclick    = onExit;

el("btnNext").onclick  = onNextLevel;
el("btnExitW").onclick = onExit;

el("btnRetry").onclick = onRetry;
el("btnExitL").onclick = onExit;

log("Listo. Login y luego Start match para jugar.\n");
