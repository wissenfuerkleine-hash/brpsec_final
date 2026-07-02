const { PermissionFlagsBits } = require('discord.js');
const { pool } = require('../database/db');

class LockdownManager {
  constructor(client) {
    this.client = client;
  }

  async isLocked() {
    const res = await pool.query(
      'SELECT * FROM active_lockdown WHERE id = 1'
    );
    return res.rows.length > 0;
  }

  async checkStatus() {
    const res = await pool.query(
      'SELECT * FROM active_lockdown WHERE id = 1'
    );

    if (!res.rows.length) return null;

    return res.rows[0];
  }

  async startLockdown(guild, level, reason) {
    const incidentId = `INC-${Date.now()}`;
    const snapshot = [];

    // Vollständigen Originalzustand speichern
    for (const [, channel] of guild.channels.cache) {
      if (!channel.permissionOverwrites) continue;

      const overwrites = [];

      for (const [, po] of channel.permissionOverwrites.cache) {
        overwrites.push({
          id: po.id,
          type: po.type,
          allow: po.allow.bitfield.toString(),
          deny: po.deny.bitfield.toString()
        });
      }

      snapshot.push({
        channelId: channel.id,
        overwrites
      });
    }

    await pool.query(
      'INSERT INTO snapshots (incident_id, channels, roles) VALUES ($1,$2,$3)',
      [incidentId, JSON.stringify(snapshot), JSON.stringify([])]
    );

    await pool.query(
      `
      INSERT INTO active_lockdown (id, incident_id, level, reason)
      VALUES (1,$1,$2,$3)
      ON CONFLICT (id)
      DO UPDATE SET incident_id=$1, level=$2, reason=$3
      `,
      [incidentId, level, reason]
    );

    await this.applyFullLockdown(guild, level);

    return incidentId;
  }

  async applyFullLockdown(guild, level) {
    const protectedChannels = [
      'server-status',
      'allgemein',
      'general',
      'support',
      'hilfe'
    ];

    for (const [, channel] of guild.channels.cache) {
      if (!channel.permissionOverwrites) continue;

      // Onboarding-Kanäle schützen
      if (
        protectedChannels.some(name =>
          channel.name.toLowerCase().includes(name)
        )
      ) {
        continue;
      }

      try {
        const updatedOverwrites = [];

        for (const [, overwrite] of channel.permissionOverwrites.cache) {
          let allow = BigInt(overwrite.allow.bitfield);
          let deny = BigInt(overwrite.deny.bitfield);

          if (level >= 1) {
            allow &= ~BigInt(PermissionFlagsBits.SendMessages);
            deny |= BigInt(PermissionFlagsBits.SendMessages);
          }

          if (level >= 2) {
            allow &= ~BigInt(PermissionFlagsBits.Connect);
            deny |= BigInt(PermissionFlagsBits.Connect);
          }

          if (level >= 3) {
            allow &= ~BigInt(PermissionFlagsBits.ViewChannel);
            deny |= BigInt(PermissionFlagsBits.ViewChannel);
          }

          updatedOverwrites.push({
            id: overwrite.id,
            type: overwrite.type,
            allow,
            deny
          });
        }

        await channel.permissionOverwrites.set(updatedOverwrites);
      } catch (err) {
        console.error(
          `Lockdown Fehler ${channel.name}:`,
          err.message
        );
      }
    }
  }

  async restoreSnapshot(guild, incidentId) {
    const res = await pool.query(
      'SELECT * FROM snapshots WHERE incident_id = $1',
      [incidentId]
    );

    if (!res.rows.length) return false;

    const snapshot = JSON.parse(res.rows[0].channels);

    for (const saved of snapshot) {
      const channel = guild.channels.cache.get(saved.channelId);

      if (!channel) continue;

      try {
        // Erst komplett löschen
        await channel.permissionOverwrites.set([]);

        // Dann Originalzustand exakt wiederherstellen
        const originalOverwrites = saved.overwrites.map(po => ({
          id: po.id,
          type: po.type,
          allow: BigInt(po.allow),
          deny: BigInt(po.deny)
        }));

        await channel.permissionOverwrites.set(originalOverwrites);
      } catch (err) {
        console.error(
          `Restore Fehler ${channel.name}:`,
          err.message
        );
      }
    }

    // Lockdown aus DB entfernen
    await pool.query('DELETE FROM active_lockdown');
    await pool.query('DELETE FROM snapshots');

    return true;
  }
}

module.exports = LockdownManager;
