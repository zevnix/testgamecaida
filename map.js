// /src/game/map.js
// Mapa destructible con “búnker” (Maduro) oculto.
// API pública:
//   setMapLevel(level)      → aplica opciones del nivel al mapa (bloques, HP, flash, seed)
//   resizeMap(w, h)         → recalcula columnas/filas según el canvas
//   buildMap()              → genera las tiles y coloca el búnker
//   drawMap(ctx)            → dibuja el mapa (respeta “congelado”)
//   bulletHitTile(b, spc)   → aplica daño y retorna "hit" | "break" | "bunker" | false
//   setFlashFrozen(boolean) → detiene/reanuda el ciclo de parpadeo del búnker

export const MAP = {
  TILE: 26,
  COLS: 0,
  ROWS: 0,
  tiles: [],            // [r][c] = { hp:number, bunker:boolean } | null
  bunkerRC: null,       // [r,c] del bunker si existe

  // defaults si el nivel no provee nada
  density: 0.16,
  tileHP: 2,

  // opciones del nivel vigente (si las hay)
  levelOpts: null,      // { targetBlocks, tileHP, flashEverySec, flashDurMs, seed }

  // parpadeo del búnker
  flashEverySec: 12,
  flashDurMs: 180,
  _lastFlashMs: 0,

  // FREEZE del parpadeo (para pausa / victoria / game over)
  _flashFrozen: false,
  _freezeStartMs: 0,
};

const nowMs = () => (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();

// PRNG simple (xorshift32)
function makeRng(seed) {
  let x = (seed | 0) || 123456789;
  return () => {
    x ^= x << 13; x |= 0;
    x ^= x >>> 17; x |= 0;
    x ^= x << 5;  x |= 0;
    return (x >>> 0) / 0xFFFFFFFF;
  };
}

function clampInt(n, min, max) {
  n |= 0;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function countBlocks() {
  let n = 0;
  for (let r = 0; r < MAP.tiles.length; r++) {
    const row = MAP.tiles[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) if (row[c]) n++;
  }
  return n;
}

// --------------- nivel ---------------
export function setMapLevel(level) {
  const targetBlocks = Number(level?.map?.destructibleBlocks ?? 50);
  const tileHP       = Number(level?.map?.tileHP ?? 2);
  const flashEvery   = Number(level?.bunker?.flashEverySec ?? 12);
  const flashDur     = Number(level?.bunker?.flashDurMs ?? 180);

  const seedBase = (level?.id ?? 0) ^ 0x9e3779b9;
  const seed     = (seedBase ^ Date.now()) | 0;

  MAP.levelOpts = {
    targetBlocks: clampInt(targetBlocks, 0, 999999),
    tileHP:       clampInt(tileHP, 1, 999),
    flashEverySec: clampInt(flashEvery, 1, 120),
    flashDurMs:    clampInt(flashDur, 60, 2000),
    seed,
  };

  MAP.tileHP        = MAP.levelOpts.tileHP;
  MAP.flashEverySec = MAP.levelOpts.flashEverySec;
  MAP.flashDurMs    = MAP.levelOpts.flashDurMs;
}

// --------------- FREEZE del flash ---------------
export function setFlashFrozen(frozen) {
  if (frozen) {
    if (!MAP._flashFrozen) {
      MAP._flashFrozen = true;
      MAP._freezeStartMs = nowMs();
    }
  } else {
    if (MAP._flashFrozen) {
      const pausedDelta = nowMs() - MAP._freezeStartMs;
      // “corremos” el origen para que el ciclo retome donde quedó
      MAP._lastFlashMs += pausedDelta;
      MAP._flashFrozen = false;
      MAP._freezeStartMs = 0;
    }
  }
}

// --------------- tamaño / construcción ---------------
export function resizeMap(w, h) {
  const cols = Math.max(6, Math.floor(w / MAP.TILE));
  const rows = Math.max(6, Math.floor((h * 0.70) / MAP.TILE));
  MAP.COLS = cols;
  MAP.ROWS = rows;
}

export function buildMap() {
  const { COLS, ROWS } = MAP;
  MAP.tiles = [];
  MAP.bunkerRC = null;

  if (COLS <= 0 || ROWS <= 0) return;

  const usableCols = Math.max(0, COLS - 2);
  const usableRows = Math.max(0, ROWS - 4);
  const totalCells = usableCols * usableRows;

  const target = (MAP.levelOpts?.targetBlocks != null)
    ? clampInt(MAP.levelOpts.targetBlocks, 0, totalCells)
    : clampInt(Math.floor(totalCells * MAP.density), 0, totalCells);

  const rng = makeRng(MAP.levelOpts?.seed ?? Math.floor(Math.random() * 1e9));
  const p = totalCells > 0 ? (target / totalCells) : 0;

  for (let r = 0; r < ROWS; r++) MAP.tiles[r] = [];
  for (let r = 2; r < ROWS - 2; r++) {
    const row = MAP.tiles[r];
    for (let c = 1; c < COLS - 1; c++) {
      row[c] = (rng() < p) ? { hp: MAP.tileHP, bunker: false } : null;
    }
  }

  let current = countBlocks();
  let deficit = target - current;
  if (deficit > 0) {
    let tries = deficit * 3 + 64;
    while (deficit > 0 && tries-- > 0) {
      const r = 2 + Math.floor(rng() * usableRows);
      const c = 1 + Math.floor(rng() * usableCols);
      if (!MAP.tiles[r][c]) {
        MAP.tiles[r][c] = { hp: MAP.tileHP, bunker: false };
        deficit--;
      }
    }
  }

  placeBunker(rng);

  // reset del ciclo de flash
  MAP._lastFlashMs = nowMs();
  setFlashFrozen(false); // por si veníamos de una pausa o fin de partida
}

function placeBunker(rng) {
  const candidates = [];
  for (let r = 0; r < MAP.tiles.length; r++) {
    const row = MAP.tiles[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) if (row[c]) candidates.push([r, c]);
  }
  if (!candidates.length) { MAP.bunkerRC = null; return; }
  const [br, bc] = candidates[Math.floor(rng() * candidates.length)];
  MAP.tiles[br][bc].bunker = true;
  MAP.tiles[br][bc].hp = (MAP.tileHP || 2) + 2;
  MAP.bunkerRC = [br, bc];
}

// --------------- dibujo ---------------
export function drawMap(ctx) {
  const s = MAP.TILE - 3;

  // Si estamos “congelados”, usamos el instante del congelado para que el
  // parpadeo quede quieto.
  const now = MAP._flashFrozen ? MAP._freezeStartMs : nowMs();

  const elapsed = now - MAP._lastFlashMs;
  const flashing = elapsed <= MAP.flashDurMs;
  if (!MAP._flashFrozen && elapsed > MAP.flashEverySec * 1000) {
    MAP._lastFlashMs = now;
  }

  for (let r = 0; r < MAP.tiles.length; r++) {
    const row = MAP.tiles[r]; if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const t = row[c]; if (!t) continue;

      const x = c * MAP.TILE + MAP.TILE * 0.5;
      const y = r * MAP.TILE + MAP.TILE * 0.5;

      ctx.fillStyle = "#1b2a4c";
      ctx.strokeStyle = "#0f1a34";
      ctx.lineWidth = 1;

      if (t.bunker && flashing) ctx.fillStyle = "#36e27a";

      ctx.fillRect(x - s / 2, y - s / 2, s, s);
      ctx.strokeRect(x - s / 2, y - s / 2, s, s);
    }
  }
}

// --------------- colisión bala ↔ bloque ---------------
export function bulletHitTile(b, special = false) {
  const c = Math.floor(b.x / MAP.TILE);
  const r = Math.floor(b.y / MAP.TILE);

  if (r < 0 || r >= MAP.tiles.length) return false;
  if (c < 0 || c >= (MAP.tiles[r]?.length ?? 0)) return false;

  const t = MAP.tiles[r][c]; if (!t) return false;

  t.hp -= (special ? 3 : 1);
  b.dead = true;

  if (t.hp <= 0) {
    const isBunker = !!t.bunker;
    MAP.tiles[r][c] = null;
    return isBunker ? "bunker" : "break";
  }
  return "hit";
}
