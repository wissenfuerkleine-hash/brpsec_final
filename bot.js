if (interaction.commandName === 'lockdown') {
  const level = interaction.options.getInteger('level');
  const reason = interaction.options.getString('reason');

  if (await lm.isLocked()) {
    return interaction.editReply('❌ Bereits aktiv');
  }

  const id = await lm.startLockdown(guild, level, reason);

  return interaction.editReply(`🚨 Lockdown aktiv: ${id}`);
}

if (interaction.commandName === 'unlock') {
  const status = await lm.checkStatus();

  if (!status) {
    return interaction.editReply('✅ Kein Lockdown aktiv');
  }

  const ok = await lm.restoreSnapshot(
    guild,
    status.incident_id
  );

  if (ok) {
    return interaction.editReply('🔓 Wiederhergestellt');
  }

  return interaction.editReply('❌ Restore fehlgeschlagen');
}
