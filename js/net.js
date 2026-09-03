'use strict';

/* Talks to Supabase over plain fetch - no SDK, no CDN, no build step.

   Everything here is optional: with no keys in supabase-config.js, `online()`
   is false and the game runs entirely out of local storage. */
const Net = {
  SESSION_KEY: 'retroboxing.session.v1',
  session: null,          // { access_token, refresh_token, user }
  handle: null,
  busy: false,
  error: '',
  saveError: '',          // last time a write did not reach the server
  board: null,            // cached leaderboard rows
  boardDivision: -1,
  boardAt: 0,

  online() { return !!(SUPABASE.url && SUPABASE.anonKey); },
  signedIn() { return !!(this.session && this.session.access_token); },
  userId() { return this.session && this.session.user && this.session.user.id; },

  /* ---------------------------------------------------------- plumbing */
  headers(auth) {
    const h = { apikey: SUPABASE.anonKey, 'Content-Type': 'application/json' };
    h.Authorization = 'Bearer ' + (auth && this.signedIn() ? this.session.access_token
                                                           : SUPABASE.anonKey);
    return h;
  },

  async call(path, opts) {
    const o = opts || {};
    const res = await fetch(SUPABASE.url + path, {
      method: o.method || 'GET',
      headers: Object.assign(this.headers(o.auth !== false), o.headers || {}),
      body: o.body ? JSON.stringify(o.body) : undefined,
    });
    const txt = await res.text();
    let data = null;
    if (txt) { try { data = JSON.parse(txt); } catch (e) { data = txt; } }
    if (!res.ok) {
      const msg = (data && (data.msg || data.message || data.error_description ||
                            data.error || data.hint)) || ('HTTP ' + res.status);
      throw new Error(String(msg).toUpperCase().slice(0, 88));
    }
    return data;
  },

  /* -------------------------------------------------------------- auth */

  /* Players sign up with a name, not an email. We make an address out of the
     name purely because the auth service wants one - nothing is ever sent to
     it, and no real address is asked for or stored. */
  emailFor(user) { return user.trim().toLowerCase() + USER_DOMAIN; },

  validUser(user) {
    const u = (user || '').trim();
    if (u.length < USER_MIN) return 'AT LEAST ' + USER_MIN + ' CHARACTERS';
    if (u.length > USER_MAX) return 'AT MOST ' + USER_MAX + ' CHARACTERS';
    if (!/^[A-Za-z0-9]+$/.test(u)) return 'LETTERS AND NUMBERS ONLY';
    return '';
  },

  // is that name already somebody's?
  async nameTaken(user) {
    // case-insensitive: BOXER and boxer are the same fighter's name
    const rows = await this.call('/rest/v1/profiles?select=handle&handle=ilike.' +
                                 encodeURIComponent(user.trim()));
    return !!(rows && rows.length);
  },

  async signUpUser(user, password) {
    if (await this.nameTaken(user)) throw new Error('THAT NAME IS TAKEN');
    try {
      return await this.signUp(this.emailFor(user), password);
    } catch (e) {
      // the unique constraint is the real guard; make its message readable
      if (/ALREADY|REGISTERED|DUPLICATE|UNIQUE/.test(e.message)) throw new Error('THAT NAME IS TAKEN');
      throw e;
    }
  },

  async signInUser(user, password) {
    try {
      return await this.signIn(this.emailFor(user), password);
    } catch (e) {
      if (/INVALID LOGIN/.test(e.message)) throw new Error('NO SUCH NAME, OR WRONG PASSWORD');
      throw e;
    }
  },

  async signUp(email, password) {
    const d = await this.call('/auth/v1/signup', {
      method: 'POST', auth: false, body: { email, password },
    });
    if (d && d.access_token) this.keep(d);
    return d;
  },

  async signIn(email, password) {
    const d = await this.call('/auth/v1/token?grant_type=password', {
      method: 'POST', auth: false, body: { email, password },
    });
    this.keep(d);
    return d;
  },

  keep(d) {
    this.session = d;
    try { localStorage.setItem(this.SESSION_KEY, JSON.stringify(d)); } catch (e) { /* ignore */ }
  },

  restore() {
    try {
      const raw = localStorage.getItem(this.SESSION_KEY);
      if (raw) this.session = JSON.parse(raw);
    } catch (e) { this.session = null; }
  },

  signOut() {
    this.session = null;
    this.handle = null;
    try { localStorage.removeItem(this.SESSION_KEY); } catch (e) { /* ignore */ }
  },

  async whoAmI() {
    const rows = await this.call('/rest/v1/profiles?select=handle&id=eq.' + this.userId());
    this.handle = rows && rows[0] ? rows[0].handle : null;
    return this.handle;
  },

  /* ---------------------------------------------------------- fighters */
  // the shape the database uses, from the shape the game uses
  toRow(slot, f) {
    return {
      owner: this.userId(), slot,
      name: f.name, division: f.weight, skin: f.skin,
      shorts: f.shorts, country: f.country,
      training_w: f.training.w, training_l: f.training.l, training_d: f.training.d,
    };
  },

  fromRow(r) {
    return {
      name: r.name, weight: r.division, skin: r.skin, shorts: r.shorts, country: r.country,
      record: { w: r.wins, l: r.losses, d: r.draws, koFor: r.ko_for, koAgainst: r.ko_against },
      training: { w: r.training_w, l: r.training_l, d: r.training_d },
      created: r.created_at,
    };
  },

  fighterIds: null,        // slot -> database id, needed to open a room

  async pullFighters() {
    const rows = await this.call('/rest/v1/fighters?select=*&owner=eq.' + this.userId() +
                                 '&order=slot.asc');
    const out = new Array(FIGHTER_SLOTS).fill(null);
    this.fighterIds = new Array(FIGHTER_SLOTS).fill(null);
    for (const r of rows || []) {
      if (r.slot < FIGHTER_SLOTS) { out[r.slot] = this.fromRow(r); this.fighterIds[r.slot] = r.id; }
    }
    return out;
  },

  /* Insert only. An upsert would compile to ON CONFLICT DO UPDATE over the
     name, division, skin and country columns, and those are deliberately not
     updatable - a fighter's identity is fixed for life. So clear the slot
     first and put a fresh row in. */
  async pushFighter(slot, f) {
    await this.dropFighter(slot).catch(() => {});
    // ask for the row back: its id is what rooms, quick fights and the
    // tournament all need, and without it the game thinks you have no fighter
    const rows = await this.call('/rest/v1/fighters', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: [this.toRow(slot, f)],
    });
    const row = this.one(rows);
    if (row && row.id) this.setFighterId(slot, row.id);
    return row;
  },

  setFighterId(slot, id) {
    if (!this.fighterIds) this.fighterIds = new Array(FIGHTER_SLOTS).fill(null);
    this.fighterIds[slot] = id;
  },

  async patchFighter(slot, fields) {
    return this.call('/rest/v1/fighters?owner=eq.' + this.userId() + '&slot=eq.' + slot, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: fields,
    });
  },

  async dropFighter(slot) {
    this.setFighterId(slot, null);
    return this.call('/rest/v1/fighters?owner=eq.' + this.userId() + '&slot=eq.' + slot, {
      method: 'DELETE', headers: { Prefer: 'return=minimal' },
    });
  },

  /* ------------------------------------------------------- leaderboard */
  async pullBoard(division) {
    return this.call('/rest/v1/leaderboard?select=*&division=eq.' + division +
                     '&order=win_pct.desc,wins.desc&limit=10');
  },

  champ: null,          // the current champion of the division on screen
  tourney: null,        // this week's draw for the division on screen

  rpc(fn, body) { return this.call('/rest/v1/rpc/' + fn, { method: 'POST', body: body || {} }); },
  one(rows) { return Array.isArray(rows) ? (rows[0] || null) : (rows || null); },

  findCasual(fighterId) { return this.rpc('find_casual', { p_fighter: fighterId }).then(r => this.one(r)); },
  leaveCasual(fighterId) { return this.rpc('leave_casual', { p_fighter: fighterId }); },
  startBout(boutId) { return this.rpc('start_bout', { p_bout: boutId }).then(r => this.one(r)); },
  checkIn(t, f) { return this.rpc('check_in', { p_tourney: t, p_fighter: f }); },
  openTournament(div) { return this.rpc('open_tournament', { p_division: div }); },

  async pullTournament(division) {
    const ts = await this.call('/rest/v1/tournaments?select=*&division=eq.' + division +
                               '&order=starts_at.desc&limit=1');
    const t = this.one(ts);
    if (!t) return null;
    t.bouts = await this.call('/rest/v1/tourney_bouts?select=*&tourney=eq.' + t.id +
                              '&order=round.asc,slot.asc');
    t.checked = await this.call('/rest/v1/tourney_checkin?select=fighter&tourney=eq.' + t.id);
    return t;
  },

  async pullChampion(division) {
    const rows = await this.call('/rest/v1/champions_view?select=*&division=eq.' + division);
    return rows && rows[0] ? rows[0] : null;
  },

  // fire-and-forget for the UI: sets .board when it arrives
  wantBoard(division) {
    if (!this.online()) return;
    if (this.boardDivision === division && Date.now() - this.boardAt < 30000) return;
    this.boardDivision = division;
    this.boardAt = Date.now();
    this.busy = true;
    this.error = '';
    this.champ = null;
    Promise.all([this.pullBoard(division), this.pullChampion(division).catch(() => null)])
      .then(([rows, champ]) => { this.board = rows || []; this.champ = champ; })
      .catch(e => { this.error = e.message; this.board = null; })
      .then(() => { this.busy = false; });
  },
};
