'use strict';
// Presence + Broadcast: danh sách online thực tế và vị trí/game state đồng bộ.
(() => {
  const api = window.campusBridge;
  const EVENTS = ['pos','shot','hit','kill','kick','ballreset','pick','matchState','ballstate','goal','botstate'];
  const handlers = {}, peers = new Map(), presenceHandlers = new Set();
  const finite = Number.isFinite, clamp = (v, m) => Math.max(-m, Math.min(m, v));
  let ch = null, db = null, selfId = null, roster = [], rosterAt = 0, muted = new Set(), live = false;
  let extra = {}, raf = 0, lastSend = 0, lastSig = '', lastFrame = 0, presence = [], profile = { name: 'Người chơi', color: '#2864cf' };
  const sentAt = new Map();
  const EVENT_GAP = { pos: 180, ballstate: 280, botstate: 240, matchState: 900, shot: 70, kick: 120, pick: 100 };
  const MAX_EVENT_BYTES = 1800;
  const net = { decorate: null };

  function notifyPresence() {
    const state = ch && typeof ch.presenceState === 'function' ? ch.presenceState() : {};
    const seen = new Map();
    Object.entries(state || {}).forEach(([key, entries]) => {
      (Array.isArray(entries) ? entries : []).forEach(meta => {
        const id = String(meta?.user_id || key || '');
        if (!id || seen.has(id)) return;
        seen.set(id, { id, name: String(meta?.name || 'Người chơi').slice(0, 24), color: /^#[0-9a-f]{6}$/i.test(meta?.color || '') ? meta.color : '#2864cf' });
      });
    });
    // Presence may take a moment to sync; retain the latest database roster during that window.
    presence = [...seen.values()];
    presenceHandlers.forEach(fn => { try { fn(presence.slice(), live); } catch (e) { console.error(e); } });
  }

  function dispatch(type, payload) {
    if (!payload || typeof payload !== 'object' || typeof payload.from !== 'string' || payload.from === selfId) return;
    if (type === 'pos') return onPos(payload);
    (handlers[type] || []).forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } });
  }

  function onPos(p) {
    if (![p.x, p.z, p.yaw].every(finite)) return;
    const e = p.e && typeof p.e === 'object' ? p.e : {};
    const x = clamp(p.x, 190), z = clamp(p.z, 190);
    let q = peers.get(p.from);
    if (!q) { q = { x, z, yaw: p.yaw }; peers.set(p.from, q); }
    q.tx = x; q.tz = z; q.tyaw = p.yaw; q.t = Date.now();
    q.e = {
      f: e.f ? 1 : 0, hp: Math.max(0, Math.min(100, +e.hp || 0)),
      w: e.w ? 1 : 0, weapon: typeof e.weapon === 'string' ? e.weapon : '',
      moving: !!e.moving, firing: !!e.firing, queue: !!e.queue,
      queueAt: finite(+e.queueAt) ? +e.queueAt : 0, team: e.team === 1 ? 1 : 0
    };
  }

  net.on = (type, fn) => { (handlers[type] = handlers[type] || []).push(fn); };
  net.onPresence = fn => { presenceHandlers.add(fn); try { fn(presence.slice(), live); } catch {} return () => presenceHandlers.delete(fn); };
  net.emit = (type, payload) => {
    if (!ch || !live || !EVENTS.includes(type) || !payload || typeof payload !== 'object') return false;
    const stamp = performance.now(), minGap = EVENT_GAP[type] || 0;
    if (minGap && stamp - (sentAt.get(type) || 0) < minGap) return false;
    let packed;
    try { packed = { ...payload, from: selfId }; if (JSON.stringify(packed).length > MAX_EVENT_BYTES) return false; }
    catch { return false; }
    try {
      const result = ch.send({ type: 'broadcast', event: type, payload: packed });
      sentAt.set(type, stamp);
      if (result?.catch) result.catch(() => {});
    } catch { return false; }
    return true;
  };

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - lastFrame) / 1000, .1); lastFrame = now;
    const t = Date.now();
    const rosterFresh = roster.length > 0 && t - rosterAt < 8000;
    const merged = new Map();
    if (rosterFresh) roster.forEach(p => merged.set(p.id, p));
    // Presence supplements the RPC roster. This keeps other browsers visible even if the
    // database's player-list RPC is delayed, while Broadcast supplies their live coordinates.
    presence.forEach(member => { if (!merged.has(member.id)) merged.set(member.id, { ...member, x: NaN, z: NaN, yaw: 0 }); });
    const list = [], k = 1 - Math.exp(-dt * 12);
    for (const p of merged.values()) {
      if (p.id === selfId || muted.has(p.id)) continue;
      const q = peers.get(p.id), fresh = q && t - q.t < 4500;
      if (!fresh && (!finite(p.x) || !finite(p.z))) continue;
      let x = p.x, z = p.z, yaw = p.yaw || 0, e = null;
      if (fresh) {
        q.x += (q.tx - q.x) * k; q.z += (q.tz - q.z) * k;
        let dy = q.tyaw - q.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); q.yaw += dy * k;
        x = q.x; z = q.z; yaw = q.yaw; e = q.e;
      }
      list.push({ id: p.id, name: net.decorate ? net.decorate(p, e) : p.name, color: p.color, x, z, yaw,
        weapon: e?.weapon || '', moving: !!e?.moving, firing: !!e?.firing, hp: e?.hp ?? 100,
        fighting: !!e?.f, queue: !!e?.queue, queueAt: e?.queueAt || 0, team: e?.team ?? 0 });
    }
    if (window.campusGame?.botPlayer) {
      const bot = window.campusGame.botPlayer();
      if (bot) list.push(bot);
    }
    if (list.length > 20) {
      const me = api.position();
      list.sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
      list.length = 20;
    }
    api.peers(list);

    // Keep sending even when the database roster is temporarily empty. Presence and broadcast
    // can recover independently from the RPC roster polling.
    if (live && t - lastSend >= 200) {
      const s = api.position(), sig = [Math.round(s.x * 10), Math.round(s.z * 10), Math.round(s.yaw * 30), JSON.stringify(extra)].join('|');
      if (sig !== lastSig || t - lastSend > 1700) {
        lastSig = sig; lastSend = t;
        net.emit('pos', { x: +s.x.toFixed(1), z: +s.z.toFixed(1), yaw: +s.yaw.toFixed(2), e: extra });
      }
    }
  }

  function start(client) {
    if (ch || !client || !client.channel || !selfId) return;
    db = client;
    ch = db.channel('ute-campus-room', { config: { broadcast: { self: false }, presence: { key: selfId } } });
    EVENTS.forEach(type => ch.on('broadcast', { event: type }, msg => dispatch(type, msg && msg.payload)));
    ch.on('presence', { event: 'sync' }, notifyPresence);
    ch.on('presence', { event: 'join' }, notifyPresence);
    ch.on('presence', { event: 'leave' }, notifyPresence);
    ch.subscribe(async status => {
      live = status === 'SUBSCRIBED';
      if (live) {
        try { await ch.track({ user_id: selfId, name: profile.name, color: profile.color, online_at: new Date().toISOString() }); }
        catch (e) { console.warn('[UTE Presence] Không thể track presence:', e); }
      }
      notifyPresence();
    });
    cancelAnimationFrame(raf); lastFrame = performance.now(); raf = requestAnimationFrame(frame);
  }

  net.roster = (client, players, self, mutedSet, me) => {
    roster = Array.isArray(players) ? players : []; selfId = self; muted = mutedSet || new Set(); rosterAt = Date.now();
    if (me) profile = { name: String(me.name || 'Người chơi').slice(0, 24), color: /^#[0-9a-f]{6}$/i.test(me.color || '') ? me.color : '#2864cf' };
    start(client);
    notifyPresence();
  };
  net.stop = () => {
    try { if (ch && db) db.removeChannel(ch); } catch {}
    ch = null; live = false; peers.clear(); presence = []; cancelAnimationFrame(raf); roster = []; lastSig = '';
    notifyPresence();
  };
  net.setExtra = obj => { extra = obj || {}; };
  net.self = () => selfId;
  net.live = () => live;
  // Merge the live Presence set with the most recent RPC roster. This avoids a visible
  // count drop while Presence is still syncing, and de-duplicates the same browser ID.
  net.onlinePlayers = () => {
    const merged = new Map();
    if (roster.length && Date.now() - rosterAt < 8000) roster.forEach(p => { if (p?.id) merged.set(p.id, { id: p.id, name: p.name || 'Người chơi', color: p.color || '#267c65' }); });
    presence.forEach(p => { if (p?.id) merged.set(p.id, { ...(merged.get(p.id) || {}), ...p }); });
    return [...merged.values()];
  };
  net.count = () => Math.max(1, net.onlinePlayers().length || 1);
  net.nameOf = id => (roster.find(p => p.id === id) || presence.find(p => p.id === id) || {}).name || 'người chơi';
  window.campusNet = net;
})();
