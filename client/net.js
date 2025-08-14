// client/net.js
"use strict";
// Lightweight client-only realtime via Supabase Presence
// No server needed.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function createNet({ url, anonKey, room = "shepherd-room-1" }) {
  const sb = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let channel = null;
  let myId = null;
  const others = new Map(); // id -> { id, name, x, y, ts }

  // callbacks
  let onUpsert = () => {};
  let onRemove = () => {};

  function connect(name = "Shep") {
    channel = sb.channel(room, {
      config: { presence: { key: Math.random().toString(36).slice(2, 10) } }
    });

    channel.on("presence", { event: "sync" }, () => {
      // Presence state is a map: presenceKey -> metas[]
      const state = channel.presenceState();
      const seen = new Set();

      for (const key in state) {
        const metas = state[key];
        metas.forEach((m) => {
          const id = m.presence_ref;            // unique per connection
          if (!myId && m.name && m.self) myId = id;

          const p = {
            id,
            name: m.name || "anon",
            x: m.x|0 || 0,
            y: m.y|0 || 0,
            ts: performance.now()
          };
          others.set(id, p);
          seen.add(id);
          onUpsert(p);
        });
      }
      // remove stale ones
      for (const [id] of others) {
        if (!seen.has(id)) {
          others.delete(id);
          onRemove(id);
        }
      }
    });

    // join + seed initial presence
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ name, x: 0, y: 0, self: true });
      }
    });
  }

  function setState(x, y) {
    if (!channel) return;
    // Update presence payload (throttled by caller)
    channel.track({ x: x|0, y: y|0, name: "Shep" });
  }

  return {
    connect,
    setState,
    others,      // Map you can read in your render loop if you want
    onUpsert(fn){ onUpsert = fn || (()=>{}); },
    onRemove(fn){ onRemove = fn || (()=>{}); },
    get id(){ return myId; }
  };
}