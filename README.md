# Nexyl Dashboard — replacement project files

This package is a consistent baseline for the Nexyl Discord bot and web dashboard.

## Files
- `src/index.js`: Express app, Discord OAuth, server permission checks, dashboard API routes.
- `src/bot.js`: Discord bot, moderation commands, consistent Premium invite.
- `src/db.js`: PostgreSQL schema and data functions.
- `src/dashboard.js`: dashboard client logic.
- `public/landing.html`, `public/dashboard.html`, `public/style.css`: web pages and styling.
- `package.json`: Node dependencies and Render start command.

## Render environment variables
Set these in Render (never commit secrets):
- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI=https://nexyl-dashboard.onrender.com/auth/callback`
- `DATABASE_URL` (your PostgreSQL connection string)
- `SESSION_SECRET` (a long random secret)
- `PREMIUM_INVITE=https://discord.gg/Adaq94kmnf`

In Discord Developer Portal → OAuth2 → Redirects, add the exact same redirect URI above. Make sure the bot has Message Content Intent enabled for prefix commands, and its role is above the roles it needs to assign.

## Deploy
Replace the corresponding repository files with these files, commit and push to the branch Render deploys, then wait for a successful deploy. Check `/health` and refresh the dashboard with Ctrl+F5.

## Notes
- The server list includes servers where the signed-in user is the owner or has Administrator / Manage Server permission. It indicates whether the bot is installed.
- Settings, warnings, logs, and sessions are only accessible when the user has manage permissions and Nexyl is installed.
- The bot invite requests Administrator permission for straightforward setup. You can reduce the requested permissions later if you define the exact feature set and required permissions.
- The session middleware uses Express's default in-memory store; for production scale, use a persistent session store.
