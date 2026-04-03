const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const PORT = process.env.PORT || 3001;
const httpServer = http.createServer((req, res) => {
  const file = path.join(__dirname, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
});
const wss = new WebSocketServer({ server: httpServer });
const rooms = new Map();
function getRoomInfo(roomId) { if (!rooms.has(roomId)) return []; const r = rooms.get(roomId); const list = []; r.clients.forEach((ws, k) => { const info = r.info.get(ws); if (info) list.push(info); }); return list; }
wss.on('connection', (ws, req) => {
  const roomId = decodeURIComponent((req.url || '/').replace(/^\//, '')) || 'default';
  if (!rooms.has(roomId)) rooms.set(roomId, { clients: new Set(), info: new Map() });
  const room = rooms.get(roomId);
  room.clients.add(ws);
  ws._roomId = roomId;
  ws._info = { name: '?', ava: '😀' };
  console.log(`[+] 连接 roomId="${roomId}" 当前=${room.clients.size}`);
  const peers = getRoomInfo(roomId).filter(i => i.name !== '?');
  if (peers.length > 0) { ws.send(JSON.stringify({ type: 'peer_list', peers, note: '当前房间已有 ' + peers.length + ' 人在线' })); }
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'ping') return;
    if (msg.type === 'identity') {
      ws._info = { name: msg.name || '匿名', ava: msg.ava || '😀' };
      room.info.set(ws, ws._info);
      room.clients.forEach(c => { if (c !== ws && c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ type: 'peer_join', peer: ws._info })); });
      return;
    }
    room.clients.forEach(client => { if (client !== ws && client.readyState === WebSocket.OPEN) client.send(JSON.stringify(msg)); });
  });
  ws.on('close', () => {
    const info = room.info.get(ws) || { name: '?', ava: '😀' };
    room.clients.delete(ws);
    room.info.delete(ws);
    room.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ type: 'peer_leave', peer: info })); });
    console.log(`[-] 断开 roomId="${roomId}" 剩余=${room.clients.size}`);
    if (room.clients.size === 0) rooms.delete(roomId);
  });
  ws.on('error', () => {});
});
httpServer.listen(PORT, '0.0.0.0', () => { console.log(`✅ 聊天服务器已启动 端口 ${PORT}`); });
