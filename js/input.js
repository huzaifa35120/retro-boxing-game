'use strict';

/* Keyboard. The right hand boxes, the left hand moves him.
   WASD ...... move (screen relative)      SPACE ... guard up (held)
   K ......... duck (held)                 Q / E ... slip left / right
   SHIFT ..... step in                     F ....... load a power shot
   J ......... jab                         L ....... cross
   I + J ..... left uppercut               I + L ... right uppercut
   U ......... left hook                   O ....... right hook
   N ......... left body                   M ....... right body

   I is read from what is *already held* when J or L goes down, so
   I-then-J gives an uppercut. K is only ever the crouch. */
/* The player's key layout. Local to this browser: what crosses the wire in
   an online fight is the intent, never the key that caused it, so two men
   with different layouts still run the same fight. */
const Binds = {
  KEY_STORE: 'retroboxing.binds.v1',
  map: Object.assign({}, DEFAULT_BINDS),

  load() {
    try {
      const raw = localStorage.getItem(this.KEY_STORE);
      if (raw) {
        const saved = JSON.parse(raw);
        for (const a in DEFAULT_BINDS) if (typeof saved[a] === 'string') this.map[a] = saved[a];
      }
    } catch (e) { /* a broken layout is not worth failing over */ }
  },
  save() {
    try { localStorage.setItem(this.KEY_STORE, JSON.stringify(this.map)); } catch (e) {}
  },
  k(action) { return this.map[action]; },
  label(action) { return keyLabel(this.map[action]); },
  is(action, k) { return this.map[action] === k; },
  usedBy(k) { for (const a in this.map) if (this.map[a] === k) return a; return null; },

  /* Two actions cannot share a key, so binding one onto another swaps them. */
  set(action, k) {
    const holder = this.usedBy(k);
    if (holder === action) return;
    if (holder) this.map[holder] = this.map[action];
    this.map[action] = k;
    this.save();
  },
  reset() { this.map = Object.assign({}, DEFAULT_BINDS); this.save(); },
};
Binds.load();

const Input = {
  keys: Object.create(null),
  hits: Object.create(null),   // keys that went down this frame, for menus
  queue: [],          // punches requested this frame
  onMeta: null,       // callback for pause / mute / help / reset
  capture: null,      // set to grab the next key press, for rebinding

  init() {
    const swallow = new Set([
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Spacebar',
    ]);

    window.addEventListener('keydown', e => {
      const raw = e.key;
      const k = raw.length === 1 ? raw.toLowerCase() : raw;
      if (swallow.has(raw)) e.preventDefault();
      Sfx.ensure();
      if (e.repeat) return;

      // the controls screen is listening for one key and nothing else
      if (this.capture) { e.preventDefault(); const f = this.capture; this.capture = null; f(raw); return; }

      this.keys[k] = true;

      /* A key that goes into a name or a room code must not also work a
         menu - B belongs in a room code, and it was also the back key. */
      if (this.text !== null && this.typeKey(raw)) { e.preventDefault(); return; }

      this.hits[k] = true;

      /* Two hands, and a key that raises them into uppercuts. Which keys
         those are is the player's business - see Binds. */
      const up = this.keys[Binds.k('upper')];
      let name = null;
      if (Binds.is('jab', k))        name = up ? 'leftUpper'  : 'jab';
      else if (Binds.is('cross', k)) name = up ? 'rightUpper' : 'cross';
      else if (Binds.is('hookL', k)) name = 'leftHook';
      else if (Binds.is('hookR', k)) name = 'rightHook';
      else if (Binds.is('bodyL', k)) name = 'leftBody';
      else if (Binds.is('bodyR', k)) name = 'rightBody';
      if (name && this.queue.length < 2) this.queue.push(name);

      if (this.onMeta && (k === 'Escape' || k === 'y' || k === 'n' ||
                          Binds.is('pause', k) || Binds.is('guide', k) ||
                          Binds.is('sound', k) || Binds.is('restart', k))) this.onMeta(k);
    });

    window.addEventListener('keyup', e => {
      const raw = e.key;
      const k = raw.length === 1 ? raw.toLowerCase() : raw;
      this.keys[k] = false;
    });

    // don't leave keys stuck down when the window loses focus
    window.addEventListener('blur', () => {
      this.keys = Object.create(null);
      this.hits = Object.create(null);
    });
  },

  /* Naming a fighter: letters and digits go into a buffer instead of the
     game. Space is left alone so it can still work menus. */
  text: null,
  charset: 'name',
  typing() { return this.text !== null; },
  startTyping(v, charset) {
    this.charset = charset || 'name';
    this.text = this.charset === 'name' ? (v || '').toUpperCase() : (v || '');
  },
  stopTyping() { const v = this.text || ''; this.text = null; return v; },
  takeTyped(max) {
    if (this.text === null) return '';
    if (this.text.length > max) this.text = this.text.slice(0, max);
    return this.text;
  },

  /* Takes the key if the field wants it, and says so, so the caller knows
     nothing else should act on it. */
  typeKey(raw) {
    if (raw === 'Backspace') { this.text = this.text.slice(0, -1); return true; }
    if (raw.length !== 1) return false;
    if (this.charset === 'name') {
      if (/[a-zA-Z0-9]/.test(raw)) { this.text += raw.toUpperCase(); return true; }
    } else if (this.charset === 'email') {
      if (/[a-zA-Z0-9@._+-]/.test(raw)) { this.text += raw.toLowerCase(); return true; }
    } else if (/[!-~]/.test(raw) && raw !== ' ') {
      this.text += raw;                        // a password takes anything but space
      return true;
    }
    return false;
  },

  down(k) { return !!this.keys[k]; },

  // true only on the frame the key went down - menus need presses, not holds
  pressed(k) { return !!this.hits[k]; },
  any(...ks) { return ks.some(k => this.hits[k]); },
  endFrame() { this.hits = Object.create(null); },

  takePunch() { return this.queue.length ? this.queue.shift() : null; },

  flush() { this.queue.length = 0; },
};
