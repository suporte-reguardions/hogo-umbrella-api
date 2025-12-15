const inviteService = require('../services/inviteService');

const generate = async (req, res) => {
    try {
        const { type, provider, providerIdentity } = req.body;

        // Validação básica de entrada
        if (!type) {
            return res.status(400).json({ error: 'Type e Provider são obrigatórios.' });
        }

        const invite = await inviteService.createInvite({ type, provider, providerIdentity });
        
        return res.status(201).json({
            message: 'Código gerado com sucesso.',
            data: invite
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Erro ao gerar código.' });
    }
};

const activate = async (req, res) => {
    try {
        const { code } = req.params; // Código vem na URL ou Body, aqui coloquei URL
        const { email, userId } = req.body; // Dados do usuário no corpo

        // O Service valida se existe ou se já foi usado
        const activeInvite = await inviteService.activateInvite(code, { email, userId });

        return res.status(200).json({
            message: 'Cupom ativado com sucesso!',
            data: activeInvite
        });

    } catch (error) {
        // Retorna 400 para erros de negócio (já usado, não existe)
        return res.status(400).json({ error: error.message });
    }
};

const bulkGenerate = async (req, res) => {
    try {
        const { amount, type, provider, providerIdentity } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Informe uma quantidade válida (amount).' });
        }
        if (!type) {
            return res.status(400).json({ error: 'Type e Provider são obrigatórios.' });
        }

        // Limite de segurança (opcional, pra ninguém pedir 1 milhão e travar o banco)
        if (amount > 1000) {
            return res.status(400).json({ error: 'O limite máximo por requisição é 1000 códigos.' });
        }

        const codes = await inviteService.createBatch(amount, { type, provider, providerIdentity });

        return res.status(201).json({
            message: `${codes.length} códigos gerados com sucesso.`,
            count: codes.length,
            data: codes // Retorna a lista dos códigos criados
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Erro ao gerar lote de códigos.' });
    }
};

// Apenas SALVAR (não usar)
const claim = async (req, res) => {
    try {
        const { code } = req.params;
        const { email, userId } = req.body; // userId opcional (guest)

        if (!email) return res.status(400).json({ error: 'Email obrigatório.' });

        const invite = await inviteService.claimInvite(code, { email, userId });
        
        return res.status(200).json({
            message: 'Cupom salvo na carteira com sucesso!',
            data: invite
        });
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
};

// Buscar Carteira do Usuário
const userWallet = async (req, res) => {
    try {
        const { userId } = req.params;
        const { type, page, limit } = req.query; 
        // type pode ser 'active' (padrão) ou 'history'

        const result = await inviteService.getUserWallet(userId, type, page || 1, limit || 10);
        return res.status(200).json(result);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Erro ao buscar carteira.' });
    }
};

// Verificar se tem cupons ativos (leve)
const checkActive = async (req, res) => {
    try {
        const { userId } = req.params;

        const result = await inviteService.hasActiveInvites(userId);
        
        return res.status(200).json(result);
        // Retorna: { hasInvites: true, count: 2 }
        
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Erro ao verificar cupons.' });
    }
};


// ATENÇÃO: Atualize a função 'list' existente para passar todos os filtros do req.query
const list = async (req, res) => {
    try {
        // Pega TUDO que vier na query string
        const filters = req.query; 
        const page = filters.page || 1;
        const limit = filters.limit || 10;

        const result = await inviteService.listInvites(filters, page, limit);
        return res.status(200).json(result);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

const syncHistory = async (req, res) => {
    try {
        const { email, userId } = req.body;

        if (!email || !userId) {
            return res.status(400).json({ error: 'Email e UserId são obrigatórios.' });
        }

        const updatedRecords = await inviteService.syncGuestHistory(email, userId);

        return res.status(200).json({
            message: 'Histórico sincronizado com sucesso.',
            recovered_invites: updatedRecords.length, // Quantos convites antigos foram achados
            data: updatedRecords
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Erro ao sincronizar histórico.' });
    }
};

const history = async (req, res) => {
    const { userId } = req.params;
    const data = await inviteService.getUserHistory(userId);
    res.json(data);
};

// Função que marca um convite como enviado
const markSent = async (req, res) => {
    try {
        const { code } = req.params;

        const invite = await inviteService.markAsSent(code);
        
        return res.status(200).json({
            message: 'Código marcado como enviado com sucesso.',
            data: invite
        });

    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
};

// Atualize o exports
module.exports = { 
    generate, 
    activate, 
    bulkGenerate, 
    claim, 
    userWallet, 
    list, 
    syncHistory, 
    history,
    markSent,
    checkActive
};