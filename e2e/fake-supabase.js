// In-browser stand-in for supabase-js, injected by the e2e run before the app
// loads. The "database" lives in localStorage, so tabs of one browser context
// share it (two tabs = two players); each tab keeps its own session in
// sessionStorage. It mirrors only what src/online.js uses, including the
// rules enforced by supabase/migrations (room size, start by host, scoring).
(() => {
  const DB_KEY = 'fake-supabase-db';
  const SESSION_KEY = 'fake-supabase-session';
  const read = () => JSON.parse(localStorage.getItem(DB_KEY) || 'null') || {
    users: [], profiles: [], runs: [], daily_results: [], rooms: [], room_players: [], seq: 1,
  };
  const write = (db) => localStorage.setItem(DB_KEY, JSON.stringify(db));
  const session = () => JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
  const uid = () => session()?.user.id ?? null;
  const err = (message) => ({ data: null, error: { message } });

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
    if (!me) return err('Sign in first');
    const profile = db.profiles.find((p) => p.id === me);
    const room = args?.room_code && db.rooms.find((r) => r.code === args.room_code.toUpperCase());
    const players = room ? db.room_players.filter((p) => p.room_id === room.id) : [];
    const touch = () => { write(db); channels.forEach((c) => c.handlers.forEach((fn) => fn())); };
    if (name === 'create_room') {
      const code = Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, 'X');
      const r = { id: `room-${db.seq++}`, code, host_id: me, seed: Math.floor(Math.random() * 2 ** 31), status: 'lobby' };
      db.rooms.push(r);
      db.room_players.push({ room_id: r.id, user_id: me, username: profile.username, score: 0, alive: true, joined_at: new Date().toISOString() });
      touch();
      return { data: code, error: null };
    }
    if (!room) return err('Room not found');
    if (name === 'join_room') {
      if (players.some((p) => p.user_id === me)) return { data: room.id, error: null };
      if (room.status !== 'lobby') return err('This game has already started');
      if (players.length >= 10) return err('Room is full (10 players)');
      db.room_players.push({ room_id: room.id, user_id: me, username: profile.username, score: 0, alive: true, joined_at: new Date().toISOString() });
      touch();
      return { data: room.id, error: null };
    }
    if (name === 'start_room') {
      if (room.host_id !== me || room.status !== 'lobby') return err('Only the host can start this room');
      room.status = 'playing';
      touch();
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
