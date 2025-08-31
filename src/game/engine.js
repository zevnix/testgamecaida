// /src/game/engine.js
import { Input } from "./input.js";
import { Player, Enemy, Bullet } from "./entities.js";
import { resizeMap, buildMap, drawMap, bulletHitTile, setMapLevel, setFlashFrozen } from "./map.js";
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
    this.bullets = [];
    this.enemies = [];

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

    // contadores cliente
    this._shotsFired  = 0;
    this._approxHits  = 0;

    // control
    this._pauseCooldown = 0;
    this._invuln        = 0;
    this._finishedSent  = false;
    this._freezeWorld   = false;
    this._raf           = null;
  }

  _getLevelRecipe(idx) {
    if (idx < LEVELS.length) return LEVELS[idx];
    return procedurallyScale(LEVELS[LEVELS.length - 1], idx - LEVELS.length + 1);
  }

  loadLevel(levelIdx) {
    this.levelIndex = levelIdx;
    this.level      = this._getLevelRecipe(levelIdx);

    // mapa
    setMapLevel(this.level);
    buildMap();                // también des-congela el flash
    setFlashFrozen(false);

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

      if (this._pauseCooldown > 0) this._pauseCooldown -= dt;

      // toggle pausa solo cuando estamos jugando/pausados
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
    if (this.state === "playing") {
      this.state = "paused";
      setFlashFrozen(true);   // congela el parpadeo del búnker
    } else if (this.state === "paused") {
      this.state = "playing";
      setFlashFrozen(false);  // reanuda el parpadeo
    }
  }

  _onTimeUp() {
    if (this._finishedSent) return;
    this.finish(false, "timeout");
  }

  // ---------------- UPDATE ----------------
  update(dt) {
    this.player.update(dt, this.input, this.cv.clientWidth, this.cv.clientHeight);

    // disparo
    if ((this.input.pressed(" ") || this.input.pressed("space")) && this.player.canShoot()) {
      this.player.shot();
      this.bullets.push(new Bullet(this.player.x, this.player.y - 12, 0, -480));
      this._shotsFired += 1;
    }

    // especial radial
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

    // balas → movimiento
    for (const b of this.bullets) b.update(dt);

    // balas jugador → mapa
    for (const b of this.bullets) {
      if (b.enemy) continue;
      const hit = bulletHitTile(b, b.special);
      const isHunt = this.level?.mode ? this.level.mode === "hunt" : true;
      if (hit === "bunker" && isHunt) {
        this.finish(true, "bunker");
        break;
      }
    }

    // fuera de pantalla
    this.bullets = this.bullets.filter(
      (b) => !b.dead && b.x > -20 && b.x < this.cv.clientWidth + 20 && b.y > -40 && b.y < this.cv.clientHeight + 40
    );

    // enemigos: movimiento + disparos
    for (const e of this.enemies) {
      e.update(dt);
      if (e.x < 30 || e.x > this.cv.clientWidth - 30) e.vx *= -1;

      if (e.fireRate && (e.fireCd -= dt) <= 0) {
        e.fireCd = 1 / e.fireRate;
        const dx = this.player.x - e.x;
        const dy = this.player.y - e.y;
        const k  = 280 / Math.hypot(dx, dy || 1);
        const eb = new Bullet(e.x, e.y, dx * k, dy * k);
        eb.enemy  = true;
        eb.damage = 1;
        this.bullets.push(eb);
      }
    }

    // daño jugador
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
              this.player.hp = this.player.maxHp;
              this._invuln   = 0.75;
            } else {
              this.finish(false, "death");
              return;
            }
          }
        }
      }
    }

    // muertos
    this.enemies = this.enemies.filter((e) => e.hp > 0);
    this.bullets = this.bullets.filter((b) => !b.dead);

    // victoria por limpiar
    const canWinByClear = this.level?.mode ? (this.level.mode !== "hunt_only_bunker") : true;
    if (this.state === "playing" && this.enemies.length === 0 && canWinByClear) {
      this.finish(true, "clear");
    }
  }

  // ---------------- FIN ----------------
  finish(victory, reason) {
    if (this._finishedSent) return;
    this._finishedSent = true;

    this._freezeWorld = true;
    this.state = victory ? "victory" : "gameover";
    setFlashFrozen(true); // el parpadeo queda quieto en la pantalla final

    const shots = this._shotsFired;
    const hits  = this._approxHits || Math.max(0, Math.floor(shots * 0.25));
    const elapsed_ms = Math.floor(this.time * 1000); // tiempo “in-game”; el backend usa su reloj

    try {
      this.onFinish({ victory, reason, stats: { shots, hits, elapsed_ms } });
    } catch (e) {
      console.error("onFinish error:", e);
    }
  }

  // ---------------- RENDER ----------------
  render() {
    const ctx = this.ctx;
    const W = this.cv.clientWidth, H = this.cv.clientHeight;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#091224";
    ctx.fillRect(0, 0, W, H);

    // grid
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

    // HUD dentro del canvas (ligero)
    ctx.fillStyle = "#fff";
    ctx.font = "12px ui-sans-serif, system-ui";
    if (this.player) ctx.fillText(`HP: ${this.player.hp}/${this.player.maxHp}  L: ${this.player.lives}  Spc: ${this.player.specials}`, 8, 14);
    ctx.fillText(`Lvl ${this.levelIndex + 1}  Time: ${Math.floor(this.time)} / ${this.timeLimitSec}`, 8, 28);

    if (this.state === "paused")   ctx.fillText("PAUSA", W / 2 - 20, 24);
    if (this.state === "victory")  ctx.fillText("¡VICTORIA!", W / 2 - 36, 24);
    if (this.state === "gameover") ctx.fillText("GAME OVER", W / 2 - 40, 24);
  }
}
