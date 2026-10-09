# Nexyl Bot + Dashboard

Node.js 20+, Discord.js v14, Express, and PostgreSQL.

## Setup
1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env` and fill in credentials.
3. Create a Discord application and bot in the Discord Developer Portal.
4. Enable **Server Members Intent** and **Message Content Intent**.
5. Add the OAuth redirect URI from `DISCORD_REDIRECT_URI`; OAuth scopes are `identify guilds`.
6. Create a PostgreSQL database and set `DATABASE_URL`.
7. Run `npm install` and `npm start`.
8. Open `http://localhost:3000`.

## Commands
- `!help`
- `!warn @user [reason]`
- `!role @user <role name>`
- `!ban @user [reason]`
- `!kick @user [reason]`
- `!verify`
- `!sessionstart`
- `!sessionvote`
- `!sessionend`

The dashboard lists servers where you have Administrator permission and the bot is installed. Configuration sections include moderation, verification, warnings, tickets, Anti-Nuke, giveaways, word responses, welcome messages, ERLC settings, logs, and Premium.

**Scope note:** Tickets, Anti-Nuke, giveaways, and ERLC API fields are dashboard configuration scaffolds, not fully implemented runtime modules yet. Never commit `.env` or secrets to GitHub.
