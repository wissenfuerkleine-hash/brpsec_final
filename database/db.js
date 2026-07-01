const { Pool } = require('pg');
require('dotenv').config();

// Der Pool verwaltet die Verbindungen zur Railway-PostgreSQL-Datenbank
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Wichtig für Railway, da SSL dort erzwungen wird
  }
});

// Funktion zum automatischen Initialisieren der Tabellen beim Start
async function initDatabase() {
  try {
    // 1. Tabelle für die Server-Snapshots (Rechte-Backups)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS snapshots (
          incident_id VARCHAR(50) PRIMARY KEY,
          channels TEXT NOT NULL,
          roles TEXT NOT NULL
      );
    `);

    // 2. Tabelle für den aktuell aktiven Lockdown-Status
    await pool.query(`
      CREATE TABLE IF NOT EXISTS active_lockdown (
          id INT PRIMARY KEY DEFAULT 1,
          incident_id VARCHAR(50) NOT NULL,
          level INT NOT NULL,
          reason TEXT
      );
    `);

    console.log('✅ Datenbank-Tabellen erfolgreich geladen/initialisiert.');
  } catch (err) {
    console.error('❌ Fehler bei der Tabellen-Initialisierung:', err.message);
  }
}

// Führe die Initialisierung direkt beim Laden der Datei aus
initDatabase();

module.exports = { pool };
