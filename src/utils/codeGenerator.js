const generateUniqueCode = () => {
    // Letras maiúsculas e números, removendo 'O' e '0'
    const chars = 'ABCDEFGHIJKLMNPQRSTUVWXYZ123456789';
    let result = '';
    for (let i = 0; i < 7; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

module.exports = { generateUniqueCode };