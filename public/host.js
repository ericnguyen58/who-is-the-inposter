'use strict';

const socket = io();
const app = document.getElementById('app');
let board = null;

trackConnection(socket);

socket.on('connect', () => {
  socket.emit('host:hello', (res) => {
    if (!res.ok) app.innerHTML = `<p class="error big">${esc(res.error)}</p>`;
  });
});

socket.on('board', (b) => {
  board = b;
  render();
});

function act(event, arg = null) {
  socket.emit(event, arg, (res) => { if (!res.ok) alert(res.error); });
}

function render() {
  const b = board;
  app.innerHTML = `
    <section class="join">
      <img src="${b.qr}" alt="QR code to join">
      <p>Scan or open<br><b>${esc(b.joinUrl.replace(/\?.*/, ''))}</b></p>
      <p class="code">${esc(b.code)}</p>
    </section>
    <section class="stage">${stage(b)}</section>
    <section class="scoreboard">
      <h2>Scores</h2>
      <ol class="scores">${b.players.map(row).join('')}</ol>
      <p class="muted">&#10003; = has been imposter this rotation</p>
    </section>`;

  app.querySelectorAll('[data-act]').forEach((el) => { el.onclick = () => act(el.dataset.act); });
  app.querySelectorAll('[data-kick]').forEach((el) => {
    el.onclick = () => { if (confirm(`Remove ${el.dataset.name}?`)) act('host:kick', el.dataset.kick); };
  });
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
