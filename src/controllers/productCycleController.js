const productCycleService = require('../services/productCycleService');

const runCycleUpdate = async (req, res) => {
    try {
        const result = await productCycleService.processProductCycles();
        
        return res.status(200).json({
            message: 'Ciclo de produtos processado com sucesso',
            data: result
        });

    } catch (error) {
        console.error('Erro no controller de ciclos:', error);
        return res.status(500).json({ 
            error: 'Falha ao processar ciclos de produtos',
            details: error.message 
        });
    }
};

// Endpoint para verificar fase de um produto específico
const checkProductPhase = async (req, res) => {
    try {
        const { dataReferencia } = req.query;
        
        if (!dataReferencia) {
            return res.status(400).json({ error: 'data_referencia é obrigatória' });
        }

        const settings = await productCycleService.getThemeSettings();
        const phase = productCycleService.determineProductPhase(dataReferencia, settings);

        return res.status(200).json({
            dataReferencia,
            currentPhase: phase,
            settings
        });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

module.exports = { 
    runCycleUpdate,
    checkProductPhase
};