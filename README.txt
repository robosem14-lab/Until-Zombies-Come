UNTIL ZOMBIES COME ONLINE v0.9

1. Install Node.js 20+ on the computer hosting the game.
2. Open a terminal in this folder and run: npm install
3. Run: npm start
4. Open http://localhost:3000
5. To play across the internet, deploy this whole folder to a Node.js hosting service with WebSocket support and HTTPS. Share the public HTTPS address with friends. The hosting service must keep the Node process running. Localhost works only on the host machine.
6. Both players open the SAME hosted URL. Each enters a nickname, one creates a party, the other joins via invitation or party code. Host clicks START.

This is a prototype. Profiles are temporary nicknames, not secure password accounts. All matches, nicknames and party codes are stored in server memory and reset when the server restarts. No persistent progression. Game logic runs on the server. Solo v0.8 is included at /solo.html.
