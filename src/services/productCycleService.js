const axios = require('axios');

const SHOPIFY_STORE = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

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
        const [year, month, day] = process.env.TEST_DATE.split('-').map(Number);
        date = new Date(year, month - 1, day);
    } else {
        date = new Date();
    }
    
    const frankfurtTime = new Date(date.toLocaleString('en-US', { 
        timeZone: 'Europe/Berlin' 
    }));
    
    return frankfurtTime;
};

const shopifyRequest = async (endpoint, method = 'GET', data = null) => {
    const url = `https://${SHOPIFY_STORE}/admin/api/2025-10/${endpoint}`;
    
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

// Busca produtos com GraphQL (suporta 2 anos em dezembro)
const fetchCurrentYearProducts = async () => {
    const now = getTestDate();
    const currentYear = now.getFullYear();
    const currentDay = now.getDate();
    const currentMonth = now.getMonth(); // 0-11

    // Em dezembro após dia 8, busca ano atual + próximo ano
    const isDecemberPreorder = currentMonth === 11 && currentDay >= 8;
    
    let query;

    if (isDecemberPreorder) {
        const nextYear = currentYear + 1;
        console.log(`📅 Dezembro + Preorder detectado! Buscando anos ${currentYear} E ${nextYear}`);
        
        query = `
        {
          products(first: 250, query: "tag:'year:${currentYear}' OR tag:'year:${nextYear}'") {
            edges {
              node {
                id
                legacyResourceId
                title
                status
                tags
                metafields(first: 10, namespace: "custom") {
                  edges {
                    node {
                      id
                      namespace
                      key
                      value
                      type
                    }
                  }
                }
              }
            }
          }
        }
        `;
    } else {
        const yearTag = `year:${currentYear}`;
        
        query = `
        {
          products(first: 250, query: "tag:'${yearTag}'") {
            edges {
              node {
                id
                legacyResourceId
                title
                status
                tags
                metafields(first: 10, namespace: "custom") {
                  edges {
                    node {
                      id
                      namespace
                      key
                      value
                      type
                    }
                  }
                }
              }
            }
          }
        }
        `;
    }

    const url = `https://${SHOPIFY_STORE}/admin/api/2025-10/graphql.json`;
    
    try {
        const response = await axios.post(url, { query }, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                'Content-Type': 'application/json'
            }
        });

        if (response.data.errors) {
            console.error('❌ GraphQL Errors:', response.data.errors);
            throw new Error(`GraphQL Error: ${JSON.stringify(response.data.errors)}`);
        }

        const products = response.data.data.products.edges.map(edge => {
            const product = edge.node;
            
            return {
                id: product.legacyResourceId,
                title: product.title,
                status: product.status,
                tags: product.tags,
                metafields: product.metafields.edges.map(m => m.node)
            };
        });

        if (isDecemberPreorder) {
            console.log(`📦 Produtos de ${currentYear} e ${currentYear + 1} encontrados: ${products.length}`);
        } else {
            console.log(`📦 Produtos do ano ${currentYear} encontrados: ${products.length}`);
        }

        // FALLBACK: Se não encontrou nada, usa REST
        if (products.length === 0) {
            console.log(`⚠️ Nenhum produto com tags de ano encontrado.`);
            console.log(`🔄 Buscando TODOS os produtos via REST para adicionar tags...`);
            return await fetchAllProductsWithMetafields();
        }

        return products;

    } catch (error) {
        console.error('❌ Erro ao buscar produtos via GraphQL:', error.message);
        throw error;
    }
};

// FALLBACK: Busca todos os produtos via REST
const fetchAllProductsWithMetafields = async () => {
    const allProducts = await shopifyRequest('products.json?limit=250');
    
    console.log(`📦 Total de produtos via REST: ${allProducts.products.length}`);

    const productsWithMetafields = [];

    for (const product of allProducts.products) {
        console.log(`🔍 Buscando metafields do produto ${product.id}...`);
        
        const metafields = await shopifyRequest(`products/${product.id}/metafields.json`);
        
        productsWithMetafields.push({
            id: product.id,
            title: product.title,
            status: product.status,
            tags: product.tags || '',
            metafields: metafields.metafields
        });
    }

    return productsWithMetafields;
};

// FUNÇÃO: Garante que o produto tem a tag do ano
const ensureYearTag = async (productId, currentTags, dataReferencia) => {
    try {
        // Parse manual para evitar problema de timezone
        const [year, month, day] = dataReferencia.split('-').map(Number);
        const yearTag = `year:${year}`; // Usa o ano direto da string!

        console.log(`🏷️ [DEBUG] Produto ${productId} - Verificando tag do ano...`);
        console.log(`🏷️ [DEBUG] Data referência: ${dataReferencia} → Ano: ${year}`);
        console.log(`🏷️ [DEBUG] Tags atuais:`, currentTags);
        console.log(`🏷️ [DEBUG] Tag a adicionar: "${yearTag}"`);

        const tagsArray = typeof currentTags === 'string' 
            ? currentTags.split(',').map(t => t.trim()).filter(t => t)
            : currentTags;

        console.log(`🏷️ [DEBUG] Tags em array:`, tagsArray);

        if (tagsArray.includes(yearTag)) {
            console.log(`✅ [DEBUG] Tag "${yearTag}" já existe. Nada a fazer.`);
            return tagsArray;
        }

        const newTags = [...tagsArray, yearTag];
        const newTagsString = newTags.join(', ');

        console.log(`➕ [DEBUG] Adicionando tag. Novas tags:`, newTagsString);

        await shopifyRequest(
            `products/${productId}.json`,
            'PUT',
            {
                product: {
                    id: productId,
                    tags: newTagsString
                }
            }
        );

        console.log(`✅ Tag "${yearTag}" adicionada ao produto ${productId}`);
        return newTags;

    } catch (error) {
        console.error(`❌ [DEBUG] Erro ao adicionar tag ao produto ${productId}:`, error.message);
        console.error(`❌ [DEBUG] Stack:`, error.stack);
        
        const tagsArray = typeof currentTags === 'string' 
            ? currentTags.split(',').map(t => t.trim()).filter(t => t)
            : currentTags;
        return tagsArray;
    }
};

const getThemeSettings = async () => {
    return {
        public_start_day: parseInt(process.env.PUBLIC_START_DAY) || 1,
        public_end_day: parseInt(process.env.PUBLIC_END_DAY) || 7,
        preorder_start_day: parseInt(process.env.PREORDER_START_DAY) || 8
    };
};

const determineProductPhase = (dataReferencia, settings) => {
    const now = getTestDate();
    
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const currentDay = now.getDate();

    const [refYear, refMonth, refDay] = dataReferencia.split('-').map(Number);
    const refDate = new Date(refYear, refMonth - 1, refDay);
    
    const productYear = refDate.getFullYear();
    const productMonth = refDate.getMonth();

    const monthDiff = (productYear - currentYear) * 12 + (productMonth - currentMonth);

    if (process.env.TEST_MODE === 'true') {
        console.log(`📅 Data atual (Frankfurt): ${now.toISOString().split('T')[0]}, Dia: ${currentDay}`);
        console.log(`🎯 Produto: ${dataReferencia}, Ano/Mês: ${productYear}/${productMonth + 1}`);
        console.log(`📊 Diferença de meses: ${monthDiff}`);
    }

    if (monthDiff > 1) {
        if (process.env.TEST_MODE === 'true') {
            console.log(`➡️ UPCOMING (${monthDiff} meses no futuro)`);
        }
        return 'upcoming';
    }

    if (monthDiff === 1) {
        if (currentDay >= settings.preorder_start_day) {
            if (process.env.TEST_MODE === 'true') {
                console.log(`➡️ PREORDER (próximo mês, dia ${currentDay} >= ${settings.preorder_start_day})`);
            }
            return 'preorder';
        }
        if (process.env.TEST_MODE === 'true') {
            console.log(`➡️ UPCOMING (próximo mês, mas antes do dia ${settings.preorder_start_day})`);
        }
        return 'upcoming';
    }

    if (monthDiff === 0) {
        if (currentDay >= settings.public_start_day && currentDay <= settings.public_end_day) {
            if (process.env.TEST_MODE === 'true') {
                console.log(`➡️ PUBLIC (mês atual, dias ${settings.public_start_day}-${settings.public_end_day})`);
            }
            return 'public';
        }
        if (currentDay > settings.public_end_day) {
            if (process.env.TEST_MODE === 'true') {
                console.log(`➡️ ARCHIVED (mês atual, após dia ${settings.public_end_day})`);
            }
            return 'archived';
        }
        return 'upcoming';
    }

    if (monthDiff < 0) {
        if (process.env.TEST_MODE === 'true') {
            console.log(`➡️ ARCHIVED (${Math.abs(monthDiff)} meses no passado)`);
        }
        return 'archived';
    }

    return 'upcoming';
};

const updateProductStatus = async (productId, phase, tags) => {
    const statusMap = {
        'upcoming': 'unlisted',
        'preorder': 'active',
        'public': 'active',
        'archived': 'unlisted'
    };

    const updatedTags = tags.filter(t => !['UPCOMING', 'PRE-ORDER', 'PUBLIC-SALE', 'ARCHIVED'].includes(t));
    
    if (phase === 'upcoming') updatedTags.push('UPCOMING');
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

const updateActiveProduct = async (settings) => {
    try {
        const now = getTestDate();
        const currentDay = now.getDate();

        let targetPhase;

        if (currentDay >= settings.public_start_day && currentDay <= settings.public_end_day) {
            targetPhase = 'public';
            console.log(`🎯 Buscando produto em PUBLIC SALE (dias ${settings.public_start_day}-${settings.public_end_day})`);
        } else if (currentDay >= settings.preorder_start_day) {
            targetPhase = 'preorder';
            console.log(`🎯 Buscando produto em PREORDER (a partir do dia ${settings.preorder_start_day})`);
        } else {
            console.log('⏸️ Fora do período de vendas (antes do dia 1). Nenhum produto será definido como ativo.');
            return { success: true, message: 'Nenhum produto ativo neste período' };
        }

        const allProducts = await shopifyRequest('products.json?limit=250');
        
        let activeProduct = null;

        for (const product of allProducts.products) {
            const metafields = await shopifyRequest(`products/${product.id}/metafields.json`);
            
            const phaseMeta = metafields.metafields.find(
                m => m.namespace === 'custom' && m.key === 'sale_phase'
            );

            if (phaseMeta && phaseMeta.value === targetPhase) {
                activeProduct = product;
                console.log(`✅ Produto encontrado: ${product.title} (ID: ${product.id}) - Fase: ${targetPhase}`);
                break;
            }
        }

        if (!activeProduct) {
            console.warn(`⚠️ Nenhum produto encontrado na fase "${targetPhase}"`);
            return { success: false, message: `Nenhum produto em ${targetPhase}` };
        }

        const shopMetafields = await shopifyRequest('metafields.json?namespace=custom&key=active_product');

        const activeProductMeta = shopMetafields.metafields.find(
            m => m.namespace === 'custom' && m.key === 'active_product'
        );

        const productGid = `gid://shopify/Product/${activeProduct.id}`;

        if (activeProductMeta) {
            if (activeProductMeta.value === productGid) {
                console.log('✅ Produto ativo já está correto. Nenhuma atualização necessária.');
                return { success: true, message: 'Já está atualizado', productId: activeProduct.id };
            }

            await shopifyRequest(
                `metafields/${activeProductMeta.id}.json`,
                'PUT',
                {
                    metafield: {
                        value: productGid,
                        type: 'product_reference'
                    }
                }
            );

            console.log(`✅ Metafield active_product atualizado para: ${activeProduct.title}`);

        } else {
            await shopifyRequest(
                'metafields.json',
                'POST',
                {
                    metafield: {
                        namespace: 'custom',
                        key: 'active_product',
                        value: productGid,
                        type: 'product_reference'
                    }
                }
            );

            console.log(`✨ Metafield active_product criado com: ${activeProduct.title}`);
        }

        return {
            success: true,
            activeProduct: {
                id: activeProduct.id,
                title: activeProduct.title,
                phase: targetPhase
            }
        };

    } catch (error) {
        console.error('❌ Erro ao atualizar produto ativo:', error.message);
        throw error;
    }
};

// FUNÇÃO PRINCIPAL OTIMIZADA
const processProductCycles = async () => {
    try {
        console.log('🔄 Iniciando processamento de ciclos de produtos...');

        const settings = await getThemeSettings();
        console.log('⚙️ Configurações:', settings);

        // Busca com GraphQL (suporta 2 anos em dezembro)
        const allProducts = await fetchCurrentYearProducts();
        console.log(`📦 Produtos para processamento: ${allProducts.length}`);

        // Filtra apenas produtos com data_referencia válida
        const now = getTestDate();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();
        const isDecember = currentMonth === 11;

        const validProducts = allProducts.filter(product => {
            const dataRefMeta = product.metafields.find(
                m => m.namespace === 'custom' && m.key === 'data_referencia'
            );

            if (!dataRefMeta || !dataRefMeta.value) {
                return false;
            }

            const productYear = new Date(dataRefMeta.value).getFullYear();
            
            // Em dezembro, aceita ano atual e próximo
            if (isDecember) {
                return productYear === currentYear || productYear === currentYear + 1;
            }
            
            // Outros meses, só ano atual
            return productYear === currentYear;
        });

        console.log(`🎯 Produtos válidos: ${validProducts.length}`);

        let updatedCount = 0;

        for (const product of validProducts) {
            console.log(`\n========== PROCESSANDO PRODUTO ${product.id} ==========`);
            
            const dataRefMeta = product.metafields.find(
                m => m.namespace === 'custom' && m.key === 'data_referencia'
            );

            const dataReferencia = dataRefMeta.value;
            console.log(`📅 [DEBUG] Data de referência: ${dataReferencia}`);

            // Adiciona tag do ano
            const updatedTags = await ensureYearTag(product.id, product.tags, dataReferencia);
            console.log(`🏷️ [DEBUG] Tags após ensureYearTag:`, updatedTags);

            const currentPhase = determineProductPhase(dataReferencia, settings);

            const phaseMeta = product.metafields.find(
                m => m.namespace === 'custom' && m.key === 'sale_phase'
            );

            const storedPhase = phaseMeta?.value?.trim() || null;

            if (process.env.TEST_MODE === 'true') {
                console.log(`🔍 Produto ${product.id}: storedPhase="${storedPhase}" → currentPhase="${currentPhase}"`);
            }

            if (currentPhase !== storedPhase) {
                console.log(`🔄 Produto ${product.id} (${product.title}): "${storedPhase}" → "${currentPhase}"`);

                console.log(`🏷️ [DEBUG] Enviando tags para updateProductStatus:`, updatedTags);
                await updateProductStatus(product.id, currentPhase, updatedTags);

                const metaPayload = {
                    metafield: {
                        namespace: 'custom',
                        key: 'sale_phase',
                        value: currentPhase,
                        type: 'single_line_text_field'
                    }
                };

                if (phaseMeta && phaseMeta.id) {
                    const metafieldId = phaseMeta.id.includes('gid://') 
                        ? phaseMeta.id.split('/').pop() 
                        : phaseMeta.id;

                    await shopifyRequest(
                        `products/${product.id}/metafields/${metafieldId}.json`, 
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

        console.log('\n🎯 Atualizando produto ativo no shop...');
        const activeProductResult = await updateActiveProduct(settings);
        console.log(`✅ Processamento concluído. ${updatedCount} produtos atualizados.`);

        return {
            success: true,
            processed: validProducts.length,
            updated: updatedCount,
            activeProduct: activeProductResult
        };

    } catch (error) {
        console.error('❌ Erro ao processar ciclos:', error.message);
        console.error('❌ Stack completo:', error.stack);
        throw error;
    }
};

module.exports = { 
    processProductCycles,
    determineProductPhase,
    getThemeSettings,
    updateActiveProduct
};