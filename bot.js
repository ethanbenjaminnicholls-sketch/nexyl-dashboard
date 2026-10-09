const {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  EmbedBuilder
} = require('discord.js');
const db = require('./db');

const PREMIUM_INVITE = process.env.PREMIUM_INVITE || 'https://discord.gg/Adaq94kmnf';
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});
let started = false;

client.once('ready', () => {
  console.log(`[BOT] Logged in as ${client.user.tag}; in ${client.guilds.cache.size} servers.`);
});

client.on('guildCreate', async guild => {
  console.log(`[BOT] Added to ${guild.name} (${guild.id})`);
  try {
    await db.addLog(guild.id, { type: 'system', message: `Nexyl joined ${guild.name}` });
  } catch (error) {
    console.error('[DB] Could not record guild join:', error.message);
  }
});

function hasPermission(member, permission) {
  return Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator) || member?.permissions?.has(permission));
}

async function sendConfiguredLog(guild, payload) {
  try {
    const config = await db.getConfig(guild.id);
    if (!config.logChannelId) return;
    const channel = await guild.channels.fetch(config.logChannelId).catch(() => null);
    if (!channel?.isTextBased?.()) return;
    await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(0x5b8cff)
        .setTitle(`Nexyl · ${payload.type}`)
        .setDescription(String(payload.message || 'Moderation event').slice(0, 4000))
        .addFields({ name: 'Moderator', value: payload.actorId ? `<@${payload.actorId}>` : 'System', inline: true })
        .setTimestamp()]
    });
  } catch (error) {
    console.error('[BOT] Could not send configured log:', error.message);
  }
}

client.on('messageCreate', async message => {
  if (!message.guild || message.author.bot) return;

  let config = {};
  try {
    config = await db.getConfig(message.guild.id);
  } catch (error) {
    console.error('[DB] Could not load guild config:', error.message);
  }
  const prefix = typeof config.prefix === 'string' && config.prefix.trim() ? config.prefix.trim().slice(0, 5) : '!';
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/\s+/).filter(Boolean);
  const command = (args.shift() || '').toLowerCase();
  const reason = args.join(' ').slice(0, 1000) || 'No reason provided';

  try {
    if (command === 'help') {
      const embed = new EmbedBuilder()
        .setColor(0x5b8cff)
        .setTitle('Nexyl — Commands')
        .setDescription(`This server's prefix is \`${prefix}\`.`)
        .addFields(
          { name: `${prefix}warn @user [reason]`, value: 'Issue a warning.' },
          { name: `${prefix}role @user @role`, value: 'Add a role to a member.' },
          { name: `${prefix}ban @user [reason]`, value: 'Ban a member.' },
          { name: `${prefix}kick @user [reason]`, value: 'Kick a member.' },
          { name: `${prefix}help`, value: 'Show this command list.' },
          { name: 'Dashboard', value: 'Configure your server on the Nexyl website.' },
          { name: 'Premium', value: `[Join the Nexyl Premium server](${PREMIUM_INVITE})` }
        );
      return message.reply({ embeds: [embed] });
    }

    if (!['warn', 'role', 'ban', 'kick'].includes(command)) return;

    const requiredPermission = {
      warn: PermissionFlagsBits.ModerateMembers,
      role: PermissionFlagsBits.ManageRoles,
      ban: PermissionFlagsBits.BanMembers,
      kick: PermissionFlagsBits.KickMembers
    }[command];
    if (!hasPermission(message.member, requiredPermission)) {
      const label = { warn: 'Moderate Members', role: 'Manage Roles', ban: 'Ban Members', kick: 'Kick Members' }[command];
      return message.reply(`You need **${label}** or **Administrator** permission to use this command.`);
    }

    const target = message.mentions.members.first();
    if (!target) {
      const usage = command === 'role' ? `${prefix}role @user @role` : `${prefix}${command} @user [reason]`;
      return message.reply(`Please mention a member. Usage: \`${usage}\``);
    }
    if (target.id === message.author.id) return message.reply('You cannot use this command on yourself.');
    if (target.id === client.user.id) return message.reply('You cannot use this command on Nexyl.');
    if (target.id === message.guild.ownerId) return message.reply('I cannot moderate the server owner.');

    const botMember = message.guild.members.me;
    if (!botMember) return message.reply('I could not verify my server permissions. Please try again.');

    if (command === 'warn') {
      await db.addWarning(message.guild.id, {
        userId: target.id,
        userTag: target.user.tag,
        moderatorId: message.author.id,
        reason
      });
      await sendConfiguredLog(message.guild, { type: 'Warning', message: `Warned ${target.user.tag}. Reason: ${reason}`, actorId: message.author.id });
      await message.reply(`⚠️ **${target.user.tag}** has been warned. Reason: ${reason}`);
      try { await target.send(`You were warned in **${message.guild.name}**. Reason: ${reason}`); } catch {}
      return;
    }

    if (command === 'role') {
      const role = message.mentions.roles.first();
      if (!role) return message.reply(`Mention a role too. Usage: \`${prefix}role @user @role\``);
      if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) return message.reply('I need the **Manage Roles** permission.');
      if (role.managed || role.position >= botMember.roles.highest.position) return message.reply('I cannot assign that role. Move Nexyl’s role above the requested role.');
      if (!message.member.permissions.has(PermissionFlagsBits.Administrator) && (role.position >= message.member.roles.highest.position || target.roles.highest.position >= message.member.roles.highest.position)) return message.reply('You cannot assign roles to, or change roles for, a member at or above your highest role.');
      if (target.roles.highest.position >= botMember.roles.highest.position) return message.reply('I cannot manage that member because their highest role is above or equal to mine.');
      await target.roles.add(role, `Requested by ${message.author.tag}`);
      const log = { type: 'role', message: `Added role ${role.name} to ${target.user.tag}`, actorId: message.author.id };
      await db.addLog(message.guild.id, log);
      await sendConfiguredLog(message.guild, log);
      return message.reply(`✅ Added **${role.name}** to **${target.user.tag}**.`);
    }

    if (target.roles.highest.position >= botMember.roles.highest.position) return message.reply('I cannot moderate that member. Move Nexyl’s role above their highest role.');
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator) && target.roles.highest.position >= message.member.roles.highest.position) return message.reply('You cannot moderate a member whose highest role is at or above yours.');
    if (command === 'kick') {
      if (!botMember.permissions.has(PermissionFlagsBits.KickMembers)) return message.reply('I need the **Kick Members** permission.');
      await target.kick(reason);
      const log = { type: 'kick', message: `Kicked ${target.user.tag}. Reason: ${reason}`, actorId: message.author.id };
      await db.addLog(message.guild.id, log);
      await sendConfiguredLog(message.guild, log);
      return message.reply(`👢 Kicked **${target.user.tag}**. Reason: ${reason}`);
    }

    if (command === 'ban') {
      if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) return message.reply('I need the **Ban Members** permission.');
      await target.ban({ reason: `${reason} (requested by ${message.author.tag})` });
      const log = { type: 'ban', message: `Banned ${target.user.tag}. Reason: ${reason}`, actorId: message.author.id };
      await db.addLog(message.guild.id, log);
      await sendConfiguredLog(message.guild, log);
      return message.reply(`🔨 Banned **${target.user.tag}**. Reason: ${reason}`);
    }
  } catch (error) {
    console.error(`[BOT] ${prefix}${command} failed:`, error);
    return message.reply('That command failed. Check Nexyl’s permissions, role hierarchy, and Render logs.').catch(() => {});
  }
});

async function startBot() {
  if (started || client.isReady()) return;
  if (!process.env.DISCORD_TOKEN) throw new Error('DISCORD_TOKEN is missing in Render → Environment. Add the bot token from Discord Developer Portal → Bot.');
  started = true;
  try {
    await client.login(process.env.DISCORD_TOKEN);
  } catch (error) {
    started = false;
    throw error;
  }
}

module.exports = { client, startBot };
