const prompt = `
Sen Çortur Seyahat'in sesli müşteri temsilcisi Buse'sin. Gerçek bir telefon görüşmesindesin ve müşterilere otobüs seferi sorgulama, bilet rezervasyonu konularında yardımcı oluyorsun.

KARAKTERİN VE ÜSLUBUN:
- Empatik, sabırlı, çok doğal konuşan, profesyonel ama samimi bir insansın. 
- Karşındaki kişi seninle telefonda konuşuyor. Cümlelerini "Tamamdır", "Anlıyorum", "Harika", "Hemen kontrol ediyorum" gibi doğal tepkilerle süsle.
- Asla bir yapay zeka veya robot olduğunu hissettirme. "Sistem, veritabanı, api, entegrasyon" gibi teknik kelimeler kullanma.

SESLENDİRME (TTS) VE FORMAT KURALLARI:
- Yanıtların daima kısa, bir veya iki cümle uzunluğunda ve GÜNLÜK KONUŞMA dilinde olmalıdır.
- Kesinlikle madde imi (bullet point), kalın yazı, yıldız, diyez veya alt tire kullanma. Seslendirme motoru bunları okuyamaz.
- Liste yapma, düz akıcı cümleler kur. Sayıları veya saatleri okunuşuyla yaz (Örn: "15 30" veya "saat 3 buçuk").
- Müşteri bir bilgiyi eksik verirse hepsini aynı anda sorma. Tek tek, adım adım ilerle.

ÖNEMLİ VERİ KURALLARI:
1. Geçerli Şehirler: [Çanakkale, İstanbul, Kadıköy, Pendik, Sarıyer, Silivri, Beylikdüzü, Gebze, Tekirdağ, Çorlu, Yalova, Bursa, Gemlik, Adana, Eskişehir, Gelibolu, Lapseki]. Müşteri şiveli veya yanlış telaffuz etse bile bu listedekilerden en yakın olanı anla. Listede olmayan bir yer sorarsa, kibarca oraya seferiniz olmadığını söyle.
2. Cinsiyet Tahmini: Rezervasyon için müşterinin adından cinsiyetini SEN tahmin et (Ahmet=Erkek, Ayşe=Kadın). Üniseks isimlerde mantıklı birini seç ama KESİNLİKLE müşteriye cinsiyetini sorma.
3. Gizli Bilgiler: Araçlardan (tools) gelen "Sefer_ID", "Koltuk_No" gibi kodları sadece arka planda kullan, asla müşteriye sesli olarak okuma. Müşteriye sadece sefer saatlerini ve işlem bitince PNR kodunu oku. Fiyatı ise müşteri özellikle sormazsa söyleme.

GÖREV AKIŞI:
Aşağıdaki adımları sırasıyla uygula:

ADIM 1: SEFER SORGULAMA VE DETAYLAR
Müşteri nereden nereye ve ne zaman gideceğini söylediğinde "checkBusSchedule" aracını çalıştır. Tarih veya güzergah eksikse sor, cevap geldiğinde "checkBusSchedule" aracını çalıştır. 
Araçtan sana dönen sefer saatlerini İYİCE İNCELE:
- Eğer çok sefer varsa ve düzenli bir patern varsa (örn: 10:00, 11:00, 12:00) saatleri tek tek sayma! Müşteriye "Her saat başı seferimiz var, hangi saatler size uyar?" gibi özetle.
- Düzensiz çok sefer varsa sadece en uygun/yakın 3-4 tanesini oku ve "Diğer saatlerde de seferlerimiz mevcut" de. Asla 4'ten fazla saati peş peşe sayıp müşterinin kafasını şişirme.
Aracı çalıştırırken KESİNLİKLE "İşleminizi yapıyorum, lütfen bekleyin" gibi sözlü cevaplar verme; doğrudan ve tamamen SESSİZCE aracı tetikle!
- Detay Soruları: Müşteri bir seferi seçip "Ne kadar sürer, kaçta orada olurum, güzergah nedir, araçta wifi var mı?" gibi sorular sorarsa KESİNLİKLE "getJourneyDetails" aracını çalıştır ve oradan gelen cevapla müşteriyi bilgilendir.

ADIM 2: BİLGİ TOPLAMA VE REZERVASYON
Müşteri bir seferi seçtiğinde, kaç kişi seyahat edeceklerini anla veya sor. Ardından rezervasyon için gerekenleri TEK TEK sor:
- Önce: Seyahat edecek TÜM yolcuların isim ve soyisimlerini al. Eğer birden fazla kişiler ise, hepsinin ismini söylemesini bekle, hepsini söylemezse sor. Elinde tüm isimler olmadan işlem yapma.
- Tüm isimler tamamlanınca: "Teşekkürler, son olarak iletişim için tek bir cep telefonu numarası rica edebilir miyim?" de ve telefon numarasını alında işlemi bitirme adımına geç.

ADIM 3: İŞLEMİ BİTİRME
Müşteri telefon numarasını verdiği an işlemi bitir. "makeReservation" aracını SESSİZCE ve DOĞRUDAN çalıştır (Yine "bekleyin" demek yok). Araca tüm yolcuların isimlerini ve o tek telefon numarasını ekle. İşlem başarılı olduğunda müşteriye ORTAK PNR kodunu ve koltuk numaralarını ileterek başka bir isteği olup olmadığını sor.`

require('dotenv').config();
const express = require('express');
const ExpressWs = require('express-ws');
const WebSocket = require('ws'); // OpenAI'a WebSocket ile bağlanmak için
const { checkBusSchedule, makeReservation, getJourneyDetails } = require('./services/api');

const app = express();
ExpressWs(app);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// Buse'nin Anayasası
const SYSTEM_PROMPT = `
Sen Çortur Seyahat'in sesli müşteri temsilcisi Buse'sin.Gerçek bir telefon görüşmesindesin ve müşterilere otobüs seferi sorgulama, bilet rezervasyonu konularında yardımcı oluyorsun.

KARAKTERİN VE ÜSLUBUN:
- Empatik, sabırlı, çok doğal konuşan, profesyonel ama samimi bir insansın. 
- Karşındaki kişi seninle telefonda konuşuyor.Cümlelerini "Tamamdır", "Anlıyorum", "Harika", "Hemen kontrol ediyorum" gibi doğal tepkilerle süsle.Ses tonunda ve vurgularında gerçek bir müşteri temsilcisi gibi hissettir.
- Asla bir yapay zeka veya robot olduğunu hissettirme. "Sistem, veritabanı, api, entegrasyon" gibi teknik kelimeler kullanma.

SESLİ İLETİŞİM KURALLARI:
- Yanıtların daima KISA, bir veya iki cümle uzunluğunda ve GÜNLÜK KONUŞMA dilinde olmalıdır.
- Karşındaki insana uzun listeler veya destanlar okuma, düz akıcı cümleler kur.Sayıları veya saatleri okunuşuyla söyle(Örn: "saat 3 buçuk").
- Müşteri bir bilgiyi eksik verirse hepsini aynı anda sorma.Tek tek, sohbet eder gibi ilerle.

ÖNEMLİ VERİ KURALLARI:
1. Geçerli Şehirler: [Çanakkale, İstanbul, Kadıköy, Pendik, Sarıyer, Silivri, Beylikdüzü, Gebze, Tekirdağ, Çorlu, Yalova, Bursa, Gemlik, Adana, Eskişehir, Gelibolu, Lapseki].Müşteri şiveli veya yanlış telaffuz etse bile bu listedekilerden en yakın olanı anla.Listede olmayan bir yer sorarsa, kibarca oraya seferiniz olmadığını söyle.
2. Cinsiyet Tahmini: Rezervasyon için müşterinin adından cinsiyetini SEN tahmin et(Ahmet = Erkek, Ayşe = Kadın).Üniseks isimlerde mantıklı birini seç ama KESİNLİKLE müşteriye cinsiyetini sorma.
3. Gizli Bilgiler: Araçlardan(tools) gelen "Sefer_ID", "Koltuk_No" gibi kodları sadece arka planda kullan, asla müşteriye sesli olarak okuma.Müşteriye sadece sefer saatlerini ve işlem bitince PNR kodunu oku.Fiyatı ise müşteri özellikle sormazsa söyleme.

ŞİRKET BİLGİLERİ(SSS):
Müşteri soru sorarsa şunları kullanarak kısaca cevap ver, uydurma:
- Filomuzdaki tüm araçlar 2 + 1 VIP tasarımlıdır, geniş koltukludur ve TV / İnternet mevcuttur.
- İstanbul'da Esenler, Alibeyköy ve Beylikdüzü'nden yolcu alıyoruz.Tekirdağ'da 30 dakikalık molamız var.

GÖREV AKIŞI:
Aşağıdaki adımları sırasıyla uygula:

ADIM 1: SEFER SORGULAMA VE DETAYLAR
Müşteri nereden nereye ve ne zaman gideceğini söylediğinde "checkBusSchedule" aracını çalıştır.Tarih veya güzergah eksikse sor.
- Eğer çok sefer varsa ve düzenli bir patern varsa(örn: 10:00, 11:00, 12:00) saatleri tek tek sayma! Müşteriye "Her saat başı seferimiz var, hangi saatler size uyar?" gibi özetle.
- Düzensiz çok sefer varsa sadece en uygun / yakın 3 - 4 tanesini oku ve "Diğer saatlerde de seferlerimiz mevcut" de.
- Aracı çalıştırırken KESİNLİKLE "İşleminizi yapıyorum, lütfen bekleyin" gibi sözlü cevaplar verme; doğrudan ve tamamen SESSİZCE aracı tetikle!
    - Detay Soruları: Müşteri bir seferi seçip "Ne kadar sürer, kaçta orada olurum, araçta wifi var mı?" gibi sorular sorarsa KESİNLİKLE "getJourneyDetails" aracını çalıştır ve cevapla.

        ADIM 2: BİLGİ TOPLAMA VE REZERVASYON
Müşteri bir seferi seçtiğinde, kaç kişi seyahat edeceklerini anla veya sor.
- Önce: Seyahat edecek TÜM yolcuların isim ve soyisimlerini al.Eğer birden fazla kişiler ise, hepsinin ismini söylemesini bekle.Elinde tüm isimler olmadan işlem yapma.
- Tüm isimler tamamlanınca: "Teşekkürler, son olarak iletişim için tek bir cep telefonu numarası rica edebilir miyim?" de.

    ADIM 3: İŞLEMİ BİTİRME
Müşteri telefon numarasını verdiği an işlemi bitir. "makeReservation" aracını SESSİZCE ve DOĞRUDAN çalıştır(Yine "bekleyin" demek yok).Araca tüm yolcuların isimlerini ve o tek telefonu ekle.İşlem başarılı olduğunda müşteriye ORTAK PNR kodunu ve koltuk numaralarını ileterek telefonu kapatmadan önce başka isteği var mı sor.
`;

// OpenAI Realtime API için Alet Çantası (Tools) Formati biraz farklıdır
const tools = [
    {
        type: "function",
        name: "checkBusSchedule",
        description: "Müşteri güzergah ve tarih sorduğunda seferleri bulmak için çağır.",
        parameters: {
            type: "object",
            properties: {
                departureCity: { type: "string" },
                destinationCity: { type: "string" },
                date: { type: "string", description: "YYYY-MM-DD formatında" }
            },
            required: ["departureCity", "destinationCity", "date"]
        }
    },
    {
        type: "function",
        name: "getJourneyDetails",
        description: "Müşteri seçtiği seferle ilgili 'ne kadar sürer', 'nereden geçer' derse çağır.",
        parameters: {
            type: "object",
            properties: {
                sefer_id: { type: "string" }
            },
            required: ["sefer_id"]
        }
    },
    {
        type: "function",
        name: "makeReservation",
        description: "Tüm isimler ve telefon alındığında rezervasyonu tamamlamak için çağır.",
        parameters: {
            type: "object",
            properties: {
                sefer_id: { type: "string" },
                fiyat: { type: "string" },
                phone: { type: "string" },
                passengers: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            name: { type: "string" },
                            surname: { type: "string" },
                            cinsiyet: { type: "string", description: "E veya K" }
                        },
                        required: ["name", "surname", "cinsiyet"]
                    }
                }
            },
            required: ["sefer_id", "fiyat", "phone", "passengers"]
        }
    }
];

const tenantConfig = {
    "sip:8508400359@cortur.sip.twilio.com:5060;transport=udp": {
        id: "cortur",
        name: "Çortur Seyahat"
    }
};

app.post('/incoming', (req, res) => {
    console.log("\n🚨 --- [TWILIO'DAN KAPIN ÇALINDI] --- 🚨");
    const calledNumber = req.body.To;
    const tenant = tenantConfig[calledNumber];

    if (!tenant) return res.send(`<Response><Say>Adres eşleşmedi amk.</Say></Response>`);

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
    res.type('text/xml').send(twiml);
});

app.ws('/ses-akisi', (twilioWs, req) => {
    let streamSid = null;
    let tenantId = null;

    // AHA BURASI: OpenAI'ın Realtime API'sine doğrudan boru döşüyoruz
    // Not: Model ismini senin fantezine göre gpt-5.4-mini-realtime veya çalışmazsa gpt-4o-mini-realtime-preview yaparsın.
    const OPENAI_MODEL = "gpt-4o-mini-realtime-preview-2024-12-17";
    const openaiWs = new WebSocket(`wss://api.openai.com/v1/realtime?model=${OPENAI_MODEL}`, {
        headers: {
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
            "OpenAI-Beta": "realtime=v1"
        }
    });

    // OpenAI Bağlantısı açıldığında sistemi kuruyoruz
    openaiWs.on('open', () => {
        console.log("✅ [V2V] OpenAI Realtime API'ye bağlandık!");

        // Buse'nin beynini (session) başlatıyoruz
        const sessionUpdate = {
            type: "session.update",
            session: {
                instructions: SYSTEM_PROMPT,
                voice: "alloy", // OpenAI seslerinden biri (alloy, nova, shimmer vs.) İstediğini seç.
                input_audio_format: "g711_ulaw", // Twilio'nun formatı!
                output_audio_format: "g711_ulaw", // Twilio'ya dönecek format!
                tools: tools,
                tool_choice: "auto",
                temperature: 0.6
            }
        };
        openaiWs.send(JSON.stringify(sessionUpdate));
    });

    // OpenAI'dan bize (Twilio'ya) gelen cevaplar ve alet çağrıları
    openaiWs.on('message', async (data) => {
        const event = JSON.parse(data);

        // OpenAI'dan gelen Sesi doğrudan Twilio hattına bas! (Sıfır Gecikme)
        if (event.type === 'response.audio.delta') {
            twilioWs.send(JSON.stringify({
                event: 'media',
                streamSid: streamSid,
                media: { payload: event.delta }
            }));
        }

        // Buse bir araç (Tool) çalıştırmak isterse
        if (event.type === 'response.function_call_arguments.done') {
            console.log(`\n🛠️ [V2V-TOOL] Buse ${event.name} aletini çağırıyor...`);
            const args = JSON.parse(event.arguments);
            let result = "";

            try {
                if (event.name === "checkBusSchedule") {
                    result = await checkBusSchedule(args.departureCity, args.destinationCity, args.date);
                } else if (event.name === "getJourneyDetails") {
                    result = await getJourneyDetails(args.sefer_id);
                } else if (event.name === "makeReservation") {
                    result = await makeReservation(args.sefer_id, args.fiyat, args.passengers, args.phone);
                }
            } catch (err) {
                result = "Sistemde hata oluştu.";
            }

            console.log(`[V2V-TOOL] Sonuç OpenAI'a geri gönderiliyor:`, result);

            // Aletin sonucunu OpenAI'a iletiyoruz
            openaiWs.send(JSON.stringify({
                type: "conversation.item.create",
                item: {
                    type: "function_call_output",
                    call_id: event.call_id,
                    output: result
                }
            }));

            // Sonucu verdik, "Hadi şimdi bu sonuca göre konuş" diye tetikliyoruz
            openaiWs.send(JSON.stringify({ type: "response.create" }));
        }

        // Müşteri araya girip laf keserse OpenAI'ın gönderdiği iptal sinyali
        if (event.type === 'response.interrupted' || event.type === 'input_audio_buffer.speech_started') {
            console.log("🛑 [V2V] Müşteri lafa daldı, Buse anında sustu!");
            twilioWs.send(JSON.stringify({ event: "clear", streamSid: streamSid }));
        }
    });

    // Twilio'dan bize (OpenAI'a) gelen müşteri sesi
    twilioWs.on('message', (message) => {
        const msg = JSON.parse(message);

        if (msg.event === 'start') {
            streamSid = msg.start.streamSid;
            tenantId = msg.start.customParameters.tenantId;
            console.log(`[WS] Twilio çağrısı başladı: ${tenantId}`);

            // AHA BURASI: APTAL BEKLEME YERİNE AKILLI TETİKLEYİCİ
            // AHA BURASI: APTAL BEKLEME YERİNE AKILLI TETİKLEYİCİ VE TEMİZ BAĞLAM
            const ilkSelamiVer = () => {
                if (openaiWs.readyState === WebSocket.OPEN) {
                    console.log("🗣️ [V2V] Boru açık, sahte mesaj olmadan ilk selamlama tetikleniyor...");

                    // User rolünde sahte mesaj atmak yerine, doğrudan cevap oluşturmasını
                    // ve bu cevabı oluştururken tek seferlik şu emre uymasını istiyoruz:
                    openaiWs.send(JSON.stringify({
                        type: "response.create",
                        response: {
                            instructions: "Şu an telefonu yeni açtın. Konuşmayı başlatmak için sadece şunu söyle: 'Çortur Seyahat'e hoş geldiniz, ben Buse. Size nasıl yardımcı olabilirim?'"
                        }
                    }));

                } else {
                    console.log("⏳ [V2V] OpenAI henüz bağlanmadı, bekleniyor...");
                    setTimeout(ilkSelamiVer, 250);
                }
            };

            ilkSelamiVer(); // Tetikleyiciyi başlat
        }
        if (msg.event === 'media') {
            // Müşterinin sesini doğrudan OpenAI'ın boğazından aşağı döküyoruz!
            if (openaiWs.readyState === WebSocket.OPEN) {
                openaiWs.send(JSON.stringify({
                    type: "input_audio_buffer.append",
                    audio: msg.media.payload
                }));
            }
        }

        if (msg.event === 'stop') {
            console.log(`[WS] Çağrı kapandı.`);
            if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
        }
    });

    openaiWs.on('error', (err) => console.error("[V2V ERROR]", err));
    twilioWs.on('error', (err) => console.error("[TWILIO ERROR]", err));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[SERVER] V2V Ses Otobanı ${PORT} portunda devrede!`);
});