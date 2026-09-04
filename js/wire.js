'use strict';

/* Two browsers, one fight.

   Rooms live in the database. The two peers swap connection details through
   the `signals` table (polled - the handshake is a handful of messages and
   takes a second or two), then open a WebRTC data channel straight to each
   other and the server drops out entirely.

   Over that channel they trade nothing but button presses. Both machines run
   the identical simulation from the identical inputs, so both screens show
   the identical fight. */

// a small deterministic generator, so both sides roll the same numbers
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const Rng = {
  fn: makeRng((Math.random() * 1e9) | 0),
  seed(s) { this.fn = makeRng(s); },
  next() { return this.fn(); },
};

const Wire = {
  DELAY: 4,                 // frames of input buffer
  ICE: [{ urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }],

  active: false,
  role: null,               // 'host' | 'guest'
  status: 'idle',           // idle|opening|waiting|joining|linking|ready|live|lost
  error: '',
  room: null,
  myFighter: null, theirFighter: null,
  seed: 0,

  pc: null, dc: null,
  poll: null, lastSignal: 0,
  frame: 0,
  mine: new Map(), theirs: new Map(),
  stalled: 0,
  myChecks: new Map(), theirChecks: new Map(), desync: 0,

  /* ------------------------------------------------------------- lifecycle */
  /* A room only deserves to exist while somebody is sitting in it. Backing
     out of the screen, or opening another one, closes it. */
  closeRoom() {
    const r = this.room;
    if (!r || !Net.signedIn() || this.status === 'live') return;
    // a room nobody fought in leaves nothing behind
    Net.call('/rest/v1/rooms?id=eq.' + r.id, {
      method: 'DELETE', headers: { Prefer: 'return=minimal' },
    }).catch(() => {});
  },

  reset(keepRoom) {
    if (!keepRoom) this.closeRoom();
    if (this.poll) { clearInterval(this.poll); this.poll = null; }
    if (this.dc) { try { this.dc.close(); } catch (e) {} }
    if (this.pc) { try { this.pc.close(); } catch (e) {} }
    this.active = false; this.role = null; this.status = 'idle'; this.error = '';
    this.room = null; this.myFighter = null; this.theirFighter = null;
    this.pc = null; this.dc = null; this.lastSignal = 0;
    this.frame = 0; this.mine.clear(); this.theirs.clear(); this.stalled = 0;
    this.myChecks.clear(); this.theirChecks.clear(); this.desync = 0;
  },

  fail(msg) {
    this.error = String(msg).toUpperCase().slice(0, 60);
    this.status = 'lost';
    if (this.poll) { clearInterval(this.poll); this.poll = null; }
  },

  /* ----------------------------------------------------------------- rooms */
  async host(fighter, fighterId) {
    this.reset();
    this.role = 'host';
    this.status = 'opening';
    this.myFighter = fighter;
    try {
      const rows = await Net.call('/rest/v1/rpc/create_room', {
        method: 'POST',
        body: { p_division: fighter.weight, p_fighter: fighterId },
      });
      this.room = Array.isArray(rows) ? rows[0] : rows;
      this.seed = (Date.parse(this.room.created_at) ^ parseInt(this.room.id.slice(0, 8), 16)) >>> 0;
      this.status = 'waiting';
      this.watchForGuest();
    } catch (e) { this.fail(e.message); }
  },

  async join(code, fighter, fighterId) {
    this.reset();
    this.role = 'guest';
    this.status = 'joining';
    this.myFighter = fighter;
    try {
      const rows = await Net.call('/rest/v1/rpc/join_room', {
        method: 'POST',
        body: { p_code: code, p_fighter: fighterId },
      });
      this.room = Array.isArray(rows) ? rows[0] : rows;
      this.seed = (Date.parse(this.room.created_at) ^ parseInt(this.room.id.slice(0, 8), 16)) >>> 0;
      await this.loadOpponent(this.room.host_fighter);
      this.status = 'linking';
      this.link();
    } catch (e) { this.fail(e.message); }
  },

  /* Join a room somebody else already put us both in - casual matchmaking
     and tournament bouts both land here. */
  async attach(room, myFighter) {
    const wasHost = room.host === Net.userId();
    this.reset(true);
    this.role = wasHost ? 'host' : 'guest';
    this.room = room;
    this.myFighter = myFighter;
    this.seed = (Date.parse(room.created_at) ^ parseInt(room.id.slice(0, 8), 16)) >>> 0;
    this.status = 'linking';
    try {
      await this.loadOpponent(wasHost ? room.guest_fighter : room.host_fighter);
      this.link();
    } catch (e) { this.fail(e.message); }
  },

  async loadOpponent(id) {
    const rows = await Net.call('/rest/v1/fighters?select=*&id=eq.' + id);
    if (rows && rows[0]) this.theirFighter = Net.fromRow(rows[0]);
  },

  // host waits for somebody to take the room, then starts the handshake
  watchForGuest() {
    this.poll = setInterval(async () => {
      try {
        const rows = await Net.call('/rest/v1/rooms?select=*&id=eq.' + this.room.id);
        const r = rows && rows[0];
        if (r && r.guest) {
          clearInterval(this.poll); this.poll = null;
          this.room = r;
          await this.loadOpponent(r.guest_fighter);
          this.status = 'linking';
          this.link();
        }
      } catch (e) { this.fail(e.message); }
    }, 1200);
  },

  /* ------------------------------------------------------------ signalling */
  send(kind, payload) {
    return Net.call('/rest/v1/signals', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: [{ room: this.room.id, sender: Net.userId(), kind, payload }],
    }).catch(() => {});
  },

  async link() {
    const pc = new RTCPeerConnection({ iceServers: this.ICE });
    this.pc = pc;

    pc.onicecandidate = e => { if (e.candidate) this.send('ice', e.candidate.toJSON()); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        if (this.status !== 'live') this.fail('CONNECTION FAILED');
      }
    };

    if (this.role === 'host') {
      const dc = pc.createDataChannel('fight', { ordered: true });
      this.hookChannel(dc);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this.send('offer', { sdp: offer.sdp, type: offer.type });
    } else {
      pc.ondatachannel = e => this.hookChannel(e.channel);
    }
    this.readSignals();
  },

  hookChannel(dc) {
    this.dc = dc;
    dc.onopen = () => {
      // both sides start with a few frames of standing still
      for (let f = 0; f < this.DELAY; f++) {
        this.mine.set(f, null);
        this.theirs.set(f, null);
      }
      this.active = true;
      this.status = 'ready';
      if (this.poll) { clearInterval(this.poll); this.poll = null; }
    };
    dc.onclose = () => { if (this.status === 'live') this.fail('OPPONENT LEFT'); };
    dc.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.t === 'i') this.theirs.set(m.f, m.i);
      else if (m.t === 'c') { this.theirChecks.set(m.f, m.s); this.compare(m.f); }
    };
  },

  readSignals() {
    this.poll = setInterval(async () => {
      if (this.status === 'ready' || this.status === 'live') return;
      try {
        const rows = await Net.call('/rest/v1/signals?select=*&room=eq.' + this.room.id +
                                    '&id=gt.' + this.lastSignal + '&order=id.asc');
        for (const s of rows || []) {
          this.lastSignal = Math.max(this.lastSignal, s.id);
          if (s.sender === Net.userId()) continue;
          await this.handleSignal(s);
        }
      } catch (e) { /* keep trying */ }
    }, 900);
  },

  async handleSignal(s) {
    const pc = this.pc;
    if (s.kind === 'offer' && this.role === 'guest') {
      await pc.setRemoteDescription(s.payload);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.send('answer', { sdp: answer.sdp, type: answer.type });
    } else if (s.kind === 'answer' && this.role === 'host') {
      await pc.setRemoteDescription(s.payload);
    } else if (s.kind === 'ice') {
      try { await pc.addIceCandidate(s.payload); } catch (e) { /* out of order, fine */ }
    }
  },

  /* ------------------------------------------------------------- the fight */
  sendInput(frame, intent) {
    this.mine.set(frame, intent);
    if (this.dc && this.dc.readyState === 'open') {
      this.dc.send(JSON.stringify({ t: 'i', f: frame, i: intent }));
    }
  },

  ready(frame) { return this.mine.has(frame) && this.theirs.has(frame); },

  /* Both sides send a number standing for the whole fight every so often. If
     they ever disagree the two simulations have come apart, and saying so is
     far better than quietly playing two different fights. */
  check(frame, sum) {
    this.myChecks.set(frame, sum);
    if (this.dc && this.dc.readyState === 'open') {
      this.dc.send(JSON.stringify({ t: 'c', f: frame, s: sum }));
    }
    this.compare(frame);
  },

  compare(frame) {
    const mine = this.myChecks.get(frame), theirs = this.theirChecks.get(frame);
    if (mine === undefined || theirs === undefined) return;
    if (mine !== theirs && !this.desync) this.desync = frame;
    this.myChecks.delete(frame);
    this.theirChecks.delete(frame);
  },

  // host drives boxer A, guest drives boxer B - the same on both machines
  intents(frame) {
    const mine = this.mine.get(frame), theirs = this.theirs.get(frame);
    return this.role === 'host' ? { a: mine, b: theirs } : { a: theirs, b: mine };
  },
};
