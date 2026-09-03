'use strict';

/* Keyboard.
   WASD .......... move (screen relative)
   SPACE ......... guard up (held)
   ARROW DOWN .... duck (held)
   ARROW LEFT .... jab            ARROW RIGHT ....... cross
   UP + LEFT ..... left uppercut  UP + RIGHT ........ right uppercut
   DOWN + LEFT ... left body      DOWN + RIGHT ...... right body
   SHIFT + LEFT .. left hook      SHIFT + RIGHT ..... right hook

   The modifier is read from what is *already held* at the moment the
   left/right arrow goes down, so DOWN-then-LEFT gives a body shot. */
const Input = {
  keys: Object.create(null),
  hits: Object.create(null),   // keys that went down this frame, for menus
  queue: [],          // punches requested this frame
  onMeta: null,       // callback for pause / mute / help / reset

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
      this.keys[k] = true;
      this.hits[k] = true;

      if (raw === 'ArrowLeft' || raw === 'ArrowRight') {
        const left = raw === 'ArrowLeft';
        let name;
        if (e.shiftKey || this.keys['Shift'])   name = left ? 'leftHook'  : 'rightHook';
        else if (this.keys['ArrowUp'])          name = left ? 'leftUpper' : 'rightUpper';
        else if (this.keys['ArrowDown'])        name = left ? 'leftBody'  : 'rightBody';
        else                                    name = left ? 'jab'       : 'cross';
        if (this.queue.length < 2) this.queue.push(name);
      }

      if (this.text !== null) {                 // naming a fighter, or signing in
        if (raw === 'Backspace') { this.text = this.text.slice(0, -1); e.preventDefault(); }
        else if (raw.length === 1) {
          if (this.charset === 'name') {
            if (/[a-zA-Z0-9]/.test(raw)) this.text += raw.toUpperCase();
          } else if (this.charset === 'email') {
            if (/[a-zA-Z0-9@._+-]/.test(raw)) this.text += raw.toLowerCase();
          } else if (/[!-~]/.test(raw)) {
            this.text += raw;                   // a password takes anything
          }
        }
        return;
      }
      if (this.onMeta && ('pmhr'.includes(k) || k === 'Escape')) this.onMeta(k);
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

  down(k) { return !!this.keys[k]; },

  // true only on the frame the key went down - menus need presses, not holds
  pressed(k) { return !!this.hits[k]; },
  any(...ks) { return ks.some(k => this.hits[k]); },
  endFrame() { this.hits = Object.create(null); },

  takePunch() { return this.queue.length ? this.queue.shift() : null; },

  flush() { this.queue.length = 0; },
};
