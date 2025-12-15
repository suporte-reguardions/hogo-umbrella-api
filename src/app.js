const express = require('express');
const cors = require('cors');
const inviteRoutes = require('./routes/inviteRoutes');

const app = express();

// CONFIGURAÇÃO DE SEGURANÇA (CORS)
const corsOptions = {
    origin: [
        'http://localhost:3000',      // Testes locais
        'https://subpericardiac-bea-interrelatedly.ngrok-free.dev', // Ngrok
        'https://hogo-umbrella.myshopify.com', // SUA LOJA SHOPIFY
        'https://hogo-umbrella-api.onrender.com', // Sua API hospedada
        'https://admin.shopify.com' // Admin da Shopify (caso precise)
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'x-api-key', 'x-shopify-customer-id', 'x-shopify-timestamp', 'x-shopify-signature'],
    credentials: true, // Permite envio de cookies/credenciais
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());

// Rotas
app.use('/api/invites', inviteRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});