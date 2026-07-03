const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits
} = require('discord.js');

require('dotenv').config();

const { pool } = require('../database/db');
const LockdownManager = require('./systems/lockdownManager');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const lm = new LockdownManager(client);

let panelChannel = null;

client.once('ready', async () => {
  console.log(`🤖 Bot online: ${client.user.tag}`);

  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  if (!guild) return;

  // 📌 PANEL CHANNEL
  panelChannel = guild.channels.cache.find(c => c.name === 'server-status');

  if (!panelChannel) {
    panelChannel = await guild.channels.create({
      name: 'server-status',
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

    console.log("📌 Panel erstellt");
  }

  await panelChannel.send("🛡 Security System aktiv");

  // SLASH COMMANDS
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
      .setDescription('Server entsperren'),

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
    { body: commands.map(c => c.toJSON()) }
  );
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const guild = interaction.guild;

  if (interaction.commandName === 'lockdown') {
    await interaction.deferReply();

    const level = interaction.options.getInteger('level');
    const reason = interaction.options.getString('reason');

    if (await lm.isLocked()) {
      return interaction.editReply("❌ Already locked");
    }

    const id = await lm.startLockdown(guild, level, reason);

    if (panelChannel) {
      panelChannel.send(`🚨 LOCKDOWN ${level} aktiv`);
    }

    return interaction.editReply(`🚨 gestartet: ${id}`);
  }

  if (interaction.commandName === 'unlock') {
    await interaction.deferReply();

    const status = await lm.checkStatus();
    if (!status) {
      return interaction.editReply("✅ kein Lockdown");
    }

    const ok = await lm.restoreSnapshot(
      guild,
      status.incident_id
    );

    if (panelChannel) {
      panelChannel.send("🔓 Server entsperrt");
    }

    return interaction.editReply(ok ? "🔓 done" : "❌ error");
  }

  if (interaction.commandName === 'status') {
    const s = await lm.checkStatus();

    return interaction.reply(
      s
        ? `🔒 LOCKDOWN LVL ${s.level}`
        : "✅ NORMAL"
    );
  }
});

client.login(process.env.DISCORD_TOKEN);
