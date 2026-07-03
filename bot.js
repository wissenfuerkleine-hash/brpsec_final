const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits
} = require('discord.js');

require('dotenv').config();

const LockdownManager = require('./systems/lockdownManager');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const lm = new LockdownManager(client);

let panelChannel = null;

client.once('ready', async () => {
  console.log(`🤖 Online: ${client.user.tag}`);

  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  if (!guild) return;

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
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
        }
      ]
    });
  }

  await panelChannel.send("🛡 System aktiv");

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
      return interaction.editReply("❌ Bereits aktiv");
    }

    const id = await lm.startLockdown(guild, level, reason);

    panelChannel?.send(`🚨 LOCKDOWN LVL ${level}`);

    return interaction.editReply(`🚨 gestartet: ${id}`);
  }

  if (interaction.commandName === 'unlock') {
    await interaction.deferReply();

    const status = await lm.checkStatus();
    if (!status) return interaction.editReply("✅ kein Lockdown");

    const ok = await lm.restoreSnapshot(guild, status.incident_id);

    panelChannel?.send("🔓 entsperrt");

    return interaction.editReply(ok ? "🔓 done" : "❌ fail");
  }

  if (interaction.commandName === 'status') {
    const s = await lm.checkStatus();

    return interaction.reply(
      s ? `🔒 LVL ${s.level}` : "✅ normal"
    );
  }
});

client.login(process.env.DISCORD_TOKEN);
