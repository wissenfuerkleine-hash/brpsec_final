const { PermissionFlagsBits } = require('discord.js');
const { pool } = require('../../database/db');

class LockdownManager {
  constructor(client) {
    this.client = client;
  }

  // 🔎 STATUS CHECK
  async checkStatus() {
    const res = await pool.query(
      'SELECT * FROM active_lockdown WHERE id=1'
    );
    return res.rows[0] || null;
  }

  async isLocked() {
    const res = await pool.query(
      'SELECT * FROM active_lockdown WHERE id=1'
    );
    return res.rows.length > 0;
  }

  // 📸 SNAPSHOT + START LOCKDOWN
  async startLockdown(guild, level, reason) {
    const incidentId = `INC-${Date.now()}`;

    const snapshot = [];

    for (const [, channel] of guild.channels.cache) {
      if (!channel.permissionOverwrites) continue;

      snapshot.push({
        id: channel.id,
        overwrites: channel.permissionOverwrites.cache.map(o => ({
          id: o.id,
          type: o.type,
          allow: o.allow.bitfield.toString(),
          deny: o.deny.bitfield.toString()
        }))
      });
    }

    await pool.query(
      'INSERT INTO snapshots VALUES ($1,$2)',
      [incidentId, JSON.stringify(snapshot)]
    );

    await pool.query(
      `INSERT INTO active_lockdown (id, incident_id, level, reason)
       VALUES (1,$1,$2,$3)
       ON CONFLICT (id)
       DO UPDATE SET incident_id=$1, level=$2, reason=$3`,
      [incidentId, level, reason]
    );

    await this.applyLockdown(guild, level);

    if (level >= 3) {
      await this.deleteAllInvites(guild);
    }

    return incidentId;
  }

  // 🔥 LOCKDOWN APPLY
  async applyLockdown(guild, level) {
    for (const [, channel] of guild.channels.cache) {
      if (!channel.permissionOverwrites) continue;

      try {
        const updated = [];

        for (const [, o] of channel.permissionOverwrites.cache) {
          let allow = BigInt(o.allow.bitfield);
          let deny = BigInt(o.deny.bitfield);

          const SEND = BigInt(PermissionFlagsBits.SendMessages);
          const CONNECT = BigInt(PermissionFlagsBits.Connect);
          const VIEW = BigInt(PermissionFlagsBits.ViewChannel);

          if (level >= 1) {
            allow &= ~SEND;
            deny |= SEND;
          }

          if (level >= 2) {
            allow &= ~CONNECT;
            deny |= CONNECT;
          }

          if (level >= 3) {
            allow &= ~VIEW;
            deny |= VIEW;
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
        console.error(`Lockdown Fehler ${channel.name}:`, err.message);
      }
    }
  }

  // 🧨 INVITES DELETE (LEVEL 3)
  async deleteAllInvites(guild) {
    try {
      const invites = await guild.invites.fetch();

      for (const invite of invites.values()) {
        await invite.delete("Lockdown Level 3 - Invite Cleanup");
      }

      console.log(`🧨 ${invites.size} Invites gelöscht`);
    } catch (err) {
      console.error("Invite Fehler:", err.message);
    }
  }

  // 🔓 RESTORE 1:1
  async restoreSnapshot(guild, incidentId) {
    const res = await pool.query(
      'SELECT * FROM snapshots WHERE incident_id=$1',
      [incidentId]
    );

    if (!res.rows.length) return false;

    const snapshot = JSON.parse(res.rows[0].data);

    for (const saved of snapshot) {
      const channel = guild.channels.cache.get(saved.id);
      if (!channel) continue;

      try {
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
