'use strict';

/* Opponent AI: circles, closes the distance, throws scripted combos and
   reacts to the player's punches by guarding or slipping under them. */

const COMBOS = {
  open: [
    [['jab', 0], ['jab', 11], ['cross', 15]],
    [['jab', 0], ['cross', 14]],
    [['leftHook', 0], ['cross', 18]],
    [['jab', 0], ['leftBody', 13], ['rightHook', 17]],
    [['cross', 0]],
    [['jab', 0], ['jab', 10]],
    [['rightHook', 0]],
  ],
  vsGuard: [                       // player has their hands up
    [['leftBody', 0], ['rightBody', 12]],
    [['leftBody', 0], ['rightUpper', 16]],
    [['rightUpper', 0]],
    [['jab', 0], ['leftUpper', 15]],
  ],
  vsDuck: [                        // player is crouched
    [['rightUpper', 0]],
    [['leftUpper', 0], ['rightUpper', 18]],
    [['leftUpper', 0]],
  ],
  light: [                         // running low on wind: cheap punches only
    [['jab', 0]],
    [['jab', 0], ['jab', 11]],
    [['leftBody', 0]],
  ],
};

class Brain {
  constructor() { this.reset(); }

  reset() {
    this.timer = 40;
    this.mode = 'circle';
    this.circleDir = Math.random() < 0.5 ? 1 : -1;
    this.combo = [];
    this.comboT = 0;
    this.guardT = 0;
    this.duckT = 0;
    this.slipT = 0; this.slipDir = 0;
    this.react = 0;
    this.bounce = 0;
    this.gassed = false;
  }

  pickCombo(self, foe) {
    if (foe.hurt > 2) { this.mode = 'circle'; this.timer = 14; return; }  // let them get their guard back
    let pool = COMBOS.open;
    if (self.st < 40) pool = COMBOS.light;
    else if (foe.duckAmt > 0.55) pool = COMBOS.vsDuck;
    else if (foe.blocking) pool = COMBOS.vsGuard;
    const c = pool[(Math.random() * pool.length) | 0];
    this.combo = c.map(s => ({ p: s[0], d: s[1] }));
    this.comboT = 0;
  }

  think(self, foe) {
    const dx = foe.x - self.x, dz = foe.z - self.z;
    const dist = Math.hypot(dx, dz) || 1;
    const tx = dx / dist, tz = dz / dist;      // towards the player
    const lx = -tz * this.circleDir, lz = tx * this.circleDir;

    const out = { mx: 0, mz: 0, block: false, duck: false, slip: 0, punch: null };
    this.bounce += 0.09;

    if (self.hurt > 0 || self.down || foe.down) {
      this.combo.length = 0; this.slipT = 0; this.guardT = 12; return out;
    }

    // ---- out of wind: break off and get some air back -----------------------
    // Two thresholds, so it rests properly instead of dipping in and out of
    // the same few points of stamina.
    if (self.st < 24) this.gassed = true;
    else if (self.st > Math.min(55, self.stCap * 0.85)) this.gassed = false;
    if (this.gassed) {
      this.combo.length = 0;
      // backing into the ropes gets a tired boxer nowhere: slide along them
      // or simply stand and breathe instead
      const roped = Math.abs(self.x) > RING_HX - PAD_X - 4 ||
                    Math.abs(self.z) > RING_HZ - PAD_Z - 4;
      if (dist < 26) {
        out.block = true;
        if (roped) { out.mx = lx * 0.8; out.mz = lz * 0.8; }
        else { out.mx = -tx * 0.7; out.mz = -tz * 0.7; }
      } else if (dist < 42 && !roped) {
        out.mx = -tx * 0.6 + lx * 0.5; out.mz = -tz * 0.6 + lz * 0.5;
      }
      return out;                      // otherwise it just stands and breathes
    }

    // ---- read the player's punch and answer it -----------------------------
    if (this.react > 0) this.react--;
    if (foe.punch && foe.punch.f <= foe.punch.def.wind + 1 && dist < 44 && this.react === 0) {
      this.react = 26;
      if (Math.random() < 0.62) {
        this.combo.length = 0;
        const head = foe.punch.def.level !== 'body';
        const r = Math.random();
        if (head && r < 0.28)      this.duckT = 20 + (Math.random() * 8 | 0);
        else if (head && r < 0.58) {                       // roll the head off it
          this.slipT = 15 + (Math.random() * 9 | 0);
          this.slipDir = Math.random() < 0.5 ? -1 : 1;
        } else this.guardT = 18 + (Math.random() * 10 | 0);
      }
    }

    if (this.duckT > 0) {
      this.duckT--;
      out.duck = true;
      if (dist > 34) { out.mx = tx * 0.6; out.mz = tz * 0.6; }
      if (this.duckT === 0 && dist < 34 && self.st > 30 && Math.random() < 0.7) {
        this.combo = [{ p: Math.random() < 0.5 ? 'rightUpper' : 'leftUpper', d: 0 }];
      }
      return out;
    }

    if (this.slipT > 0) {
      this.slipT--;
      out.slip = this.slipDir;
      if (dist > 32) { out.mx = tx * 0.5; out.mz = tz * 0.5; }
      // slip, then come back over the top
      if (this.slipT === 0 && dist < 32 && self.st > 30 && Math.random() < 0.6) {
        this.combo = [{ p: Math.random() < 0.5 ? 'cross' : (this.slipDir < 0 ? 'rightHook' : 'leftHook'), d: 0 }];
      }
      return out;
    }

    if (this.guardT > 0) {
      this.guardT--;
      out.block = true;
      if (dist > 36) { out.mx = tx * 0.7; out.mz = tz * 0.7; }
      else if (dist < 20) { out.mx = -tx; out.mz = -tz; }
      if (this.guardT === 0 && dist < 36 && Math.random() < 0.65) this.pickCombo(self, foe);
      return out;
    }

    // ---- run the current combo --------------------------------------------
    if (this.combo.length) {
      if (this.comboT > 0) this.comboT--;
      if (this.comboT <= 0 && !self.punch) {
        const step = this.combo.shift();
        out.punch = step.p;
        this.comboT = (this.combo.length ? this.combo[0].d : 0);
      }
      if (dist > 30) { out.mx = tx * 0.9; out.mz = tz * 0.9; }
      else if (dist < 19) { out.mx = -tx * 0.6; out.mz = -tz * 0.6; }
      return out;
    }

    // ---- footwork ----------------------------------------------------------
    if (--this.timer <= 0) {
      if (dist > 50) { this.mode = 'approach'; this.timer = 26 + (Math.random() * 30 | 0); }
      else if (dist < 19) { this.mode = 'retreat'; this.timer = 16 + (Math.random() * 16 | 0); }
      else {
        const r = Math.random();
        if (r < 0.44) { this.pickCombo(self, foe); this.timer = 30; }
        else if (r < 0.72) { this.mode = 'circle'; this.circleDir = Math.random() < 0.5 ? 1 : -1; this.timer = 26 + (Math.random() * 34 | 0); }
        else if (r < 0.86) { this.mode = 'guard'; this.timer = 22 + (Math.random() * 20 | 0); }
        else { this.mode = 'approach'; this.timer = 20 + (Math.random() * 20 | 0); }
      }
    }

    switch (this.mode) {
      case 'approach':
        out.mx = tx; out.mz = tz;
        if (dist < 27) { this.mode = 'circle'; this.timer = 24; if (Math.random() < 0.55) this.pickCombo(self, foe); }
        break;
      case 'retreat':
        out.mx = -tx * 0.95; out.mz = -tz * 0.95;
        break;
      case 'guard':
        out.block = true;
        out.mx = lx * 0.5; out.mz = lz * 0.5;
        break;
      default: {                    // circle, drifting in and out of range
        const io = (dist > 34 ? 0.45 : (dist < 24 ? -0.5 : Math.sin(this.bounce) * 0.3));
        out.mx = lx * 0.85 + tx * io;
        out.mz = lz * 0.85 + tz * io;
      }
    }
    return out;
  }
}
