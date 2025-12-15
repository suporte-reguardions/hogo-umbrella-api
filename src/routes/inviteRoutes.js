const express = require('express');
const router = express.Router();
const inviteController = require('../controllers/inviteController');
const verifyApiKey = require('../middlewares/auth'); // Importa a segurança

// --- APLICA A SEGURANÇA EM TUDO ---
// O "porteiro" fica aqui. Ninguém passa dessa linha sem a chave.
router.use(verifyApiKey); 

// Admin
router.post('/generate', inviteController.generate);
router.post('/bulk-generate', inviteController.bulkGenerate);
router.get('/', inviteController.list); // Listagem Admin (filtros)

// Ações de Cupom
router.post('/claim/:code', inviteController.claim); // Salvar na carteira
router.post('/activate/:code', inviteController.activate); // Gastar/Queimar
router.post('/sync-guest', inviteController.syncHistory); // Login/Sync
router.patch('/mark-sent/:code', inviteController.markSent); // Marca como enviado

// Perfil do Usuário
router.get('/wallet/:userId', inviteController.userWallet);// Carteira de cupom ativo do usuário
router.get('/check-active/:userId', inviteController.checkActive); // Verifica cupom ativos true e false

module.exports = router;