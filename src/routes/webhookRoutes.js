const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const db = require('../config/db');

const SHOPIFY_STORE = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

// Helper para fazer requisições à Shopify
const shopifyRequest = async (endpoint, method = 'GET') => {
    const url = `https://${SHOPIFY_STORE}/admin/api/2025-10/${endpoint}`;
    
    const config = {
        method,
        url,
        headers: {
            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
            'Content-Type': 'application/json'
        }
    };

    const response = await axios(config);
    return response.data;
};

// Verifica se algum produto do pedido está em preorder
const hasPreorderProduct = async (lineItems) => {
    for (const item of lineItems) {
        if (!item.product_id) continue;

        try {
            // Busca o produto completo
            const productData = await shopifyRequest(`products/${item.product_id}.json`);
            const product = productData.product;

            // 1. Verifica se tem a tag PRE-ORDER
            const tags = product.tags ? product.tags.split(',').map(t => t.trim()) : [];
            if (tags.includes('PRE-ORDER')) {
                console.log(`✅ Produto ${product.id} (${product.title}) tem tag PRE-ORDER`);
                return true;
            }

            // 2. Verifica o metafield sale_phase
            const metafields = await shopifyRequest(`products/${item.product_id}/metafields.json`);
            
            const phaseMeta = metafields.metafields.find(
                m => m.namespace === 'custom' && m.key === 'sale_phase'
            );

            if (phaseMeta && phaseMeta.value && phaseMeta.value.toLowerCase() === 'preorder') {
                console.log(`✅ Produto ${product.id} (${product.title}) tem sale_phase = preorder`);
                return true;
            }

        } catch (error) {
            console.error(`⚠️ Erro ao verificar produto ${item.product_id}:`, error.message);
            // Continua verificando outros produtos
        }
    }

    return false;
};

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

// Rota que marca UM cupom ALEATÓRIO como usado (APENAS se tiver produto em preorder)
router.post('/order-paid', verifyShopifyWebhook, async (req, res) => {
    try {
        const order = req.body;
        const customerId = order.customer?.id?.toString();
        
        console.log('📦 Pedido Pago Recebido:', {
            orderId: order.id,
            orderNumber: order.order_number,
            customerId: customerId,
            email: order.email,
            total: order.total_price,
            itemCount: order.line_items?.length || 0
        });

        if (!customerId) {
            console.warn('⚠️ Pedido sem customer_id (compra guest)');
            return res.status(200).send('OK - No customer');
        }

        // ✅ NOVA VALIDAÇÃO: Verifica se há produtos em preorder
        const hasPreorder = await hasPreorderProduct(order.line_items || []);

        if (!hasPreorder) {
            console.log('ℹ️ Nenhum produto em PRE-ORDER neste pedido. Cupom não será gasto.');
            return res.status(200).json({
                success: true,
                message: 'Pedido processado, mas sem produtos em preorder',
                couponUsed: false
            });
        }

        console.log('🎯 Pedido contém produto(s) em PRE-ORDER. Processando cupom...');

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
            message: 'Cupom processado com sucesso (produto em preorder)',
            couponUsed: true,
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