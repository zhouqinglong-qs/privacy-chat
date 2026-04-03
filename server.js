/**
 * 双人实时聊天 - WebSocket 服务器
 * 运行: node server.js
 * 端口 3001，用 PORT=xxxx node server.js 修改
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 3001;

// ── HTTP 服务 ──
const httpServer = http.createServer((req, res) => {
  const file = path.join(__dirname, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
});

// ── WebSocket 服务 ──
const wss = new WebSocketServer({ server: httpServer });

// rooms: { roomId: { clients: Set<ws>, info: Map<ws, {name,ava}>, history: Array<msg> } }
// history: 最多保存最近 50 条消息，供离线重连后获取
const rooms = new Map();
const MAX_HISTORY = 50;

function getRoomInfo(roomId) {
  if (!rooms.has(roomId)) return [];
  const r = rooms.get(roomId);
  const list = [];
  r.clients.forEach((ws, k) => {
    const info = r.info.get(ws);
    if (info) list.push(info);
  });
  return list;
}

wss.on('connection', (ws, req) => {
  const roomId = decodeURIComponent((req.url || '/').replace(/^\//, '')) || 'default';

  if (!rooms.has(roomId)) rooms.set(roomId, { clients: new Set(), info: new Map(), history: [] });
  const room = rooms.get(roomId);
  room.clients.add(ws);

  // 记录身份（等待客户端 later 发来）
  ws._roomId = roomId;
  ws._info   = { name: '?', ava: '😀' };

  console.log(`[+] 连接 roomId="${roomId}"  当前=${room.clients.size}`);

  // ── 告知新来者：房间里现在有哪些人 ──
  const peers = getRoomInfo(roomId).filter(i => i.name !== '?');
  if (peers.length > 0) {
    ws.send(JSON.stringify({
      type: 'peer_list',
      peers,
      note: '当前房间已有 ' + peers.length + ' 人在线'
    }));
  }

  // ── 发送消息历史（如果有的话） ──
  const history = room.history;
  if (history.length > 0) {
    ws.send(JSON.stringify({
      type: 'history',
      messages: history
    }));
  }

  // ── 接收消息 ──
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // 心跳不转发
    if (msg.type === 'ping') return;

    // 记录身份
    if (msg.type === 'identity') {
      ws._info = { name: msg.name || '匿名', ava: msg.ava || '😀' };
      room.info.set(ws, ws._info);

      // 告知房间里的其他人：有新成员
      room.clients.forEach(c => {
        if (c !== ws && c.readyState === WebSocket.OPEN) {
          c.send(JSON.stringify({ type: 'peer_join', peer: ws._info }));
        }
      });
      return;
    }

    // 转发聊天 / typing / presence
    room.clients.forEach(client => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(msg));
      }
    });

    // 保存聊天消息到历史记录（typing 消息不保存）
    if (msg.type === 'chat' && msg.text) {
      room.history.push({
        text: msg.text,
        senderId: msg.senderId,
        name: msg.name,
        ava: msg.ava,
        ts: msg.ts || Date.now()
      });
      // 限制历史记录长度
      if (room.history.length > MAX_HISTORY) {
        room.history.shift();
      }
    }
  });

  ws.on('close', () => {
    const info = room.info.get(ws) || { name: '?', ava: '😀' };
    room.clients.delete(ws);
    room.info.delete(ws);

    // 告知其他人：有人离开
    room.clients.forEach(c => {
      if (c.readyState === WebSocket.OPEN) {
        c.send(JSON.stringify({ type: 'peer_leave', peer: info }));
      }
    });

    console.log(`[-] 断开 roomId="${roomId}"  剩余=${room.clients.size}`);
    if (room.clients.size === 0) rooms.delete(roomId);
  });

  ws.on('error', () => {});
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 聊天服务器已启动`);
  console.log(`   本机:        http://localhost:${PORT}`);
  console.log(`   局域网:      http://<本机IP>:${PORT}`);
  console.log(`   公网（Cloudflare Tunnel）: https://intermediate-recognized-posing-tony.trycloudflare.com\n`);
});
