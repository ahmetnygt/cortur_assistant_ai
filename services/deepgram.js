const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');

const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

// onTranscript parameteresi eklendi, böylece metni dışarıya fırlatabileceğiz
function startDeepgramService(tenantId, streamSid, onTranscript) {
    console.log(`[DEEPGRAM] Starting service for tenant: ${tenantId}`);

    const dgConnection = deepgram.listen.live({
        model: "nova-2",
        language: "tr",
        smart_format: true,
        encoding: "mulaw",
        sample_rate: 8000,
        // AHA BURASI: 1000 (1 saniye) olan bekleme süresini 3000 (3 saniye) yapıyoruz
        endpointing: 3000,
        interim_results: false
    });

    dgConnection.addListener(LiveTranscriptionEvents.Open, () => {
        console.log(`[DEEPGRAM] Connection established. Ready to transcribe. (SID: ${streamSid})`);
    });

    dgConnection.addListener(LiveTranscriptionEvents.Transcript, (data) => {
        const transcript = data.channel.alternatives[0].transcript;
        const isFinal = data.is_final;

        if (transcript.trim() !== '' && isFinal) {
            console.log(`\n🗣️ [CUSTOMER - ${tenantId}]: ${transcript}`);
            // Metni yakaladık, index.js'e gönderiyoruz!
            if (onTranscript) onTranscript(transcript);
        }
    });

    dgConnection.addListener(LiveTranscriptionEvents.Error, (err) => {
        console.error(`[DEEPGRAM ERROR]`, err);
    });

    return dgConnection;
}

module.exports = { startDeepgramService };