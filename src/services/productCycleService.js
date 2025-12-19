const axios = require('axios');

const SHOPIFY_STORE = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

// ✅ ADICIONE ESTAS LINHAS PARA DEBUG
console.log('🔍 DEBUG - Variáveis de Ambiente:');
console.log('SHOPIFY_STORE:', SHOPIFY_STORE || '❌ UNDEFINED');
console.log('SHOPIFY_ACCESS_TOKEN:', SHOPIFY_ACCESS_TOKEN ? '✅ Configurado' : '❌ UNDEFINED');

if (!SHOPIFY_STORE || !SHOPIFY_ACCESS_TOKEN) {
    throw new Error('⚠️ Variáveis SHOPIFY_STORE_URL e SHOPIFY_ACCESS_TOKEN são obrigatórias');
}

const getTestDate = () => {
    let date;
    
    if (process.env.TEST_MODE === 'true' && process.env.TEST_DATE) {
        console.log(`🧪 [TESTE] Usando data simulada: ${process.env.TEST_DATE}`);
        // Parse correto forçando timezone local
        const [year, month, day] = process.env.TEST_DATE.split('-').map(Number);
        date = new Date(year, month - 1, day);
    } else {
        date = new Date();
    }
    
    // Converte para timezone de Frankfurt (Europe/Berlin)
    const frankfurtTime = new Date(date.toLocaleString('en-US', { 
        timeZone: 'Europe/Berlin' 
    }));
    
    return frankfurtTime;
};

// Helper para fazer requisições à Shopify
const shopifyRequest = async (endpoint, method = 'GET', data = null) => {
    const url = `https://${SHOPIFY_STORE}/admin/api/2024-01/${endpoint}`;
    
    const config = {
        method,
        url,
        headers: {
            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
            'Content-Type': 'application/json'
        }
    };

    if (data) config.data = data;

    const response = await axios(config);
    return response.data;
};

// Busca configurações do tema
const getThemeSettings = async () => {
    // Valores padrão se não houver tema configurado
    return {
        public_start_day: parseInt(process.env.PUBLIC_START_DAY) || 1,
        public_end_day: parseInt(process.env.PUBLIC_END_DAY) || 7,
        preorder_start_day: parseInt(process.env.PREORDER_START_DAY) || 8
    };
};

const determineProductPhase = (dataReferencia, settings) => {
    // Usa data de Frankfurt (Europe/Berlin)
    const now = getTestDate();
    
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-11
    const currentDay = now.getDate();

    // 🔧 FIX: Parse correto da data (yyyy-mm-dd)
    const [refYear, refMonth, refDay] = dataReferencia.split('-').map(Number);
    const refDate = new Date(refYear, refMonth - 1, refDay); // Força timezone local
    
    const productYear = refDate.getFullYear();
    const productMonth = refDate.getMonth(); // 0-11

    // Calcula diferença em meses
    const monthDiff = (productYear - currentYear) * 12 + (productMonth - currentMonth);

    // Logs apenas em modo de teste
    if (process.env.TEST_MODE === 'true') {
        console.log(`📅 Data atual (Frankfurt): ${now.toISOString().split('T')[0]}, Dia: ${currentDay}`);
        console.log(`🎯 Produto: ${dataReferencia}, Ano/Mês: ${productYear}/${productMonth + 1}`);
        console.log(`📊 Diferença de meses: ${monthDiff}`);
    }

    // PRODUTO DE 2+ MESES NO FUTURO = DRAFT
    if (monthDiff > 1) {
        if (process.env.TEST_MODE === 'true') {
            console.log(`➡️ DRAFT (${monthDiff} meses no futuro)`);
        }
        return 'draft';
    }

    // PRODUTO DO PRÓXIMO MÊS = PRÉ-VENDA (a partir do dia configurado)
    if (monthDiff === 1) {
        if (currentDay >= settings.preorder_start_day) {
            if (process.env.TEST_MODE === 'true') {
                console.log(`➡️ PREORDER (próximo mês, dia ${currentDay} >= ${settings.preorder_start_day})`);
            }
            return 'preorder';
        }
        if (process.env.TEST_MODE === 'true') {
            console.log(`➡️ DRAFT (próximo mês, mas antes do dia ${settings.preorder_start_day})`);
        }
        return 'draft';
    }

    // PRODUTO DO MÊS ATUAL
    if (monthDiff === 0) {
        // Venda Pública (dias 1-7 ou configurado)
        if (currentDay >= settings.public_start_day && currentDay <= settings.public_end_day) {
            if (process.env.TEST_MODE === 'true') {
                console.log(`➡️ PUBLIC (mês atual, dias ${settings.public_start_day}-${settings.public_end_day})`);
            }
            return 'public';
        }
        // Depois da venda pública = ARCHIVED
        if (currentDay > settings.public_end_day) {
            if (process.env.TEST_MODE === 'true') {
                console.log(`➡️ ARCHIVED (mês atual, após dia ${settings.public_end_day})`);
            }
            return 'archived';
        }
        // Antes do dia 1 (caso improvável) = draft
        return 'draft';
    }

    // PRODUTO DE MESES PASSADOS = ARCHIVED
    if (monthDiff < 0) {
        if (process.env.TEST_MODE === 'true') {
            console.log(`➡️ ARCHIVED (${Math.abs(monthDiff)} meses no passado)`);
        }
        return 'archived';
    }

    return 'draft';
};

// Atualiza status do produto na Shopify
// const updateProductStatus = async (productId, phase, tags) => {
//     const statusMap = {
//         'draft': 'draft',
//         'preorder': 'active',
//         'public': 'active',
//         'archived': 'draft'
//     };

//     const updatedTags = tags.filter(t => !['PRE-ORDER', 'PUBLIC-SALE', 'ARCHIVED'].includes(t));
    
//     if (phase === 'preorder') updatedTags.push('PRE-ORDER');
//     if (phase === 'public') updatedTags.push('PUBLIC-SALE');
//     if (phase === 'archived') updatedTags.push('ARCHIVED');

//     const payload = {
//         product: {
//             id: productId,
//             status: statusMap[phase],
//             tags: updatedTags.join(', ')
//         }
//     };

//     await shopifyRequest(`products/${productId}.json`, 'PUT', payload);

//     console.log(`✅ Produto ${productId} atualizado para fase: ${phase}`);
// };

const updateProductStatus = async (productId, phase, tags) => {
    // TODOS ficam ACTIVE (nunca draft)
    const updatedTags = tags.filter(t => !['PRE-ORDER', 'PUBLIC-SALE', 'ARCHIVED'].includes(t));
    
    if (phase === 'preorder') updatedTags.push('PRE-ORDER');
    if (phase === 'public') updatedTags.push('PUBLIC-SALE');
    if (phase === 'archived') updatedTags.push('ARCHIVED');

    const payload = {
        product: {
            id: productId,
            status: 'active', // ✅ SEMPRE ATIVO
            tags: updatedTags.join(', ')
        }
    };

    // Para produtos DRAFT (futuro) e ARCHIVED (passado): torna não listado
    if (phase === 'draft' || phase === 'archived') {
        payload.product.published_at = null; // Remove da vitrine
        payload.product.published_scope = 'web';
    } else {
        // Para PRE-ORDER e PUBLIC: garante que está listado
        payload.product.published_scope = 'web';
        if (!payload.product.published_at) {
            payload.product.published_at = new Date().toISOString();
        }
    }

    await shopifyRequest(`products/${productId}.json`, 'PUT', payload);

    // 🔧 Zera estoque APENAS para ARCHIVED (produtos que já passaram)
    if (phase === 'archived') {
        await zeroProductInventory(productId);
    }

    console.log(`✅ Produto ${productId} → ${phase} | Listado: ${phase === 'preorder' || phase === 'public'} | Estoque zerado: ${phase === 'archived'}`);
};

// Função para zerar estoque
const zeroProductInventory = async (productId) => {
    try {
        const productData = await shopifyRequest(`products/${productId}.json`);
        const variants = productData.product.variants;

        const locationsData = await shopifyRequest('locations.json');
        const location = locationsData.locations[0];

        if (!location) {
            console.warn(`⚠️ Nenhum location encontrado`);
            return;
        }

        for (const variant of variants) {
            const inventoryItemId = variant.inventory_item_id;
            if (!inventoryItemId) continue;

            await shopifyRequest('inventory_levels/set.json', 'POST', {
                location_id: location.id,
                inventory_item_id: inventoryItemId,
                available: 0
            });

            console.log(`📦 Estoque zerado: Variante ${variant.id}`);
        }

    } catch (error) {
        console.error(`❌ Erro ao zerar estoque ${productId}:`, error.message);
    }
};

// FUNÇÃO PRINCIPAL - Processa todos os produtos
const processProductCycles = async () => {
    try {
        console.log('🔄 Iniciando processamento de ciclos de produtos...');

        const settings = await getThemeSettings();
        console.log('⚙️ Configurações:', settings);

        // Busca todos os produtos
        let allProducts = [];
        let hasNextPage = true;
        let pageInfo = null;

        while (hasNextPage) {
            const endpoint = pageInfo 
                ? `products.json?limit=250&page_info=${pageInfo}`
                : 'products.json?limit=250';

            const data = await shopifyRequest(endpoint);
            allProducts = allProducts.concat(data.products);

            hasNextPage = false;
        }

        console.log(`📦 Total de produtos encontrados: ${allProducts.length}`);

        let updatedCount = 0;

        for (const product of allProducts) {
            // Busca metafield data_referencia
            const metafields = await shopifyRequest(`products/${product.id}/metafields.json`);
            
            const dataRefMeta = metafields.metafields.find(
                m => m.namespace === 'custom' && m.key === 'data_referencia'
            );

            if (!dataRefMeta || !dataRefMeta.value) {
                console.log(`⚠️ Produto ${product.id} sem data_referencia, pulando...`);
                continue;
            }

            const dataReferencia = dataRefMeta.value;
            const currentPhase = determineProductPhase(dataReferencia, settings);

            // Busca metafield de fase atual
            const phaseMeta = metafields.metafields.find(
                m => m.namespace === 'custom' && m.key === 'sale_phase'
            );

            // 🔧 FIX: Trata valores vazios, null e undefined
            const storedPhase = phaseMeta?.value?.trim() || null;

            // Log para debug
            if (process.env.TEST_MODE === 'true') {
                console.log(`🔍 Produto ${product.id}: storedPhase="${storedPhase}" → currentPhase="${currentPhase}"`);
            }

            // Atualiza se mudou OU se estiver vazio/null
            if (currentPhase !== storedPhase) {
                console.log(`🔄 Produto ${product.id} (${product.title}): "${storedPhase}" → "${currentPhase}"`);

                // Atualiza status na Shopify
                await updateProductStatus(product.id, currentPhase, product.tags.split(', ').filter(t => t));

                // Atualiza ou cria metafield de fase
                const metaPayload = {
                    metafield: {
                        namespace: 'custom',
                        key: 'sale_phase',
                        value: currentPhase,
                        type: 'single_line_text_field'
                    }
                };

                if (phaseMeta && phaseMeta.id) {
                    // Atualiza metafield existente
                    await shopifyRequest(
                        `products/${product.id}/metafields/${phaseMeta.id}.json`, 
                        'PUT', 
                        metaPayload
                    );
                    console.log(`✏️ Metafield sale_phase atualizado: "${currentPhase}"`);
                } else {
                    // Cria metafield se não existir
                    await shopifyRequest(
                        `products/${product.id}/metafields.json`, 
                        'POST', 
                        metaPayload
                    );
                    console.log(`✨ Metafield sale_phase criado: "${currentPhase}"`);
                }

                updatedCount++;
            } else {
                if (process.env.TEST_MODE === 'true') {
                    console.log(`⏭️ Produto ${product.id} já está na fase correta: "${currentPhase}"`);
                }
            }
        }

        console.log(`✅ Processamento concluído. ${updatedCount} produtos atualizados.`);

        return {
            success: true,
            processed: allProducts.length,
            updated: updatedCount
        };

    } catch (error) {
        console.error('❌ Erro ao processar ciclos:', error.message);
        throw error;
    }
};

module.exports = { 
    processProductCycles,
    determineProductPhase,
    getThemeSettings
};