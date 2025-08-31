// src/main.js
import { defaultUrl, loginOrRegister, startMatch, finishMatch, fetchLeaderboard } from "./api.js";
import { Game } from "./game/engine.js";

const el  = (id) => document.getElementById(id);
const log = (m) => { const p = el("log"); if (!p) return; p.textContent += m + "\n"; p.scrollTop = p.scrollHeight; };

const cv = el("canvas");

// ------------ helpers ------------
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const isTyping = () => {
  const a = document.activeElement;
  if (!a) return false;
  const tag = a.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || a.isContentEditable === true;
};

// overlay helpers
const showOverlay = (v) => { const o = el("overlay"); if (o) o.style.display = v ? "flex" : "none"; };
const setBadge = (ok=false, warn=false) => {
  const bOk = el("ovBadgeB"), bWarn = el("ovBadgeC");
  if (bOk)  bOk.style.display   = ok   ? "inline-flex" : "none";
  if (bWarn) bWarn.style.display = warn ? "inline-flex" : "none";
};

// ------------ global state ------------
let session = { user: null, token: null, match_id: null };
let game = null;

let currentLevel = 0;
let lastFinish   = null;  // {victory,status,body}
let isStarting   = false; // anti double start

// server time anchor (to avoid elapsed_not_coherent)
let serverStartMs = null;
let matchMsCap    = 60000;

// ------------ status panel ------------
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

// ------------ auth ------------
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

// ------------ match flow ------------
async function startNewMatch(levelIdx = 0) {
  if (!session.token) { log("start: missing token"); return; }
  if (isStarting) return;
  isStarting = true;

  // evitar que Space vuelva a "clickear" el botón
  if (document.activeElement) document.activeElement.blur();

  // esconder cualquier overlay previo
  showOverlay(false);
  lastFinish = null;

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
  matchMsCap        = (m.rules?.MATCH_SECONDS ?? 60) * 1000;
  uiState();

  // reinicia engine
  game?.stop();
  game = new Game(cv);
  game.loadLevel(currentLevel);
  game.start({ onFinish: handleFinishFromGame });

  // foco al canvas para capturar WASD/Espacio/Esc
  cv.focus();

  isStarting = false;
}

const elapsedFromServer = () =>
  clamp(Date.now() - (serverStartMs ?? Date.now()), 0, matchMsCap);

// --- overlay content setters ---
function openPauseOverlay() {
  const title = el("ovTitle");
  const desc  = el("ovDesc");
  if (title) title.textContent = "Pausa";
  if (desc)  desc.innerHTML = 'Juego pausado. Usa <span class="badge">P</span> o <span class="badge">Esc</span> para continuar.';

  // botones
  toggleButtons({ cont:true, next:false, retry:false, exit:true });
  setBadge(false, false);
  showOverlay(true);
}

function openWinOverlay(reason) {
  const title = el("ovTitle");
  const desc  = el("ovDesc");
  if (title) title.textContent = "¡Victoria!";
  if (desc) {
    desc.textContent = (reason === "bunker")
      ? "¡Encontraste a Maduro y fue enviado a la cárcel de Bukele!"
      : "Has completado el objetivo.";
  }

  toggleButtons({ cont:false, next:true, retry:false, exit:true });
  setBadge(true, false);
  showOverlay(true);
}

function openLoseOverlay(reason) {
  const title = el("ovTitle");
  const desc  = el("ovDesc");
  if (title) title.textContent = "Game Over";
  if (desc)  desc.textContent = (reason === "timeout") ? "Se acabó el tiempo." : "Se acabaron las vidas.";

  toggleButtons({ cont:false, next:false, retry:true, exit:true });
  setBadge(false, true);
  showOverlay(true);
}

function toggleButtons({ cont, next, retry, exit }) {
  const bC = el("ovContinue");
  const bN = el("ovNext");
  const bR = el("ovRetry");
  const bE = el("ovExit");
  if (bC) bC.style.display = cont ? "inline-flex" : "none";
  if (bN) bN.style.display = next ? "inline-flex" : "none";
  if (bR) bR.style.display = retry ? "inline-flex" : "none";
  if (bE) bE.style.display = exit ? "inline-flex" : "none";
}

// --- finish handler from engine ---
async function handleFinishFromGame({ victory, reason, stats }) {
  // evita doble envío
  if (lastFinish) return;

  const url = el("url").value;
  const elapsed_ms = elapsedFromServer();
  const payload = { ...stats, elapsed_ms };

  const r = await finishMatch(url, session.token, session.match_id, payload);
  log(`POST finish_match ...\nfinish status: ${r.status}\n${JSON.stringify(r.body, null, 2)}\n`);

  lastFinish = { victory, status: r.status, body: r.body };
  session.match_id = null;
  serverStartMs = null;
  uiState();

  if (victory && r.status === 200) {
    openWinOverlay(reason);    // muestra “Siguiente / Salir”
  } else {
    openLoseOverlay(reason);   // muestra “Reintentar / Salir”
  }
}

// ------------ overlay actions ------------
function onResume() {
  showOverlay(false);
  if (game?.state === "paused") game.pauseToggle();
  cv.focus();
}
function onRestart() {
  showOverlay(false);
  startNewMatch(currentLevel);
}
function onExit() {
  showOverlay(false);
  game?.stop();
}
function onNextLevel() {
  showOverlay(false);
  startNewMatch(currentLevel + 1);
}
function onRetry() {
  showOverlay(false);
  startNewMatch(currentLevel);
}

// ------------ global keyboard ------------
window.addEventListener("keydown", (ev) => {
  // si está escribiendo en inputs, ignorar atajos
  if (isTyping()) return;

  const playingOrPaused = !!game && (game.state === "playing" || game.state === "paused");

  // evita scroll/activación de botones mientras juegas
  if (playingOrPaused) {
    const block = [" ", "Spacebar", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown"];
    if (block.includes(ev.key)) ev.preventDefault();
  }

  // restart rápido
  if (ev.key === "r" || ev.key === "R") {
    if (game || lastFinish) { ev.preventDefault(); onRestart(); }
  }

  // siguiente nivel (solo tras victoria)
  if (ev.key === "n" || ev.key === "N") {
    if (lastFinish?.victory) { ev.preventDefault(); onNextLevel(); }
  }

  // pausa
  if (ev.key === "Escape" || ev.key === "p" || ev.key === "P") {
    // deja que el engine haga toggle y luego sincronizamos overlay
    setTimeout(() => {
      if (!game) return;
      if (game.state === "paused") openPauseOverlay();
      else showOverlay(false);
    }, 0);
  }
});

// el canvas recupera foco con click/touch
cv.addEventListener("mousedown", () => cv.focus());
cv.addEventListener("touchstart", () => cv.focus(), { passive: true });

// ------------ wiring UI ------------
el("url").value = defaultUrl();
el("btnLogin").onclick  = doLogin;
el("btnStart").onclick  = () => startNewMatch(0);
el("btnFinish").onclick = () => log("Tip: termina por victoria/derrota o deja que llegue el tiempo 😉");
el("btnLb").onclick     = refreshLb;

// overlay buttons
el("ovContinue").onclick = onResume;
el("ovNext").onclick     = onNextLevel;
el("ovRetry").onclick    = onRetry;
el("ovExit").onclick     = onExit;

log("Listo. Login y luego Start match para jugar.\n");
