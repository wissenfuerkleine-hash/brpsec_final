const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes
} = require('discord.js');

require('dotenv').config();

const LockdownManager = require('./systems/lockdownManager');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildModeration
  ]
});

const lm = new LockdownManager(client);

client.once('ready', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName('lockdown')
      .setDescription('Sperrt den Server')
      .addIntegerOption(option =>
        option
          .setName('level')
          .setDescription('Lockdown Level (1-3)')
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
      .setDescription('Stellt den Server wieder her'),

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
    console.error('Command Fehler:', err.message);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const isMainOwner =
    interaction.user.id === process.env.OWNER_ID;

  const isSecondOwner =
    interaction.user.id === process.env.SECOND_OWNER_ID;

  if (!isMainOwner && !isSecondOwner) {
    return interaction.reply({
      content:
        '❌ Keine Berechtigung für dieses Sicherheitssystem.',
      ephemeral: true
    });
  }

  const guild = interaction.guild;

  try {
    // LOCKDOWN
    if (interaction.commandName === 'lockdown') {
      await interaction.deferReply();

      const level = interaction.options.getInteger('level');
      const reason = interaction.options.getString('reason');

      if (await lm.isLocked()) {
        return interaction.editReply(
          '❌ Lockdown ist bereits aktiv.'
        );
      }

      const incidentId = await lm.startLockdown(
        guild,
        level,
        reason
      );

      return interaction.editReply(
        `🚨 Lockdown aktiviert\nID: ${incidentId}`
      );
    }

    // UNLOCK
    if (interaction.commandName === 'unlock') {
      await interaction.deferReply();

      const status = await lm.checkStatus();

      if (!status) {
        return interaction.editReply(
          '✅ Kein Lockdown aktiv.'
        );
      }

      const restored = await lm.restoreSnapshot(
        guild,
        status.incident_id
      );

      if (!restored) {
        return interaction.editReply(
          '❌ Snapshot konnte nicht wiederhergestellt werden.'
        );
      }

      return interaction.editReply(
        '🔓 Server erfolgreich wiederhergestellt.'
      );
    }

    // STATUS
    if (interaction.commandName === 'status') {
      const status = await lm.checkStatus();

      if (!status) {
        return interaction.reply(
          '✅ Status: Normal (kein Lockdown aktiv)'
        );
      }

      return interaction.reply(
        `🔒 Lockdown aktiv\nID: ${status.incident_id}\nLevel: ${status.level}\nGrund: ${status.reason}`
      );
    }
  } catch (err) {
    console.error('Interaction Fehler:', err.message);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(
        '❌ Ein Fehler ist aufgetreten.'
      );
    } else {
      await interaction.reply({
        content: '❌ Ein Fehler ist aufgetreten.',
        ephemeral: true
      });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
