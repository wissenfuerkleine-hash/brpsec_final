const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits
} = require('discord.js');

const { pool } = require('./database/db');
const LockdownManager = require('./systems/lockdownManager');

require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const lm = new LockdownManager(client);

let panelChannel = null;

client.once('ready', async () => {
  console.log(`🤖 Bot online: ${client.user.tag}`);

  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  if (!guild) {
    console.log('❌ Guild nicht gefunden');
    return;
  }

  // 📌 PANEL CHANNEL ERSTELLEN / FINDEN
  panelChannel = guild.channels.cache.find(
    c => c.name === 'server-status'
  );

  if (!panelChannel) {
    try {
      panelChannel = await guild.channels.create({
        name: 'server-status',
        type: 0,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            allow: [PermissionFlagsBits.ViewChannel],
            deny: [PermissionFlagsBits.SendMessages]
          },
          {
            id: client.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages
            ]
          }
        ]
      });

      console.log('📌 Panel-Channel erstellt');
    } catch (err) {
      console.error('Fehler Panel:', err.message);
    }
  }

  // 📊 Status Nachricht
  try {
    await panelChannel.send(
      '🛡️ **Security System aktiv**\n' +
      'Commands: /status | /lockdown | /unlock'
    );
  } catch {}

  // SLASH COMMANDS
  const commands = [
    new SlashCommandBuilder()
      .setName('lockdown')
      .setDescription('Server sperren')
      .addIntegerOption(o =>
        o.setName('level').setRequired(true).setDescription('1-3')
      )
      .addStringOption(o =>
        o.setName('reason').setRequired(true).setDescription('Grund')
      ),

    new SlashCommandBuilder()
      .setName('unlock')
      .setDescription('Server entsperren'),

    new SlashCommandBuilder()
      .setName('status')
      .setDescription('Server Status anzeigen')
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  try {
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands.map(c => c.toJSON()) }
    );

    console.log('🚀 Slash Commands registriert');
  } catch (err) {
    console.error('Command Fehler:', err.message);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const guild = interaction.guild;

  // 🔒 LOCKDOWN
  if (interaction.commandName === 'lockdown') {
    await interaction.deferReply();

    const level = interaction.options.getInteger('level');
    const reason = interaction.options.getString('reason');

    const already = await lm.isLocked();
    if (already) {
      return interaction.editReply('❌ Lockdown bereits aktiv');
    }

    const id = await lm.startLockdown(guild, level, reason);

    if (panelChannel) {
      panelChannel.send(
        `🚨 LOCKDOWN AKTIV\nLevel: ${level}\nGrund: ${reason}`
      );
    }

    return interaction.editReply(`🚨 Lockdown gestartet: ${id}`);
  }

  // 🔓 UNLOCK
  if (interaction.commandName === 'unlock') {
    await interaction.deferReply();

    const status = await lm.checkStatus();

    if (!status) {
      return interaction.editReply('✅ Kein Lockdown aktiv');
    }

    const ok = await lm.restoreSnapshot(
      guild,
      status.incident_id
    );

    if (panelChannel) {
      panelChannel.send('🔓 Server entsperrt');
    }

    return interaction.editReply(
      ok ? '🔓 Restore fertig' : '❌ Fehler beim Restore'
    );
  }

  // 📊 STATUS
  if (interaction.commandName === 'status') {
    const s = await lm.checkStatus();

    return interaction.reply(
      s
        ? `🔒 LOCKDOWN aktiv\nLevel: ${s.level}\nGrund: ${s.reason}`
        : '✅ Server normal'
    );
  }
});

client.login(process.env.DISCORD_TOKEN);
