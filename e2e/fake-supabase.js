// In-browser stand-in for supabase-js, injected by the e2e run before the app
// loads. The "database" lives in localStorage, so tabs of one browser context
// share it (two tabs = two players); each tab keeps its own session in
// sessionStorage. It mirrors only what src/online.js uses, including the
// rules enforced by supabase/migrations (room size, start by host, scoring).
(() => {
  const DB_KEY = 'fake-supabase-db';
  const SESSION_KEY = 'fake-supabase-session';
  const read = () => JSON.parse(localStorage.getItem(DB_KEY) || 'null') || {
    users: [], profiles: [], runs: [], daily_results: [], rooms: [], room_players: [], room_guesses: [], answer_stats: [], daily_counts: [], seq: 1,
  };
  const write = (db) => localStorage.setItem(DB_KEY, JSON.stringify(db));
  const session = () => JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
  const uid = () => session()?.user.id ?? null;
  const err = (message) => ({ data: null, error: { message } });
  // Guessing games run on short clocks here (15 s + 6 s × 10 rounds on the server).
  const GUESS_CLOCK = { round_seconds: 4, reveal_seconds: 3, rounds: 3 };
  const roomDefaults = (mode) => ({ mode: mode || 'standing', ...GUESS_CLOCK, started_at: null });
  const startNow = (r) => { r.status = 'playing'; r.started_at = new Date(Date.now() + (r.mode === 'guess' ? 1500 : 0)).toISOString(); };
  const roundOpens = (r, round) => Date.parse(r.started_at) + round * (r.round_seconds + r.reveal_seconds) * 1000;

  function tableRows(db, table) {
    if (table === 'leaderboard') {
      const best = new Map();
      for (const r of db.runs) {
        const name = db.profiles.find((p) => p.id === r.user_id).username;
        const cur = best.get(name) || { username: name, best: 0, runs: 0 };
        best.set(name, { username: name, best: Math.max(cur.best, r.score), runs: cur.runs + 1 });
      }
      return [...best.values()];
    }
    if (table === 'room_guesses') {
      // Row level security: your own guesses, everyone's once the round's clock stops.
      const me = uid();
      return db.room_guesses.filter((g) => {
        const r = db.rooms.find((x) => x.id === g.room_id);
        return g.user_id === me || (r?.started_at && Date.now() >= roundOpens(r, g.round) + r.round_seconds * 1000);
      });
    }
    if (table === 'daily_results') {
      return db.daily_results.map((d) => ({ ...d, profiles: { username: db.profiles.find((p) => p.id === d.user_id)?.username } }));
    }
    return db[table];
  }

  class Query {
    constructor(table) { Object.assign(this, { table, filters: [], orders: [], max: Infinity, op: 'select', single: false }); }
    select(_cols, opts = {}) { if (this.op === 'select') this.opts = opts; return this; }
    eq(col, val) { this.filters.push((r) => String(r[col]) === String(val)); return this; }
    ilike(col, val) { const v = val.replace(/\\(.)/g, '$1').toLowerCase(); this.filters.push((r) => String(r[col]).toLowerCase() === v); return this; }
    order(col, { ascending = true } = {}) { this.orders.push([col, ascending]); return this; }
    limit(n) { this.max = n; return this; }
    maybeSingle() { this.single = true; return this; }
    insert(row) { this.op = 'insert'; this.row = row; return this; }
    update(row) { this.op = 'update'; this.row = row; return this; }
    upsert(row) { this.op = 'upsert'; this.row = row; return this; }
    then(resolve, reject) { return Promise.resolve().then(() => this.run()).then(resolve, reject); }
    run() {
      const db = read();
      const me = uid();
      if (this.op === 'insert') {
        if (!me) return err('not signed in');
        db[this.table].push({ id: db.seq++, user_id: me, created_at: new Date().toISOString(), ...this.row });
        write(db);
        return { data: null, error: null };
      }
      if (this.op === 'upsert') {
        const i = db.daily_results.findIndex((d) => d.user_id === this.row.user_id && d.day === this.row.day);
        if (i >= 0) db.daily_results[i] = this.row; else db.daily_results.push(this.row);
        write(db);
        return { data: null, error: null };
      }
      if (this.op === 'update') {
        const rows = db[this.table].filter((r) => this.filters.every((f) => f(r)));
        if (this.table === 'profiles' && db.profiles.some((p) => p.id !== me && p.username.toLowerCase() === this.row.username.toLowerCase())) {
          return err('duplicate key value violates unique constraint');
        }
        rows.forEach((r) => Object.assign(r, this.row));
        write(db);
        return { data: null, error: null };
      }
      let rows = tableRows(db, this.table).filter((r) => this.filters.every((f) => f(r)));
      for (const [col, asc] of [...this.orders].reverse()) {
        rows = [...rows].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1));
      }
      if (this.opts?.head) return { data: null, count: rows.length, error: null };
      rows = rows.slice(0, this.max);
      return { data: this.single ? rows[0] ?? null : rows, error: null };
    }
  }

  const authListeners = new Set();
  const notify = (event) => authListeners.forEach((fn) => fn(event, session()));
  const channels = new Set();
  window.addEventListener('storage', (e) => { if (e.key === DB_KEY) channels.forEach((c) => c.handlers.forEach((fn) => fn())); });

  function rpc(name, args) {
    const db = read();
    const me = uid();
    // Shared counters: open to guests without an account, like on the server.
    const bump = (table, match, init, add) => {
      let row = db[table].find(match);
      if (!row) { row = init; db[table].push(row); }
      add(row);
      write(db);
      return { data: null, error: null };
    };
    if (name === 'record_pair') return bump('answer_stats', (r) => r.key === args.pair_key, { key: args.pair_key, kind: 'pair', plays: 0, hits: 0, guess_sum: 0, miss_sum: 0 }, (r) => { r.plays++; r.hits += args.correct ? 1 : 0; });
    if (name === 'record_guess') return bump('answer_stats', (r) => r.key === args.card_id, { key: args.card_id, kind: 'guess', plays: 0, hits: 0, guess_sum: 0, miss_sum: 0 }, (r) => { r.plays++; r.guess_sum += args.guess; r.miss_sum += args.miss; });
    if (name === 'record_daily') return bump('daily_counts', (r) => r.day === args.day && r.game === args.game && r.score === args.score, { day: args.day, game: args.game, score: args.score, players: 0 }, (r) => { r.players++; });
    if (!me) return err('Sign in first');
    const profile = db.profiles.find((p) => p.id === me);
    const room = args?.room_code && db.rooms.find((r) => r.code === args.room_code.toUpperCase());
    const players = room ? db.room_players.filter((p) => p.room_id === room.id) : [];
    const touch = () => { write(db); channels.forEach((c) => c.handlers.forEach((fn) => fn())); };
    const newCode = () => Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, 'X');
    // Public games start PUBLIC_START_MS after the second player (20 s on the server; shorter here).
    const PUBLIC_START_MS = 3000;
    const tick = (r) => {
      const n = db.room_players.filter((p) => p.room_id === r.id).length;
      if (r.status === 'playing' && r.mode === 'guess' && Date.now() >= roundOpens(r, r.rounds)) r.status = 'finished';
      if (r.status !== 'lobby' || !r.is_public) return;
      if (n >= 2 && !r.starts_at) r.starts_at = new Date(Date.now() + PUBLIC_START_MS).toISOString();
      if (n < 2) r.starts_at = null;
      if (r.starts_at && Date.parse(r.starts_at) <= Date.now() && n >= 2) startNow(r);
    };
    if (name === 'server_time') return { data: new Date().toISOString(), error: null };
    if (name === 'quick_match') {
      const mode = args?.room_mode || 'standing';
      const category = args?.room_category ?? null;
      let r = db.rooms.find((x) => x.is_public && x.status === 'lobby' && x.mode === mode && x.category === category && db.room_players.filter((p) => p.room_id === x.id).length < 10);
      if (!r) {
        r = { id: `room-${db.seq++}`, code: newCode(), host_id: me, seed: Math.floor(Math.random() * 2 ** 31), status: 'lobby', is_public: true, starts_at: null, category, ...roomDefaults(mode) };
        db.rooms.push(r);
      }
      if (!db.room_players.some((p) => p.room_id === r.id && p.user_id === me)) {
        db.room_players.push({ room_id: r.id, user_id: me, username: profile.username, score: 0, alive: true, joined_at: new Date().toISOString() });
      }
      tick(r);
      touch();
      return { data: r.code, error: null };
    }
    if (name === 'create_room') {
      const r = { id: `room-${db.seq++}`, code: newCode(), host_id: me, seed: Math.floor(Math.random() * 2 ** 31), status: 'lobby', is_public: false, starts_at: null, category: args?.room_category ?? null, ...roomDefaults(args?.room_mode) };
      db.rooms.push(r);
      db.room_players.push({ room_id: r.id, user_id: me, username: profile.username, score: 0, alive: true, joined_at: new Date().toISOString() });
      touch();
      return { data: r.code, error: null };
    }
    if (!room) return name === 'room_heartbeat' || name === 'leave_room' ? { data: null, error: null } : err('Room not found');
    if (name === 'room_heartbeat') {
      const before = room.status;
      tick(room);
      if (room.status !== before) touch(); else write(db);
      return { data: null, error: null };
    }
    if (name === 'leave_room') {
      if (room.status === 'lobby') db.room_players = db.room_players.filter((p) => !(p.room_id === room.id && p.user_id === me));
      tick(room);
      touch();
      return { data: null, error: null };
    }
    if (name === 'join_room') {
      if (players.some((p) => p.user_id === me)) return { data: room.id, error: null };
      if (room.status !== 'lobby') return err('This game has already started');
      if (players.length >= 10) return err('Room is full (10 players)');
      db.room_players.push({ room_id: room.id, user_id: me, username: profile.username, score: 0, alive: true, joined_at: new Date().toISOString() });
      touch();
      return { data: room.id, error: null };
    }
    if (name === 'start_room') {
      if (room.host_id !== me || room.status !== 'lobby' || room.is_public) return err('Only the host can start this room');
      startNow(room);
      touch();
      return { data: null, error: null };
    }
    if (name === 'submit_guess') {
      if (room.mode !== 'guess' || room.status !== 'playing') return err('No guessing game running here');
      const opens = roundOpens(room, args.round_no);
      if (Date.now() < opens || Date.now() > opens + (room.round_seconds + 1.5) * 1000) return err('Too late for this round');
      db.room_guesses = db.room_guesses.filter((g) => !(g.room_id === room.id && g.user_id === me && g.round === args.round_no));
      db.room_guesses.push({ room_id: room.id, user_id: me, round: args.round_no, guess: Math.round(args.value * 10) / 10 });
      write(db);
      return { data: null, error: null };
    }
    if (name === 'report_room_score') {
      if (room.status !== 'playing') return { data: null, error: null };
      const p = players.find((x) => x.user_id === me && x.alive);
      if (p) { p.score = Math.max(p.score, args.new_score); p.alive = args.still_alive; }
      if (!db.room_players.some((x) => x.room_id === room.id && x.alive)) room.status = 'finished';
      touch();
      return { data: null, error: null };
    }
    return err(`unknown rpc ${name}`);
  }

  window.supabase = {
    createClient: () => ({
      auth: {
        getSession: async () => ({ data: { session: session() }, error: null }),
        onAuthStateChange: (fn) => { authListeners.add(fn); return { data: { subscription: { unsubscribe: () => authListeners.delete(fn) } } }; },
        signUp: async ({ email, password, options }) => {
          const db = read();
          if (db.users.some((u) => u.email === email)) return err('User already registered');
          const user = { id: `user-${db.seq++}`, email, password };
          db.users.push(user);
          db.profiles.push({ id: user.id, username: options.data.username });
          write(db);
          sessionStorage.setItem(SESSION_KEY, JSON.stringify({ user: { id: user.id, email } }));
          notify('SIGNED_IN');
          return { data: { session: session() }, error: null };
        },
        signInWithPassword: async ({ email, password }) => {
          const user = read().users.find((u) => u.email === email && u.password === password);
          if (!user) return err('Invalid login credentials');
          sessionStorage.setItem(SESSION_KEY, JSON.stringify({ user: { id: user.id, email } }));
          notify('SIGNED_IN');
          return { data: { session: session() }, error: null };
        },
        signInWithOAuth: async () => err('Unsupported provider: provider is not enabled'),
        signInAnonymously: async ({ options }) => {
          const db = read();
          let name = options.data.username;
          while (db.profiles.some((p) => p.username.toLowerCase() === name.toLowerCase())) name = `${options.data.username}${Math.floor(Math.random() * 90000) + 10000}`;
          const user = { id: `user-${db.seq++}`, email: null, password: null };
          db.users.push(user);
          db.profiles.push({ id: user.id, username: name });
          write(db);
          sessionStorage.setItem(SESSION_KEY, JSON.stringify({ user: { id: user.id, email: null, is_anonymous: true } }));
          notify('SIGNED_IN');
          return { data: { session: session() }, error: null };
        },
        updateUser: async ({ email, password }) => {
          const db = read();
          const me = session()?.user;
          if (!me) return err('not signed in');
          if (db.users.some((u) => u.email === email)) return err('A user with this email address has already been registered');
          Object.assign(db.users.find((u) => u.id === me.id), { email, password });
          write(db);
          sessionStorage.setItem(SESSION_KEY, JSON.stringify({ user: { id: me.id, email, is_anonymous: false } }));
          return { data: { user: session().user }, error: null };
        },
        getUser: async () => ({ data: { user: session() ? { ...session().user, email_confirmed_at: new Date().toISOString() } : null }, error: null }),
        signOut: async () => { sessionStorage.removeItem(SESSION_KEY); notify('SIGNED_OUT'); return { error: null }; },
      },
      from: (table) => new Query(table),
      rpc: async (name, args) => rpc(name, args),
      channel: () => {
        const c = { handlers: [], on(_type, _filter, fn) { this.handlers.push(fn); return this; }, subscribe() { channels.add(this); return this; } };
        return c;
      },
      removeChannel: (c) => channels.delete(c),
    }),
  };
})();
