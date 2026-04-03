const Groq = require("groq-sdk");
const { checkBusSchedule, makeReservation } = require('./api');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Buse'nin Alet Çantası (Yapay zekaya hangi fonksiyonları kullanabileceğini anlatıyoruz)
const tools = [
    {
        type: "function",
        function: {
            name: "checkBusSchedule",
            description: "Müşteri sefer, bilet veya saat sorduğunda bu fonksiyonu çağır.",
            parameters: {
                type: "object",
                properties: {
                    departureCity: { type: "string" },
                    destinationCity: { type: "string" },
                    date: { type: "string" }
                },
                required: ["departureCity", "destinationCity", "date"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "makeReservation",
            description: "Müşteri belirli bir saati seçip rezervasyon yapmak istediğinde KESİNLİKLE bu fonksiyonu çağır. Öncesinde müşterinin adını öğren.",
            parameters: {
                type: "object",
                properties: {
                    passengerName: { type: "string", description: "Yolcunun ad ve soyadı" },
                    departureCity: { type: "string" },
                    destinationCity: { type: "string" },
                    date: { type: "string", description: "YYYY-MM-DD formatında tarih" },
                    time: { type: "string", description: "Seçilen sefer saati, örn: 14:00" }
                },
                required: ["passengerName", "departureCity", "destinationCity", "date", "time"],
            },
        },
    }
];

async function generateResponse(systemPrompt, userMessage, history = []) {
    try {
        console.log(`[LLM] Groq is thinking...`);
        const startTime = Date.now();

        // LLM'in "Yarın" kelimesini anlaması için bugünün tarihini sisteme çakıyoruz
        const todayDate = new Date().toISOString().split('T')[0];
        const dynamicPrompt = `${systemPrompt}\nÖNEMLİ BİLGİ: Bugünün tarihi ${todayDate}. Müşteri 'yarın' veya 'bugün' derse bu tarihi baz al. STT kaynaklı şive veya kelime hatalarını düzeltip bağlamı anla. Kısa ve net cevap ver.`;

        const messages = [
            { role: "system", content: dynamicPrompt },
            ...history, // index.js'den gelen geçmişi artık sisteme gömüyoruz
            { role: "user", content: userMessage }
        ];

        // 1. İSTEK: Groq'a soruyoruz: "Adamın lafına direkt cevap mı vereceksin, yoksa alet mi kullanacaksın?"
        const response = await groq.chat.completions.create({
            messages: messages,
            model: "llama-3.3-70b-versatile",
            temperature: 0.3, // Tool kullanırken halüsinasyon görmesin diye düşük
            max_tokens: 250,
            tools: tools,
            tool_choice: "auto"
        });

        const responseMessage = response.choices[0].message;

        // EĞER YAPAY ZEKA ALET KULLANMAYA KARAR VERDİYSE:
        if (responseMessage.tool_calls) {
            console.log(`[LLM] Tool call detected! Buse alet çantasına sarıldı amk...`);
            messages.push(responseMessage); // Asistanın bu hamlesini geçmişe ekliyoruz ki hafıza kaybolmasın

            // Birden fazla fonksiyon çağırmak istediyse hepsini dönüyoruz
            for (const toolCall of responseMessage.tool_calls) {
                const functionName = toolCall.function.name;
                const functionArgs = JSON.parse(toolCall.function.arguments);

                console.log(`[LLM-TOOL] Executing ${functionName} with arguments:`, functionArgs);

                let functionResult = "";

                // Bizim yazdığımız API servisini tetikliyoruz
                // Bizim yazdığımız API servisini tetikliyoruz
                if (functionName === "checkBusSchedule") {
                    functionResult = await checkBusSchedule(
                        functionArgs.departureCity,
                        functionArgs.destinationCity,
                        functionArgs.date
                    );
                } else if (functionName === "makeReservation") {
                    functionResult = await makeReservation(
                        functionArgs.passengerName,
                        functionArgs.departureCity,
                        functionArgs.destinationCity,
                        functionArgs.date,
                        functionArgs.time
                    );
                }

                console.log(`[LLM-TOOL] Result from API:`, functionResult);

                // API'den gelen veriyi yapay zekaya "Al bakalım Buse, sonuç bu" diye geri besliyoruz
                messages.push({
                    tool_call_id: toolCall.id,
                    role: "tool",
                    name: functionName,
                    content: functionResult,
                });
            }

            // 2. İSTEK: API'nin sonucunu gören Llama'ya "Şimdi bu veriyi adama insan gibi oku" diyoruz
            console.log(`[LLM] Asking Llama to summarize the API result for the user...`);
            const secondResponse = await groq.chat.completions.create({
                messages: messages,
                model: "llama-3.3-70b-versatile",
                temperature: 0.2, // AHA BURASI AMK. Kızı sınırlandırdık ki veriyi okurken destan yazmasın, halüsinasyon görmesin.
                max_tokens: 250
            });

            console.log(`[LLM] Final tool-based response generated in ${Date.now() - startTime}ms.`);
            return secondResponse.choices[0].message.content;
        }

        // Eğer alet kullanmadıysa (mesela adam sadece "Selam" dediyse) direkt cevabı dön
        console.log(`[LLM] Standard response generated in ${Date.now() - startTime}ms.`);
        return responseMessage.content;

    } catch (error) {
        console.error(`[LLM ERROR]`, error);
        return "Sistemde anlık bir yoğunluk var, lütfen tekrar söyler misiniz?";
    }
}

module.exports = { generateResponse };