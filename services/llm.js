const OpenAI = require("openai");
const { checkBusSchedule, makeReservation } = require('./api');

// OpenAI'ı fişe takıyoruz
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Buse'nin Alet Çantası (OpenAI Formatı)
const tools = [
    {
        type: "function",
        function: {
            name: "checkBusSchedule",
            description: "Müşteri İLK DEFA bir güzergah ve tarih sorduğunda bu fonksiyonu çağır. DİKKAT: Eğer geçmiş mesajlarda bu güzergah ve tarih için aleti zaten çağırdıysan TEKRAR ÇAĞIRMA! Geçmiş konuşmandaki verilere bakarak cevap ver.",
            parameters: {
                type: "object",
                properties: {
                    departureCity: { type: "string" },
                    destinationCity: { type: "string" },
                    date: { type: "string", description: "YYYY-MM-DD formatında tarih" }
                },
                required: ["departureCity", "destinationCity", "date"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "makeReservation",
            description: "Müşteri AD, SOYAD ve TELEFON numarasını verdiği AN bu aracı ÇAĞIR! 'cinsiyet' parametresini müşterinin isminden KENDİN TAHMİN EDEREK (Erkekse 'E', Kadınsa 'K') doldur. Aracı çağırırken müşteriye ASLA 'işlemi yapıyorum' diye yazılı/sözlü bir cevap verme, direkt aracı tetikle.",
            parameters: {
                type: "object",
                properties: {
                    sefer_id: { type: "string" },
                    koltuk_no: { type: "string" },
                    fiyat: { type: "string" },
                    name: { type: "string", description: "Yolcunun adı" },
                    surname: { type: "string", description: "Yolcunun soyadı" },
                    phone: { type: "string", description: "Yolcunun telefonu" },
                    cinsiyet: { type: "string", description: "Yolcu Erkek ise 'E', Kadın ise 'K' yaz." } // <-- EKLENDİ
                },
                required: ["sefer_id", "koltuk_no", "fiyat", "name", "surname", "phone", "cinsiyet"],
            },
        }
    }
];

async function generateResponse(systemPrompt, userMessage, history = [], sessionState = {}, signal = null) {
    try {
        console.log(`[LLM] GPT-4o-mini is thinking...`);
        const startTime = Date.now();

        const todayDate = new Date().toISOString().split('T')[0];
        let hafizaUyarisi = "";
        if (sessionState.lastSchedules) {
            hafizaUyarisi = `\n[SİSTEM EMRİ - ÇOK ÖNEMLİ]: Sen daha önce şu seferleri çektin: ${sessionState.lastSchedules}. Eğer müşteri AYNI GÜZERGAH VE TARİH için sefer soruyorsa SAKIN 'checkBusSchedule' ALETİNİ TEKRAR ÇAĞIRMA...`;
        }

        const dynamicPrompt = `${systemPrompt}\nÖNEMLİ BİLGİ: Bugünün tarihi ${todayDate}. ${hafizaUyarisi}`;

        const messages = [
            { role: "system", content: dynamicPrompt },
            ...history,
            { role: "user", content: userMessage }
        ];

        // İptal sinyalini OpenAI'a gönderilecek seçeneklere (options) ekliyoruz
        const options = signal ? { signal } : {};

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            temperature: 0.2,
            messages: messages,
            tools: tools,
            tool_choice: "auto"
        }, options); // <-- AHA BURASI! Fişi buraya bağladık

        const responseMessage = response.choices[0].message;

        if (responseMessage.tool_calls) {
            console.log(`[LLM] Tool call detected! Buse aleti eline aldı...`);
            messages.push(responseMessage);

            for (const toolCall of responseMessage.tool_calls) {
                const functionName = toolCall.function.name;
                const functionArgs = JSON.parse(toolCall.function.arguments);

                console.log(`[LLM-TOOL] Executing ${functionName} with arguments:`, functionArgs);

                let functionResult = "";

                if (functionName === "checkBusSchedule") {
                    functionResult = await checkBusSchedule(
                        functionArgs.departureCity,
                        functionArgs.destinationCity,
                        functionArgs.date
                    );

                    // AHA BURASI: API'den gelen sonucu RAM'e (sessionState) çakıyoruz!
                    sessionState.lastSchedules = functionResult;

                } else if (functionName === "makeReservation") {
                    functionResult = await makeReservation(
                        functionArgs.sefer_id,
                        functionArgs.koltuk_no,
                        functionArgs.fiyat,
                        functionArgs.name,
                        functionArgs.surname,
                        functionArgs.phone,
                        null, // govId (TC) null kalmıştı hatırlarsan
                        functionArgs.cinsiyet // <-- YENİ EKLENDİ
                    );
                }

                console.log(`[LLM-TOOL] Result from API:`, functionResult);

                // API'den dönen veriyi OpenAI'a geri yediriyoruz
                messages.push({
                    tool_call_id: toolCall.id,
                    role: "tool",
                    name: functionName,
                    content: functionResult,
                });
            }

            // AHA RÖNTGEN CİHAZINI BURAYA TAKTIK: Buse'nin beynine tam olarak ne girdiğini ekrana kusuyoruz
            console.log(`\n🧠 [BUSE'NİN BEYNİNE GİREN HAM DATA]:\n--------------------------------------------------\n${messages[messages.length - 1].content}\n--------------------------------------------------\n`);

            console.log(`[LLM] Asking GPT to summarize the API result...`);
            const secondResponse = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                temperature: 0.2,
                messages: messages
            }, options); // <-- İkinci isteğe de aynı fişi bağlıyoruz

            return secondResponse.choices[0].message.content;
        }

        return responseMessage.content;

    } catch (error) {
        // İptal edildiğinde hata fırlatır, bunu yakalayıp sessizce bitirmemiz lazım
        if (error.name === 'AbortError') {
            console.log("🛑 [LLM] Adam lafa daldı, OpenAI isteği siktir edildi (Tokenler cepte kaldı).");
            return null; // Yarıda kesildiğini belirtmek için null dönüyoruz
        }

        console.error(`[LLM ERROR]`, error);
        return "Sistemde anlık bir yoğunluk var, lütfen tekrar söyler misiniz?";
    }
}

module.exports = { generateResponse };
