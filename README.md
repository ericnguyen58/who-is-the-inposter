# Who is the Imposter?

Party game for friends in the same room. A laptop runs the game and shows the scoreboard; everyone plays on their phone.

## Run

Requires Node.js 18+. The laptop and all phones must be on the same Wi-Fi.

```
npm install
npm start
```

- Open `http://localhost:3000/host` on the laptop: this is the scoreboard with the QR code and room code.
- Players scan the QR code (or open the printed link and type the room code), then enter a name.
- If the link shows the wrong IP: `HOST_IP=192.168.x.x npm start`.
- If phones can't connect, allow Node.js through the laptop firewall.

## Rules

- Each game, one player is the imposter. Everyone gets the same word except the imposter, who gets a different one (e.g. Bear vs Fish). Nobody is told who the imposter is.
- Each round, everyone says one clue about their word out loud. The host then starts the vote. Voting lasts **10 seconds** (game-show music plays on the laptop).
- Vote result:
  - Imposter gets the most votes: **caught**. Every other player gets **+1**.
  - Someone else gets the most votes: **imposter wins** right away.
  - Tie, or Skip gets the most votes: nobody is out, next round.
  - Imposter survives 5 rounds: **imposter wins**.
- Imposter win = **points equal to the round number** (1 to 5).
- Rotation: the order is shuffled so everyone is the imposter exactly once. Late joiners are added to the rotation. After the rotation, the host can start a new one.

## Act & Draw mode

Pick **Act & Draw** on the scoreboard before starting (switching is possible whenever no game is running). Needs at least 4 players.

- The app makes random teams of 2. With an odd number of players, one team has 3.
- Each turn one team plays. Every other team types a word on their phones, and the app picks one at random.
- The actor sees the word and acts it out or draws it on paper, without saying it or pointing at it. Their teammate guesses out loud. Teammates take turns acting.
- The team whose word was picked confirms on their phone:
  - **Correct**: the playing team gets **+1**.
  - **Fail**, or the timer runs out: the team that wrote the word gets **+1**.
- The first team to reach the target score wins.
- The host sets the timer length and the target score with the − / + buttons. Both can be changed between turns.
- Late joiners go to the smallest team.

## How to operate

### First-time setup (host laptop)

1. Install Node.js (LTS) from https://nodejs.org.
2. Download the game and install it:
   ```
   git clone https://github.com/ericnguyen58/who-is-the-inposter
   cd who-is-the-inposter
   npm install
   ```

### Start a session

1. Connect the laptop to the same Wi-Fi as the phones.
2. In the game folder, run `npm start`. Keep this terminal open while you play.
3. On the laptop, open `http://localhost:3000/host`. This is the scoreboard. Put it where everyone can see it, such as on a TV.
4. Each player scans the QR code with their phone camera (or opens the link and types the 4-letter code), types a name and taps **Join**.
5. Pick a mode with the **Imposter** / **Act & Draw** buttons at the top of the scoreboard.

### Run Imposter mode (3+ players)

1. Tap **Start game**. Each phone shows a word.
2. Everyone says one clue about their word out loud.
3. Tap **Start vote**. Music plays on the laptop and everyone votes on their phone for a player or **Skip**.
4. The vote closes after **10 seconds**, or sooner if everyone has voted. Votes already in are counted. **Close vote now** ends it immediately.
   - The result shows a vote leaderboard when votes went to more than one choice. If every vote went to one choice, it shows only who was voted out.
5. If nobody is out, the next round starts: go back to step 2.
6. When the game ends, the scoreboard shows the imposter, both words and the scores. Tap **Next game**.
7. After everyone has been the imposter once, tap **Show final scores**. Tap **New rotation** to play again.

### Run Act & Draw mode (4+ players)

1. Set **Timer** and **Win at** with the − / + buttons.
2. Tap **Make random teams & start**. The scoreboard lists the teams.
3. The phones of the other teams ask for a word. Each team types one word and taps **Submit**. To stop waiting for slow teams, tap **Pick from the words in now**.
4. The actor's phone shows the word. When they're ready, they tap **Start timer** (the host can also tap **Start timer** on the laptop).
5. The actor acts or draws on paper and the teammate guesses out loud. The team that wrote the word taps **Correct** or **Fail** on their phone. If time runs out, it counts as a fail.
6. Tap **Next turn**. The timer and win score can be changed here.
7. When a team reaches the win score, the game ends. Tap **Back to lobby** to play again or switch modes.

### During play

- **Player's phone locks or the page closes:** they reopen the same link. Their name, word and score come back.
- **Remove a player:** tap **×** next to their name on the scoreboard.
- **New player joins mid-game:** in Imposter mode they play from the next game. In Act & Draw they're added to the smallest team.
- **Switch modes:** only possible when no game is running (lobby, or after a game ends).
- **Help:** tap **How to play** on the scoreboard, or **?** on a phone, for the rules of the current mode.
- **Sound:** tap **Sound: on / off** on the scoreboard. Click anywhere on the scoreboard once after opening it so the browser allows sound.

### Stop

Press `Ctrl + C` in the terminal. Scores are not saved: restarting gives a new room code and empty scores.

### Troubleshooting

- **Phones can't open the page:**
  - Check that the phones are on the same Wi-Fi as the laptop, not mobile data.
  - Allow Node.js through the laptop firewall. On Windows, click **Allow** when asked.
- **The link under the QR code shows the wrong IP:** find the laptop's Wi-Fi IP and restart:
  - Mac / Linux: `HOST_IP=192.168.x.x npm start`
  - Windows (PowerShell): `$env:HOST_IP="192.168.x.x"; npm start`
- **Port 3000 is already in use:** `PORT=4000 npm start` (Windows: `$env:PORT="4000"; npm start`), then open `http://localhost:4000/host`.
- **The scoreboard says to open it on the host laptop:** host controls only work at `http://localhost:3000/host` on the laptop running the game.

## Files

- `game.js` – Imposter rules, rotation, voting, scoring
- `teams.js` – Act & Draw rules, teams, timer, scoring
- `server.js` – web server, sockets, QR code
- `words.js` – word pairs (edit to add your own)
- `public/` – phone and scoreboard pages
- `test/` – `npm test`
