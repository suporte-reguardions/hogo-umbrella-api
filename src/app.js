const express = require('express');
const cors = require('cors');
const inviteRoutes = require('./routes/inviteRoutes');

const app = express();

// CONFIGURAÇÃO DE SEGURANÇA (CORS)
const corsOptions = {
    origin: [
        'http://localhost:3000',      // Permite seus testes locais
        'https://subpericardiac-bea-interrelatedly.ngrok-free.dev'
        // 'https://sua-loja-shopify.com' // <-- Quando subir pro ar, descomente e coloque o site da sua loja aqui
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    // IMPORTANTE: Permitir que o 'x-api-key' seja enviado
    allowedHeaders: ['Content-Type', 'x-api-key'], 
    optionsSuccessStatus: 200
};

app.use(cors());
app.use(express.json());

// Rotas
app.use('/api/invites', inviteRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});