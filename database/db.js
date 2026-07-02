const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS snapshots (
        incident_id VARCHAR(50) PRIMARY KEY,
        channels TEXT NOT NULL,
        roles TEXT NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS active_lockdown (
        id INT PRIMARY KEY DEFAULT 1,
        incident_id VARCHAR(50) NOT NULL,
        level INT NOT NULL,
        reason TEXT
      );
    `);

    console.log('✅ DB initialisiert');
  } catch (err) {
    console.error('❌ DB Fehler:', err.message);
  }
}

initDatabase();

module.exports = { pool };
