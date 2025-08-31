export class Bullet {
  constructor(x,y,vx,vy,{enemy=false,special=false}={}) {
    this.x=x; this.y=y; this.vx=vx; this.vy=vy;
    this.enemy=enemy; this.special=special; this.dead=false;
  }
  update(dt){ this.x+=this.vx*dt; this.y+=this.vy*dt; }
  draw(ctx){
    ctx.fillStyle = this.enemy ? "#ff6a6a" : (this.special ? "#7dffbe" : "#fff");
    ctx.beginPath(); ctx.arc(this.x,this.y,2.2,0,Math.PI*2); ctx.fill();
  }
}

export class Player {
  constructor(x,y){ this.x=x; this.y=y; this.spd=260; this.hp=3; this.specials=1; this.cool=0; }
  update(dt, input, W, H){
    const L = input.pressed("a") || input.pressed("arrowleft");
    const R = input.pressed("d") || input.pressed("arrowright");
    const U = input.pressed("w") || input.pressed("arrowup");
    const D = input.pressed("s") || input.pressed("arrowdown");
    const vx = (R?1:0)-(L?1:0), vy=(D?1:0)-(U?1:0);
    this.x = Math.max(12, Math.min(W-12, this.x + vx*this.spd*dt));
    this.y = Math.max(12, Math.min(H-12, this.y + vy*this.spd*dt));
    this.cool = Math.max(0, this.cool - dt);
  }
  canShoot(){ return this.cool===0; }
  shot(){ this.cool = .12; }
  draw(ctx){
    ctx.fillStyle = "#7bd1ff";
    ctx.beginPath(); ctx.moveTo(this.x, this.y-10); ctx.lineTo(this.x-8,this.y+8); ctx.lineTo(this.x+8,this.y+8); ctx.closePath(); ctx.fill();
  }
}

export class Enemy {
  constructor(x,y){ this.x=x; this.y=y; this.hp=3; this.t=0; }
  update(dt){ this.t+=dt; /* puedes añadir movimiento */ }
  draw(ctx){
    ctx.fillStyle="#9cff95"; ctx.beginPath(); ctx.arc(this.x,this.y,10,0,Math.PI*2); ctx.fill();
    ctx.fillStyle="rgba(0,0,0,.35)"; ctx.fillRect(this.x-8,this.y-12,16,3);
    ctx.fillStyle="#fff"; ctx.fillRect(this.x-8,this.y-12,16*(this.hp/3),3);
  }
}
