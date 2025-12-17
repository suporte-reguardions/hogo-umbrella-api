const express = require('express');
const router = express.Router();
const productCycleController = require('../controllers/productCycleController');
const verifyApiKey = require('../middlewares/verifyApiKey');

router.use(verifyApiKey); 

// Executar manualmente
router.post('/run-update', productCycleController.runCycleUpdate);

// Verificar fase de um produto
router.get('/check-phase', productCycleController.checkProductPhase);

module.exports = router;