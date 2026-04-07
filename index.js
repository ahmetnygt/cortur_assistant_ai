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

const tenantConfig = {
    "sip:8508400359@cortur.sip.twilio.com:5060;transport=udp": {
        id: "cortur",
        name: "Çortur Seyahat",
        prompt: `# ROL VE KİMLİK
Sen Çortur Seyahat'in telefon kanalında hizmet veren sesli müşteri temsilcisi Buse'sin. 
Karakterin: Profesyonel, kibar, çözüm odaklı ve hızlı.
Format: Telefon görüşmesinde olduğun için yanıtların her zaman KISA, NET ve GÜNLÜK KONUŞMA DİLİNDE olmalıdır. Liste (bullet point), kalın yazı veya uzun paragraflar kullanmak kesinlikle yasaktır. 

# GİZLİLİK VE HAFIZA
- Gizli Veriler: Araçlardan (tools) dönen 'Sefer_ID' gibi teknik kodları sadece sistemde kullan, müşteriye asla okuma.
- Hafıza: Müşteri aynı güzergahı ve tarihi tekrar sorarsa aracı (tool) yeniden çalıştırma, önceki sorgunun sonucunu doğrudan ilet.

# VERİ İŞLEME KURALLARI (STT DÜZELTMELERİ)
- Şehir Eşleştirme: Müşteriden gelen bozuk veya şiveli şehir isimlerini şu geçerli lokasyonlara göre algıla ve eşleştir: [Çanakkale, İstanbul, Kadıköy, Pendik, Sarıyer, Silivri, Beylikdüzü, Gebze, Tekirdağ, Çorlu, Yalova, Bursa, Gemlik, Adana, Eskişehir, Gelibolu, Lapseki].
- TC Kimlik Algılama: Müşteriler TC kimlik numaralarını yazıyla (örn: "yüz doksan iki") veya boşluklu gruplar halinde söyleyebilir. Müşteriden numarayı "tek tek okumasını" İSTEME. Gelen metni kendi zihninde birleştir, boşlukları sil ve geçerli 11 haneli bir sayıya çevir.

# GÖREV AKIŞI
Aşağıdaki adımları sırayla, her mesajda yalnızca bir adım ilerleyerek uygula:

[ADIM 1: SORGULAMA]
Müşteriden KALKIŞ, VARIŞ ve TARİH (Bugün/Yarın) bilgilerini al. Bilgiler tamsa anında 'checkBusSchedule' aracını çalıştır.

[ADIM 2: BİLGİ TOPLAMA]
Müşteri seferi seçtiğinde, bilet kesmek için gereken bilgileri TEK TEK sor. Hepsini aynı anda isteme.
1. Sadece "İşleminiz için adınızı ve soyadınızı alabilir miyim?" de ve bekle.
2. Ad soyad gelince, sadece "Teşekkürler, cep telefonu numaranızı rica edebilir miyim?" de ve bekle.
3. Telefon gelince, sadece "Son olarak, biletiniz için T.C. Kimlik numaranızı alabilir miyim?" de ve bekle.

[ADIM 3: REZERVASYONU TAMAMLAMA]
Müşteri Ad, Soyad, Telefon ve 11 Haneli TC bilgisini eksiksiz verdiği an, "İşleminizi yapıyorum, lütfen bekleyin" gibi hiçbir laf kalabalığı yapmadan DOĞRUDAN 'makeReservation' aracını çalıştır.`}
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
    let sessionState = { lastSchedules: null }; // AHA! RAM HAFIZAMIZ BURADA BAŞLIYOR

    ws.on('message', async (message) => {
        const msg = JSON.parse(message);

        if (msg.event === 'start') {
            streamSid = msg.start.streamSid;
            tenantId = msg.start.customParameters.tenantId;
            const currentTenant = Object.values(tenantConfig).find(t => t.id === tenantId);

            console.log(`[WS] Stream started. Tenant: ${tenantId}`);

            dgConnection = startDeepgramService(tenantId, streamSid, async (transcript) => {
                if (isSpeaking) return;

                isSpeaking = true;

                // sessionState'i de fonksiyona yolluyoruz ki LLM içine yazıp çizebilsin
                const answer = await generateResponse(currentTenant.prompt, transcript, callHistory, sessionState);

                // AHA BURASI: Buse'nin tam lafını terminale basıyoruz
                console.log(`\n🤖 [BUSE - ${tenantId}]: ${answer}\n`);

                callHistory.push({ role: "user", content: transcript });
                callHistory.push({ role: "assistant", content: answer });

                await streamTextToSpeech(answer, streamSid, ws);

                isSpeaking = false;
            });

            // AHA BURASI: Buse'nin telefonu açar açmaz konuşmasını sağlayan tetikleyici
            setTimeout(async () => {
                if (isSpeaking) return;
                isSpeaking = true;

                console.log(`\n🤖 [SİSTEM]: Telefon açıldı, Buse ilk selamlamayı yapıyor...`);

                // Buse'nin beynine gizli bir "Alo" yolluyoruz ki prompt'taki 1. kuralı (hoş geldiniz) çalıştırsın
                const ilkMesaj = "Alo";
                const answer = await generateResponse(currentTenant.prompt, ilkMesaj, callHistory, sessionState);

                console.log(`\n🤖 [BUSE - ${tenantId}]: ${answer}\n`);

                // İlk konuşmayı da hafızaya ekliyoruz ki Buse kendi dediğini unutmasın
                callHistory.push({ role: "user", content: ilkMesaj });
                callHistory.push({ role: "assistant", content: answer });

                await streamTextToSpeech(answer, streamSid, ws);
                isSpeaking = false;
            }, 600); // Bağlantının tam oturması için 600 milisaniye avans veriyoruz
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