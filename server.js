'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { Game } = require('./game');
const { TeamGame } = require('./teams');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const CODE = randomCode();
const IP = process.env.HOST_IP || lanIp() || 'localhost';
const JOIN_URL = `http://${IP}:${PORT}/?code=${CODE}`;

const game = new Game(); // imposter mode; also holds the player list
const teamGame = new TeamGame({ players: game.players }); // Act & Draw mode
let mode = 'imposter'; // 'imposter' | 'teams'
let turnTimer = null;
let voteTimer = null;
const bots = new Set(); // ids of test bots (dev shortcut)
const BOT_NAMES = ['Acorn', 'Maple', 'Pumpkin', 'Cranberry', 'Gravy', 'Biscuit', 'Pecan', 'Cider', 'Hazel', 'Nutmeg',
  'Clove', 'Squash', 'Yam', 'Butter', 'Sage', 'Walnut', 'Honey', 'Ginger', 'Turnip', 'Barley'];
const socketCount = new Map(); // playerId -> number of open sockets
let qr = '';

// ---------- static files ----------

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const ROUTES = { '/': 'player.html', '/host': 'host.html' };

// Optional music from the host's own files: custom-music/vote.mp3 and custom-music/lobby.mp3
// (or .m4a/.ogg/.wav). The folder is git-ignored, so the files stay on the laptop.
const MUSIC_DIR = path.join(__dirname, 'custom-music');
const MUSIC_TYPES = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };

function findCustomMusic(name) {
  for (const ext of Object.keys(MUSIC_TYPES)) {
    const file = path.join(MUSIC_DIR, name + ext);
    try {
      const stat = fs.statSync(file);
      if (stat.isFile()) return { file, ext, version: Math.floor(stat.mtimeMs) };
    } catch { /* not there */ }
  }
  return null;
}

const server = http.createServer((req, res) => {
  const urlPath = new URL(req.url, 'http://x').pathname;
  const musicMatch = urlPath.match(/^\/custom-music\/(vote|lobby)$/);
  if (musicMatch) {
    const music = findCustomMusic(musicMatch[1]);
    if (!music) return send404(res);
    res.writeHead(200, { 'Content-Type': MUSIC_TYPES[music.ext], 'Cache-Control': 'no-cache' });
    return fs.createReadStream(music.file).pipe(res);
  }
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
        teamGame.addPlayer(id);
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

  const playerActions = {
    'team:word': (word) => teamGame.submitWord(socket.data.playerId, word),
    'team:addWord': (word) => teamGame.addWord(socket.data.playerId, word),
    'team:removeWord': (cardId) => teamGame.removeWord(socket.data.playerId, Number(cardId)),
    'team:pickCard': (cardId) => teamGame.pickCard(socket.data.playerId, Number(cardId)),
    'team:roll': () => teamGame.roll(socket.data.playerId),
    'team:go': () => armTimer(teamGame.startTimer(socket.data.playerId)),
    'team:judge': (correct) => teamGame.judge(socket.data.playerId, !!correct),
  };
  for (const [event, fn] of Object.entries(playerActions)) {
    socket.on(event, (arg, ack) => {
      if (typeof arg === 'function') [arg, ack] = [undefined, arg];
      try {
        if (!socket.data.playerId) throw new Error('Join first');
        fn(arg);
        reply(ack, { ok: true });
        broadcast();
      } catch (e) {
        reply(ack, { ok: false, error: e.message });
      }
    });
  }

  const imposterOnly = (fn) => (arg) => {
    if (mode !== 'imposter') throw new Error('Switch to Imposter mode first');
    return fn(arg);
  };
  const teamsOnly = (fn) => (arg) => {
    if (mode !== 'teams') throw new Error('Switch to Act & Draw mode first');
    return fn(arg);
  };

  const hostActions = {
    'host:mode': (m) => {
      if (m !== 'imposter' && m !== 'teams') throw new Error('Unknown mode');
      if (!canSwitchMode()) throw new Error('Finish the current game first');
      mode = m;
    },
    'host:start': imposterOnly(() => game.start()),
    'host:settings': imposterOnly((s) => game.setSettings(s || {})),
    'host:startVote': imposterOnly(() => armVoteTimer(game.startVote())),
    'host:closeVote': imposterOnly(() => game.closeVote()),
    'host:next': imposterOnly(() => game.next()),
    'team:start': teamsOnly(() => teamGame.start()),
    'team:settings': teamsOnly((s) => teamGame.setSettings(s || {})),
    'team:pick': teamsOnly(() => teamGame.pickNow()),
    'team:begin': teamsOnly(() => teamGame.begin()),
    'team:pickRandom': teamsOnly(() => teamGame.pickRandom()),
    'team:hostRoll': teamsOnly(() => teamGame.roll(null)),
    'team:hostGo': teamsOnly(() => armTimer(teamGame.startTimer(null))),
    'team:next': teamsOnly(() => teamGame.next()),
    'team:lobby': teamsOnly(() => teamGame.toLobby()),
    // Dev shortcut: adds 10 idle bots, or removes them all if there are any.
    'host:bots': () => {
      if (bots.size) {
        for (const id of [...bots]) removePlayer(id);
        return;
      }
      const taken = new Set([...game.players.values()].map((p) => p.name.toLowerCase()));
      const names = BOT_NAMES.filter((n) => !taken.has(('bot ' + n).toLowerCase()));
      for (let i = 0; i < 10 && names.length; i++) {
        const [name] = names.splice(crypto.randomInt(names.length), 1);
        const id = 'bot-' + crypto.randomUUID();
        game.addPlayer(id, 'Bot ' + name);
        teamGame.addPlayer(id);
        bots.add(id);
      }
      game.useTestWords = true;
    },
    // Stops any game, sets scores to 0 and goes back to the lobby. Players and bots stay.
    'host:reset': () => {
      clearTimeout(turnTimer);
      clearTimeout(voteTimer);
      game.reset();
      teamGame.reset();
    },
    'host:kick': (id) => {
      removePlayer(id);
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

function removePlayer(id) {
  teamGame.removePlayer(id);
  game.removePlayer(id);
  bots.delete(id);
  game.useTestWords = bots.size > 0;
}

function leave(socket) {
  const id = socket.data.playerId;
  if (!id || !socketCount.has(id)) return;
  const n = socketCount.get(id) - 1;
  if (n > 0) socketCount.set(id, n);
  else socketCount.delete(id);
}

function canSwitchMode() {
  return ['lobby', 'done'].includes(game.phase) && ['lobby', 'done'].includes(teamGame.phase);
}

// Ends the Act & Draw turn when its time runs out.
function armTimer(ms) {
  clearTimeout(turnTimer);
  const turnNo = teamGame.turnNo;
  turnTimer = setTimeout(() => {
    teamGame.timeUp(turnNo);
    broadcast();
  }, ms);
}

// Closes the Imposter vote when its 10 seconds run out.
function armVoteTimer(ms) {
  clearTimeout(voteTimer);
  const voteNo = game.voteNo;
  voteTimer = setTimeout(() => {
    game.voteTimeUp(voteNo);
    broadcast();
  }, ms);
}

function customMusicInfo() {
  const info = (name) => {
    const m = findCustomMusic(name);
    return m ? { name: name + m.ext, version: m.version } : null;
  };
  return { vote: info('vote'), lobby: info('lobby') };
}

function reply(ack, msg) {
  if (typeof ack === 'function') ack(msg);
}

function broadcast() {
  const connected = new Set(socketCount.keys());
  const now = Date.now();
  const board = game.boardView(connected, now);
  board.players = board.players.map((p) => ({ ...p, bot: bots.has(p.id) }));
  io.to('host').emit('board', {
    ...board,
    code: CODE,
    joinUrl: JOIN_URL,
    qr,
    mode,
    canSwitch: canSwitchMode(),
    testing: bots.size > 0,
    customMusic: customMusicInfo(),
    team: teamGame.boardView(now),
  });
  for (const id of game.players.keys()) {
    io.to('p:' + id).emit('state', { ...game.playerView(id, now), mode, team: teamGame.playerView(id, now) });
  }
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
    console.log('  Wrong IP in the link? Restart with HOST_IP=<your Wi-Fi IP> npm start');
    const vote = findCustomMusic('vote');
    const lobby = findCustomMusic('lobby');
    console.log(vote ? `  Vote music: custom-music/vote${vote.ext}` : '  Vote music: built-in');
    console.log(lobby ? `  Lobby music: custom-music/lobby${lobby.ext}\n` : '  Lobby music: none\n');
  });
});
