const db = require('../config/db');
const { generateUniqueCode } = require('../utils/codeGenerator');

// 1. CRIAR UM ÚNICO CONVITE
const createInvite = async (data) => {
    let created = false;
    let attempts = 0;
    let newInvite;

    // ALTERAÇÃO: Define Hogo se provider não vier
    const providerName = data.provider || 'Hogo';
    const providerIdentity = data.providerIdentity || 'HOGO';

    while (!created && attempts < 5) {
        const code = generateUniqueCode();

        try {
            const query = `
                INSERT INTO invites (code, type, is_used, provider, provider_identity)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING *;
            `;
            
            // ALTERAÇÃO: Usa providerName no lugar de data.provider
            const values = [code, data.type, false, providerName, providerIdentity];
            const result = await db.query(query, values);
            newInvite = result.rows[0];
            created = true;

        } catch (error) {
            if (error.code === '23505') { // Código repetido
                attempts++;
                continue;
            }
            throw error;
        }
    }

    if (!created) throw new Error('Falha ao gerar código único após várias tentativas.');
    return newInvite;
};

// 2. CRIAR EM LOTE (BULK)
const createBatch = async (amount, data) => {
    const createdCodes = [];
    
    // ALTERAÇÃO: Define Hogo se provider não vier
    const providerName = data.provider || 'Hogo';
    const providerIdentity = data.providerIdentity || 'HOGO';
    
    let remaining = parseInt(amount);

    while (remaining > 0) {
        const params = [];
        let paramIndex = 1;
        const codesBatch = new Set();
        
        while (codesBatch.size < remaining) {
            codesBatch.add(generateUniqueCode());
        }

        const valuesClause = [];
        for (const code of codesBatch) {
            valuesClause.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4})`);
            
            // ALTERAÇÃO: Usa providerName no lugar de data.provider
            params.push(code, data.type, false, providerName, providerIdentity);
            
            paramIndex += 5;
        }

        const query = `
            INSERT INTO invites (code, type, is_used, provider, provider_identity)
            VALUES ${valuesClause.join(', ')}
            ON CONFLICT (code) DO NOTHING
            RETURNING *;
        `;

        const result = await db.query(query, params);
        createdCodes.push(...result.rows);
        remaining -= result.rows.length;
    }

    return createdCodes;
};

// 3. LISTAR COM FILTROS AVANÇADOS (ADMIN)
const listInvites = async (filters, page = 1, limit = 10) => {
    const offset = (page - 1) * limit;
    const params = [];
    let query = `SELECT * FROM invites WHERE 1=1`;
    let countQuery = `SELECT COUNT(*) FROM invites WHERE 1=1`;
    let paramIndex = 1;

    // Helper para adicionar filtros
    const addFilter = (field, value, operator = '=') => {
        if (value !== undefined && value !== null && value !== '') {
            if (operator === 'ILIKE') {
                query += ` AND ${field} ILIKE $${paramIndex}`;
                countQuery += ` AND ${field} ILIKE $${paramIndex}`;
                params.push(`%${value}%`);
            } else {
                query += ` AND ${field} ${operator} $${paramIndex}`;
                countQuery += ` AND ${field} ${operator} $${paramIndex}`;
                params.push(value);
            }
            paramIndex++;
        }
    };

    addFilter('code', filters.code);
    addFilter('type', filters.type);
    addFilter('provider', filters.provider, 'ILIKE');
    addFilter('provider_identity', filters.providerIdentity, 'ILIKE');
    addFilter('user_email', filters.user_email, 'ILIKE');
    
    // FILTRO DE BUSCA GLOBAL
    if (filters.search) {
        query += ` AND (code ILIKE $${paramIndex} OR user_email ILIKE $${paramIndex} OR provider ILIKE $${paramIndex})`;
        countQuery += ` AND (code ILIKE $${paramIndex} OR user_email ILIKE $${paramIndex} OR provider ILIKE $${paramIndex})`;
        params.push(`%${filters.search}%`);
        paramIndex++;
    }
    
    // Filtro Boolean
    if (filters.is_used === 'true' || filters.is_used === true) addFilter('is_used', true);
    if (filters.is_used === 'false' || filters.is_used === false) addFilter('is_used', false);

    // Filtro por enviado
    if (filters.is_sent === 'true' || filters.is_sent === true) addFilter('is_sent', true);
    if (filters.is_sent === 'false' || filters.is_sent === false) addFilter('is_sent', false);
    
    // Filtro de Data
    if (filters.startDate) {
        query += ` AND created_at >= $${paramIndex}`;
        countQuery += ` AND created_at >= $${paramIndex}`;
        params.push(filters.startDate);
        paramIndex++;
    }
    if (filters.endDate) {
        query += ` AND created_at <= $${paramIndex}`;
        countQuery += ` AND created_at <= $${paramIndex}`;
        params.push(filters.endDate);
        paramIndex++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    
    const dataParams = [...params, limit, offset];
    
    const [rowsResult, countResult] = await Promise.all([
        db.query(query, dataParams),
        db.query(countQuery, params)
    ]);

    return {
        data: rowsResult.rows,
        meta: {
            total: parseInt(countResult.rows[0].count),
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limit)
        }
    };
};

// 4. SALVAR NA CARTEIRA (CLAIM) - SEM GASTAR
const claimInvite = async (code, userData) => {
    const checkQuery = `SELECT * FROM invites WHERE code = $1`;
    const checkResult = await db.query(checkQuery, [code]);

    if (checkResult.rows.length === 0) throw new Error('Invalid code.');
    const invite = checkResult.rows[0];


    if (invite.user_id && invite.user_id !== userData.userId) {
        throw new Error('This coupon already belongs to another user.');
    }

    if (invite.user_id === userData.userId) {
        throw new Error('This coupon is already in your wallet.');
    }

    if (invite.is_used) {
        throw new Error('This coupon has already been used.');
    }

    const userId = userData.userId || 'guest';
    
    const updateQuery = `
        UPDATE invites 
        SET user_email = $1, 
            user_id = $2,
            claimed_at = COALESCE(claimed_at, NOW()),
            updated_at = NOW()
        WHERE id = $3
        RETURNING *;
    `;

    const result = await db.query(updateQuery, [userData.email, userId, invite.id]);
    return result.rows[0];
};

// 5. GASTAR O CUPOM (ACTIVATE/BURN)
const activateInvite = async (code, userData) => {
    // Garante que o cupom é válido/pertence ao usuário antes de gastar
    let invite;
    try {
        invite = await claimInvite(code, userData); 
    } catch (e) {
        throw e;
    }

    const burnQuery = `
        UPDATE invites 
        SET is_used = true, 
            updated_at = NOW()
        WHERE id = $1
        RETURNING *;
    `;
    
    const result = await db.query(burnQuery, [invite.id]);
    return result.rows[0];
};

// 6. SINCRONIZAR HISTÓRICO (GUEST -> LOGADO)
const syncGuestHistory = async (email, newUserId) => {
    const query = `
        UPDATE invites 
        SET user_id = $1, updated_at = NOW()
        WHERE user_email = $2 
        AND (user_id = 'guest' OR user_id IS NULL)
        RETURNING *;
    `;
    const result = await db.query(query, [newUserId, email]);
    return result.rows;
};

// 7. OBTER CARTEIRA DO USUÁRIO
const getUserWallet = async (userId, type = 'active', page = 1, limit = 10) => {
    // PROTEÇÃO DE SEGURANÇA: GUEST NÃO PODE VER CARTEIRA
    if (!userId || userId === 'guest') {
        throw new Error('É necessário ter uma conta logada para visualizar a carteira.');
    }

    const offset = (page - 1) * limit;
    const isUsedValue = type === 'history' ? true : false;

    const query = `
        SELECT * FROM invites 
        WHERE user_id = $1 
        AND is_used = $2
        ORDER BY updated_at DESC
        LIMIT $3 OFFSET $4
    `;
    
    const countQuery = `SELECT COUNT(*) FROM invites WHERE user_id = $1 AND is_used = $2`;

    const [rows, count] = await Promise.all([
        db.query(query, [userId, isUsedValue, limit, offset]),
        db.query(countQuery, [userId, isUsedValue])
    ]);

    return {
        data: rows.rows,
        meta: {
            total: parseInt(count.rows[0].count),
            page: parseInt(page),
            limit: parseInt(limit)
        }
    };
};

// 8. VERIFICAR SE USUÁRIO TEM CUPONS ATIVOS (apenas contagem)
const hasActiveInvites = async (userId) => {
    // PROTEÇÃO: GUEST NÃO PODE VERIFICAR
    if (!userId || userId === 'guest') {
        return { hasInvites: false, count: 0 };
    }

    const query = `
        SELECT COUNT(*) as total 
        FROM invites 
        WHERE user_id = $1 
        AND is_used = false
    `;
    
    const result = await db.query(query, [userId]);
    const count = parseInt(result.rows[0].total);

    return {
        hasInvites: count > 0,
        count: count
    };
};

// Marca como enviado
const markAsSent = async (code) => {
    const checkQuery = `SELECT * FROM invites WHERE code = $1`;
    const checkResult = await db.query(checkQuery, [code]);

    if (checkResult.rows.length === 0) {
        throw new Error('Código não encontrado.');
    }

    const invite = checkResult.rows[0];

    if (invite.is_sent) {
        throw new Error('Este código já foi marcado como enviado.');
    }

    const updateQuery = `
        UPDATE invites 
        SET is_sent = true, 
            sent_at = NOW()
        WHERE code = $1
        RETURNING *;
    `;

    const result = await db.query(updateQuery, [code]);
    return result.rows[0];
};

module.exports = { 
    createInvite, 
    createBatch, 
    listInvites, 
    claimInvite, 
    activateInvite, 
    syncGuestHistory, 
    getUserWallet,
    markAsSent,
    hasActiveInvites
};