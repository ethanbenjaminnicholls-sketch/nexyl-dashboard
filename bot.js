const { Client, GatewayIntentBits, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('./db');

const PREMIUM_INVITE = process.env.PREMIUM_INVITE || 'https://discord.gg/Adaq94kmnf';
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers] });
let started = false;

function canModerate(member) {
  return member?.permissions?.has(PermissionFlagsBits.ModerateMembers) || member?.permissions?.has(PermissionFlagsBits.Administrator);
}
function hasBotPermission(guild, permission) {
  const me = guild.members.me;
  return Boolean(me && me.permissions.has(permission));
}

client.once('ready', () => console.log(`[BOT] Logged in as ${client.user.tag}; in ${client.guilds.cache.size} servers.`));

client.on('guildCreate', async guild => {
  console.log(`[BOT] Added to ${guild.name} (${guild.id})`);
  try { await db.addLog(guild.id, { type: 'system', message: `Nexyl joined ${guild.name}` }); } catch (e) { console.error('[DB] guildCreate log:', e.message); }
});

client.on('messageCreate', async message => {
  if (!message.guild || message.author.bot) return;
  const prefix = '!';
  if (!message.content.startsWith(prefix)) return;
  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const command = (args.shift() || '').toLowerCase();
  const reason = args.join(' ');

  try {
    if (command === 'help') {
      const embed = new EmbedBuilder()
        .setColor(0x5b8cff)
        .setTitle('Nexyl — Commands')
        .setDescription('Moderation commands for this server.')
        .addFields(
          { name: '!warn @user [reason]', value: 'Issue a warning.' },
          { name: '!role @user @role', value: 'Add a role to a member.' },
          { name: '!ban @user [reason]', value: 'Ban a member.' },
          { name: '!kick @user [reason]', value: 'Kick a member.' },
          { name: 'Dashboard', value: 'Configure Nexyl using the website dashboard.' },
          { name: 'Premium', value: `[Join the Nexyl Premium server](${PREMIUM_INVITE})` }
        );
      return message.reply({ embeds: [embed] });
    }

    if (!['warn', 'role', 'ban', 'kick'].includes(command)) return;
    if (!canModerate(message.member)) return message.reply('You need **Moderate Members** or **Administrator** permission to use this command.');

    const target = message.mentions.members.first();
    if (!target) return message.reply(`Please mention a member. Usage: \`!${command} @user${command === 'role' ? ' @role' : ' [reason]'}\``);
    if (target.id === message.author.id) return message.reply('You cannot use this command on yourself.');
    if (target.id === client.user.id) return message.reply('You cannot use this command on Nexyl.');

    if (command === 'warn') {
      const warningReason = reason || 'No reason provided';
      await db.addWarning(message.guild.id, { userId: target.id, userTag: target.user.tag, moderatorId: message.author.id, reason: warningReason });
      await message.reply(`⚠️ ${target.user.tag} has been warned. Reason: ${warningReason}`);
      try { await target.send(`You were warned in **${message.guild.name}**. Reason: ${warningReason}`); } catch {}
      return;
    }

    if (command === 'role') {
      const role = message.mentions.roles.first();
      if (!role) return message.reply('Mention a role too. Usage: `!role @user @role`');
      if (role.managed || role.position >= message.guild.members.me.roles.highest.position) return message.reply('I cannot assign that role. Move my bot role above it and check the role settings.');
      if (!hasBotPermission(message.guild, PermissionFlagsBits.ManageRoles)) return message.reply('I need the **Manage Roles** permission.');
      await target.roles.add(role, `Requested by ${message.author.tag}`);
      await db.addLog(message.guild.id, { type: 'role', message: `Added role ${role.name} to ${target.user.tag}`, actorId: message.author.id });
      return message.reply(`✅ Added **${role.name}** to ${target.user.tag}.`);
    }

    if (target.roles.highest.position >= message.guild.members.me.roles.highest.position || target.id === message.guild.ownerId) return message.reply('I cannot moderate that member. Check the bot role position and server ownership.');
    if (command === 'kick') {
      if (!hasBotPermission(message.guild, PermissionFlagsBits.KickMembers)) return message.reply('I need the **Kick Members** permission.');
      await target.kick(reason || `Requested by ${message.author.tag}`);
      await db.addLog(message.guild.id, { type: 'kick', message: `Kicked ${target.user.tag}: ${reason || 'No reason provided'}`, actorId: message.author.id });
      return message.reply(`👢 Kicked **${target.user.tag}**. Reason: ${reason || 'No reason provided'}`);
    }
    if (command === 'ban') {
      if (!hasBotPermission(message.guild, PermissionFlagsBits.BanMembers)) return message.reply('I need the **Ban Members** permission.');
      await target.ban({ reason: reason || `Requested by ${message.author.tag}` });
      await db.addLog(message.guild.id, { type: 'ban', message: `Banned ${target.user.tag}: ${reason || 'No reason provided'}`, actorId: message.author.id });
      return message.reply(`🔨 Banned **${target.user.tag}**. Reason: ${reason || 'No reason provided'}`);
    }
  } catch (error) {
    console.error(`[BOT] !${command} failed:`, error);
    return message.reply('That command failed. Check Nexyl’s permissions, role hierarchy, and Render logs.').catch(() => {});
  }
});

async function startBot() {
  if (started || client.isReady()) return;
  if (!process.env.DISCORD_TOKEN) throw new Error('DISCORD_TOKEN is not configured.');
  started = true;
  try { await client.login(process.env.DISCORD_TOKEN); }
  catch (error) { started = false; throw error; }
}

module.exports = { client, startBot };
