const {
  Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionFlagsBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, Events
} = require("discord.js");
const { getConfig, addWarning, addLog, getSession, setSession } = require("./db");
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent], partials: [Partials.Channel] });
const isAdmin = m => m?.permissions?.has(PermissionFlagsBits.Administrator);
const isPremium = m => !!m && ((process.env.PREMIUM_SERVER_ID && m.guild.id === process.env.PREMIUM_SERVER_ID) || (process.env.PREMIUM_ROLE_ID && m.roles.cache.has(process.env.PREMIUM_ROLE_ID)));
const userIdFrom = s => (String(s||"").match(/^<@!?(\\d+)>$/)||[])[1];
const premiumLink = () => process.env.PREMIUM_INVITE || "https://discord.gg/tBrKBdsgMe";
function help() {
  return new EmbedBuilder().setColor(0x5865f2).setTitle("Nexyl Help")
    .addFields(
      {name:"Moderation",value:"`!warn @user [reason]`\\n`!role @user <role name>`\\n`!ban @user [reason]`\\n`!kick @user [reason]`"},
      {name:"General",value:"`!help`\\n`!verify`"},
      {name:"Premium sessions",value:"`!sessionstart`\\n`!sessionvote`\\n`!sessionend`"},
      {name:"Links",value:`[Website](${process.env.DASHBOARD_URL||"http://localhost:3000"}) • [Premium](${premiumLink()})`}
    );
}
client.once(Events.ClientReady, c => console.log(`Nexyl logged in as ${c.user.tag}`));
client.on(Events.GuildMemberAdd, async member => {
  try {
    const c = await getConfig(member.guild.id);
    if (!c.welcome.enabled || !c.welcome.channelId) return;
    const channel = member.guild.channels.cache.get(c.welcome.channelId);
    if (channel?.isTextBased()) await channel.send(String(c.welcome.message||"Welcome {user} to {server}!").replaceAll("{user}", `<@${member.id}>`).replaceAll("{server}", member.guild.name));
  } catch(e) { console.error("Welcome:",e); }
});
client.on(Events.InteractionCreate, async i => {
  if (!i.isButton() || !i.customId.startsWith("nexyl_vote_")) return;
  try {
    const s = await getSession(i.guildId);
    if (!s?.active) return i.reply({content:"This session has ended.",ephemeral:true});
    const votes = Array.isArray(s.votes) ? s.votes : [];
    if (votes.some(v=>v.userId===i.user.id)) return i.reply({content:"You already voted.",ephemeral:true});
    votes.push({userId:i.user.id,vote:i.customId.endsWith("_yes")?"yes":"no"});
    await setSession(i.guildId,{...s,votes});
    await i.reply({content:"Vote recorded.",ephemeral:true});
  } catch(e) { console.error(e); if(!i.replied) await i.reply({content:"Vote failed.",ephemeral:true}); }
});
async function sessionStart(message) {
  if (!isAdmin(message.member)) return message.reply("You need Administrator permission.");
  if (!isPremium(message.member)) return message.reply(`Premium-only command. ${premiumLink()}`);
  const old = await getSession(message.guild.id);
  if (old?.active) return message.reply("A session is already active.");
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("nexyl_vote_yes").setLabel("Vote Yes").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("nexyl_vote_no").setLabel("Vote No").setStyle(ButtonStyle.Danger)
  );
  const sent = await message.channel.send({embeds:[new EmbedBuilder().setTitle("Nexyl Session Vote").setDescription("Vote using the buttons below.").setColor(0x5865f2)],components:[row]});
  await setSession(message.guild.id,{active:true,message_id:sent.id,channel_id:sent.channel.id,votes:[]});
  await addLog(message.guild.id,"session_start",null,message.author.id,"Session started");
  return message.reply("Session started.");
}
client.on(Events.MessageCreate, async message => {
  if (message.author.bot || !message.guild) return;
  try {
    const c = await getConfig(message.guild.id);
    if (c.wordResponses.enabled) {
      const lower = message.content.toLowerCase();
      for (const [word,response] of Object.entries(c.wordResponses.responses||{})) {
        if (word && lower.includes(word.toLowerCase())) { await message.channel.send(String(response)); break; }
      }
    }
    const p = c.prefix || "!";
    if (!message.content.startsWith(p)) return;
    const parts = message.content.slice(p.length).trim().split(/\\s+/);
    const cmd = (parts.shift()||"").toLowerCase();
    if (cmd==="help") return message.reply({embeds:[help()]});
    if (cmd==="verify") {
      if (!c.verification.enabled || !c.verification.roleId) return message.reply("Verification is not configured. Set it up in the dashboard.");
      const role = message.guild.roles.cache.get(c.verification.roleId);
      if (!role) return message.reply("Configured verification role not found.");
      await message.member.roles.add(role);
      return message.reply("You have been verified.");
    }
    if (["warn","role","ban","kick"].includes(cmd)) {
      if (!isAdmin(message.member)) return message.reply("You need Administrator permission.");
      const targetId = userIdFrom(parts.shift());
      if (!targetId) return message.reply(`Usage: ${p}${cmd} @user${cmd==="role"?" <role name>":" [reason]"}`);
      const target = await message.guild.members.fetch(targetId).catch(()=>null);
      if (!target) return message.reply("User not found in this server.");
      const rest = parts.join(" ").trim();
      if (cmd==="warn") {
        const warning = await addWarning(message.guild.id,targetId,message.author.id,rest||"No reason provided.");
        await addLog(message.guild.id,"warn",targetId,message.author.id,rest||"No reason provided.");
        return message.reply(`Warned <@${targetId}>. Warning #${warning.id} recorded.`);
      }
      if (cmd==="role") {
        if (!rest) return message.reply(`Usage: ${p}role @user <role name>`);
        const role = message.guild.roles.cache.find(r=>r.name.toLowerCase()===rest.toLowerCase());
        if (!role) return message.reply("Role not found.");
        if (role.position >= message.guild.members.me.roles.highest.position) return message.reply("I cannot manage that role because it is above my highest role.");
        await target.roles.add(role); await addLog(message.guild.id,"role_add",targetId,message.author.id,role.name);
        return message.reply(`Added **${role.name}** to <@${targetId}>.`);
      }
      const reason = rest || "No reason provided.";
      if (cmd==="ban") { await target.ban({reason}); await addLog(message.guild.id,"ban",targetId,message.author.id,reason); return message.reply(`Banned <@${targetId}>.`); }
      await target.kick(reason); await addLog(message.guild.id,"kick",targetId,message.author.id,reason); return message.reply(`Kicked <@${targetId}>.`);
    }
    if (cmd==="sessionstart") return sessionStart(message);
    if (cmd==="sessionvote") {
      if (!isPremium(message.member)) return message.reply(`Premium-only command. ${premiumLink()}`);
      const s = await getSession(message.guild.id);
      if (!s?.active) return message.reply("There is no active session.");
      const votes = Array.isArray(s.votes)?s.votes:[];
      if (votes.some(v=>v.userId===message.author.id)) return message.reply("You already voted.");
      votes.push({userId:message.author.id,vote:"yes"}); await setSession(message.guild.id,{...s,votes});
      return message.reply("Your yes vote has been recorded.");
    }
    if (cmd==="sessionend") {
      if (!isAdmin(message.member)) return message.reply("You need Administrator permission.");
      if (!isPremium(message.member)) return message.reply(`Premium-only command. ${premiumLink()}`);
      const s = await getSession(message.guild.id);
      if (!s?.active) return message.reply("There is no active session.");
      const votes = Array.isArray(s.votes)?s.votes:[];
      const yes = votes.filter(v=>v.vote==="yes").length, no = votes.filter(v=>v.vote==="no").length;
      await setSession(message.guild.id,{...s,active:false});
      await addLog(message.guild.id,"session_end",null,message.author.id,`Yes: ${yes}, No: ${no}`);
      return message.reply(`Session ended. Yes: ${yes} • No: ${no}`);
    }
  } catch(e) { console.error("Command error:",e); try { await message.reply("Something went wrong running that command."); } catch {} }
});
async function startBot() {
  if (!process.env.DISCORD_TOKEN) { console.warn("DISCORD_TOKEN is missing; dashboard starting without bot."); return; }
  await client.login(process.env.DISCORD_TOKEN);
}
module.exports = {client,startBot};
