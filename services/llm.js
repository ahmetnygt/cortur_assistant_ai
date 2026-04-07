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
            description: "Müşteri ad, soyad, telefon ve T.C. Kimlik numarasını eksiksiz verdiğinde, KESİNLİKLE MÜŞTERİDEN ONAY BEKLEMEDEN VE 'YAPIYORUM' DİYE CEVAP YAZMADAN DİREKT BU ALETİ ÇAĞIR! Aleti çağırmak için müşterinin 'tamam yap' demesini bekleme.",
            parameters: {
                type: "object",
                properties: {
                    sefer_id: { type: "string" },
                    koltuk_no: { type: "string" },
                    fiyat: { type: "string" },
                    name: { type: "string", description: "Yolcunun adı" },
                    surname: { type: "string", description: "Yolcunun soyadı" },
                    phone: { type: "string", description: "Yolcunun telefonu" },
                    tc_kimlik: { type: "string", description: "Yolcunun 11 haneli T.C. Kimlik Numarası" } // <-- YENİ EKLENDİ
                },
                required: ["sefer_id", "koltuk_no", "fiyat", "name", "surname", "phone", "tc_kimlik"], // <-- ZORUNLU KILINDI
            },
        }
    }
];

async function generateResponse(systemPrompt, userMessage, history = [], sessionState = {}) {
    try {
        console.log(`[LLM] GPT-4o-mini is thinking...`);
        const startTime = Date.now();

        const todayDate = new Date().toISOString().split('T')[0];

        // EĞER RAM'DE SEFER VARSA YAPAY ZEKAYI TEHDİT EDİYORUZ
        let hafizaUyarisi = "";
        if (sessionState.lastSchedules) {
            hafizaUyarisi = `\n[SİSTEM EMRİ - ÇOK ÖNEMLİ]: Sen bu müşteri için zaten seferleri çektin! İşte bulduğun seferler: ${sessionState.lastSchedules}. SAKIN 'checkBusSchedule' ALETİNİ TEKRAR ÇAĞIRMA! Müşteri saat seçtiyse direkt ismini al ve rezervasyon yap.`;
        }

        // Dinamik prompta uyarımızı ekliyoruz
        const dynamicPrompt = `${systemPrompt}\nÖNEMLİ BİLGİ: Bugünün tarihi ${todayDate}. ${hafizaUyarisi}`;

        const messages = [
            { role: "system", content: dynamicPrompt },
            ...history,
            { role: "user", content: userMessage }
        ];

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            temperature: 0.2,
            messages: messages,
            tools: tools,
            tool_choice: "auto"
        });

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
                        functionArgs.tc_kimlik // <-- YENİ EKLENDİ
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

            // 2. İSTEK: API sonucunu gören OpenAI'a "Bunu adama düzgünce oku" diyoruz
            console.log(`[LLM] Asking GPT to summarize the API result...`);
            const secondResponse = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                temperature: 0.2,
                messages: messages
            });

            console.log(`[LLM] Final tool-based response generated in ${Date.now() - startTime}ms.`);
            return secondResponse.choices[0].message.content;
        }

        console.log(`[LLM] Standard response generated in ${Date.now() - startTime}ms.`);
        return responseMessage.content;

    } catch (error) {
        console.error(`[LLM ERROR]`, error);
        return "Sistemde anlık bir yoğunluk var, lütfen tekrar söyler misiniz?";
    }
}

module.exports = { generateResponse };