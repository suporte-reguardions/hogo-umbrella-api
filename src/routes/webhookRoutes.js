const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../config/db');

// Middleware de verificação Shopify
const verifyShopifyWebhook = (req, res, next) => {
    const hmac = req.headers['x-shopify-hmac-sha256'];
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
    
    if (!hmac || !secret) {
        console.error('❌ [Webhook] Headers ou secret ausentes');
        return res.status(401).send('Unauthorized');
    }
    
    const hash = crypto
        .createHmac('sha256', secret)
        .update(req.rawBody, 'utf8')
        .digest('base64');
    
    if (hash === hmac) {
        console.log('✅ [Webhook] Verificação OK');
        next();
    } else {
        console.error('❌ [Webhook] Assinatura inválida');
        res.status(401).send('Unauthorized');
    }
};

// Rota que marca UM cupom ALEATÓRIO como usado
router.post('/order-paid', verifyShopifyWebhook, async (req, res) => {
    try {
        const order = req.body;
        const customerId = order.customer?.id?.toString();
        
        console.log('📦 Pedido Pago Recebido:', {
            orderId: order.id,
            orderNumber: order.order_number,
            customerId: customerId,
            email: order.email,
            total: order.total_price
        });

        if (!customerId) {
            console.warn('⚠️ Pedido sem customer_id (compra guest)');
            return res.status(200).send('OK - No customer');
        }

        // Busca 1 cupom ATIVO ALEATÓRIO do usuário
        const query = `
            SELECT * FROM invites 
            WHERE user_id = $1 
            AND is_used = false
            ORDER BY RANDOM()
            LIMIT 1
        `;
        
        const result = await db.query(query, [customerId]);

        if (result.rows.length === 0) {
            console.log('ℹ️ Nenhum cupom ativo encontrado para este usuário');
            return res.status(200).send('OK - No active invite');
        }

        const selectedInvite = result.rows[0];

        console.log(`🎲 Cupom sorteado: ${selectedInvite.code}`);

        // Marca como usado
        const updateQuery = `
            UPDATE invites 
            SET is_used = true, 
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `;

        const updated = await db.query(updateQuery, [selectedInvite.id]);

        console.log('✅ Cupom marcado como usado:', {
            code: selectedInvite.code,
            customerId: customerId,
            orderId: order.id
        });

        return res.status(200).json({
            success: true,
            message: 'Cupom processado com sucesso',
            data: {
                code: updated.rows[0].code,
                orderId: order.id,
                customerId: customerId
            }
        });

    } catch (error) {
        console.error('❌ [Webhook] Erro ao processar:', error);
        return res.status(500).send('Error');
    }
});

module.exports = router;