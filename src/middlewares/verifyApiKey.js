// PARA CRON JOBS E TESTES INTERNOS
const verifyApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    const expectedKey = process.env.API_KEY;

    if (!apiKey) {
        return res.status(401).json({ error: 'API Key ausente' });
    }

    if (apiKey !== expectedKey) {
        return res.status(403).json({ error: 'API Key inválida' });
    }

    next();
};

module.exports = verifyApiKey;