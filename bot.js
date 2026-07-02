const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  MessageFlags,
  AuditLogEvent,
  EmbedBuilder,
  PermissionFlagsBits
} = require('discord.js');

const { pool } = require('./database/db');
const LockdownManager = require('./systems/lockdownManager');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildModeration]
});

const lm = new LockdownManager(client);

async function getOrCreateStatusChannel(guild) {
  let ch = guild.channels.cache.find(c => c.name === 'server-status');

  if (!ch) {
    ch = await guild.channels.create({
      name: 'server-status',
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          allow: [PermissionFlagsBits.ViewChannel],
          deny: [PermissionFlagsBits.SendMessages]
        },
        {
          id: client.user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
        }
      ]
    });
  }

  return ch;
}

client.once('ready', async () => {
  console.log(`Bot online: ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName('lockdown')
      .setDescription('Server sperren')
      .addIntegerOption(o =>
        o.setName('level').setRequired(true)
      )
      .addStringOption(o =>
        o.setName('reason').setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('unlock')
      .setDescription('Server wiederherstellen'),

    new SlashCommandBuilder()
      .setName('status')
      .setDescription('Status anzeigen')
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(
      process.env.CLIENT_ID,
      process.env.GUILD_ID
    ),
    { body: commands }
  );
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const isOwner =
    interaction.user.id === process.env.OWNER_ID ||
    interaction.user.id === process.env.SECOND_OWNER_ID;

  if (!isOwner) {
    return interaction.reply({
      content: 'Kein Zugriff',
      flags: [MessageFlags.Ephemeral]
    });
  }

  const guild = interaction.guild;
  const statusChannel = await getOrCreateStatusChannel(guild);

  await interaction.deferReply();

  if (interaction.commandName === 'lockdown') {
    const level = interaction.options.getInteger('level');
    const reason = interaction.options.getString('reason');

    if (await lm.isLocked()) {
      return interaction.editReply('Schon aktiv');
    }

    const id = await lm.startLockdown(guild, level, reason);

    await interaction.editReply(`Lockdown aktiv: ${id}`);
  }

  if (interaction.commandName === 'unlock') {
    const status = await lm.checkStatus();

    if (!status) {
      return interaction.editReply('Kein Lockdown aktiv');
    }

    const success = await lm.restoreSnapshot(guild, status.incident_id);

    if (success) {
      await pool.query('DELETE FROM active_lockdown');
      await pool.query('DELETE FROM snapshots');

      return interaction.editReply('Server wiederhergestellt');
    }

    return interaction.editReply('Restore fehlgeschlagen');
  }

  if (interaction.commandName === 'status') {
    const status = await lm.checkStatus();

    if (!status) {
      return interaction.reply('Alles normal');
    }

    return interaction.reply(
      `LOCKDOWN\nID: ${status.incident_id}\nLevel: ${status.level}`
    );
  }
});

client.on('channelDelete', async channel => {
  try {
    const logs = await channel.guild.fetchAuditLogs({
      limit: 1,
      type: AuditLogEvent.ChannelDelete
    });

    const entry = logs.entries.first();
    if (!entry) return;

    const user = entry.executor;
    if (!user) return;

    if (
      user.id === process.env.OWNER_ID ||
      user.id === process.env.SECOND_OWNER_ID
    )
      return;

    const logChannel = channel.guild.channels.cache.get(
      process.env.LOG_CHANNEL_ID
    );

    if (logChannel) {
      logChannel.send(`⚠ Kanal gelöscht: ${channel.name}`);
    }
  } catch (e) {
    console.error(e);
  }
});

client.login(process.env.DISCORD_TOKEN);
