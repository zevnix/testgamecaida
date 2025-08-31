// /src/game/levels.js
// Modo principal: "hunt" => Victoria real al destruir el bunker (Maduro).
// Si quisieras obligar SIEMPRE a destruir el bunker (aunque no queden enemigos), usa mode: "hunt_only_bunker".

export const LEVELS = [
  {
    id: 1,
    name: "Puerto bloqueado",
    mode: "hunt",
    timeLimitSec: 60,
    player: { health: 100, lives: 3, specials: 1, speed: 260, fireRate: 7 },
    map: { w: 64, h: 36, destructibleBlocks: 45 },
    bunker: { hidden: true, flashEverySec: 12, flashDurMs: 180 }, // pista ligera
    enemies: [
      { type: "drone",   count: 12, hp: 1,  speed: 120 },
      { type: "shooter", count: 6,  hp: 2,  speed: 90,  fireRate: 1.5 },
      { type: "turret",  count: 3,  hp: 4,              fireRate: 0.8 },
    ],
    boss: null
  },
  {
    id: 2,
    name: "Refinería",
    mode: "hunt",
    timeLimitSec: 65,
    player: { health: 100, lives: 3, specials: 1, speed: 260, fireRate: 7 },
    map: { w: 64, h: 36, destructibleBlocks: 55 },
    bunker: { hidden: true, flashEverySec: 10, flashDurMs: 180 },
    enemies: [
      { type: "drone",   count: 16, hp: 1,  speed: 140 },
      { type: "shooter", count: 8,  hp: 2,  speed: 110, fireRate: 1.7 },
      { type: "turret",  count: 4,  hp: 4,              fireRate: 1.0 },
    ],
    boss: null
  },
  {
    id: 3,
    name: "Búnker de ‘el duro’",
    mode: "hunt",
    timeLimitSec: 70,
    player: { health: 100, lives: 3, specials: 2, speed: 270, fireRate: 8 },
    map: { w: 64, h: 36, destructibleBlocks: 65 },
    bunker: { hidden: true, flashEverySec: 8, flashDurMs: 200 },
    enemies: [
      { type: "drone",   count: 18, hp: 1,  speed: 150 },
      { type: "shooter", count: 10, hp: 3,  speed: 120, fireRate: 2.0 },
      { type: "turret",  count: 5,  hp: 5,              fireRate: 1.2 },
    ],
    boss: { type: "boss", hp: 30, speed: 85, fireRate: 2.2, specials: true }
  }
];

// Escalado procedural para niveles > LEVELS.length
// - Más enemigos y más rápidos
// - Más bloques destructibles en el mapa
// - Ligeramente más fireRate en torretas/shooters
// - El tiempo sube despacio y se clampa
export function procedurallyScale(base, levelIndex) {
  // levelIndex: 1,2,3... por encima del último definido
  const kEnemies = 1 + levelIndex * 0.12;    // +12% por nivel
  const kSpeed   = 1 + levelIndex * 0.06;    // +6% velocidad
  const kFire    = 1 + levelIndex * 0.05;    // +5% fireRate
  const kBlocks  = 1 + levelIndex * 0.10;    // +10% bloques destructibles
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  // Copias defensivas
  const nextMap = {
    ...(base.map || { w: 64, h: 36, destructibleBlocks: 50 }),
    destructibleBlocks: Math.round((base.map?.destructibleBlocks ?? 50) * kBlocks)
  };

  const nextEnemies = (base.enemies || []).map(e => ({
    ...e,
    count: Math.max(1, Math.round((e.count || 1) * kEnemies)),
    speed: Math.round((e.speed || 100) * kSpeed),
    fireRate: e.fireRate ? Number((e.fireRate * kFire).toFixed(2)) : e.fireRate
  }));

  const nextBoss = base.boss
    ? {
        ...base.boss,
        hp: Math.round(base.boss.hp * (1 + levelIndex * 0.15)),
        speed: Math.round((base.boss.speed || 85) * kSpeed),
        fireRate: base.boss.fireRate ? Number((base.boss.fireRate * kFire).toFixed(2)) : base.boss.fireRate
      }
    : null;

  const nextTime = clamp(Math.round((base.timeLimitSec || 60) * (1 + levelIndex * 0.03)), 40, 120);

  const nextPlayer = {
    ...(base.player || { health: 100, lives: 3, specials: 1, speed: 260, fireRate: 7 }),
    // le bajamos un poco la vida cada 3 niveles (mín 60) para tensión
    health: clamp(Math.round((base.player?.health ?? 100) - Math.floor(levelIndex / 3) * 5), 60, 140),
    // un pelín más de velocidad en runs muy altos
    speed: Math.round((base.player?.speed ?? 260) * (1 + Math.min(levelIndex * 0.01, 0.15)))
  };

  return {
    ...base,
    id: (base.id ?? 1000) + levelIndex,
    name: `${base.name} +${levelIndex}`,
    mode: base.mode || "hunt",
    timeLimitSec: nextTime,
    player: nextPlayer,
    map: nextMap,
    bunker: base.bunker ? { ...base.bunker } : { hidden: true, flashEverySec: 8, flashDurMs: 200 },
    enemies: nextEnemies,
    boss: nextBoss
  };
}
