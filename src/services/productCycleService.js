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
const updateProductStatus = async (productId, phase, tags) => {
    const statusMap = {
        'draft': 'draft',
        'preorder': 'active',
        'public': 'active',
        'archived': 'draft'
    };

    const updatedTags = tags.filter(t => !['PRE-ORDER', 'PUBLIC-SALE', 'ARCHIVED'].includes(t));
    
    if (phase === 'preorder') updatedTags.push('PRE-ORDER');
    if (phase === 'public') updatedTags.push('PUBLIC-SALE');
    if (phase === 'archived') updatedTags.push('ARCHIVED');

    const payload = {
        product: {
            id: productId,
            status: statusMap[phase],
            tags: updatedTags.join(', ')
        }
    };

    await shopifyRequest(`products/${productId}.json`, 'PUT', payload);

    console.log(`✅ Produto ${productId} atualizado para fase: ${phase}`);
};

// NOVA FUNÇÃO - Organiza produtos por mês
const organizeProductsByMonth = (products) => {
    const productsByMonth = {};

    products.forEach(product => {
        if (!product.dataReferencia) return;

        const [year, month] = product.dataReferencia.split('-');
        const monthKey = `${year}-${month}`;

        if (!productsByMonth[monthKey]) {
            productsByMonth[monthKey] = product;
        }
    });

    const sortedMonths = Object.keys(productsByMonth).sort();

    return {
        productsByMonth,
        sortedMonths
    };
};

// NOVA FUNÇÃO - Determina os 3 slots
const determineProductSlots = (products, currentDate) => {
    const day = currentDate.getDate();
    const currentYear = currentDate.getFullYear();
    const currentMonth = (currentDate.getMonth() + 1).toString().padStart(2, '0');
    const currentMonthKey = `${currentYear}-${currentMonth}`;

    const { productsByMonth, sortedMonths } = organizeProductsByMonth(products);

    console.log(`📅 Mês atual: ${currentMonthKey}`);
    console.log(`📦 Meses disponíveis:`, sortedMonths);

    let startIndex = sortedMonths.indexOf(currentMonthKey);

    // Se não encontrou o mês atual, busca o próximo disponível
    if (startIndex === -1) {
        console.warn(`⚠️ Mês ${currentMonthKey} não encontrado. Buscando próximo disponível...`);
        
        startIndex = sortedMonths.findIndex(monthKey => monthKey > currentMonthKey);
        
        if (startIndex === -1) {
            console.warn(`⚠️ Nenhum mês futuro encontrado. Usando primeiro disponível.`);
            startIndex = 0;
        }
    }

    // Dia 8+ avança 1 posição
    if (day >= 8) {
        startIndex += 1;
    }

    // Busca circular: se passar do final, volta pro início
    const getSlot = (index) => {
        if (index >= sortedMonths.length) {
            const wrappedIndex = index % sortedMonths.length;
            console.log(`🔄 Slot ${index} passou do limite. Usando índice circular: ${wrappedIndex}`);
            return productsByMonth[sortedMonths[wrappedIndex]] || null;
        }
        return productsByMonth[sortedMonths[index]] || null;
    };

    const slot1 = getSlot(startIndex);
    const slot2 = getSlot(startIndex + 1);
    const slot3 = getSlot(startIndex + 2);

    console.log(`🎯 Slots determinados:`);
    console.log(`   Índice inicial: ${startIndex}`);
    console.log(`   Slot 1 (índice ${startIndex}): ${slot1?.title || 'Nenhum'} - ${slot1?.dataReferencia || 'N/A'}`);
    console.log(`   Slot 2 (índice ${startIndex + 1}): ${slot2?.title || 'Nenhum'} - ${slot2?.dataReferencia || 'N/A'}`);
    console.log(`   Slot 3 (índice ${startIndex + 2}): ${slot3?.title || 'Nenhum'} - ${slot3?.dataReferencia || 'N/A'}`);

    return { slot1, slot2, slot3 };
};

// NOVA FUNÇÃO - Atualiza os 3 metafields da loja
const updateProductSlots = async (slot1, slot2, slot3) => {
    try {
        console.log('🔄 Atualizando metafields da loja...');

        const metafields = await shopifyRequest('metafields.json?metafield[owner_resource]=shop');
        
        const slots = [
            { key: 'current_month_product', product: slot1, label: 'Mês Atual' },
            { key: 'next_month_product', product: slot2, label: 'Próximo Mês' },
            { key: 'following_month_product', product: slot3, label: 'Mês Seguinte' }
        ];

        for (const slot of slots) {
            if (!slot.product) {
                console.log(`⚠️ ${slot.label}: Nenhum produto disponível`);
                continue;
            }

            const existingMeta = metafields.metafields.find(
                m => m.namespace === 'custom' && m.key === slot.key
            );

            const gid = `gid://shopify/Product/${slot.product.id}`;

            if (existingMeta) {
                // Atualiza apenas se mudou
                if (existingMeta.value !== gid) {
                    await shopifyRequest(
                        `metafields/${existingMeta.id}.json`,
                        'PUT',
                        {
                            metafield: {
                                value: gid,
                                type: 'product_reference'
                            }
                        }
                    );
                    console.log(`✅ ${slot.label} atualizado: ${slot.product.title}`);
                } else {
                    console.log(`ℹ️ ${slot.label} já está correto: ${slot.product.title}`);
                }
            } else {
                // Cria metafield
                await shopifyRequest(
                    'metafields.json',
                    'POST',
                    {
                        metafield: {
                            namespace: 'custom',
                            key: slot.key,
                            value: gid,
                            type: 'product_reference',
                            owner_resource: 'shop'
                        }
                    }
                );
                console.log(`✅ ${slot.label} criado: ${slot.product.title}`);
            }
        }

    } catch (error) {
        console.error('❌ Erro ao atualizar slots de produtos:', error.message);
        if (error.response) {
            console.error('Detalhes:', error.response.data);
        }
    }
};

// NOVA FUNÇÃO - Alerta de produtos faltando
const checkUpcomingProducts = (sortedMonths, currentDate) => {
    const threeMonthsAhead = new Date(currentDate);
    threeMonthsAhead.setMonth(threeMonthsAhead.getMonth() + 3);
    
    const targetMonth = `${threeMonthsAhead.getFullYear()}-${(threeMonthsAhead.getMonth() + 1).toString().padStart(2, '0')}`;
    
    if (!sortedMonths.includes(targetMonth)) {
        console.warn(`⚠️ ALERTA: Cadastre o produto de ${targetMonth} em breve!`);
    }
};

// MODIFICADA - Função principal
const processProductCycles = async () => {
    try {
        console.log('🔄 Iniciando processamento de ciclos de produtos...');

        const settings = await getThemeSettings();
        console.log('⚙️ Configurações:', settings);

        const now = getTestDate();

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
        const productsWithDate = []; // Lista de produtos com data_referencia

        for (const product of allProducts) {
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

            // Adiciona à lista com data_referencia
            productsWithDate.push({
                ...product,
                dataReferencia,
                currentPhase
            });

            const phaseMeta = metafields.metafields.find(
                m => m.namespace === 'custom' && m.key === 'sale_phase'
            );

            const storedPhase = phaseMeta?.value?.trim() || null;

            if (process.env.TEST_MODE === 'true') {
                console.log(`🔍 Produto ${product.id}: storedPhase="${storedPhase}" → currentPhase="${currentPhase}"`);
            }

            if (currentPhase !== storedPhase) {
                console.log(`🔄 Produto ${product.id} (${product.title}): "${storedPhase}" → "${currentPhase}"`);

                await updateProductStatus(product.id, currentPhase, product.tags.split(', ').filter(t => t));

                const metaPayload = {
                    metafield: {
                        namespace: 'custom',
                        key: 'sale_phase',
                        value: currentPhase,
                        type: 'single_line_text_field'
                    }
                };

                if (phaseMeta && phaseMeta.id) {
                    await shopifyRequest(
                        `products/${product.id}/metafields/${phaseMeta.id}.json`, 
                        'PUT', 
                        metaPayload
                    );
                    console.log(`✏️ Metafield sale_phase atualizado: "${currentPhase}"`);
                } else {
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

        // Determina e atualiza os 3 slots
        const { slot1, slot2, slot3 } = determineProductSlots(productsWithDate, now);
        
        // Alerta de produtos faltando
        const { sortedMonths } = organizeProductsByMonth(productsWithDate);
        checkUpcomingProducts(sortedMonths, now);
        
        // Atualiza metafields da loja
        await updateProductSlots(slot1, slot2, slot3);

        console.log(`✅ Processamento concluído. ${updatedCount} produtos atualizados.`);
        console.log(`📅 Slots atuais:`);
        console.log(`   Slot 1 (Mês Atual): ${slot1?.title || 'Nenhum'}`);
        console.log(`   Slot 2 (Próximo): ${slot2?.title || 'Nenhum'}`);
        console.log(`   Slot 3 (Seguinte): ${slot3?.title || 'Nenhum'}`);

        return {
            success: true,
            processed: allProducts.length,
            updated: updatedCount,
            slots: {
                current: slot1?.title || 'Nenhum',
                next: slot2?.title || 'Nenhum',
                following: slot3?.title || 'Nenhum'
            }
        };

    } catch (error) {
        console.error('❌ Erro ao processar ciclos:', error.message);
        throw error;
    }
};

module.exports = { 
    processProductCycles,
    determineProductPhase,
    getThemeSettings,
    updateProductSlots,
    determineProductSlots,
    organizeProductsByMonth
};