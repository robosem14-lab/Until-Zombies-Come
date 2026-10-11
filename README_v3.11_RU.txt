UNTIL ZOMBIES COME v3.11 — PERMANENT ACCOUNTS (SUPABASE)

1. Upload server.js, public/index.html and package.json to GitHub in their respective paths.
2. Render Environment must contain SUPABASE_URL and SUPABASE_SECRET_KEY (never put secrets in GitHub).
3. Supabase table public.game_accounts must exist (id, username, username_key, password_hash, created_at).
4. Wait until Render Live; test creating an account and logging in from another browser.
5. Accounts are persisted in Supabase across Render deploys, provided Supabase project remains active. Make backups.
6. Accounts previously stored only in temporary accounts.json are NOT automatically migrated.
7. Auto-login tokens expire after 90 days; then log in again with password. Logout clears browser token, but an already copied token is not revoked server-side.
8. All gameplay copied from v3.10 unchanged.
