const { PermissionFlagsBits } = require('discord.js');
const { pool } = require('../database/db');

class LockdownManager {
  constructor(client) {
    this.client = client;
  }

  // SNAPSHOT ERSTELLEN & KANÄLE SPERREN
  async startLockdown(guild, level, reason) {
    const incidentId = `INC-${Date.now()}`;
    const channelData = [];
    const roleData = [];

    // Jeden einzelnen Kanal scannen und Rechte für jede Rolle/User sichern
    guild.channels.cache.forEach(channel => {
      const overwrites = channel.permissionOverwrites?.cache;
      channelData.push({
        id: channel.id,
        permissionOverwrites: overwrites ? overwrites.map(po => ({
          id: po.id,
          type: po.type,
          allow: po.allow.bitfield.toString(),
          deny: po.deny.bitfield.toString()
        })) : []
      });
    });

    // Snapshot unzerstörbar auf Railway sichern
    await pool.query(
      'INSERT INTO snapshots (incident_id, channels, roles) VALUES ($1, $2, $3)',
      [incidentId, JSON.stringify(channelData), JSON.stringify(roleData)]
    );

    // Aktiven Zustand in der DB vermerken (für Crash-Resistenz)
    await pool.query(
      `INSERT INTO active_lockdown (id, incident_id, level, reason) 
       VALUES (1, $1, $2, $3) 
       ON CONFLICT (id) DO UPDATE SET incident_id = $1, level = $2, reason = $3`,
      [incidentId, level, reason]
    );

    // Lockdown-Maßnahmen (Sperrung) anwenden
    await this.applyRestrictions(guild, level);
    return incidentId;
  }

  // Kanäle für @everyone sperren
  async applyRestrictions(guild, level) {
    const channels = guild.channels.cache.filter(c => c.isTextBased());
    const allowedChannels = ['mod', 'admin', 'staff', 'bot-log', 'log'];

    for (const [_, ch] of channels) {
      if (!allowedChannels.some(name => ch.name.toLowerCase().includes(name))) {
        try {
          await ch.permissionOverwrites.edit(guild.roles.everyone, {
            [PermissionFlagsBits.SendMessages]: false
          });
        } catch (err) {
          console.error(`Fehler beim Sperren von ${ch.name}:`, err.message);
        }
      }
    }
  }

  // RESTORE SYSTEM (1ZU1 RECHTE-WIEDERHERSTELLUNG FÜR JEDE ROLLE)
  async stopLockdown(guild) {
    const activeRes = await pool.query('SELECT incident_id FROM active_lockdown WHERE id = 1');
    if (activeRes.rows.length === 0) return false;

    const incidentId = activeRes.rows[0].incident_id;

    const snapshotRes = await pool.query('SELECT channels FROM snapshots WHERE incident_id = $1', [incidentId]);
    if (snapshotRes.rows.length === 0) return false;

    const savedChannels = JSON.parse(snapshotRes.rows[0].channels);

    // Kanäle nacheinander wiederherstellen
    for (const savedChan of savedChannels) {
      const realChannel = guild.channels.cache.get(savedChan.id);
      if (realChannel) {
        try {
          // Alle aktuellen Rechte auf dem Kanal komplett löschen
          await realChannel.permissionOverwrites.set([]);
          
          // Jede einzelne Rolle und Berechtigung aus der DB exakt neu setzen
          for (const overwrite of savedChan.permissionOverwrites) {
            await realChannel.permissionOverwrites.create(overwrite.id, {
              allow: BigInt(overwrite.allow),
              deny: BigInt(overwrite.deny)
            }, { type: overwrite.type });
          }
        } catch (err) {
          console.error(`Fehler beim Wiederherstellen von ${realChannel.name}:`, err.message);
        }
      }
    }

    // Lockdown-Status aus DB löschen
    await pool.query('DELETE FROM active_lockdown WHERE id = 1');
    return true;
  }

  async checkStatus() {
    const res = await pool.query('SELECT * FROM active_lockdown WHERE id = 1');
    return res.rows.length > 0 ? res.rows[0] : null;
  }
}

module.exports = LockdownManager;
