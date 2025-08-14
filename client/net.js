// client/net.js
"use strict";

export function createNetWS({ url }) {
  let ws = null;
  let onSnapshot = () => {};
  let myId = null;

  function connect(name){
    ws = new WebSocket(url.replace(/^http/, "ws")); // support http(s) -> ws(s)
    ws.onopen = () => {
      if (name) send({ type:"join", name });
    };
    ws.onmessage = (ev) => {
      let msg = null;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg) return;

      if (msg.type === "hello") {
        myId = msg.id;
      } else if (msg.type === "snapshot") {
        onSnapshot(msg);
      }
    };
    ws.onclose = () => { /* optionally reconnect */ };
  }

  function send(obj){
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function sendInput(held){
    send({ type:"input", held });
  }

  return {
    connect,
    sendInput,
    onSnapshot: (cb) => { onSnapshot = cb; },
    get myId(){ return myId; }
  };
}
