const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');

const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

// onSpeech eklendi: Müşteri lafa girdiği an tetiklenecek
function startDeepgramService(tenantId, streamSid, onTranscript, onSpeech) {
    console.log(`[DEEPGRAM] Starting service for tenant: ${tenantId}`);

    const dgConnection = deepgram.listen.live({
        model: "nova-2",
        language: "tr",
        smart_format: true,
        encoding: "mulaw",
        sample_rate: 8000,
        endpointing: 5000,
        interim_results: true, // AHA BURASI: Anlık kelimeleri yakalamak için açtık
        // keywords: ["Çanakkale:2", "İstanbul:2", "Kadıköy:2", "Beylikdüzü:2", "Çortur:3", "Ahmet:2"]
    });

    let transcriptBuffer = "";
    let silenceTimer = null;
    let isInterrupted = false; // Twilio'yu saniyede 50 kere darlamayalım diye bayrak koyduk

    dgConnection.addListener(LiveTranscriptionEvents.Open, () => {
        console.log(`[DEEPGRAM] Connection established. Ready to transcribe. (SID: ${streamSid})`);
    });

    dgConnection.addListener(LiveTranscriptionEvents.Transcript, (data) => {
        const transcript = data.channel.alternatives[0].transcript;
        const isFinal = data.is_final;

        if (transcript.trim() !== '') {
            // SÖZ KESME (BARGE-IN) YAKALAYICISI
            // AHA BURASI: Sadece nefes alışını veya "e" demesini laf kesme sanmasın diye uzunluk şartı koyduk
            if (!isFinal && transcript.trim().length > 3) {
                if (!isInterrupted && onSpeech) {
                    isInterrupted = true; // Sesi bir kere kestik, cümleyi bitirene kadar bir daha tetikleme
                    onSpeech();
                }
            }

            if (isFinal) {
                isInterrupted = false; // Adam lafını bitirdi, bayrağı sıfırla
                transcriptBuffer += transcript + " ";
                clearTimeout(silenceTimer);

                silenceTimer = setTimeout(() => {
                    const finalMessage = transcriptBuffer.trim();
                    transcriptBuffer = "";

                    if (finalMessage !== "") {
                        console.log(`\n🗣️ [CUSTOMER - ${tenantId}]: ${finalMessage}`);
                        if (onTranscript) onTranscript(finalMessage);
                    }
                }, 800);
            }
        }
    });

    dgConnection.addListener(LiveTranscriptionEvents.Error, (err) => {
        console.error(`[DEEPGRAM ERROR]`, err);
    });

    return dgConnection;
}

module.exports = { startDeepgramService };