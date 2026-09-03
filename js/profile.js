'use strict';

/* Where a player's fighters live.

   Today this is the browser's own storage, so everything works offline and
   without an account. It is deliberately the only place that touches storage:
   when the game gets accounts, `load` and `save` are the two functions that
   move to Supabase, and nothing else has to change. */
const Profile = {
  GUEST_KEY: 'retroboxing.profile.guest',
  data: null,

  /* Fighters belong to whoever made them. Signed in, they are the account's
     and are cached under its id; signed out, you get your own guest roster
     back. The two never mix. */
  key() {
    return Net.signedIn() ? 'retroboxing.profile.' + Net.userId() : this.GUEST_KEY;
  },

  blank() {
    return { account: null, fighters: new Array(FIGHTER_SLOTS).fill(null) };
  },

  newFighter() {
    return {
      name: '', weight: DEFAULT_WEIGHT, skin: 1, shorts: 0, country: 0,
      record: { w: 0, l: 0, d: 0, koFor: 0, koAgainst: 0 },
      training: { w: 0, l: 0, d: 0 },
      created: Date.now(),
    };
  },

  load() {
    // one-time tidy: the old single roster predates accounts, and keeping it
    // would show account fighters to a signed-out player
    try { localStorage.removeItem('retroboxing.profile.v1'); } catch (e) { /* ignore */ }
    try {
      const raw = localStorage.getItem(this.key());
      this.data = raw ? JSON.parse(raw) : this.blank();
    } catch (e) {
      this.data = this.blank();
    }
    if (!this.data.fighters || this.data.fighters.length !== FIGHTER_SLOTS) {
      this.data.fighters = new Array(FIGHTER_SLOTS).fill(null);
    }
    return this.data;
  },

  save() {
    try { localStorage.setItem(this.key(), JSON.stringify(this.data)); } catch (e) { /* private mode */ }
  },

  /* Signing out must leave nothing of the account behind on this machine. */
  dropAccountCache() {
    if (!Net.signedIn()) return;
    try { localStorage.removeItem(this.key()); } catch (e) { /* ignore */ }
  },

  fighters() { return this.data.fighters; },
  get(slot) { return this.data.fighters[slot]; },
  count() { return this.data.fighters.filter(Boolean).length; },

  put(slot, fighter) {
    this.data.fighters[slot] = fighter;
    this.save();
    if (Net.signedIn()) Net.pushFighter(slot, fighter).then(() => { Net.saveError = ''; })
      .catch(e => { Net.saveError = 'NOT SAVED: ' + e.message; });
  },

  remove(slot) {
    this.data.fighters[slot] = null;
    this.save();
    if (Net.signedIn()) Net.dropFighter(slot).then(() => { Net.saveError = ''; })
      .catch(e => { Net.saveError = 'NOT SAVED: ' + e.message; });
  },

  // the only thing a fighter can change once he exists
  setShorts(slot, i) {
    const f = this.get(slot);
    if (!f) return;
    f.shorts = (i + SHORTS.length) % SHORTS.length;
    this.save();
    if (Net.signedIn()) Net.patchFighter(slot, { shorts: f.shorts }).then(() => { Net.saveError = ''; })
      .catch(e => { Net.saveError = 'NOT SAVED: ' + e.message; });
  },

  /* Switch to the signed-in account's roster.

     The server is the truth, with one exception: a fighter this browser has
     and the server does not is one whose save has not landed yet - saving is
     two round trips - so it gets pushed up rather than thrown away. */
  async useAccount() {
    if (!Net.signedIn()) return;
    this.load();                       // whatever we cached for this account
    try {
      const cloud = await Net.pullFighters();
      for (let i = 0; i < FIGHTER_SLOTS; i++) {
        if (!cloud[i] && this.data.fighters[i]) {
          await Net.pushFighter(i, this.data.fighters[i]).catch(() => {});
          cloud[i] = this.data.fighters[i];
        }
      }
      this.data.fighters = cloud;
      this.save();
      await Net.pullFighters().then(rows => {
        for (let i = 0; i < FIGHTER_SLOTS; i++) if (rows[i]) this.data.fighters[i] = rows[i];
        this.save();
      }).catch(() => {});
    } catch (e) {
      // offline: keep showing the cache rather than an empty roster
    }
  },

  // first fighter in a division, so training can use your own man
  bySlot(slot) { return this.get(slot); },
  inClass(weight) {
    for (const f of this.data.fighters) if (f && f.weight === weight) return f;
    return null;
  },

  recordFight(slot, result, method, official) {
    const f = this.get(slot);
    if (!f) return;
    const r = official ? f.record : f.training;
    if (result === 'w') r.w++;
    else if (result === 'l') r.l++;
    else r.d++;
    if (official) {
      if (method === 'ko' && result === 'w') f.record.koFor++;
      if (method === 'ko' && result === 'l') f.record.koAgainst++;
    }
    this.save();
    // sparring is the only record a client is allowed to write
    if (!official && Net.signedIn()) {
      Net.patchFighter(slot, {
        training_w: f.training.w, training_l: f.training.l, training_d: f.training.d,
      }).catch(e => { Net.saveError = 'NOT SAVED: ' + e.message; });
    }
  },
};

function recordLine(r) { return r.w + '-' + r.l + '-' + r.d; }

function winPct(r) {
  const n = r.w + r.l + r.d;
  return n ? Math.round((r.w / n) * 100) : 0;
}
