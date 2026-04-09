require('dotenv').config();
const express = require('express');
const ExpressWs = require('express-ws');
const { startDeepgramService } = require('./services/deepgram');
const { generateResponse } = require('./services/llm');
const { streamTextToSpeech } = require('./services/tts');

const app = express();
ExpressWs(app);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

const prompt = `
Sen Çortur Seyahat'in sesli müşteri temsilcisi Buse'sin. Gerçek bir telefon görüşmesindesin ve müşterilere otobüs seferi sorgulama, bilet rezervasyonu konularında yardımcı oluyorsun.

KARAKTERİN VE ÜSLUBUN:
- Empatik, sabırlı, çok doğal konuşan, profesyonel ama samimi bir insansın. 
- Karşındaki kişi seninle telefonda konuşuyor. Cümlelerini "Tamamdır", "Anlıyorum", "Harika", "Hemen kontrol ediyorum" gibi doğal tepkilerle süsle.
- Asla bir yapay zeka veya robot olduğunu hissettirme. "Sistem, veritabanı, api, entegrasyon" gibi teknik kelimeler kullanma.

SESLENDİRME (TTS) VE FORMAT KURALLARI:
- Yanıtların daima kısa, tek nefeste söylenebilecek uzunlukta ve GÜNLÜK KONUŞMA dilinde olmalıdır.
- Kesinlikle madde imi (bullet point), kalın yazı, yıldız, diyez veya alt tire kullanma. Seslendirme motoru bunları okuyamaz.
- Liste yapma, düz akıcı cümleler kur. Sayıları veya saatleri okunuşuyla yaz (Örn: "15 30" veya "saat 3 buçuk").
- Müşteri bir bilgiyi eksik verirse hepsini aynı anda sorma. Tek tek, adım adım ilerle.

ÖNEMLİ VERİ KURALLARI:
1. Geçerli Şehirler: [Çanakkale, İstanbul, Kadıköy, Pendik, Sarıyer, Silivri, Beylikdüzü, Gebze, Tekirdağ, Çorlu, Yalova, Bursa, Gemlik, Adana, Eskişehir, Gelibolu, Lapseki]. Müşteri şiveli veya yanlış telaffuz etse bile bu listedekilerden en yakın olanı anla. Listede olmayan bir yer sorarsa, kibarca oraya seferiniz olmadığını söyle.
2. Cinsiyet Tahmini: Rezervasyon için müşterinin adından cinsiyetini SEN tahmin et (Ahmet=Erkek, Ayşe=Kadın). Üniseks isimlerde mantıklı birini seç ama KESİNLİKLE müşteriye cinsiyetini sorma.
3. Gizli Bilgiler: Araçlardan (tools) gelen "Sefer_ID", "Koltuk_No" gibi kodları sadece arka planda kullan, asla müşteriye sesli olarak okuma. Müşteriye sadece sefer saatlerini ve işlem bitince PNR kodunu oku. Fiyatı ise müşteri özellikle sormazsa söyleme.

GÖREV AKIŞI:
Aşağıdaki adımları sırasıyla uygula:

ADIM 1: SEFER SORGULAMA
Müşteri nereden nereye ve ne zaman gideceğini söylediğinde "checkBusSchedule" aracını çalıştır. Tarih, kalkış veya varış yeri eksikse sadece eksik olanı sor. Aracı çalıştırırken KESİNLİKLE "İşleminizi yapıyorum, lütfen bekleyin" gibi sözlü cevaplar verme; doğrudan ve tamamen SESSİZCE aracı tetikle!

ADIM 2: BİLGİ TOPLAMA VE REZERVASYON
Seferleri sunduktan sonra müşteri birini seçerse, rezervasyon için gerekenleri TEK TEK sor:
- Önce: "İşleminiz için adınızı ve soyadınızı öğrenebilir miyim?" de ve bekle.
- Ad soyad gelince: "Teşekkürler, son olarak cep telefonu numaranızı rica edebilir miyim?" de ve bekle.

ADIM 3: İŞLEMİ BİTİRME
Müşteri telefon numarasını verdiği an işlemi bitir. "makeReservation" aracını SESSİZCE ve DOĞRUDAN çalıştır (Yine "bekleyin" demek yok). İşlem başarılı olduğunda müşteriye PNR kodunu ve koltuk numarasını ileterek başka bir isteği olup olmadığını sor.
`

const tenantConfig = {
    "sip:8508400359@cortur.sip.twilio.com:5060;transport=udp": {
        id: "cortur",
        name: "Çortur Seyahat",
        prompt: prompt
    }
};

app.post('/incoming', (req, res) => {
    console.log("\n🚨 --- [TWILIO'DAN KAPIN ÇALINDI] --- 🚨");
    console.log("Aranan Adres (To)  :", req.body.To);
    console.log("Arayan Adam (From) :", req.body.From);
    console.log("----------------------------------------\n");

    const calledNumber = req.body.To;
    const tenant = tenantConfig[calledNumber];

    if (!tenant) {
        console.log(`[HATA] Eşleşme bulunamadı! Lütfen tenantConfig içine tam olarak şunu yaz: "${calledNumber}"`);
        const hataTwiml = `
        <Response>
            <Say language="tr-TR">Sistem bağlantısı başarılı fakat adres eşleşmedi. Lütfen terminaldeki adresi kopyalayın.</Say>
        </Response>
        `;
        res.type('text/xml');
        return res.send(hataTwiml);
    }

    console.log(`[SYSTEM] Eşleşme başarılı! Yönlendirilen Tenant: ${tenant.name}`);

    // host URL'sini alıyoruz ki MP3'lerin yolunu Twilio'ya verebilelim
    const hostUrl = `https://${req.headers.host}`;

    const twiml = `
    <Response>
        <Play>${hostUrl}/ring.mp3</Play>
        <Play>${hostUrl}/ding.mp3</Play>
        <Connect>
            <Stream url="wss://${req.headers.host}/ses-akisi">
                <Parameter name="tenantId" value="${tenant.id}" />
            </Stream>
        </Connect>
    </Response>
    `;

    res.type('text/xml');
    res.send(twiml);
});

app.ws('/ses-akisi', (ws, req) => {
    let streamSid = null;
    let tenantId = null;
    let dgConnection = null;
    let isSpeaking = false;
    let callHistory = [];
    let sessionState = { lastSchedules: null };
    let currentAbortController = null; // AHA BURASI: OpenAI'ın celladı

    ws.on('message', async (message) => {
        const msg = JSON.parse(message);

        if (msg.event === 'start') {
            streamSid = msg.start.streamSid;
            tenantId = msg.start.customParameters.tenantId;
            const currentTenant = Object.values(tenantConfig).find(t => t.id === tenantId);

            console.log(`[WS] Stream started. Tenant: ${tenantId}`);

            dgConnection = startDeepgramService(tenantId, streamSid,
                // Müşteri lafını BİTİRDİĞİNDE çalışacak yer (onTranscript)
                async (transcript) => {
                    if (isSpeaking) return;
                    isSpeaking = true;

                    // Yeni bir istek için yeni bir kılıç çekiyoruz
                    currentAbortController = new AbortController();

                    // Sinyali LLM'e yolluyoruz
                    const answer = await generateResponse(
                        currentTenant.prompt,
                        transcript,
                        callHistory,
                        sessionState,
                        currentAbortController.signal
                    );

                    // Eğer LLM null dönerse demek ki adam araya girdi ve biz isteği geberttik.
                    // İşlemi burada bırak, TTS'e geçme.
                    if (!answer) {
                        isSpeaking = false;
                        return;
                    }

                    console.log(`\n🤖 [BUSE - ${tenantId}]: ${answer}\n`);
                    // index.js içinde push yaptıktan hemen sonra:
                    callHistory.push({ role: "user", content: transcript });
                    callHistory.push({ role: "assistant", content: answer });
                    // Context şişmesin diye son 10 mesajı (5 soru-cevap) tutuyoruz:
                    if (callHistory.length > 10) callHistory = callHistory.slice(-10);
                    await streamTextToSpeech(answer, streamSid, ws);
                    isSpeaking = false;
                },
                // Müşteri lafa GİRDİĞİ AN çalışacak yer (onSpeech - Susturucu)
                () => {
                    ws.send(JSON.stringify({ event: "clear", streamSid: streamSid }));
                    console.log(`\n🛑 [SİSTEM]: Müşteri lafa daldı, Twilio sesi anında kesildi!`);

                    if (currentAbortController) {
                        currentAbortController.abort();
                        currentAbortController = null;
                    }
                    isSpeaking = false; // <-- BUNU EKLE: Buse sağır kalmasın, hemen yeni cümleyi işlesin
                }
            );

            setTimeout(async () => {
                if (isSpeaking) return;
                isSpeaking = true;

                // Selamlama için de bir cellat (AbortController) atıyoruz
                currentAbortController = new AbortController();

                console.log(`\n🤖 [SİSTEM]: Telefon açıldı, Buse sabit ilk selamlamayı yapıyor...`);
                const sabitSelamlama = "Çortur Seyahat'e hoş geldiniz, ben Buse. Size nasıl yardımcı olabilirim?";
                console.log(`\n🤖 [BUSE - ${tenantId} (SABİT)]: ${sabitSelamlama}\n`);

                callHistory.push({ role: "assistant", content: sabitSelamlama });

                // Sinyali TTS'e paslıyoruz
                await streamTextToSpeech(sabitSelamlama, streamSid, ws, currentAbortController.signal);
                isSpeaking = false;
            }, 0);
        }

        if (msg.event === 'media') {
            const rawAudioBase64 = msg.media.payload;

            if (dgConnection && dgConnection.getReadyState() === 1 && !isSpeaking) {
                dgConnection.send(Buffer.from(rawAudioBase64, 'base64'));
            }
        }

        if (msg.event === 'stop') {
            console.log(`[WS] Stream stopped.`);
            if (dgConnection) dgConnection.requestClose();
            // Adam telefonu kapatınca hafıza otomatik silinir, dert yok.
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[SERVER] Traffic router is listening on port ${PORT}.`);
});