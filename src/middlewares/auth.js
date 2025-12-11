const verifyApiKey = (req, res, next) => {
    // Busca a senha no cabeçalho da requisição
    const clientKey = req.headers['x-api-key'];
    const serverKey = process.env.API_KEY;

    // Segurança: Se o servidor não tiver senha configurada, bloqueia tudo
    if (!serverKey) {
        console.error("ERRO: API_KEY não configurada no .env");
        return res.status(500).json({ error: 'Erro de configuração interna.' });
    }

    // Validação: Se não mandou a chave ou a chave está errada
    if (!clientKey || clientKey !== serverKey) {
        return res.status(403).json({ 
            error: 'Acesso Negado. Chave de API inválida ou ausente.' 
        });
    }

    // Se a senha bate, pode passar
    next();
};

module.exports = verifyApiKey;