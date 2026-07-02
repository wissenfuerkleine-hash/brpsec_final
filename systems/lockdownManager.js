const { PermissionFlagsBits } = require('discord.js');
const { pool } = require('../database/db');

class LockdownManager {
  constructor(client) {
    this.client = client;
  }

  async isLocked() {
    const res = await pool.query('SELECT * FROM active_lockdown WHERE id = 1');
    return res.rows.length > 0;
  }

  async checkStatus() {
    const res = await pool.query('SELECT * FROM active_lockdown WHERE id = 1');
    if (res.rows.length === 0) return null;
    return res.rows[0];
  }

  async startLockdown(guild, level, reason) {
    const incidentId = `INC-${Date.now()}`;

    const channelData = [];

    guild.channels.cache.forEach(channel => {
      if (!channel.permissionOverwrites) return;

      channelData.push({
        id: channel.id,
        overwrites: channel.permissionOverwrites.cache.map(po => ({
          id: po.id,
          type: po.type,
          allow: po.allow.bitfield.toString(),
          deny: po.deny.bitfield.toString()
        }))
      });
    });

    await pool.query(
      'INSERT INTO snapshots (incident_id, channels, roles) VALUES ($1, $2, $3)',
      [incidentId, JSON.stringify(channelData), JSON.stringify([])]
    );

    await pool.query(
      `INSERT INTO active_lockdown (id, incident_id, level, reason)
       VALUES (1, $1, $2, $3)
       ON CONFLICT (id)
       DO UPDATE SET incident_id=$1, level=$2, reason=$3`,
      [incidentId, level, reason]
    );

    await this.applyRestrictions(guild, level);

    return incidentId;
  }

  async applyRestrictions(guild, level) {
    const channels = guild.channels.cache;

    const ignore = ['mod', 'admin', 'staff', 'log', 'bot'];

    for (const [, ch] of channels) {
      if (!ch.isTextBased() && !ch.isVoiceBased()) continue;
      if (ignore.some(n => ch.name.toLowerCase().includes(n))) continue;

      try {
        if (ch.isTextBased()) {
          await ch.permissionOverwrites.edit(guild.roles.everyone, {
            SendMessages: false
          });
        }

        if (level >= 2 && ch.isVoiceBased()) {
          await ch.permissionOverwrites.edit(guild.roles.everyone, {
            Connect: false
          });
        }

        if (level >= 3) {
          await ch.permissionOverwrites.edit(guild.roles.everyone, {
            ViewChannel: false
          });
        }
      } catch (err) {
        console.error(`Lock Fehler ${ch.name}:`, err.message);
      }
    }
  }

  async restoreSnapshot(guild, incidentId) {
    const res = await pool.query(
      'SELECT * FROM snapshots WHERE incident_id=$1',
      [incidentId]
    );

    if (res.rows.length === 0) return false;

    const snapshot = res.rows[0];
    const channels = JSON.parse(snapshot.channels);

    for (const chData of channels) {
      const channel = guild.channels.cache.get(chData.id);
      if (!channel) continue;

      try {
        const overwrites = chData.overwrites.map(o => ({
          id: o.id,
          allow: BigInt(o.allow),
          deny: BigInt(o.deny),
          type: o.type
        }));

        await channel.permissionOverwrites.set(overwrites);
      } catch (err) {
        console.error(`Restore Fehler ${channel.name}:`, err.message);
      }
    }

    return true;
  }
}

module.exports = LockdownManager;
