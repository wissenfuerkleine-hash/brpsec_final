const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, MessageFlags, AuditLogEvent } = require('discord.js');
const { pool } = require('./database/db');
const LockdownManager = require('./systems/lockdownManager');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildModeration]
});

const lm = new LockdownManager(client);

client.once('ready', async () => {
  console.log(`Bot eingeloggt als ${client.user.tag}`);
  
  const commands = [
    new SlashCommandBuilder()
      .setName('lockdown')
      .setDescription('Sperrt den Server und erstellt ein Backup der Rechte')
      .addIntegerOption(o => o.setName('level').setDescription('Stufe (1-3)').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Grund für den Lockdown').setRequired(true)),
    new SlashCommandBuilder()
      .setName('unlock')
      .setDescription('Entsperrt den Server (Stellt alle Rechte 1zu1 wieder her)'),
    new SlashCommandBuilder()
      .setName('status')
      .setDescription('Zeigt den aktuellen Sicherheitsstatus des Servers')
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
    console.log('🚀 Slash-Commands erfolgreich registriert!');
  } catch (err) {
    console.error('Fehler bei Command-Registrierung:', err);
  }
});

// INTERACTION HANDLING (Befehle)
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // Multi-Owner Berechtigungsprüfung
  const isMainOwner = interaction.user.id === process.env.OWNER_ID;
  const isSecondOwner = interaction.user.id === process.env.SECOND_OWNER_ID;

  if (!isMainOwner && !isSecondOwner) {
    return interaction.reply({ 
      content: '❌ Zugriff verweigert. Nur die beiden hinterlegten Serverbesitzer dürfen das System steuern.', 
      flags: [MessageFlags.Ephemeral] 
    });
  }

  const guild = interaction.guild;

  if (interaction.commandName === 'lockdown') {
    const level = interaction.options.getInteger('level');
    const reason = interaction.options.getString('reason');

    if (await lm.checkStatus()) return interaction.reply('❌ Der Server befindet sich bereits in einem Lockdown.');

    await interaction.deferReply();
    const id = await lm.startLockdown(guild, level, reason);
    await interaction.editReply(`🚨 **LOCKDOWN AKTIVIERT**\n**ID:** \`${id}\`\n**Stufe:** ${level}\n**Grund:** ${reason}`);
  }

  if (interaction.commandName === 'unlock') {
    if (!(await lm.checkStatus())) return interaction.reply('✅ Der Server ist aktuell nicht gesperrt.');

    await interaction.deferReply();
    const success = await lm.stopLockdown(guild);
    if (success) {
      await interaction.editReply('🔓 **SERVER ENTSPERRT**\nAlle individuellen Rollen- und Kanalrechte wurden erfolgreich 1zu1 aus der Datenbank wiederhergestellt.');
    } else {
      await interaction.editReply('❌ Fehler bei der Wiederherstellung des Snapshots.');
    }
  }

  if (interaction.commandName === 'status') {
    const current = await lm.checkStatus();
    if (current) {
      await interaction.reply(`🔒 **LOCKDOWN AKTIV**\n**Incident-ID:** \`${current.incident_id}\`\n**Stufe:** ${current.level}\n**Grund:** ${current.reason}`);
    } else {
      await interaction.reply('✅ **STATUS: NORMAL**\nKeine Einschränkungen aktiv. Der Server ist sicher.');
    }
  }
});

// SICHERHEITSWARNUNG (Kanal-Löschung erkennen)
client.on('channelDelete', async (channel) => {
  const guild = channel.guild;
  if (guild.id !== process.env.GUILD_ID) return;

  try {
    const fetchedLogs = await guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete });
    const deletionLog = fetchedLogs.entries.first();
    
    if (!deletionLog) return;
    const { executor } = deletionLog;

    // Ignoriere Aktionen von beiden Owners und dem Bot selbst
    if (executor.id === process.env.OWNER_ID || executor.id === process.env.SECOND_OWNER_ID || executor.id === client.user.id) return;

    console.log(`[WARNUNG] Kanal #${channel.name} wurde von ${executor.tag} gelöscht!`);

    const logChannel = guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
    if (logChannel && logChannel.isTextBased()) {
      await logChannel.send({
        content: `⚠️ **SICHERHEITSWARNUNG / MÖGLICHER RAID**\n` +
                 `**Aktion:** Ein Kanal wurde gelöscht!\n` +
                 `**Kanal:** \`#${channel.name}\` (ID: ${channel.id})\n` +
                 `**Verursacher:** <@${executor.id}> (\`${executor.tag}\` / ID: ${executor.id})\n\n` +
                 `*Falls dies ein unbefugter Angriff ist, reagiere sofort mit \`/lockdown\`!*`
      });
    }
  } catch (err) {
    console.error('Fehler beim Verarbeiten des Log-Events:', err.message);
  }
});

client.login(process.env.DISCORD_TOKEN);
