'use strict';

const socket = io();
const app = document.getElementById('app');
let board = null;
let showHelp = false;

trackConnection(socket);

socket.on('connect', () => {
  socket.emit('host:hello', (res) => {
    if (!res.ok) app.innerHTML = `<p class="error big">${esc(res.error)}</p>`;
  });
});

socket.on('board', (b) => {
  // Music plays while an Imposter vote is open.
  const voting = b.mode === 'imposter' && b.phase === 'voting';
  const wasVoting = !!board && board.mode === 'imposter' && board.phase === 'voting';
  if (voting && !wasVoting) VoteMusic.start();
  if (!voting && wasVoting) {
    VoteMusic.stop();
    VoteMusic.sting();
  }
  board = b;
  render();
});

// Browsers only allow sound after a click on the page.
document.addEventListener('click', () => VoteMusic.unlock(), true);

function act(event, arg = null) {
  socket.emit(event, arg, (res) => { if (!res.ok) alert(res.error); });
}

function render() {
  const b = board;
  const teams = b.mode === 'teams';
  app.innerHTML = `
    <section class="join">
      <img src="${b.qr}" alt="QR code to join">
      <p>Scan or open<br><b>${esc(b.joinUrl.replace(/\?.*/, ''))}</b></p>
      <p class="code">${esc(b.code)}</p>
      <button class="secondary" data-help>${showHelp ? 'Hide help' : 'How to play'}</button>
      <button class="secondary" data-sound>${VoteMusic.isMuted() ? 'Sound: off' : 'Sound: on'}</button>
      ${showHelp ? helpHtml(b.mode, true) : ''}
    </section>
    <section class="stage">${b.canSwitch ? modeSwitch(b) : ''}${teams ? teamStage(b.team, b.players.length) : stage(b)}</section>
    <section class="scoreboard">${teams ? teamScoreboard(b) : `
      <h2>Scores</h2>
      <ol class="scores">${b.players.map(row).join('')}</ol>
      <p class="muted">&#10003; = has been imposter this rotation</p>`}
    </section>`;

  app.querySelectorAll('[data-act]').forEach((el) => { el.onclick = () => act(el.dataset.act); });
  app.querySelector('[data-help]').onclick = () => { showHelp = !showHelp; render(); };
  app.querySelector('[data-sound]').onclick = () => {
    VoteMusic.setMuted(!VoteMusic.isMuted());
    if (!VoteMusic.isMuted() && b.mode === 'imposter' && b.phase === 'voting') VoteMusic.start();
    render();
  };
  app.querySelectorAll('[data-mode]').forEach((el) => { el.onclick = () => act('host:mode', el.dataset.mode); });
  app.querySelectorAll('[data-set]').forEach((el) => {
    el.onclick = () => {
      const key = el.dataset.set;
      act('team:settings', { [key]: b.team.settings[key] + Number(el.dataset.delta) });
    };
  });
  app.querySelectorAll('[data-kick]').forEach((el) => {
    el.onclick = () => { if (confirm(`Remove ${el.dataset.name}?`)) act('host:kick', el.dataset.kick); };
  });
  startCountdown(teams ? b.team.turn && b.team.turn.timerMs : b.voteTimerMs, teams ? 10 : 3);
}

function modeSwitch(b) {
  const btn = (m, label) => `<button class="${b.mode === m ? '' : 'secondary'}" data-mode="${m}">${label}</button>`;
  return `<div class="modes">${btn('imposter', 'Imposter')}${btn('teams', 'Act &amp; Draw')}</div>`;
}

// ---------- Act & Draw ----------

function teamStage(t, playerCount) {
  const turnLine = t.turn
    ? `<p class="round">Playing: ${esc(t.turn.playingTeam)} &middot; ${esc(t.turn.actorName)} acts / draws</p>`
    : '';
  switch (t.phase) {
    case 'lobby': {
      const enough = playerCount >= t.minPlayers;
      return `<h1>Act &amp; Draw</h1>
        <p class="big">${playerCount} player${playerCount === 1 ? '' : 's'} joined</p>
        ${settingsHtml(t.settings)}
        <button data-act="team:start" ${enough ? '' : 'disabled'}>Make random teams &amp; start</button>
        ${enough ? '' : `<p class="muted">Need at least ${t.minPlayers} players.</p>`}`;
    }
    case 'writing':
      return `${turnLine}
        <p class="big">Other teams are writing a word&hellip; ${t.turn.wordsIn} / ${t.turn.wordsNeeded}</p>
        <button class="secondary" data-act="team:pick" ${t.turn.wordsIn ? '' : 'disabled'}>Pick from the words in now</button>
        ${settingsHtml(t.settings)}`;
    case 'ready':
      return `${turnLine}
        <p class="big">Word picked from <b>${esc(t.turn.writerTeam)}</b>.</p>
        <p>${esc(t.turn.actorName)} starts the timer on their phone.</p>
        <button class="secondary" data-act="team:hostGo">Start timer</button>`;
    case 'acting':
      return `${turnLine}
        <p class="timer huge"></p>
        <p class="big">Guess out loud! <b>${esc(t.turn.writerTeam)}</b> confirms on their phone.</p>`;
    case 'turnResult':
      return `${teamResultHtml(t.result)}
        <button data-act="team:next">Next turn</button>
        ${settingsHtml(t.settings)}`;
    case 'done':
      return `<h1>Game over</h1>
        ${t.result ? teamResultHtml(t.result) : ''}
        <p class="big">Winner: <b>${t.winners.map(esc).join(', ') || '-'}</b></p>
        <button data-act="team:lobby">Back to lobby</button>`;
    default:
      return '';
  }
}

function settingsHtml(s) {
  const ctl = (key, delta, label) =>
    `<button class="step" data-set="${key}" data-delta="${-delta}">&minus;</button><b>${label}</b><button class="step" data-set="${key}" data-delta="${delta}">+</button>`;
  return `<div class="settings">
    <div><span>Timer</span>${ctl('seconds', 10, `${s.seconds}s`)}</div>
    <div><span>Win at</span>${ctl('target', 1, `${s.target} pts`)}</div>
  </div>`;
}

function teamScoreboard(b) {
  const t = b.team;
  const teams = t.teams.length
    ? `<h2>Teams</h2><ol class="scores">${t.teams.map((x) => `<li><span>${esc(x.name)}</span><b>${x.score}</b></li>`).join('')}</ol>
       <p class="muted">First to ${t.settings.target} wins</p>`
    : '';
  const players = b.players.map((p) => `<li class="${p.connected ? '' : 'away'}">
      <span>${esc(p.name)}</span>
      <button class="kick" data-kick="${esc(p.id)}" data-name="${esc(p.name)}" title="Remove">&times;</button>
    </li>`).join('');
  return `${teams}<h2>Players</h2><ol class="scores">${players}</ol>`;
}

function stage(b) {
  const gameLine = `<p class="round">Game ${b.gameNo} / ${b.totalGames} &middot; Round ${b.round} / ${b.maxRounds}</p>`;
  switch (b.phase) {
    case 'lobby': {
      const enough = b.players.length >= b.minPlayers;
      return `<h1>Who is the Imposter?</h1>
        <p class="big">${b.players.length} player${b.players.length === 1 ? '' : 's'} joined</p>
        <button data-act="host:start" ${enough ? '' : 'disabled'}>Start game</button>
        ${enough ? '' : `<p class="muted">Need at least ${b.minPlayers} players.</p>`}`;
    }
    case 'clues':
      return `${gameLine}${roundNoteHtml(b.roundNote)}
        <p class="big">Everyone say one clue about their word.</p>
        <button data-act="host:startVote">Start vote</button>`;
    case 'voting':
      return `${gameLine}
        <p class="timer huge"></p>
        <p class="big">Voting&hellip; ${b.votesIn} / ${b.votesNeeded}</p>
        <button class="secondary" data-act="host:closeVote">Close vote now</button>`;
    case 'result': {
      const last = b.gameNo >= b.totalGames;
      return `<p class="round">Game ${b.gameNo} / ${b.totalGames}</p>${resultHtml(b.result)}
        <button data-act="host:next">${last ? 'Show final scores' : 'Next game'}</button>`;
    }
    case 'done': {
      const top = b.players.length ? b.players[0].score : 0;
      const winners = b.players.filter((p) => p.score === top).map((p) => esc(p.name)).join(', ');
      return `<h1>Rotation complete</h1>
        <p class="big">Leader: <b>${winners}</b> (${top} pts)</p>
        <button data-act="host:start">New rotation</button>`;
    }
    default:
      return '';
  }
}

function row(p) {
  const status = board.phase === 'voting' && p.inGame ? (p.voted ? ' <span class="good">voted</span>' : '') : '';
  return `<li class="${p.connected ? '' : 'away'}">
    <span>${esc(p.name)}${p.wasImposter ? ' &#10003;' : ''}${status}</span>
    <b>${p.score}</b>
    <button class="kick" data-kick="${esc(p.id)}" data-name="${esc(p.name)}" title="Remove">&times;</button>
  </li>`;
}
