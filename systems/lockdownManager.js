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
    return res.rows.length ? res.rows[0] : null;
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
      `INSERT INTO active_lockdown (id, incident_id, level, reason)
       VALUES (1,$1,$2,$3)
       ON CONFLICT (id)
       DO UPDATE SET incident_id=$1, level=$2, reason=$3`,
      [incidentId, level, reason]
    );

    await this.applyLockdown(guild, level);

    return incidentId;
  }

  async applyLockdown(guild, level) {
    const protectedChannels = [
      'allgemein',
      'general',
      'support',
      'hilfe',
      'server-status'
    ];

    for (const [, channel] of guild.channels.cache) {
      if (!channel.permissionOverwrites) continue;

      if (
        protectedChannels.some(n =>
          channel.name.toLowerCase().includes(n)
        )
      ) continue;

      try {
        const updated = [];

        for (const [, o] of channel.permissionOverwrites.cache) {
          let allow = BigInt(o.allow.bitfield);
          let deny = BigInt(o.deny.bitfield);

          const S = BigInt(PermissionFlagsBits.SendMessages);
          const C = BigInt(PermissionFlagsBits.Connect);
          const V = BigInt(PermissionFlagsBits.ViewChannel);

          if (level >= 1) {
            allow &= ~S;
            deny |= S;
          }

          if (level >= 2) {
            allow &= ~C;
            deny |= C;
          }

          if (level >= 3) {
            allow &= ~V;
            deny |= V;
          }

          updated.push({
            id: o.id,
            type: o.type,
            allow,
            deny
          });
        }

        await channel.permissionOverwrites.set(updated);
      } catch (err) {
        console.error(`Lock Fehler ${channel.name}:`, err.message);
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
        // komplett reset
        await channel.permissionOverwrites.set([]);

        const restored = saved.overwrites.map(o => ({
          id: o.id,
          type: o.type,
          allow: BigInt(o.allow),
          deny: BigInt(o.deny)
        }));

        await channel.permissionOverwrites.set(restored);
      } catch (err) {
        console.error(`Restore Fehler ${channel.name}:`, err.message);
      }
    }

    await pool.query('DELETE FROM active_lockdown');
    await pool.query('DELETE FROM snapshots');

    return true;
  }
}

module.exports = LockdownManager;
