export class Input {
  constructor() { this.keys = new Set(); this.init(); }
  init() {
    addEventListener("keydown", e => this.keys.add(e.key.toLowerCase()));
    addEventListener("keyup",   e => this.keys.delete(e.key.toLowerCase()));
  }
  pressed(k) { return this.keys.has(k.toLowerCase()); }
}
