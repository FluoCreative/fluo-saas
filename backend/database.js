const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');
const fs = require('fs');

const dbPath = path.resolve(__dirname, '../database.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password_hash TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
});

const createUser = async (username, password) => {
    const saltRounds = 10;
    const hash = await bcrypt.hash(password, saltRounds);
    
    return new Promise((resolve, reject) => {
        db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, hash], function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
        });
    });
};

const verifyUser = async (username, password) => {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE username = ?', [username], async (err, row) => {
            if (err) reject(err);
            if (!row) resolve(false);
            else {
                const match = await bcrypt.compare(password, row.password_hash);
                resolve(match ? row : false);
            }
        });
    });
};

module.exports = {
    db,
    createUser,
    verifyUser
};
