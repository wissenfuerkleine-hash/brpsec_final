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

const requiredEnv = [
  'DISCORD_TOKEN',
  'CLIENT_ID',
  'GUILD_ID',
  'DATABASE_URL',
  'OWNER_ID',
  'SECOND_OWNER_ID',
  'LOG_CHANNEL_ID'
];

for (const envVar of requiredEnv) {
  if (!process.env[envVar]) {
    throw new Error(`❌ Fehlende ENV Variable: ${envVar}`);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildModeration
  ]
});

const lm = new LockdownManager(client);

async function getOrCreateStatusChannel(guild) {
  let channel = guild.channels.cache.find(
    c => c.name === 'server-status' && c.isTextBased()
  );

  if (!channel) {
    try {
      channel = await guild.channels.create({
        name: 'server-status',
        reason: 'Automatischer Sicherheitsstatus-Kanal',
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            allow: [PermissionFlagsBits.ViewChannel],
            deny: [
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.AddReactions
            ]
          },
          {
            id: client.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.EmbedLinks
            ]
          }
        ]
      });

      console.log('✅ Status-Kanal erstellt');
    } catch (err) {
      console.error('Fehler beim Erstellen des Status-Kanals:', err.message);
    }
  }

  return channel;
}

client.once('clientReady', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName('lockdown')
      .setDescription('Sperrt den Server')
      .addIntegerOption(option =>
        option
          .setName('level')
          .setDescription('Lockdown Stufe (1-3)')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('reason')
          .setDescription('Grund für den Lockdown')
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('unlock')
      .setDescription('Hebt den Lockdown auf'),

    new SlashCommandBuilder()
      .setName('status')
      .setDescription('Zeigt den aktuellen Status')
  ];

  const rest = new REST({ version: '10' }).setToken(
    process.env.DISCORD_TOKEN
  );

  try {
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      {
        body: commands.map(cmd => cmd.toJSON())
      }
    );

    console.log('🚀 Slash Commands registriert');
  } catch (err) {
    console.error('Fehler bei Slash Commands:', err);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const isMainOwner = interaction.user.id === process.env.OWNER_ID;
  const isSecondOwner = interaction.user.id === process.env.SECOND_OWNER_ID;

  if (!isMainOwner && !isSecondOwner) {
    return interaction.reply({
      content: '❌ Zugriff verweigert.',
      flags: [MessageFlags.Ephemeral]
    });
  }

  const guild = interaction.guild;
  const statusChannel = await getOrCreateStatusChannel(guild);

  if (
    interaction.commandName === 'lockdown' ||
    interaction.commandName === 'unlock'
  ) {
    await interaction.deferReply();
  }

  if (interaction.commandName === 'lockdown') {
    const level = interaction.options.getInteger('level');
    const reason = interaction.options.getString('reason');

    if (await lm.isLocked()) {
      return interaction.editReply(
        '❌ Es läuft bereits ein Lockdown.'
      );
    }

    const incidentId = await lm.startLockdown(
      guild,
      level,
      reason
    );

    await interaction.editReply(
      `🚨 Lockdown aktiviert\nID: ${incidentId}`
    );

    if (statusChannel) {
      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('🚨 LOCKDOWN AKTIV')
        .setDescription(
          'Serverrechte wurden vorübergehend eingeschränkt.'
        )
        .addFields(
          {
            name: 'Stufe',
            value: `${level}`,
            inline: true
          },
          {
            name: 'Grund',
            value: reason,
            inline: false
          },
          {
            name: 'Von',
            value: `<@${interaction.user.id}>`,
            inline: true
          }
        )
        .setTimestamp();

      await statusChannel.send({
        embeds: [embed]
      });
    }
  }

  if (interaction.commandName === 'unlock') {
    const status = await lm.checkStatus();

    if (!status) {
      return interaction.editReply(
        '✅ Kein Lockdown aktiv.'
      );
    }

    const success = await lm.restoreSnapshot(
      guild,
      status.incident_id
    );

    if (success) {
      await pool.query('DELETE FROM active_lockdown');
      await pool.query('DELETE FROM snapshots');

      await interaction.editReply(
        '🔓 Server erfolgreich wiederhergestellt.'
      );

      if (statusChannel) {
        const embed = new EmbedBuilder()
          .setColor(0x00ff00)
          .setTitle('🔓 LOCKDOWN BEENDET')
          .setDescription(
            'Alle Rechte wurden wiederhergestellt.'
          )
          .setTimestamp();

        await statusChannel.send({
          embeds: [embed]
        });
      }
    } else {
      await interaction.editReply(
        '❌ Snapshot konnte nicht wiederhergestellt werden.'
      );
    }
  }

  if (interaction.commandName === 'status') {
    const status = await lm.checkStatus();

    if (!status) {
      return interaction.reply(
        '✅ Status normal. Kein Lockdown aktiv.'
      );
    }

    return interaction.reply(
      `🔒 Lockdown aktiv\nID: ${status.incident_id}\nStufe: ${status.level}\nGrund: ${status.reason}`
    );
  }
});

client.on('channelDelete', async channel => {
  const guild = channel.guild;

  if (guild.id !== process.env.GUILD_ID) return;

  try {
    const logs = await guild.fetchAuditLogs({
      limit: 1,
      type: AuditLogEvent.ChannelDelete
    });

    const entry = logs.entries.first();

    if (!entry) return;

    const executor = entry.executor;

    if (
      executor.id === process.env.OWNER_ID ||
      executor.id === process.env.SECOND_OWNER_ID ||
      executor.id === client.user.id
    ) {
      return;
    }

    console.log(
      `⚠ Kanal gelöscht: ${channel.name} von ${executor.tag}`
    );

    const logChannel = guild.channels.cache.get(
      process.env.LOG_CHANNEL_ID
    );

    if (logChannel && logChannel.isTextBased()) {
      await logChannel.send(
        `⚠ Sicherheitswarnung!\nKanal gelöscht: #${channel.name}\nVon: <@${executor.id}>`
      );
    }
  } catch (err) {
    console.error(
      'AuditLog Fehler:',
      err.message
    );
  }
});

client.login(process.env.DISCORD_TOKEN);
