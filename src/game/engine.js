// /src/game/engine.js
import { Input } from "./input.js";
import { Player, Enemy, Bullet } from "./entities.js";
import { resizeMap, buildMap, drawMap, bulletHitTile, setMapLevel } from "./map.js";
import { LEVELS, procedurallyScale } from "./levels.js";

export class Game {
  constructor(canvas) {
    this.cv  = canvas;
    this.ctx = canvas.getContext("2d");

    // HiDPI
    this.W = canvas.width  = canvas.clientWidth  * devicePixelRatio;
    this.H = canvas.height = canvas.clientHeight * devicePixelRatio;
    this.ctx.scale(devicePixelRatio, devicePixelRatio);

    resizeMap(this.cv.clientWidth, this.cv.clientHeight);

    // entrada & entidades
    this.input   = new Input();
    this.player  = null;
    this.bullets = [];   // { x,y,vx,vy,damage,enemy,special,dead }
    this.enemies = [];   // Enemy[]

    // tiempo y estado
    this.running = false;
    this.state   = "menu"; // 'playing' | 'paused' | 'victory' | 'gameover'
    this.time    = 0;
    this.lastT   = 0;
    this.timeLimitSec = 60;

    // niveles
    this.levelIndex = 0;
    this.level      = null;

    // callbacks
    this.onFinish = () => {}; // ({victory, reason, stats}) => void

    // contadores estadísticos (cliente) — el servidor valida de verdad
    this._shotsFired  = 0;
    this._approxHits  = 0;

    // control
    this._pauseCooldown = 0;   // seg (debounce)
    this._invuln        = 0;   // seg (invulnerabilidad tras revivir)
    this._finishedSent  = false; // evita doble finish
    this._freezeWorld   = false; // congela el update al terminar
    this._raf           = null;  // id del RAF para cancelar
  }

  _getLevelRecipe(idx) {
    if (idx < LEVELS.length) return LEVELS[idx];
    return procedurallyScale(LEVELS[LEVELS.length - 1], idx - LEVELS.length + 1);
  }

  loadLevel(levelIdx) {
    this.levelIndex = levelIdx;
    this.level      = this._getLevelRecipe(levelIdx);

    // aplica parámetros de mapa según nivel y construye
    setMapLevel(this.level);
    buildMap();

    this.time = 0;
    this.timeLimitSec = this.level?.timeLimitSec ?? 60;

    // jugador
    const pCfg = this.level?.player ?? { health: 100, lives: 3, specials: 1, speed: 260, fireRate: 7 };
    if (!this.player) this.player = new Player(this.cv.clientWidth / 2, this.cv.clientHeight - 40);
    this.player.x = this.cv.clientWidth / 2;
    this.player.y = this.cv.clientHeight - 40;
    this.player.hp        = pCfg.health;
    this.player.maxHp     = pCfg.health;
    this.player.lives     = pCfg.lives;
    this.player.specials  = pCfg.specials;
    this.player.speed     = pCfg.speed;
    this.player.fireRate  = pCfg.fireRate;

    // enemigos
    this.enemies.length = 0;
    const addEnemies = (type, count, hp, speed = 100, fireRate = 0) => {
      for (let i = 0; i < count; i++) {
        const e = new Enemy(
          60 + Math.random() * (this.cv.clientWidth - 120),
          70 + Math.random() * 200
        );
        e.type = type;
        e.hp = hp;
        e.speed = speed;
        e.vx = (Math.random() < 0.5 ? -1 : 1) * (speed * 0.4);
        e.vy = 0;
        e.fireRate = fireRate;
        e.fireCd = Math.random() * 2;
        this.enemies.push(e);
      }
    };

    for (const spec of (this.level?.enemies ?? [])) {
      addEnemies(spec.type || "drone", spec.count || 6, spec.hp || 1, spec.speed || 100, spec.fireRate || 0);
    }
    if (this.level?.boss) {
      const b = this.level.boss;
      const boss = new Enemy(this.cv.clientWidth / 2, 120);
      boss.type = "boss";
      boss.hp   = b.hp   ?? 25;
      boss.speed= b.speed?? 85;
      boss.vx   = 60;
      boss.vy   = 0;
      boss.fireRate = b.fireRate ?? 2;
      boss.fireCd   = 1.5;
      this.enemies.push(boss);
    }
    // fallback si no había configuración
    if (this.enemies.length === 0) {
      for (let i = 0; i < 6; i++) {
        const e = new Enemy(60 + i * 80, 100 + Math.random() * 60);
        e.type = "drone"; e.hp = 1; e.speed = 100; e.vx = (Math.random() < 0.5 ? -1 : 1) * 40;
        e.fireRate = 0; e.fireCd = 1;
        this.enemies.push(e);
      }
    }

    // colecciones y contadores
    this.bullets.length = 0;
    this._shotsFired    = 0;
    this._approxHits    = 0;

    // estado
    this.state         = "playing";
    this._invuln       = 0;
    this._finishedSent = false;
    this._freezeWorld  = false;
  }

  start({ onFinish } = {}) {
    this.onFinish = onFinish || (() => {});
    if (!this.level) this.loadLevel(0);

    this.running = true;
    this.lastT   = performance.now();

    const loop = (t) => {
      if (!this.running) return;
      const dt = Math.min(0.033, (t - this.lastT) / 1000);
      this.lastT = t;

      // cooldown de pausa
      if (this._pauseCooldown > 0) this._pauseCooldown -= dt;

      // Toggle de pausa (debounce 250ms) — solo cuando estamos jugando
      if ((this.input.pressed("p") || this.input.pressed("escape")) &&
          this._pauseCooldown <= 0 &&
          (this.state === "playing" || this.state === "paused")) {
        this.pauseToggle();
        this._pauseCooldown = 0.25;
      }

      if (this._invuln > 0) this._invuln -= dt;

      if (this.state === "playing" && !this._freezeWorld) {
        this.update(dt);
        this.time += dt;
        if (this.time >= this.timeLimitSec) this._onTimeUp();
      }

      this.render();
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this._raf != null) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
  }

  pauseToggle() {
    if (this.state === "playing") this.state = "paused";
    else if (this.state === "paused") this.state = "playing";
  }

  _onTimeUp() {
    if (this._finishedSent) return;
    this.finish(false, "timeout");
  }

  // -------------------------------------------------------
  // UPDATE
  // -------------------------------------------------------
  update(dt) {
    this.player.update(dt, this.input, this.cv.clientWidth, this.cv.clientHeight);

    // Disparo normal
    if ((this.input.pressed(" ") || this.input.pressed("space")) && this.player.canShoot()) {
      this.player.shot();
      this.bullets.push(new Bullet(this.player.x, this.player.y - 12, 0, -480));
      this._shotsFired += 1;
    }

    // Especial (ráfaga radial)
    if (this.input.pressed("x") && this.player.specials > 0) {
      this.player.specials--;
      const N = 18;
      for (let i = 0; i <= N; i++) {
        const a  = (Math.PI * 2 * i) / N;
        const vx = Math.cos(a) * 380;
        const vy = Math.sin(a) * 380;
        this.bullets.push(new Bullet(this.player.x, this.player.y, vx, vy, { special: true }));
      }
      this._shotsFired += (N + 1);
    }

    // BALAS: movimiento
    for (const b of this.bullets) b.update(dt);

    // Balas jugador → mapa (tiles/bunker)
    for (const b of this.bullets) {
      if (b.enemy) continue;
      const hit = bulletHitTile(b, b.special);
      // Victoria por bunker SOLO si el modo es "hunt" (o si no hay info, asumimos hunt)
      const isHunt = this.level?.mode ? this.level.mode === "hunt" : true;
      if (hit === "bunker" && isHunt) {
        this.finish(true, "bunker");
        break;
      }
    }

    // Limpiar balas fuera de pantalla
    this.bullets = this.bullets.filter(
      (b) => !b.dead && b.x > -20 && b.x < this.cv.clientWidth + 20 && b.y > -40 && b.y < this.cv.clientHeight + 40
    );

    // ENEMIGOS: movimiento + disparos
    for (const e of this.enemies) {
      e.update(dt);
      if (e.x < 30 || e.x > this.cv.clientWidth - 30) e.vx *= -1;

      if (e.fireRate && (e.fireCd -= dt) <= 0) {
        e.fireCd = 1 / e.fireRate;
        const dx = this.player.x - e.x;
        const dy = this.player.y - e.y;
        const k  = 280 / Math.hypot(dx, dy || 1);
        const vx = dx * k;
        const vy = dy * k;
        const eb = new Bullet(e.x, e.y, vx, vy);
        eb.enemy  = true;
        eb.damage = 1;
        this.bullets.push(eb);
      }
    }

    // DAÑO: balas del jugador → enemigos
    for (const e of this.enemies) {
      for (const b of this.bullets) {
        if (b.enemy) continue;
        const dx = e.x - b.x, dy = e.y - b.y;
        const r  = e.type === "boss" ? 18 : 12;
        if (dx * dx + dy * dy < r * r) {
          e.hp -= b.special ? 2 : 1;
          b.dead = true;
          this._approxHits = (this._approxHits || 0) + 1;
        }
      }
    }

    // DAÑO: balas enemigas → jugador (con invulnerabilidad tras revivir)
    for (const b of this.bullets) {
      if (!b.enemy) continue;
      const dx = this.player.x - b.x, dy = this.player.y - b.y;
      if (dx * dx + dy * dy < 14 * 14) {
        b.dead = true;
        if (this._invuln <= 0) {
          this.player.hp -= (b.damage || 1);
          if (this.player.hp <= 0) {
            this.player.lives -= 1;
            if (this.player.lives > 0) {
              // revive
              this.player.hp = this.player.maxHp;
              this._invuln   = 0.75; // 750 ms
            } else {
              this.finish(false, "death");
              return;
            }
          }
        }
      }
    }

    // limpiar muertos
    this.enemies = this.enemies.filter((e) => e.hp > 0);
    this.bullets = this.bullets.filter((b) => !b.dead);

    // victoria cuando no hay enemigos (si el modo lo permite)
    const canWinByClear = this.level?.mode ? (this.level.mode !== "hunt_only_bunker") : true;
    if (this.state === "playing" && this.enemies.length === 0 && canWinByClear) {
      this.finish(true, "clear");
    }
  }

  // -------------------------------------------------------
  // FIN DE PARTIDA
  // -------------------------------------------------------
  finish(victory, reason) {
    if (this._finishedSent) return;
    this._finishedSent = true;

    // congela el mundo (pero dejamos el RAF para render de fondo)
    this._freezeWorld = true;
    this.state = victory ? "victory" : "gameover";

    const shots = this._shotsFired;
    const hits  = this._approxHits || Math.max(0, Math.floor(shots * 0.25));
    const elapsed_ms = Math.floor(Math.min(this.time, this.timeLimitSec) * 1000);

    try {
      this.onFinish({ victory, reason, stats: { shots, hits, elapsed_ms } });
    } catch (e) {
      console.error("onFinish error:", e);
    }
  }

  // -------------------------------------------------------
  // RENDER
  // -------------------------------------------------------
  render() {
    const ctx = this.ctx;
    const W = this.cv.clientWidth, H = this.cv.clientHeight;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#091224";
    ctx.fillRect(0, 0, W, H);

    // grid sutil
    ctx.strokeStyle = "rgba(255,255,255,.05)";
    for (let x = 0; x < W; x += 26) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 26) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    // mapa
    drawMap(ctx);

    // balas
    for (const b of this.bullets) b.draw(ctx);

    // enemigos
    for (const e of this.enemies) e.draw(ctx);

    // jugador
    if (this.player) this.player.draw(ctx);

    // HUD
    ctx.fillStyle = "#fff";
    ctx.font = "12px ui-sans-serif, system-ui";
    if (this.player) {
      ctx.fillText(`HP: ${this.player.hp}/${this.player.maxHp}  L: ${this.player.lives}  Spc: ${this.player.specials}`, 8, 14);
    }
    ctx.fillText(`Lvl ${this.levelIndex + 1}  Time: ${Math.floor(this.time)} / ${this.timeLimitSec}`, 8, 28);

    // Labels (el overlay se encarga de los popups)
    if (this.state === "paused")   ctx.fillText("PAUSA", W / 2 - 20, 24);
    if (this.state === "victory")  ctx.fillText("¡VICTORIA!", W / 2 - 36, 24);
    if (this.state === "gameover") ctx.fillText("GAME OVER", W / 2 - 40, 24);
  }
}
