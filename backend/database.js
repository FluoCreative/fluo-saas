const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Required for Supabase/Render
});

// Impede que quedas de conexão no banco travem o servidor (Render 502)
pool.on('error', (err, client) => {
    console.error('Erro inesperado na conexão com o banco de dados:', err);
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
        );
        CREATE TABLE IF NOT EXISTS leads (
            id SERIAL PRIMARY KEY,
            instagram VARCHAR(255) NOT NULL,
            phone VARCHAR(255) NOT NULL,
            niche VARCHAR(255) NOT NULL,
            html_report TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `, (err) => {
        release();
        if (err) {
            console.error('Erro ao criar tabelas:', err.stack);
        } else {
            console.log('Tabelas users e leads garantidas no PostgreSQL.');
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
            if (err) {
                return reject(err);
            }
            if (res.rows.length === 0) return resolve(false);
            
            const row = res.rows[0];
            const match = await bcrypt.compare(password, row.password_hash);
            resolve(match ? row : false);
        });
    });
};

const getUserCredits = async (userId) => {
    return new Promise((resolve, reject) => {
        pool.query('SELECT credits FROM users WHERE id = $1', [userId], (err, res) => {
            if (err) {
                return reject(err);
            }
            resolve(res.rows.length > 0 ? res.rows[0].credits : 0);
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

const createLead = async (instagram, phone, niche, htmlReport) => {
    return new Promise((resolve, reject) => {
        pool.query(
            'INSERT INTO leads (instagram, phone, niche, html_report) VALUES ($1, $2, $3, $4) RETURNING id',
            [instagram, phone, niche, htmlReport],
            (err, res) => {
                if (err) reject(err);
                else resolve(res.rows[0].id);
            }
        );
    });
};

const getLeads = async () => {
    return new Promise((resolve, reject) => {
        pool.query('SELECT id, instagram, phone, niche, created_at FROM leads ORDER BY created_at DESC', (err, res) => {
            if (err) reject(err);
            else resolve(res.rows);
        });
    });
};

const getLeadHtml = async (id) => {
    return new Promise((resolve, reject) => {
        pool.query('SELECT html_report FROM leads WHERE id = $1', [id], (err, res) => {
            if (err) reject(err);
            else resolve(res.rows.length > 0 ? res.rows[0].html_report : null);
        });
    });
};

module.exports = {
    pool,
    createUser,
    verifyUser,
    getUserCredits,
    consumeCredit,
    createLead,
    getLeads,
    getLeadHtml
};
