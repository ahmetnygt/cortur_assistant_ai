const VOICE_ID = process.env.ELEVENLABS_VOICE_ID;
const API_KEY = process.env.ELEVENLABS_API_KEY;

/**
 * Metni ElevenLabs API'si ile sese çevirir ve Twilio WebSocket'i üzerinden hatta basar.
 * @param {string} text - Okunacak metin (Groq'tan gelen cevap)
 * @param {string} streamSid - Twilio çağrı kimliği
 * @param {Object} twilioWs - Aktif Twilio WebSocket bağlantısı
 */
async function streamTextToSpeech(text, streamSid, twilioWs) {
    console.log(`[TTS] ElevenLabs is processing: "${text.substring(0, 30)}..."`);
    const startTime = Date.now();

    try {
        // ElevenLabs'e istek atıyoruz. output_format olarak direkt Twilio'nun formatını (ulaw_8000) istiyoruz.
        // Node 18+ ile gelen yerleşik fetch API'sini kullanıyoruz.
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream?output_format=ulaw_8000`, {
            method: "POST",
            headers: {
                "Accept": "audio/mpeg",
                "xi-api-key": API_KEY,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                text: text,
                model_id: "eleven_turbo_v2_5", // Düşük gecikmeli çoklu dil destekli turbo model
                voice_settings: {
                    stability: 0.45,
                    similarity_boost: 0.75
                }
            })
        });

        if (!response.ok) {
            console.error("[TTS ERROR] ElevenLabs request failed:", await response.text());
            return;
        }

        // Gelen sesi Buffer'a, oradan da Base64 formatına çeviriyoruz
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64Audio = buffer.toString('base64');

        // Twilio'nun anlayacağı "media" paketi formatını hazırlıyoruz
        const mediaMessage = {
            event: 'media',
            streamSid: streamSid,
            media: {
                payload: base64Audio
            }
        };

        // Sesi canlı olarak Twilio WebSocket'ine (telefon hattına) basıyoruz
        twilioWs.send(JSON.stringify(mediaMessage));
        console.log(`[TTS] Audio injected to Twilio line in ${Date.now() - startTime}ms.`);

    } catch (error) {
        console.error(`[TTS ERROR]`, error);
    }
}

module.exports = { streamTextToSpeech };