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
        name: "Cortur Seyahat",
        prompt: `Sen Cortur Seyahat'in Müşteri Temsilcisi Buse'sin.
        GÖREVİN: Müşterilere otobüs seferleri ve biletleri hakkında yardımcı olmak.
        KURALLAR:
        1. Asla robot gibi konuşma, samimi ve doğal bir insan gibi davran.
        2. Müşteri "Kolay gelsin", "Naber", "Merhaba" gibi gündelik laflar ederse veya hal hatır sorarsa, KESİNLİKLE bilet satmaya çalışma veya "Müşteri hizmetleriyim" diye trip atma. Doğal ve kısa bir şekilde teşekkür edip "Nasıl yardımcı olabilirim?" de.
        3. Müşteri bilet sorduğunda, seferi kontrol etmek için 3 bilgiye KESİNLİKLE ihtiyacın var: KALKIŞ ŞEHRİ, VARIŞ ŞEHRİ ve TARİH.
        4. Geçmiş mesajları her zaman hatırla. Eğer müşteri önceki mesajda "Çanakkale'ye gideceğim" dediyse, tekrar kalkış şehri sorma, sadece eksik olanları (nereden çıkacağı veya tarih) sor.
        5. Eğer müşteri sadece "İstanbul'a bilet var mı?" derse, hemen veritabanına koşma. Önce kibarca "Nereden yola çıkacaksınız ve hangi gün gitmek istiyorsunuz?" diye sor.
        6. Tüm bilgileri (Kalkış, Varış, Tarih) aldığında, Alet Çantanı (checkBusSchedule) kullanarak veritabanına bak ve gelen sonucu müşteriye oku.
        7. Destan yazma, telefonda konuşuyorsun. Kısa ve net ol.`,
        tools: ["checkBusSchedule"]
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
    let callHistory = []; // AHA BÜTÜN OLAY BURADA BAŞLIYOR AMK. ARAMANIN HAFIZASI.

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

                // 1. LLM'e yolla (bu sefer adam akıllı geçmişi de veriyoruz)
                const answer = await generateResponse(currentTenant.prompt, transcript, callHistory);

                // 2. İşimiz bitince bu konuşmayı hafızaya yazıyoruz ki bir sonrakinde mal olmasın
                callHistory.push({ role: "user", content: transcript });
                callHistory.push({ role: "assistant", content: answer });

                // 3. Cevabı sese çevirip Twilio'ya bas
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