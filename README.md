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
- Each round, everyone says one clue about their word out loud. The host then starts the vote.
- Vote result:
  - Imposter gets the most votes: **caught**. Every other player gets **+1**.
  - Someone else gets the most votes: **imposter wins** right away.
  - Tie, or Skip gets the most votes: nobody is out, next round.
  - Imposter survives 5 rounds: **imposter wins**.
- Imposter win = **points equal to the round number** (1 to 5).
- Rotation: the order is shuffled so everyone is the imposter exactly once. Late joiners are added to the rotation. After the rotation, the host can start a new one.

## Files

- `game.js` – rules, rotation, voting, scoring
- `server.js` – web server, sockets, QR code
- `words.js` – word pairs (edit to add your own)
- `public/` – phone and scoreboard pages
- `test/` – `npm test`
