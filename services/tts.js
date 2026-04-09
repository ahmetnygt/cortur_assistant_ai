const VOICE_ID = process.env.ELEVENLABS_VOICE_ID;
const API_KEY = process.env.ELEVENLABS_API_KEY;

/**
 * Metni ElevenLabs API'si ile sese çevirir ve anında Twilio WebSocket'i üzerinden akıtır (Stream).
 */
async function streamTextToSpeech(text, streamSid, twilioWs) {
    console.log(`[TTS] ElevenLabs is streaming: "${text.substring(0, 30)}..."`);
    const startTime = Date.now();

    try {
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream?output_format=ulaw_8000`, {
            method: "POST",
            headers: {
                "Accept": "audio/mpeg",
                "xi-api-key": API_KEY,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                text: text,
                model_id: "eleven_turbo_v2_5",
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

        console.log(`[TTS] İlk ses paketi (TTFB) ${Date.now() - startTime}ms içinde geldi. Akış başlıyor...`);

        // Node 18+ ile gelen ReadableStream üzerinden veriyi parça parça okuyup anında basıyoruz
        if (response.body) {
            for await (const chunk of response.body) {
                // AHA BURASI: Eğer iptal sinyali geldiyse akışı anında kes!
                if (signal && signal.aborted) {
                    console.log("🛑 [TTS] Müşteri araya girdi, ElevenLabs şelalesi kapatıldı.");
                    break;
                }

                const base64Audio = Buffer.from(chunk).toString('base64');
                const mediaMessage = { event: 'media', streamSid: streamSid, media: { payload: base64Audio } };
                twilioWs.send(JSON.stringify(mediaMessage));
            }
            console.log(`[TTS] Ses akışı tamamlandı.`);
        }

    } catch (error) {
        console.error(`[TTS ERROR]`, error);
    }
}

module.exports = { streamTextToSpeech };