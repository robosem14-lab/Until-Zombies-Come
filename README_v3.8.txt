Until Zombies Come v3.8 — Technical + Accounts

Deploy server.js and public/index.html, plus package.json as before.
IMPORTANT: Set DATA_DIR=/var/data and attach a persistent Render disk mounted at /var/data. Render instances without persistent disk lose local account files on redeploy/restart. For a free instance, use an external durable database for truly permanent accounts.
Passwords hashed with scrypt and random salt. Sessions stored as SHA256 hashes. Never commit data/accounts.json.
All existing gameplay from v3.7 is retained.
