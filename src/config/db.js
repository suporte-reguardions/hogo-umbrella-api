require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Força o SSL ignorando certificados não autorizados (Padrão para Render)
    ssl: { rejectUnauthorized: false } 
});

pool.connect((err) => {
    if (err) {
        console.error('Erro de conexão com o banco', err.stack);
    } else {
        console.log('✅ Conectado ao banco de dados com sucesso!');
    }
});

// Exportamos assim para facilitar o uso nos services (db.query)
module.exports = {
    query: (text, params) => pool.query(text, params),
};