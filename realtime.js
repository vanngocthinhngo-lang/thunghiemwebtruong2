'use strict';
// Shared public campus room. Presence is for online membership; Broadcast is for live transforms/gameplay.
(() => {
  const api = window.campusBridge;
  const ROOM = 'ute-campus-main-campus-v2'; // Same topic for the gate, walk mode, shooting and football.
  const EVENTS = ['pos','shot','hit','kill','kick','ballreset','pick','matchState','ballstate','goal','botstate'];
  const handlers = {}, peers = new Map(), presenceHandlers = new Set();
  const finite = Number.isFinite, clamp = (v, m) => Math.max(-m, Math.min(m, v));
  const makeId = () => (window.crypto?.randomUUID ? crypto.randomUUID() : `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,12)}`);
  let ch = null, db = null, authId = null, selfId = makeId(), roster = [], rosterAt = 0, muted = new Set(), live = false;
  let extra = {}, raf = 0, lastSend = 0, lastSig = '', lastFrame = 0, presence = [], profile = { name: 'Người chơi', color: '#2864cf' };
  let retryTimer = 0, retryAttempt = 0, stopping = false, statusText = 'Chưa kết nối phòng chung';
  const sentAt = new Map();
  const EVENT_GAP = { pos: 190, ballstate: 320, botstate: 300, matchState: 1000, shot: 70, kick: 130, pick: 160 };
  const MAX_EVENT_BYTES = 1800;
  const net = { decorate: null };

  function notifyPresence() {
    const state = ch && typeof ch.presenceState === 'function' ? ch.presenceState() : {};
    const seen = new Map();
    Object.entries(state || {}).forEach(([key, entries]) => {
      (Array.isArray(entries) ? entries : []).forEach(meta => {
        const id = String(meta?.client_id || key || '');
        if (!id || seen.has(id)) return;
        seen.set(id, {
          id, userId: String(meta?.user_id || ''),
          name: String(meta?.name || 'Người chơi').slice(0, 24),
          color: /^#[0-9a-f]{6}$/i.test(meta?.color || '') ? meta.color : '#2864cf'
        });
      });
    });
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
    if (!q) { q = { x, z, y: clamp(p.y || 0, 14), yaw: p.yaw }; peers.set(p.from, q); }
    q.tx = x; q.tz = z; q.ty = clamp(finite(+p.y) ? +p.y : 0, 14); q.tyaw = p.yaw; q.t = Date.now();
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
    try { packed = { ...payload, from: selfId, room: ROOM }; if (JSON.stringify(packed).length > MAX_EVENT_BYTES) return false; }
    catch { return false; }
    try {
      const result = ch.send({ type: 'broadcast', event: type, payload: packed });
      sentAt.set(type, stamp);
      if (result?.catch) result.catch(err => console.warn('[UTE Realtime] Broadcast gửi thất bại:', err));
    } catch (err) { console.warn('[UTE Realtime] Broadcast lỗi:', err); return false; }
    return true;
  };

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - lastFrame) / 1000, .1); lastFrame = now;
    const t = Date.now();
    const rosterFresh = roster.length > 0 && t - rosterAt < 8000;
    const activePresenceUsers = new Set(presence.map(p => p.userId).filter(Boolean));
    const merged = new Map();
    // RPC roster is a fallback for position snapshots while Presence/Broadcast is joining.
    if (rosterFresh) roster.forEach(p => {
      if (!p?.id || p.id === authId || activePresenceUsers.has(String(p.id))) return;
      merged.set(String(p.id), { ...p, id: String(p.id) });
    });
    // Each browser tab has a unique Presence/client ID, even if it shares an auth session.
    presence.forEach(member => { merged.set(member.id, { ...member, x: NaN, z: NaN, yaw: 0 }); });
    const list = [], k = 1 - Math.exp(-dt * 10.5);
    for (const p of merged.values()) {
      if (p.id === selfId || muted.has(p.id)) continue;
      const q = peers.get(p.id), fresh = q && t - q.t < 6500;
      if (!fresh && (!finite(p.x) || !finite(p.z))) continue;
      let x = p.x, z = p.z, yaw = p.yaw || 0, e = null;
      if (fresh) {
        q.x += (q.tx - q.x) * k; q.z += (q.tz - q.z) * k; q.y += (q.ty - q.y) * k;
        let dy = q.tyaw - q.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); q.yaw += dy * k;
        x = q.x; z = q.z; yaw = q.yaw; e = q.e;
      }
      list.push({ id: p.id, userId: p.userId || p.id, name: net.decorate ? net.decorate(p, e) : p.name, color: p.color || '#2864cf', x, z,
        y: q && fresh ? q.y : (finite(+p.y) ? +p.y : 0), yaw,
        weapon: e?.weapon || '', moving: !!e?.moving, firing: !!e?.firing, hp: e?.hp ?? 100,
        fighting: !!e?.f, queue: !!e?.queue, queueAt: e?.queueAt || 0, team: e?.team ?? 0 });
    }
    if (window.campusGame?.botPlayer) { const bot = window.campusGame.botPlayer(); if (bot) list.push(bot); }
    if (list.length > 20) {
      const me = api.position();
      list.sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
      list.length = 20;
    }
    api.peers(list);

    if (live && t - lastSend >= 190) {
      const s = api.position(), sig = [Math.round(s.x * 12), Math.round(s.z * 12), Math.round((s.y || 0) * 10), Math.round(s.yaw * 24), JSON.stringify(extra)].join('|');
      if (sig !== lastSig || t - lastSend > 1600) {
        lastSig = sig; lastSend = t;
        net.emit('pos', { x: +s.x.toFixed(2), z: +s.z.toFixed(2), y: +(s.y || 0).toFixed(2), floor: s.floor || 0, yaw: +s.yaw.toFixed(3), e: extra });
      }
    }
  }

  function scheduleReconnect(reason) {
    live = false; statusText = 'Realtime gián đoạn · đang kết nối lại'; presence = []; peers.clear(); notifyPresence();
    const old = ch; ch = null;
    if (old && db) { try { db.removeChannel(old); } catch {} }
    if (stopping || retryTimer || !db || !authId) return;
    const delay = Math.min(15000, 900 * (2 ** Math.min(retryAttempt++, 4)));
    console.warn('[UTE Realtime] Kênh phòng chung gặp lỗi, thử lại sau', delay, 'ms:', reason || 'unknown');
    retryTimer = setTimeout(() => { retryTimer = 0; start(db); }, delay);
  }

  function start(client) {
    if (ch || !client || !client.channel || !authId || stopping) return;
    db = client;
    ch = db.channel(ROOM, { config: { private: false, broadcast: { self: false, ack: false }, presence: { key: selfId, enabled: true } } });
    statusText = 'Đang mở phòng chung UTE…'; notifyPresence();
    EVENTS.forEach(type => ch.on('broadcast', { event: type }, msg => dispatch(type, msg && msg.payload)));
    ch.on('presence', { event: 'sync' }, notifyPresence);
    ch.on('presence', { event: 'join' }, notifyPresence);
    ch.on('presence', { event: 'leave' }, notifyPresence);
    const thisChannel = ch;
    ch.subscribe(async (status, err) => {
      if (thisChannel !== ch) return;
      if (status === 'SUBSCRIBED') {
        live = true; statusText = 'Đã vào phòng chung UTE'; retryAttempt = 0;
        try {
          const result = await ch.track({ client_id: selfId, user_id: authId, name: profile.name, color: profile.color, room: ROOM, online_at: new Date().toISOString() });
          if (result?.status && result.status !== 'ok') console.warn('[UTE Presence] Track status:', result.status);
        } catch (e) { console.warn('[UTE Presence] Không thể track presence:', e); }
        notifyPresence();
        // Send an immediate position after entering the shared room.
        lastSend = 0; lastSig = '';
      } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
        scheduleReconnect(err || status);
      } else {
        statusText = 'Đang kết nối Realtime…'; notifyPresence();
      }
    });
    cancelAnimationFrame(raf); lastFrame = performance.now(); raf = requestAnimationFrame(frame);
  }

  net.roster = (client, players, self, mutedSet, me) => {
    roster = Array.isArray(players) ? players : []; authId = self ? String(self) : authId;
    muted = mutedSet || new Set(); rosterAt = Date.now(); stopping = false;
    if (me) profile = { name: String(me.name || 'Người chơi').slice(0, 24), color: /^#[0-9a-f]{6}$/i.test(me.color || '') ? me.color : '#2864cf' };
    if (!retryTimer) start(client);
    notifyPresence();
  };
  net.stop = () => {
    stopping = true; if (retryTimer) { clearTimeout(retryTimer); retryTimer = 0; }
    try { if (ch && db) db.removeChannel(ch); } catch {}
    ch = null; live = false; authId = null; peers.clear(); presence = []; cancelAnimationFrame(raf); roster = []; lastSig = ''; statusText = 'Đã rời phòng chung'; notifyPresence();
  };
  net.setExtra = obj => { extra = obj || {}; };
  net.self = () => selfId;
  net.clientId = () => selfId;
  net.authUserId = () => authId;
  net.live = () => live;
  net.status = () => statusText;
  net.room = () => ROOM;
  net.onlinePlayers = () => {
    const result = new Map(), presenceUsers = new Set(presence.map(p => p.userId).filter(Boolean));
    presence.forEach(p => result.set(p.id, { id: p.id, name: p.name, color: p.color, userId: p.userId }));
    if (roster.length && Date.now() - rosterAt < 8000) roster.forEach(p => {
      if (!p?.id || p.id === authId || presenceUsers.has(String(p.id))) return;
      result.set(String(p.id), { id: String(p.id), name: p.name || 'Người chơi', color: p.color || '#2864cf' });
    });
    return [...result.values()];
  };
  net.count = () => { const list = net.onlinePlayers(); return live && !list.some(p => p.id === selfId) ? list.length + 1 : list.length; };
  net.nameOf = id => presence.find(p => p.id === id)?.name || roster.find(p => p.id === id)?.name || 'người chơi';
  window.campusNet = net;
})();
