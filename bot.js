const {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder
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

const slashDefinitions = [
  new SlashCommandBuilder().setName('warn').setDescription('Warn a server member').addUserOption(o => o.setName('member').setDescription('Member to warn').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason for the warning').setMaxLength(1000)),
  new SlashCommandBuilder().setName('kick').setDescription('Kick a server member').addUserOption(o => o.setName('member').setDescription('Member to kick').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason for the kick').setMaxLength(1000)),
  new SlashCommandBuilder().setName('ban').setDescription('Ban a server member').addUserOption(o => o.setName('member').setDescription('Member to ban').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason for the ban').setMaxLength(1000)),
  new SlashCommandBuilder().setName('role').setDescription('Give a member the configured role').addUserOption(o => o.setName('member').setDescription('Member to give the role to').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('Role to assign (optional if configured in dashboard)')),
  new SlashCommandBuilder().setName('help').setDescription('Show Nexyl commands')
].map(command => command.toJSON());

async function registerGuildCommands(guild) {
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: slashDefinitions });
    console.log(`[BOT] Registered slash commands in ${guild.name}.`);
  } catch (error) { console.error(`[BOT] Could not register slash commands in ${guild.name}:`, error.message); }
}

client.once('ready', async () => {
  console.log(`[BOT] Logged in as ${client.user.tag}; in ${client.guilds.cache.size} servers.`);
  for (const guild of client.guilds.cache.values()) await registerGuildCommands(guild);
});

client.on('guildCreate', async guild => {
  console.log(`[BOT] Added to ${guild.name} (${guild.id})`);
  if (client.isReady()) await registerGuildCommands(guild);
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
  // Configurable automatic word responses (case-insensitive phrase matching).
  const responses = config.wordResponses && typeof config.wordResponses === 'object' ? config.wordResponses : {};
  const lowerContent = message.content.toLowerCase();
  for (const [trigger, response] of Object.entries(responses)) {
    const phrase = String(trigger || '').trim();
    const replyText = String(response || '').trim();
    if (phrase && replyText && lowerContent.includes(phrase.toLowerCase())) {
      await message.channel.send(replyText.slice(0, 1800)).catch(() => {});
      return;
    }
  }
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
          { name: `${prefix}role @user${config.roleCommandRoleId && config.roleCommandEnabled !== false ? '' : ' @role'}`, value: 'Add a role to a member (uses the configured role if set in the dashboard).' },
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
    const hasConfiguredStaffRole = Boolean(config.staffRoleId && message.member?.roles?.cache?.has(config.staffRoleId));
    if (!hasPermission(message.member, requiredPermission) && !hasConfiguredStaffRole) {
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
      const warning = await db.addWarning(message.guild.id, {
        userId: target.id,
        userTag: target.user.tag,
        moderatorId: message.author.id,
        reason
      });
      const configNow = await db.getConfig(message.guild.id);
      await sendConfiguredLog(message.guild, { type: 'Warning', message: `Warned ${target.user.tag}. Reason: ${reason}`, actorId: message.author.id });
      let reply = `⚠️ **${target.user.tag}** has been warned. Reason: ${reason}`;
      if (configNow.warningDmEnabled !== false) {
        try { await target.send(`You were warned in **${message.guild.name}**. Reason: ${reason}`); } catch {}
      }
      const threshold = Math.min(100, Math.max(0, Number(configNow.warningThreshold) || 0));
      const action = ['none', 'kick', 'ban'].includes(configNow.warningAction) ? configNow.warningAction : 'none';
      if (threshold > 0 && action !== 'none') {
        const userWarnings = await db.getWarningsForUser(message.guild.id, target.id);
        if (userWarnings >= threshold) {
          try {
            if (action === 'kick' && botMember.permissions.has(PermissionFlagsBits.KickMembers) && target.kickable) {
              await target.kick(`Reached ${threshold} warnings (latest reason: ${reason})`);
              reply += `\n👢 Automatic action: kicked after reaching ${threshold} warnings.`;
            } else if (action === 'ban' && botMember.permissions.has(PermissionFlagsBits.BanMembers) && target.bannable) {
              await target.ban({ reason: `Reached ${threshold} warnings (latest reason: ${reason})` });
              reply += `\n🔨 Automatic action: banned after reaching ${threshold} warnings.`;
            } else {
              reply += `\n⚠️ The warning threshold was reached, but Nexyl lacks the required permission or role hierarchy to ${action} this member.`;
            }
          } catch (actionError) {
            console.error('[BOT] Warning threshold action failed:', actionError.message);
            reply += `\n⚠️ The warning threshold was reached, but the automatic action failed.`;
          }
        }
      }
      await message.reply(reply);
      return;
    }

    if (command === 'role') {
      const fixedRoleId = config.roleCommandEnabled !== false ? String(config.roleCommandRoleId || '') : '';
      const role = fixedRoleId ? message.guild.roles.cache.get(fixedRoleId) : message.mentions.roles.first();
      if (fixedRoleId && !role) return message.reply('The role configured in the Nexyl dashboard could not be found. Update the Role command tab.');
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

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand() || !interaction.guild) return;
  const command = interaction.commandName;
  if (!['warn', 'kick', 'ban', 'role', 'help'].includes(command)) return;
  try {
    const config = await db.getConfig(interaction.guild.id);
    const prefix = typeof config.prefix === 'string' && config.prefix.trim() ? config.prefix.trim() : '!';
    if (command === 'help') {
      const embed = new EmbedBuilder().setColor(0x5b8cff).setTitle('Nexyl — Commands').setDescription(`Prefix commands use ${prefix}. Slash commands are also available.`).addFields(
        { name: '/warn and ' + prefix + 'warn', value: 'Warn a member and record the reason.' },
        { name: '/kick and ' + prefix + 'kick', value: 'Kick a member from the server.' },
        { name: '/ban and ' + prefix + 'ban', value: 'Ban a member from the server.' },
        { name: '/role and ' + prefix + 'role', value: 'Give a member the configured role.' },
        { name: 'Dashboard', value: 'Configure staff permissions, role assignment, verification, word responses, warnings, tickets, and session details on the Nexyl website.' },
        { name: 'Premium', value: `[Join the Nexyl Premium server](${PREMIUM_INVITE})` }
      );
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    const targetUser = interaction.options.getUser('member', true);
    const target = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    const reason = interaction.options.getString('reason')?.trim().slice(0, 1000) || 'No reason provided';
    const staffRole = config.staffRoleId && member?.roles.cache.has(config.staffRoleId);
    const requiredPermission = { warn: PermissionFlagsBits.ModerateMembers, kick: PermissionFlagsBits.KickMembers, ban: PermissionFlagsBits.BanMembers, role: PermissionFlagsBits.ManageRoles }[command];
    if (!hasPermission(member, requiredPermission) && !staffRole) return interaction.reply({ content: 'You need the matching Discord permission or the configured Nexyl staff role to use this command.', ephemeral: true });
    if (!target) return interaction.reply({ content: 'That member is not in this server.', ephemeral: true });
    if (target.id === interaction.user.id || target.id === interaction.guild.ownerId || target.id === client.user.id) return interaction.reply({ content: 'You cannot use this command on yourself, the server owner, or Nexyl.', ephemeral: true });
    const botMember = interaction.guild.members.me;
    if (!botMember) return interaction.reply({ content: 'Could not verify Nexyl’s permissions.', ephemeral: true });
    if (command === 'warn') {
      await db.addWarning(interaction.guild.id, { userId: target.id, userTag: target.user.tag, moderatorId: interaction.user.id, reason });
      if (config.warningDmEnabled !== false) await target.send(`You were warned in **${interaction.guild.name}**. Reason: ${reason}`).catch(() => {});
      await sendConfiguredLog(interaction.guild, { type: 'Warning', message: `Warned ${target.user.tag}. Reason: ${reason}`, actorId: interaction.user.id });
      const threshold = Math.min(100, Math.max(0, Number(config.warningThreshold) || 0));
      const action = ['none', 'kick', 'ban'].includes(config.warningAction) ? config.warningAction : 'none';
      let extra = '';
      if (threshold > 0 && action !== 'none' && await db.getWarningsForUser(interaction.guild.id, target.id) >= threshold) {
        try {
          if (action === 'kick' && botMember.permissions.has(PermissionFlagsBits.KickMembers) && target.kickable) { await target.kick(`Reached ${threshold} warnings`); extra = ` Automatic action: kicked after ${threshold} warnings.`; }
          else if (action === 'ban' && botMember.permissions.has(PermissionFlagsBits.BanMembers) && target.bannable) { await target.ban({ reason: `Reached ${threshold} warnings` }); extra = ` Automatic action: banned after ${threshold} warnings.`; }
        } catch (e) { console.error('[BOT] Slash warning threshold action failed:', e.message); }
      }
      return interaction.reply({ content: `⚠️ Warned **${target.user.tag}**. Reason: ${reason}.${extra}`, ephemeral: false });
    }
    if (target.roles.highest.position >= botMember.roles.highest.position) return interaction.reply({ content: 'Move Nexyl’s role above the target member’s highest role first.', ephemeral: true });
    if (!member.permissions.has(PermissionFlagsBits.Administrator) && target.roles.highest.position >= member.roles.highest.position) return interaction.reply({ content: 'You cannot moderate a member at or above your highest role.', ephemeral: true });
    if (command === 'role') {
      const fixedRoleId = config.roleCommandEnabled !== false ? String(config.roleCommandRoleId || '') : '';
      const requestedRole = interaction.options.getRole('role');
      const role = fixedRoleId ? interaction.guild.roles.cache.get(fixedRoleId) : requestedRole;
      if (!role) return interaction.reply({ content: 'Set a fixed role in the dashboard Role command tab, or select a role in this command.', ephemeral: true });
      if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles) || role.managed || role.position >= botMember.roles.highest.position) return interaction.reply({ content: 'Nexyl needs Manage Roles permission and its bot role must be above the role being assigned.', ephemeral: true });
      if (!member.permissions.has(PermissionFlagsBits.Administrator) && (role.position >= member.roles.highest.position || target.roles.highest.position >= member.roles.highest.position)) return interaction.reply({ content: 'You cannot assign that role to this member.', ephemeral: true });
      await target.roles.add(role, `Requested by ${interaction.user.tag}`);
      await db.addLog(interaction.guild.id, { type: 'role', message: `Added role ${role.name} to ${target.user.tag}`, actorId: interaction.user.id });
      return interaction.reply({ content: `✅ Added **${role.name}** to **${target.user.tag}**.`, ephemeral: false });
    }
    if (command === 'kick') {
      if (!botMember.permissions.has(PermissionFlagsBits.KickMembers) || !target.kickable) return interaction.reply({ content: 'Nexyl cannot kick this member. Check permissions and role hierarchy.', ephemeral: true });
      await target.kick(`${reason} (requested by ${interaction.user.tag})`);
      await db.addLog(interaction.guild.id, { type: 'kick', message: `Kicked ${target.user.tag}. Reason: ${reason}`, actorId: interaction.user.id });
      await sendConfiguredLog(interaction.guild, { type: 'Kick', message: `Kicked ${target.user.tag}. Reason: ${reason}`, actorId: interaction.user.id });
      return interaction.reply({ content: `👢 Kicked **${target.user.tag}**. Reason: ${reason}`, ephemeral: false });
    }
    if (command === 'ban') {
      if (!botMember.permissions.has(PermissionFlagsBits.BanMembers) || !target.bannable) return interaction.reply({ content: 'Nexyl cannot ban this member. Check permissions and role hierarchy.', ephemeral: true });
      await target.ban({ reason: `${reason} (requested by ${interaction.user.tag})` });
      await db.addLog(interaction.guild.id, { type: 'ban', message: `Banned ${target.user.tag}. Reason: ${reason}`, actorId: interaction.user.id });
      await sendConfiguredLog(interaction.guild, { type: 'Ban', message: `Banned ${target.user.tag}. Reason: ${reason}`, actorId: interaction.user.id });
      return interaction.reply({ content: `🔨 Banned **${target.user.tag}**. Reason: ${reason}`, ephemeral: false });
    }
  } catch (error) {
    console.error(`[BOT] Slash /${command} failed:`, error);
    if (interaction.deferred || interaction.replied) await interaction.followUp({ content: 'That command failed. Check Nexyl permissions, role hierarchy, and Render logs.', ephemeral: true }).catch(() => {});
    else await interaction.reply({ content: 'That command failed. Check Nexyl permissions, role hierarchy, and Render logs.', ephemeral: true }).catch(() => {});
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton() || !interaction.guild) return;
  try {
    if (interaction.customId === 'nexyl_verify_member') {
      const config = await db.getConfig(interaction.guild.id);
      const verification = config.verificationSettings || {};
      if (!verification.enabled || !verification.roleId) return interaction.reply({ content: 'Verification is not configured in the Nexyl dashboard yet.', ephemeral: true });
      const role = await interaction.guild.roles.fetch(verification.roleId).catch(() => null);
      if (!role) return interaction.reply({ content: 'The configured verified role no longer exists. Ask a server administrator to update Verify setup.', ephemeral: true });
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member) return interaction.reply({ content: 'Could not find your server member profile. Try again.', ephemeral: true });
      if (member.roles.cache.has(role.id)) return interaction.reply({ content: 'You are already verified.', ephemeral: true });
      const botMember = interaction.guild.members.me;
      if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles) || role.position >= botMember.roles.highest.position) return interaction.reply({ content: 'Nexyl needs Manage Roles permission and its bot role must be above the verified role.', ephemeral: true });
      await member.roles.add(role, 'Self-service verification via Nexyl dashboard panel');
      await db.addLog(interaction.guild.id, { type: 'verification', message: `Verified ${interaction.user.tag}`, actorId: interaction.user.id });
      return interaction.reply({ content: `You are now verified and have been given **${role.name}**.`, ephemeral: true });
    }
    if (interaction.customId === 'nexyl_ticket_open') {
      const config = await db.getConfig(interaction.guild.id);
      const ticket = config.ticketSettings || {};
      if (!ticket.enabled) return interaction.reply({ content: 'Tickets are not enabled in this server yet.', ephemeral: true });
      const existing = interaction.guild.channels.cache.find(ch => ch.type === ChannelType.GuildText && String(ch.topic || '').includes(`nexyl-ticket:${interaction.user.id}`) && !ch.name.startsWith('closed-'));
      if (existing) return interaction.reply({ content: `You already have an open ticket: ${existing}`, ephemeral: true });
      const botMember = interaction.guild.members.me;
      if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: 'Nexyl needs Manage Channels permission to create tickets.', ephemeral: true });
      const overwrites = [
        { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
        { id: botMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }
      ];
      if (ticket.supportRoleId && interaction.guild.roles.cache.has(ticket.supportRoleId)) {
        overwrites.push({ id: ticket.supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
      }
      const category = ticket.categoryId ? await interaction.guild.channels.fetch(ticket.categoryId).catch(() => null) : null;
      const channel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 90),
        type: ChannelType.GuildText,
        topic: `nexyl-ticket:${interaction.user.id}`,
        parent: category?.type === ChannelType.GuildCategory ? category.id : undefined,
        permissionOverwrites: overwrites,
        reason: `Support ticket opened by ${interaction.user.tag}`
      });
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('nexyl_ticket_close').setLabel('Close ticket').setStyle(ButtonStyle.Danger));
      const intro = new EmbedBuilder().setColor(0x8b7cff).setTitle('Support ticket').setDescription(`Hello ${interaction.user}, thanks for opening a ticket. Describe what you need help with and a staff member will be with you soon.`).setTimestamp();
      await channel.send({ content: `<@${interaction.user.id}>${ticket.supportRoleId ? ` <@&${ticket.supportRoleId}>` : ''}`, embeds: [intro], components: [row], allowedMentions: { users: [interaction.user.id], roles: ticket.supportRoleId ? [ticket.supportRoleId] : [] } });
      await db.addLog(interaction.guild.id, { type: 'ticket', message: `Ticket opened by ${interaction.user.tag} in #${channel.name}`, actorId: interaction.user.id });
      return interaction.reply({ content: `Your ticket has been created: ${channel}`, ephemeral: true });
    }
    if (interaction.customId === 'nexyl_ticket_close') {
      const channel = interaction.channel;
      const topic = String(channel?.topic || '');
      const openerId = topic.startsWith('nexyl-ticket:') ? topic.slice('nexyl-ticket:'.length) : '';
      if (!openerId) return interaction.reply({ content: 'This does not look like a Nexyl ticket channel.', ephemeral: true });
      const config = await db.getConfig(interaction.guild.id);
      const ticket = config.ticketSettings || {};
      const supportRoleId = ticket.supportRoleId;
      const isOpener = interaction.user.id === openerId;
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      const isStaff = Boolean(member?.permissions?.has(PermissionFlagsBits.ManageChannels) || (supportRoleId && member?.roles?.cache?.has(supportRoleId)));
      if (!isOpener && !isStaff) return interaction.reply({ content: 'Only the ticket opener or configured support staff can close this ticket.', ephemeral: true });
      await interaction.deferReply();
      if (ticket.transcriptChannelId) {
        const archive = await interaction.guild.channels.fetch(ticket.transcriptChannelId).catch(() => null);
        if (archive?.isTextBased?.() && archive.send) {
          const fetched = await channel.messages.fetch({ limit: 100 }).catch(() => null);
          const lines = fetched ? [...fetched.values()].reverse().map(msg => `[${msg.createdAt.toISOString()}] ${msg.author?.tag || 'Unknown'}: ${msg.content || (msg.attachments.size ? '[attachment]' : '[embed or component]')}`) : ['Transcript could not be fetched.'];
          const transcript = `Nexyl ticket transcript\nServer: ${interaction.guild.name} (${interaction.guild.id})\nChannel: #${channel.name}\nOpened by user ID: ${openerId}\nClosed by: ${interaction.user.tag}\n\n${lines.join('\n')}`;
          await archive.send({ content: `Transcript for **#${channel.name}** (closed by ${interaction.user}).`, files: [new AttachmentBuilder(Buffer.from(transcript, 'utf8'), { name: `${channel.name}-transcript.txt` })] }).catch(error => console.error('[TICKETS] Transcript archive failed:', error.message));
        }
      }
      await channel.permissionOverwrites.edit(openerId, { SendMessages: false, ViewChannel: true }).catch(() => {});
      if (!channel.name.startsWith('closed-')) await channel.setName(`closed-${channel.name}`.slice(0, 100)).catch(() => {});
      await db.addLog(interaction.guild.id, { type: 'ticket', message: `Ticket #${channel.name} closed by ${interaction.user.tag}`, actorId: interaction.user.id });
      return interaction.editReply('🔒 This ticket has been closed. Staff can delete the channel when the conversation is no longer needed.');
    }
  } catch (error) {
    console.error('[TICKETS] Interaction failed:', error);
    const message = 'Ticket action failed. Check Nexyl permissions and the Render logs.';
    if (interaction.deferred || interaction.replied) await interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
    else await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
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
