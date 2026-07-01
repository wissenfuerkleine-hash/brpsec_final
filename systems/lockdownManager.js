const { PermissionFlagsBits } = require('discord.js');
const { pool } = require('../database/db');

class LockdownManager {
  constructor(client) {
    this.client = client;
  }

  // Der intelligente Rettungs-Unlock
  async stopLockdown(guild) {
    console.log("🚨 Sicherer Rettungs-Unlock gestartet...");
    const channels = guild.channels.cache;

    // Kanäle, die NIEMALS Schreibrechte für @everyone haben dürfen (z.B. Info-Kanäle)
    const permanentReadonlyChannels = ['regeln', 'rules', 'info', 'news', 'ankündigung', 'welcome', 'willkommen', 'server-status', 'partner'];

    for (const [_, ch] of channels) {
      if (!ch.permissionOverwrites) continue;

      // Wenn der Kanal ein Info-Kanal ist, überspringen wir das Öffnen der Schreibrechte!
      if (permanentReadonlyChannels.some(name => ch.name.toLowerCase().includes(name))) {
        console.log(`[ÜBERSPRUNGEN] ${ch.name} bleibt schreibgeschützt.`);
        
        // Sicherstellen, dass er zumindest wieder gesehen werden kann (falls Level 3 aktiv war)
        try {
          await ch.permissionOverwrites.edit(guild.roles.everyone, {
            [PermissionFlagsBits.ViewChannel]: null
          });
        } catch (_) {}
        continue; 
      }

      try {
        // Normale Textkanäle: Schreibrechte wieder für alle öffnen
        if (ch.isTextBased()) {
          await ch.permissionOverwrites.edit(guild.roles.everyone, {
            [PermissionFlagsBits.SendMessages]: null
          });
        }
        // Voicekanäle: Beitrittsrechte wieder öffnen
        if (ch.isVoiceBased()) {
          await ch.permissionOverwrites.edit(guild.roles.everyone, {
            [PermissionFlagsBits.Connect]: null
          });
        }
        // Sichtbarkeit überall wiederherstellen
        await ch.permissionOverwrites.edit(guild.roles.everyone, {
          [PermissionFlagsBits.ViewChannel]: null
        });
      } catch (err) {
        console.error(`Fehler beim automatischen Öffnen von ${ch.name}:`, err.message);
      }
    }

    try {
      await guild.setVerificationLevel(1);
    } catch (err) {}

    // Datenbank aufräumen
    await pool.query('DELETE FROM active_lockdown');
    await pool.query('DELETE FROM snapshots');

    return true;
  }

  async startLockdown(guild, level, reason) {
    const incidentId = `INC-${Date.now()}`;
    const channelData = [];

    guild.channels.cache.forEach(channel => {
      if (channel.permissionOverwrites && (channel.isTextBased() || channel.isVoiceBased())) {
        const overwrites = channel.permissionOverwrites.cache;
        channelData.push({
          id: channel.id,
          permissionOverwrites: overwrites ? overwrites.map(po => ({
            id: po.id,
            type: po.type,
            allow: po.allow.bitfield.toString(),
            deny: po.deny.bitfield.toString()
          })) : []
        });
      }
    });

    await pool.query(
      'INSERT INTO snapshots (incident_id, channels, roles) VALUES ($1, $2, $3)',
      [incidentId, JSON.stringify(channelData), JSON.stringify([])]
    );

    await pool.query(
      `INSERT INTO active_lockdown (id, incident_id, level, reason) 
       VALUES (1, $1, $2, $3) 
       ON CONFLICT (id) DO UPDATE SET incident_id = $1, level = $2, reason = $3`,
      [incidentId, level, reason]
    );

    await this.applyRestrictions(guild, level);
    return incidentId;
  }

  async applyRestrictions(guild, level) {
    const channels = guild.channels.cache;
    const allowedChannels = ['mod', 'admin', 'staff', 'bot-log', 'log', 'server-status'];

    for (const [_, ch] of channels) {
      if (!ch.permissionOverwrites || !ch.guild) continue;
      if (allowedChannels.some(name => ch.name.toLowerCase().includes(name))) continue;

      try {
        if (ch.isTextBased()) {
          await ch.permissionOverwrites.edit(guild.roles.everyone, {
            [PermissionFlagsBits.SendMessages]: false
          });
        }
        if (level >= 2 && ch.isVoiceBased()) {
          await ch.permissionOverwrites.edit(guild.roles.everyone, {
            [PermissionFlagsBits.Connect]: false
          });
        }
        if (level >= 3) {
          await ch.permissionOverwrites.edit(guild.roles.everyone, {
            [PermissionFlagsBits.ViewChannel]: false
          });
        }
      } catch (err) {
        console.error(`Fehler beim Sperren von ${ch.name}:`, err.message);
      }
    }
  }

  async checkStatus() {
    const res = await pool.query('SELECT * FROM active_lockdown WHERE id = 1');
    if (res.rows.length > 0) return res.rows[0];
    return { incident_id: "RESCUE", level: 1, reason: "Emergency Restore" };
  }
}

module.exports = LockdownManager;
