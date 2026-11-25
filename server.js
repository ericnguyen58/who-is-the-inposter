'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { Game } = require('./game');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const CODE = randomCode();
const IP = process.env.HOST_IP || lanIp() || 'localhost';
const JOIN_URL = `http://${IP}:${PORT}/?code=${CODE}`;

const game = new Game();
const socketCount = new Map(); // playerId -> number of open sockets
let qr = '';

// ---------- static files ----------

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const ROUTES = { '/': 'player.html', '/host': 'host.html' };

const server = http.createServer((req, res) => {
  const urlPath = new URL(req.url, 'http://x').pathname;
  const file = path.join(PUBLIC_DIR, ROUTES[urlPath] || urlPath);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send404(res);
  fs.readFile(file, (err, data) => {
    if (err) return send404(res);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

function send404(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

// ---------- sockets ----------

const io = new Server(server);

io.on('connection', (socket) => {
  const isLocal = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(socket.handshake.address);

  // Board: only allowed from the host laptop itself.
  socket.on('host:hello', (ack) => {
    if (!isLocal) return reply(ack, { ok: false, error: `Open the scoreboard on the host laptop: http://localhost:${PORT}/host` });
    socket.join('host');
    reply(ack, { ok: true });
    broadcast();
  });

  socket.on('join', (data, ack) => {
    try {
      const { code, name, playerId } = data || {};
      let id = playerId;
      if (!id || !game.players.has(id)) {
        if (!name) throw new Error('Session expired, join again');
        if (String(code || '').trim().toUpperCase() !== CODE) throw new Error('Wrong room code');
        id = crypto.randomUUID();
        game.addPlayer(id, name);
      }
      if (socket.data.playerId !== id) {
        if (socket.data.playerId) leave(socket);
        socket.data.playerId = id;
        socket.join('p:' + id);
        socketCount.set(id, (socketCount.get(id) || 0) + 1);
      }
      reply(ack, { ok: true, playerId: id });
      broadcast();
    } catch (e) {
      reply(ack, { ok: false, error: e.message });
    }
  });

  socket.on('vote', (target, ack) => {
    try {
      game.vote(socket.data.playerId, target);
      reply(ack, { ok: true });
      broadcast();
    } catch (e) {
      reply(ack, { ok: false, error: e.message });
    }
  });

  const hostActions = {
    'host:start': () => game.start(),
    'host:startVote': () => game.startVote(),
    'host:closeVote': () => game.closeVote(),
    'host:next': () => game.next(),
    'host:kick': (id) => {
      game.removePlayer(id);
      io.to('p:' + id).emit('kicked');
      io.in('p:' + id).socketsLeave('p:' + id);
      socketCount.delete(id);
    },
  };
  for (const [event, fn] of Object.entries(hostActions)) {
    socket.on(event, (arg, ack) => {
      if (typeof arg === 'function') [arg, ack] = [undefined, arg];
      if (!socket.rooms.has('host')) return reply(ack, { ok: false, error: 'Not the host' });
      try {
        fn(arg);
        reply(ack, { ok: true });
        broadcast();
      } catch (e) {
        reply(ack, { ok: false, error: e.message });
      }
    });
  }

  socket.on('disconnect', () => {
    leave(socket);
    broadcast();
  });
});

function leave(socket) {
  const id = socket.data.playerId;
  if (!id || !socketCount.has(id)) return;
  const n = socketCount.get(id) - 1;
  if (n > 0) socketCount.set(id, n);
  else socketCount.delete(id);
}

function reply(ack, msg) {
  if (typeof ack === 'function') ack(msg);
}

function broadcast() {
  const connected = new Set(socketCount.keys());
  io.to('host').emit('board', { ...game.boardView(connected), code: CODE, joinUrl: JOIN_URL, qr });
  for (const id of game.players.keys()) io.to('p:' + id).emit('state', game.playerView(id));
}

// ---------- helpers ----------

function randomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion with 1/0
  let s = '';
  for (let i = 0; i < 4; i++) s += letters[crypto.randomInt(letters.length)];
  return s;
}

function lanIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return null;
}

QRCode.toDataURL(JOIN_URL, { margin: 1, width: 360 }).then((url) => {
  qr = url;
  server.listen(PORT, () => {
    console.log('\n  Who is the Imposter?\n');
    console.log(`  Scoreboard (open on this laptop): http://localhost:${PORT}/host`);
    console.log(`  Players join at:                  ${JOIN_URL}`);
    console.log(`  Room code:                        ${CODE}\n`);
    console.log('  Wrong IP in the link? Restart with HOST_IP=<your Wi-Fi IP> npm start\n');
  });
});
