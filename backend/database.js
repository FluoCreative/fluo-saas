const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Required for Supabase/Render
});

pool.connect((err, client, release) => {
    if (err) {
        console.error('Erro ao conectar ao PostgreSQL. Verifique sua DATABASE_URL.', err.stack);
        return;
    }
    console.log('Conectado ao PostgreSQL com sucesso.');
    
    // Migrações Iniciais
    client.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(255) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            credits INTEGER DEFAULT 2,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        release();
        if (err) {
            console.error('Erro ao criar tabela users:', err.stack);
        } else {
            console.log('Tabela users garantida no PostgreSQL.');
        }
    });
});

const createUser = async (username, password) => {
    const saltRounds = 10;
    const hash = await bcrypt.hash(password, saltRounds);
    
    return new Promise((resolve, reject) => {
        pool.query(
            'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id',
            [username, hash],
            (err, res) => {
                if (err) reject(err);
                else resolve(res.rows[0].id);
            }
        );
    });
};

const verifyUser = async (username, password) => {
    return new Promise((resolve, reject) => {
        pool.query('SELECT * FROM users WHERE username = $1', [username], async (err, res) => {
            if (err) reject(err);
            if (res.rows.length === 0) resolve(false);
            else {
                const row = res.rows[0];
                const match = await bcrypt.compare(password, row.password_hash);
                resolve(match ? row : false);
            }
        });
    });
};

const getUserCredits = async (userId) => {
    return new Promise((resolve, reject) => {
        pool.query('SELECT credits FROM users WHERE id = $1', [userId], (err, res) => {
            if (err) reject(err);
            else resolve(res.rows.length > 0 ? res.rows[0].credits : 0);
        });
    });
};

const consumeCredit = async (userId) => {
    return new Promise((resolve, reject) => {
        pool.query(
            'UPDATE users SET credits = credits - 1 WHERE id = $1 AND credits > 0 RETURNING id',
            [userId],
            (err, res) => {
                if (err) reject(err);
                else resolve(res.rowCount > 0);
            }
        );
    });
};

module.exports = {
    pool,
    createUser,
    verifyUser,
    getUserCredits,
    consumeCredit
};
