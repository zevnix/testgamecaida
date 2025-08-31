// /src/game/map.js
// Mapa destructible con “búnker” (Maduro) oculto.
//
// API pública:
//   - setMapLevel(level)     → aplica opciones del nivel al mapa (bloques, HP, flash, seed)
//   - resizeMap(w, h)        → recalcula columnas/filas según el canvas
//   - buildMap()             → genera las tiles y coloca el búnker
//   - drawMap(ctx, isActive) → dibuja el mapa; el búnker parpadea brevemente cada ciclo.
//                              Si isActive=false (pausa/victoria/gameover) el flash se congela.
//   - bulletHitTile(b, spc)  → aplica daño, destruye bloque, devuelve: "hit" | "break" | "bunker" | false

export const MAP = {
  TILE: 26,
  COLS: 0,
  ROWS: 0,
  tiles: [],            // [r][c] = { hp:number, bunker:boolean } | null
  bunkerRC: null,       // [r,c] del bunker si existe

  // defaults si el nivel no provee nada
  density: 0.16,        // probabilidad base de ocupar celdas
  tileHP: 2,

  // opciones del nivel vigente (si las hay)
  levelOpts: null,      // { targetBlocks, tileHP, flashEverySec, flashDurMs, seed }

  // comportamiento del “flash” (pista visual del búnker)
  flashEverySec: 12,
  flashDurMs: 180,
  _lastFlashMs: 0,      // inicio de la ventana de flash
};

//
// Utilidades
//
const nowMs = () =>
  (typeof performance !== "undefined" && performance.now)
    ? performance.now()
    : Date.now();

// PRNG simple (xorshift32) para reproducibilidad
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

// Cuenta bloques actuales (tiles no nulas)
function countBlocks() {
  let n = 0;
  for (let r = 0; r < MAP.tiles.length; r++) {
    const row = MAP.tiles[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      if (row[c]) n++;
    }
  }
  return n;
}

//
// API de nivel
//
export function setMapLevel(level) {
  // Puede venir desde levels.js → level.map / level.bunker
  const targetBlocks = Number(level?.map?.destructibleBlocks ?? 50);
  const tileHP       = Number(level?.map?.tileHP ?? 2);

  // Parámetros de parpadeo del búnker
  const flashEvery   = Number(level?.bunker?.flashEverySec ?? 12);
  const flashDur     = Number(level?.bunker?.flashDurMs ?? 180);

  // Seed reproducible: preferimos id del nivel; mezclamos con el tiempo para variedad
  const seedBase = (level?.id ?? 0) ^ 0x9e3779b9; // golden ratio constant
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

//
// Tamaño del mapa
//
export function resizeMap(w, h) {
  const cols = Math.max(6, Math.floor(w / MAP.TILE));
  const rows = Math.max(6, Math.floor((h * 0.70) / MAP.TILE));
  MAP.COLS = cols;
  MAP.ROWS = rows;
}

//
// Construcción del mapa
//
export function buildMap() {
  const { COLS, ROWS } = MAP;
  MAP.tiles = [];
  MAP.bunkerRC = null;

  if (COLS <= 0 || ROWS <= 0) return;

  // Espacio útil (evitamos bordes para estética y para no pegarse a los límites)
  const usableCols = Math.max(0, COLS - 2);
  const usableRows = Math.max(0, ROWS - 4);
  const totalCells = usableCols * usableRows;

  const target = (MAP.levelOpts?.targetBlocks != null)
    ? clampInt(MAP.levelOpts.targetBlocks, 0, totalCells)
    : clampInt(Math.floor(totalCells * MAP.density), 0, totalCells);

  // RNG reproducible (o aleatorio si no hay levelOpts)
  const rng = makeRng(MAP.levelOpts?.seed ?? Math.floor(Math.random() * 1e9));

  // Probabilidad base para aproximar target
  const p = totalCells > 0 ? (target / totalCells) : 0;

  // Rellena por probabilidad
  for (let r = 0; r < ROWS; r++) MAP.tiles[r] = [];
  for (let r = 2; r < ROWS - 2; r++) {
    const row = MAP.tiles[r];
    for (let c = 1; c < COLS - 1; c++) {
      row[c] = (rng() < p) ? { hp: MAP.tileHP, bunker: false } : null;
    }
  }

  // Si quedó por debajo del target, añadimos bloques extra en huecos aleatorios
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

  // Colocar búnker en un bloque existente; si no hay ninguno, no habrá búnker
  placeBunker(rng);

  // Reset del ciclo de flash
  MAP._lastFlashMs = nowMs();
}

function placeBunker(rng) {
  const candidates = [];
  for (let r = 0; r < MAP.tiles.length; r++) {
    const row = MAP.tiles[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      if (row[c]) candidates.push([r, c]);
    }
  }
  if (candidates.length === 0) {
    MAP.bunkerRC = null;
    return;
  }
  const [br, bc] = candidates[Math.floor(rng() * candidates.length)];
  MAP.tiles[br][bc].bunker = true;
  MAP.tiles[br][bc].hp = (MAP.tileHP || 2) + 2; // un pelín más duro
  MAP.bunkerRC = [br, bc];
}

//
// Dibujo
//
export function drawMap(ctx, isActive = true) {
  const s = MAP.TILE - 3;

  // Control del “flash” (si el juego no está activo, el flash queda congelado)
  const now = nowMs();
  const elapsed = now - MAP._lastFlashMs;
  const flashing = elapsed <= MAP.flashDurMs;

  if (isActive) {
    if (elapsed > MAP.flashEverySec * 1000) {
      MAP._lastFlashMs = now;
    }
  }

  for (let r = 0; r < MAP.tiles.length; r++) {
    const row = MAP.tiles[r];
    if (!row) continue;

    for (let c = 0; c < row.length; c++) {
      const t = row[c];
      if (!t) continue;

      const x = c * MAP.TILE + MAP.TILE * 0.5;
      const y = r * MAP.TILE + MAP.TILE * 0.5;

      // base
      ctx.fillStyle = "#1b2a4c";
      ctx.strokeStyle = "#0f1a34";
      ctx.lineWidth = 1;

      // si es bunker y justo ahora toca flash, resaltamos
      if (t.bunker && flashing) {
        ctx.fillStyle = "#36e27a"; // verde brillante temporal
      }

      ctx.fillRect(x - s / 2, y - s / 2, s, s);
      ctx.strokeRect(x - s / 2, y - s / 2, s, s);
    }
  }
}

//
// Colisión bala ↔ bloque
//
export function bulletHitTile(b, special = false) {
  const c = Math.floor(b.x / MAP.TILE);
  const r = Math.floor(b.y / MAP.TILE);

  // fuera del mapa
  if (r < 0 || r >= MAP.tiles.length) return false;
  const row = MAP.tiles[r];
  if (!row) return false;
  if (c < 0 || c >= row.length) return false;

  const t = row[c];
  if (!t) return false;

  // daño
  const dmg = special ? 3 : 1;
  t.hp -= dmg;
  b.dead = true;

  if (t.hp <= 0) {
    const isBunker = !!t.bunker;
    row[c] = null;
    return isBunker ? "bunker" : "break";
  }
  return "hit";
}
