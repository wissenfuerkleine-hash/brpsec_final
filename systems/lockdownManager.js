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

    if (res.rows.length === 0) return null;
    return res.rows[0];
  }

  async startLockdown(guild, level, reason) {
    const incidentId = `INC-${Date.now()}`;

    const snapshot = [];

    for (const [, channel] of guild.channels.cache) {
      if (!channel.permissionOverwrites) continue;

      snapshot.push({
        channelId: channel.id,
        overwrites: channel.permissionOverwrites.cache.map(po => ({
          id: po.id,
          type: po.type,
          allow: po.allow.bitfield.toString(),
          deny: po.deny.bitfield.toString()
        }))
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
    for (const [, channel] of guild.channels.cache) {
      if (!channel.permissionOverwrites) continue;

      try {
        const newOverwrites = [];

        for (const [, overwrite] of channel.permissionOverwrites.cache) {
          let deny = BigInt(overwrite.deny.bitfield);
          let allow = BigInt(overwrite.allow.bitfield);

          if (level >= 1) {
            deny |= BigInt(PermissionFlagsBits.SendMessages);
          }

          if (level >= 2) {
            deny |= BigInt(PermissionFlagsBits.Connect);
          }

          if (level >= 3) {
            deny |= BigInt(PermissionFlagsBits.ViewChannel);
          }

          newOverwrites.push({
            id: overwrite.id,
            type: overwrite.type,
            allow,
            deny
          });
        }

        await channel.permissionOverwrites.set(newOverwrites);
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

    if (res.rows.length === 0) return false;

    const snapshot = JSON.parse(res.rows[0].channels);

    for (const savedChannel of snapshot) {
      const channel = guild.channels.cache.get(
        savedChannel.channelId
      );

      if (!channel) continue;

      try {
        const restoredOverwrites = savedChannel.overwrites.map(
          overwrite => ({
            id: overwrite.id,
            type: overwrite.type,
            allow: BigInt(overwrite.allow),
            deny: BigInt(overwrite.deny)
          })
        );

        await channel.permissionOverwrites.set(
          restoredOverwrites
        );
      } catch (err) {
        console.error(
          `Restore Fehler ${channel.name}:`,
          err.message
        );
      }
    }

    return true;
  }
}

module.exports = LockdownManager;
