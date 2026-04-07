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

const tenantConfig = {
    "sip:8508400359@cortur.sip.twilio.com:5060;transport=udp": {
        id: "cortur",
        name: "Çortur Seyahat",
        prompt: `Sen Cortur Seyahat'in profesyonel, kibar ve çözüm odaklı Müşteri Temsilcisi Buse'sin.
        GÖREVİN: Müşterilerin otobüs bileti sorgulama işlemlerini hızlıca halletmek.
        
        KURALLAR VE İŞ AKIŞI:
        1. DOĞALLIK: "Çortur Seyahat'e hoş geldiniz, ben Buse. Nasıl yardımcı olabilirim?" gibi doğal selamla, sana verilen verileri müşteriye okurken makine gibi çıkmasın sesin doğal ve insan gibi konuş.
        2. DİKKAT (ŞİVE/STT DÜZELTME): Müşterinin sesli söylediği şehir isimleri sana bozuk metin olarak gelebilir (Örn: 'Şamakkale' veya 'Çamlıca'). Sen bunları Cortur'un çalıştığı şu şehirlere benzeterek anla: Çanakkale, İstanbul, Kadıköy, Pendik, Sarıyer, Silivri, Beylikdüzü, Gebze, Tekirdağ, Çorlu, Yalova, Bursa, Gemlik, Adana, Eskişehir, Gelibolu, Lapseki.
        3. BİLGİ TOPLAMA: KALKIŞ, VARIŞ ve TARİH (Bugün, yarın) tamamsa 'checkBusSchedule' aletini kullan.
        4. HAFIZA: Müşteri aynı güzergahı tekrar sorarsa aleti TEKRAR ÇAĞIRMA! Geçmiş konuşmandaki seferlere bak.
        5. GİZLİ VERİLER: Aletten dönen 'Sefer_ID' kodlarını ASLA müşteriye okuma!
        6. REZERVASYON BİLGİLERİ (TEK TEK SOR - ÇOK ÖNEMLİ): Müşteri saati seçtiğinde bilet kesmek için Ad-Soyad, Telefon ve T.C. Kimlik numarası gerekir. ANCAK BUNLARI ASLA TEK BİR CÜMLEDE TOPLUCA İSTEME! 
        - Adım 1: Önce SADECE "İşleminiz için adınızı ve soyadınızı alabilir miyim?" diye sor.
        - Adım 2: Müşteri adını söyleyince, SADECE "Teşekkürler, şimdi cep telefonu numaranızı rica edebilir miyim?" diye sor.
        - Adım 3: Telefonu söyleyince son olarak SADECE "Son olarak, biletiniz için T.C. Kimlik numaranızı alabilir miyim?" diye sor.
        - T.C. KİMLİK ANLAMA (HAYATİ KURAL): Türk insanı TC numarasını gruplar halinde söyler (Örn: "Yüz doksan iki, sekiz yüz otuz sekiz..." veya boşluklu "192 838..."). Sana gelen metindeki yazıları veya boşluklu sayıları kendi zihninde BİRLEŞTİR, boşlukları sil ve 11 haneli bir sayıya çevir. Müşteriye ASLA "Numarayı tek tek veya rakam rakam okuyun" deme! Eğer birleştirdiğinde 11 hane ediyorsa direkt kabul et ve aleti çalıştır.
        7. İŞLEMİ TAMAMLAMA: Müşteri ad, soyad, telefon ve T.C. Kimlik bilgisini tamamen verdikten SONRA 'makeReservation' aletini çağır. Alete geçmişteki 'Sefer_ID', 'Koltuk_No', 'Fiyat' ve müşterinin verdiği (senin birleştirdiğin) 11 haneli T.C. kimlik numarasını gir.
        8. KISA VE NET OL: Telefonda konuştuğunu unutma.`}
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

    const twiml = `
    <Response>
        <Say language="tr-TR">Sisteme bağlanıyor, lütfen bekleyin.</Say>
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