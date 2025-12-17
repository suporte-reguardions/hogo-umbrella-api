const crypto = require('crypto');

// Use a mesma chave que está no seu .env
const SECRET = process.env.API_KEY; 

const verifyHmac = (req, res, next) => {
    // 1. Pegar os cabeçalhos enviados pelo Front
    const customerId = req.headers['x-shopify-customer-id'];
    const timestamp = req.headers['x-shopify-timestamp'];
    const signatureRecebida = req.headers['x-shopify-signature'];

    // Se faltar algum dado, recusa na hora
    if (!customerId || !timestamp || !signatureRecebida) {
        return res.status(401).json({ error: 'Assinatura ou dados de autenticação ausentes.' });
    }

    // 2. Verificar Validade (Anti-Replay)
    // Se o timestamp for mais antigo que 5 minutos (300 segundos), bloqueia.
    const now = Math.floor(Date.now() / 1000);
    const timeDiff = now - parseInt(timestamp);

    if (timeDiff > 300 || timeDiff < -60) { // Aceita até 1min no futuro (relógios descalibrados)
        return res.status(403).json({ error: 'Requisição expirada. Recarregue a página.' });
    }

    // 3. Recriar a Assinatura (O Segredo)
    // A string DEVE ser montada exatamente igual ao frontend: "ID:TIMESTAMP"
    const data = `${customerId}:${timestamp}`;
    
    // Cria o hash usando sua chave secreta
    const assinaturaReal = crypto
        .createHmac('sha256', SECRET)
        .update(data)
        .digest('hex');

    // 4. Comparar (Timing Safe para evitar ataques de tempo)
    // Se assinaturaReal === assinaturaRecebida, passa.
    if (crypto.timingSafeEqual(Buffer.from(signatureRecebida), Buffer.from(assinaturaReal))) {
        // Opcional: Salvar o customerId na requisição para usar nos controllers
        req.authCustomerId = customerId;
        next();
    } else {
        return res.status(403).json({ error: 'Assinatura inválida. Acesso negado.' });
    }
};

module.exports = verifyHmac;