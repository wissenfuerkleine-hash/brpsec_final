const { PermissionFlagsBits } = require('discord.js');
const { pool } = require('../database/db');

class LockdownManager {
  constructor(client) {
    this.client = client;
  }

  async startLockdown(guild, level, reason) {
    const incidentId = `INC-${Date.now()}`;
    const channelData = [];
    const roleData = [];

    // 1. Snapshot der Kanalrechte erstellen
    guild.channels.cache.forEach(channel => {
      // Nur Kanäle mit echten Rechten sichern (Kategorien/Texte/Voice)
      if (channel.permissionOverwrites) {
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

    // 2. LEVEL 3 SPEZIAL: Einladungen sichern und löschen
    let savedInvites = [];
    if (level >= 3) {
      try {
        const invites = await guild.invites.fetch();
        savedInvites = invites.map(inv => ({
          code: inv.code,
          channelId: inv.channelId,
          uses: inv.uses,
          maxUses: inv.maxUses,
          maxAge: inv.maxAge,
          temporary: inv.temporary,
          inviterId: inv.inviter?.id
        }));

        for (const [_, invite] of invites) {
          await invite.delete('🚨 Lockdown Level 3 aktiviert - Invites gelöscht');
        }
        console.log(`[LEVEL 3] ${invites.size} Einladungs-Links wurden gelöscht und gesichert.`);
      } catch (err) {
        console.error('Fehler beim Sichern/Löschen der Invites:', err.message);
      }
    }

    await pool.query(
      'INSERT INTO snapshots (incident_id, channels, roles) VALUES ($1, $2, $3)',
      [incidentId, JSON.stringify(channelData), JSON.stringify(savedInvites)]
    );

    await pool.query(
      `INSERT INTO active_lockdown (id, incident_id, level, reason) 
       VALUES (1, $1, $2, $3) 
       ON CONFLICT (id) DO UPDATE SET incident_id = $1, level = $2, reason = $3`,
      [incidentId, level, reason]
    );

    // 3. Einschränkungen anwenden
    await this.applyRestrictions(guild, level);
    return incidentId;
  }

  async applyRestrictions(guild, level) {
    const channels = guild.channels.cache;
    const allowedChannels = ['mod', 'admin', 'staff', 'bot-log', 'log', 'server-status'];

    for (const [_, ch] of channels) {
      // Sicherheits-Check: Hat der Kanal überhaupt das Permission-Objekt?
      if (!ch.permissionOverwrites) continue;

      // Team-Kanäle und den Status-Kanal ignorieren
      if (allowedChannels.some(name => ch.name.toLowerCase().includes(name))) continue;

      try {
        // LEVEL 1: Textkanäle sperren
        if (ch.isTextBased()) {
          await ch.permissionOverwrites.edit(guild.roles.everyone, {
            [PermissionFlagsBits.SendMessages]: false
          });
        }

        // LEVEL 2: Voice-Channels sperren
        if (level >= 2 && ch.isVoiceBased()) {
          await ch.permissionOverwrites.edit(guild.roles.everyone, {
            [PermissionFlagsBits.Connect]: false
          });
        }

        // LEVEL 3: Absoluter Riegel (Unsichtbar machen)
        if (level >= 3) {
          await ch.permissionOverwrites.edit(guild.roles.everyone, {
            [PermissionFlagsBits.ViewChannel]: false,
            [PermissionFlagsBits.CreateInstantInvite]: false
          });
        }
      } catch (err) {
        console.error(`Fehler beim Sperren von ${ch.name}:`, err.message);
      }
    }

    if (level >= 3) {
      try {
        await guild.setVerificationLevel(4);
      } catch (err) {
        console.error('Fehler beim Ändern der Verifikationsstufe:', err.message);
      }
    }
  }

  async stopLockdown(guild) {
    const activeRes = await pool.query('SELECT incident_id, level FROM active_lockdown WHERE id = 1');
    if (activeRes.rows.length === 0) return false;

    const { incident_id: incidentId, level } = activeRes.rows[0];

    const snapshotRes = await pool.query('SELECT channels, roles FROM snapshots WHERE incident_id = $1', [incidentId]);
    if (snapshotRes.rows.length === 0) return false;

    const savedChannels = JSON.parse(snapshotRes.rows[0].channels);
    const savedInvites = JSON.parse(snapshotRes.rows[0].roles);

    for (const savedChan of savedChannels) {
      const realChannel = guild.channels.cache.get(savedChan.id);
      if (realChannel && realChannel.permissionOverwrites) {
        try {
          await realChannel.permissionOverwrites.set([]);
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

    if (level >= 3) {
      try {
        await guild.setVerificationLevel(1);
        for (const inv of savedInvites) {
          const channel = guild.channels.cache.get(inv.channelId);
          if (channel) {
            await channel.createInvite({
              maxAge: inv.maxAge,
              maxUses: inv.maxUses,
              temporary: inv.temporary,
              unique: true,
              reason: 'Lockdown beendet - Invite wiederhergestellt'
            });
          }
        }
      } catch (err) {
        console.error('Fehler bei der Invite-Wiederherstellung:', err.message);
      }
    }

    await pool.query('DELETE FROM active_lockdown WHERE id = 1');
    return true;
  }

  async checkStatus() {
    const res = await pool.query('SELECT * FROM active_lockdown WHERE id = 1');
    return res.rows.length > 0 ? res.rows[0] : null;
  }
}

module.exports = LockdownManager;
