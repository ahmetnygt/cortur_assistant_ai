const axios = require('axios');

// .env dosyasından ayarları çekiyoruz ve sondaki gereksiz slash'ı (varsa) kesip atıyoruz
const API_BASE = (process.env.OBUS_API_URL || "").replace(/\/$/, "");
const BASIC_AUTH = process.env.OBUS_BASIC_AUTH;
const IP_ADDRESS = process.env.OBUS_IP_ADDRESS || "127.0.0.1";
const PORT = process.env.OBUS_PORT || "5117";
const PARTNER_CODE = process.env.OBUS_PARTNER_CODE;

let currentSession = { sessionId: null, deviceId: null };
let cachedStations = null;

async function getSession() {
    try {
        const payload = {
            type: 1,
            connection: { "ip-address": IP_ADDRESS, "port": PORT },
            browser: { name: "Chrome" }
        };

        const res = await axios.post(`${API_BASE}/client/getsession`, payload, {
            headers: { 'Content-Type': 'application/json', 'Authorization': BASIC_AUTH }
        });

        if (res.data && res.data.data) {
            currentSession.sessionId = res.data.data['session-id'];
            currentSession.deviceId = res.data.data['device-id'];
            console.log("✅ [API] oBus Session cillop gibi alındı.");
            return true;
        }
        return false;
    } catch (err) {
        console.error(`❌ [API] Session alırken sıçtık: ${err.message}`);
        return false;
    }
}

async function obusRequest(endpoint, data = null, isRetry = false) {
    if (!currentSession.sessionId) await getSession();

    const payload = {
        data: data,
        "device-session": { "session-id": currentSession.sessionId, "device-id": currentSession.deviceId },
        date: new Date().toISOString(),
        language: "tr-TR"
    };

    try {
        const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
        const finalUrl = `${API_BASE}${cleanEndpoint}`;

        const res = await axios.post(finalUrl, payload, {
            headers: { 'Content-Type': 'application/json', 'Authorization': BASIC_AUTH, 'PartnerCode': PARTNER_CODE }
        });

        if (res.data && (res.data.status === 'InvalidSession' || res.data.status === 'Error') && !isRetry) {
            console.log("⚠️ [API] Obüs session geçersiz dedi, sike sike baştan alıyoruz...");
            currentSession.sessionId = null;
            await getSession();
            return await obusRequest(endpoint, data, true);
        }

        return res.data;
    } catch (err) {
        const isAuthError = err.response && (err.response.status === 401 || err.response.status === 403 || err.response.status === 400);
        if (isAuthError && !isRetry) {
            console.log("⚠️ [API] Token/Session bayatlamış, yenilenip tekrar deneniyor...");
            currentSession.sessionId = null;
            await getSession();
            return await obusRequest(endpoint, data, true);
        }
        // BURASI DEĞİŞTİ: Axios patlarsa sunucunun döndüğü asıl hatayı basacak
        console.error(`🔥 [API] ${endpoint} isteği fena gümledi:`, err.response ? JSON.stringify(err.response.data, null, 2) : err.message);
        throw err;
    }
}

// ==========================================
// YARDIMCI FONKSİYON: ŞEHİR İSMİNDEN DİNAMİK ID BULMA
// ==========================================
async function getStationId(cityName) {
    if (!cachedStations) {
        console.log("⏳ [API] Duraklar ilk defa çekiliyor...");
        try {
            const res = await obusRequest('web/getstations');
            if (res && res.data) {
                cachedStations = res.data;
                console.log(`✅ [API] ${cachedStations.length} adet durak hafızaya kazındı.`);
            } else {
                throw new Error("API durakları boş döndü amk.");
            }
        } catch (error) {
            console.error("❌ [API] Durakları çekerken patladık:", error.message);
            return null;
        }
    }

    const aranan = cityName.toLowerCase().trim();
    const durak = cachedStations.find(s => {
        const ad = (s.name || s['station-name'] || s.Name || "").toLowerCase();
        return ad.includes(aranan) || ad === aranan;
    });

    return durak ? (durak.id || durak.Id || durak['station-id']) : null;
}

// ==========================================
// BUSE'NİN LLM ALET ÇANTASI (TOOLS) FONKSİYONLARI
// ==========================================

async function checkBusSchedule(departureCity, destinationCity, date) {
    try {
        console.log(`[API] GERÇEK SORGULAMA: ${departureCity} -> ${destinationCity} | Tarih: ${date}`);

        const originId = await getStationId(departureCity);
        const destinationId = await getStationId(destinationCity);

        if (!originId || !destinationId) {
            return `Sistemimizde ${departureCity} veya ${destinationCity} için bir durak bulunamadı. Lütfen kontrol edip tekrar sorun.`;
        }

        const data = {
            "origin": originId,
            "destination": destinationId,
            "from": `${date}T00:00:00.000Z`,
            "to": `${date}T23:59:59.000Z`
        };

        const res = await obusRequest('web/getjourneys', data);

        if (res && res.data && res.data.length > 0) {
            const bosSeferler = res.data.filter(j => j['available-seat-count'] > 0).slice(0, 3);

            if (bosSeferler.length === 0) {
                return `Maalesef ${date} tarihinde bu güzergah için seferlerimizin tamamı doludur.`;
            }

            let seferDetaylari = [];

            // AHA BURASI: Seferleri bulur bulmaz içine girip peşin peşin boş koltuk arıyoruz
            for (const j of bosSeferler) {
                const seatsRes = await obusRequest('web/getjourneyseats', j.id);
                let selectedSeat = null;

                if (seatsRes && seatsRes.data && seatsRes.data.seats && seatsRes.data.seats.cells) {
                    const available = seatsRes.data.seats.cells.filter(c =>
                        (c.type === 'Available' || c.type === 'AvailableM') && c.seat > 0
                    );
                    if (available.length > 0) {
                        selectedSeat = available[0].seat;
                    }
                }

                // Sadece gerçekten cinsiyete uygun boş koltuğu olan seferleri listeye ekliyoruz
                if (selectedSeat) {
                    const originStop = j.route.find(r => r.id === originId) || j.route[0];
                    let saat = "Bilinmiyor";
                    if (originStop && originStop.time) {
                        saat = new Date(originStop.time).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
                    }
                    const fiyat = j.price ? (j.price.internet || j.price.original) : "Bilinmiyor";

                    seferDetaylari.push(`Saat: ${saat}, Fiyat: ${fiyat} TL, Sefer_ID: ${j.id}, Koltuk_No: ${selectedSeat}`);
                }
            }

            if (seferDetaylari.length === 0) {
                return `Maalesef ${date} tarihinde uygun boş koltuk kalmamıştır.`;
            }

            return `Şu seferleri buldum: ${seferDetaylari.join(" | ")}. Müşteriye SAAT ve FİYATLARI oku, ama 'Sefer_ID' ve 'Koltuk_No' değerlerini KESİNLİKLE müşteriye SÖYLEME! Hafızanda tut.`;
        } else {
            return `Maalesef ${date} tarihinde bu güzergah için boş seferimiz yok.`;
        }
    } catch (error) {
        console.error("[API ERROR] Sefer çekerken sıçtık:", error.message);
        return "Şu anda ana bilgisayara bağlanamıyorum, seferleri göremiyorum.";
    }
}

async function makeReservation(journeyId, koltukNo, fiyat, name, surname, phone, govId) {
    try {
        console.log(`[API] REZERVASYON BAŞLIYOR: Journey: ${journeyId} | Koltuk: ${koltukNo} | Fiyat: ${fiyat} | Yolcu: ${name} ${surname} - ${phone} - TC: ${govId}`);

        const preparePassengers = [{
            "gender": true,
            "seat-number": parseInt(koltukNo),
            "price": parseFloat(fiyat), // <-- SIFIR YERİNE GERÇEK FİYAT
            "name": name,
            "surname": surname,
            "full-name": `${name} ${surname}`
        }];

        const prepRes = await obusRequest('web/PrepareOrder', { "journey-id": journeyId, "passengers": preparePassengers });
        console.log("\n[API DEBUG] PrepareOrder Yanıtı:\n", JSON.stringify(prepRes, null, 2));

        // AHA BURASI: Sadece "success" false gelirse hata ver diyoruz
        if (!prepRes || prepRes.success === false || !prepRes.data) {
            const hataMesaji = prepRes ? (prepRes['user-message'] || prepRes.message) : 'Bilinmiyor';
            return `Sistem şu an bu sefere bilet kesemiyor. API Hatası: ${hataMesaji}. Müşteriden özür dile.`;
        }

        // Dedektiflik yapıp sipariş kodunu buluyoruz (bazen pos-order içinde, bazen direkt order-code olarak gelir)
        let orderCode = null;
        if (prepRes.data['pos-order'] && prepRes.data['pos-order'].code) {
            orderCode = prepRes.data['pos-order'].code;
        } else if (prepRes.data['order-code']) {
            orderCode = prepRes.data['order-code'];
        }

        // ... (yukarısı aynı, orderCode'u bulduğumuz yer)
        if (!orderCode) {
            return "Sistem bilet kesemedi. Obüs API'si sipariş kodu (PNR) döndürmedi amk. Müşteriden özür dile.";
        }

        // AHA 1. DÜZELTME: PrepareOrder'dan dönen yolcu ID'sini yakalıyoruz
        let passengerId = null;
        if (prepRes.data.passengers && prepRes.data.passengers.length > 0) {
            passengerId = prepRes.data.passengers[0].id;
        }

        const reservationPassengers = [{
            "id": passengerId,
            "first-name": name,
            "last-name": surname,
            "full-name": `${name} ${surname}`,
            "email": "bilet@cortur.com",
            "phone": phone,
            "gender": true,
            "pnr-code": null,
            "price": parseFloat(fiyat),
            "nationality": "TR",
            "passenger-type": 1,
            "seat-number": parseInt(koltukNo),
            "gov-id": govId, // <-- 11111111111 YERİNE DEĞİŞKENİ KOYDUK
            "service-id": null
        }];

        const resRes = await obusRequest('web/Reservation', {
            "journey-id": journeyId,
            "order-code": orderCode,
            "passengers": reservationPassengers
        });

        console.log("\n[API DEBUG] Reservation Yanıtı:\n", JSON.stringify(resRes, null, 2));

        // AHA 2. DÜZELTME: İkinci adımda (Reservation) hata çıkarsa Buse'yi uyarıyoruz, yalan söylemesini engelliyoruz
        if (!resRes || resRes.success === false) {
            const hataMesaji = resRes ? (resRes['user-message'] || resRes.message) : 'Bilinmeyen hata';
            return `Sistem ikinci aşamada (Satın Alma) hata verdi. API Hatası: ${hataMesaji}. Müşteriden özür dile.`;
        }

        const pnr = (resRes.data && resRes.data.pnr) ? resRes.data.pnr : orderCode;

        return `Rezervasyon tamamlandı! Koltuk No: ${koltukNo}, PNR Kodunuz: ${pnr}. Müşteriye PNR ve koltuk numarasını ilet, telefonu kapatmadan önce başka isteği var mı sor.`;
    } catch (error) {
        console.error("[API ERROR] Rezervasyon Catch Bloğunda Patladı:", error.message);
        return "Rezervasyon sırasında veritabanında bir hata oluştu, müşteriden özür dile.";
    }
}

module.exports = { checkBusSchedule, makeReservation };