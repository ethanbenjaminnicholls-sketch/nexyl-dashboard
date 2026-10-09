CREATE TABLE IF NOT EXISTS guild_configs (guild_id TEXT PRIMARY KEY, config JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS warnings (id BIGSERIAL PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, moderator_id TEXT NOT NULL, reason TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS warnings_guild_user_idx ON warnings(guild_id, user_id);
CREATE TABLE IF NOT EXISTS logs (id BIGSERIAL PRIMARY KEY, guild_id TEXT NOT NULL, action TEXT NOT NULL, user_id TEXT, moderator_id TEXT, details TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS logs_guild_created_idx ON logs(guild_id, created_at DESC);
CREATE TABLE IF NOT EXISTS sessions (guild_id TEXT PRIMARY KEY, active BOOLEAN NOT NULL DEFAULT FALSE, message_id TEXT, channel_id TEXT, votes JSONB NOT NULL DEFAULT '[]'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
