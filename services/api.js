const axios = require('axios');

// .env dosyasından ayarları çekiyoruz ve sondaki gereksiz slash'ı (varsa) kesip atıyoruz
const API_BASE = (process.env.OBUS_API_URL || "").replace(/\/$/, "");
const BASIC_AUTH = process.env.OBUS_BASIC_AUTH;
const IP_ADDRESS = process.env.OBUS_IP_ADDRESS || "127.0.0.1";
const PORT = process.env.OBUS_PORT || "5117";
const PARTNER_CODE = process.env.OBUS_PARTNER_CODE;

let currentSession = { sessionId: null, deviceId: null };
let cachedStations = null;
let sessionLock = null; // AHA BURASI: Bizi ipten alacak Mutex (Kilit) değişkeni
const journeyCache = new Map();

async function getSession() {
    // Eğer kilit doluysa (zaten biri session almaya gittiyse), yeni istek atma, gidenin dönmesini bekle
    if (sessionLock) {
        console.log("⏳ [API] Başka bir çağrı session alıyor, kuyrukta bekleniyor...");
        return await sessionLock;
    }

    // Kimse gitmediyse kilidi kendimiz oluşturup API'ye gidiyoruz
    sessionLock = (async () => {
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
                console.log("✅ [API] oBus Session cillop gibi alındı ve kilit açıldı.");
                return true;
            }
            return false;
        } catch (err) {
            console.error(`❌ [API] Session alırken sıçtık: ${err.message}`);
            return false;
        } finally {
            sessionLock = null; // İş bitince kilidi kaldır ki sonradan gelenler girebilsin
        }
    })();

    return await sessionLock;
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
            // Eğer zaten başka bir işlem kilidi koyup yenilemeye başlamadıysa biz sıfırlayalım
            if (!sessionLock) {
                currentSession.sessionId = null;
            }
            await getSession();
            return await obusRequest(endpoint, data, true);
        }

        return res.data;
    } catch (err) {
        const isAuthError = err.response && (err.response.status === 401 || err.response.status === 403 || err.response.status === 400);
        if (isAuthError && !isRetry) {
            console.log("⚠️ [API] Token/Session bayatlamış, yenilenip tekrar deneniyor...");
            if (!sessionLock) {
                currentSession.sessionId = null;
            }
            await getSession();
            return await obusRequest(endpoint, data, true);
        }

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
            // SLICE İPTAL! Tüm boş seferleri alıyoruz
            const bosSeferler = res.data.filter(j => j['available-seat-count'] > 0);

            if (bosSeferler.length === 0) {
                return `Maalesef ${date} tarihinde bu güzergah için seferlerimizin tamamı doludur.`;
            }

            // DİKKAT: 20 sefere tek tek await atarsan müşteri yaşlanır. 
            // Hepsine aynı anda dalmak için Promise.all kullanıyoruz!
            const seferDetaylariHam = await Promise.all(bosSeferler.map(async (j) => {
                try {
                    // AHA BURASI: Çöp ev olmasın diye sifonu çekiyoruz. 200 seferden fazlası RAM'de durmasın.
                    if (journeyCache.size > 200) {
                        console.log("🧹 [API] RAM Zulası (Cache) doldu, sifon çekiliyor...");
                        journeyCache.clear();
                    }

                    // API'den gelen koca JSON objesini doğrudan RAM'e çakıyoruz
                    journeyCache.set(j.id, j);

                    const seatsRes = await obusRequest('web/getjourneyseats', j.id); let selectedSeat = null;

                    if (seatsRes && seatsRes.data && seatsRes.data.seats && seatsRes.data.seats.cells) {
                        const available = seatsRes.data.seats.cells.filter(c =>
                            (c.type === 'Available' || c.type === 'AvailableM') && c.seat > 0
                        );
                        if (available.length > 0) {
                            selectedSeat = available[0].seat;
                        }
                    }

                    if (selectedSeat) {
                        const originStop = j.route.find(r => r.id === originId) || j.route[0];
                        let saat = "Bilinmiyor";
                        if (originStop && originStop.time) {
                            saat = new Date(originStop.time).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
                        }
                        const fiyat = j.price ? (j.price.internet || j.price.original) : "Bilinmiyor";

                        // LLM'in midesini bulandırmamak için SADECE temel bilgiyi dönüyoruz
                        return `Saat: ${saat}, Fiyat: ${fiyat} TL, Sefer_ID: ${j.id}, Koltuk_No: ${selectedSeat}`;
                    }
                } catch (error) {
                    return null;
                }
                return null;
            }));

            // Null olanları (koltuk bulamadıklarımızı veya patlayanları) listeden söküp atıyoruz
            const seferDetaylari = seferDetaylariHam.filter(Boolean);

            if (seferDetaylari.length === 0) {
                return `Maalesef ${date} tarihinde uygun boş koltuk kalmamıştır.`;
            }

            // Yapay zekaya tüm listeyi verip aklını kullanmasını emrediyoruz
            return `Şu seferleri buldum: ${seferDetaylari.join(" | ")}.BİLGİ: Sana liste olarak verilen bu saatlere bak.Düzenli bir aralık varsa(örn: her saat başı) özetle.Düzensizse 3 - 4 tanesini say. 'Sefer_ID' ve 'Koltuk_No' değerlerini müşteriye ASLA SÖYLEME! Eğer müşteri güzergah, varış saati veya araç özellikleri hakkında detay sorarsa "getJourneyDetails" aracını kullan.`;
        } else {
            return `Maalesef ${date} tarihinde bu güzergah için boş seferimiz yok.`;
        }

    } catch (error) {
        console.error("[API ERROR] Sefer çekerken sıçtık:", error.message);
        return "Şu anda ana bilgisayara bağlanamıyorum, seferleri göremiyorum.";
    }
}

async function makeReservation(journeyId, fiyat, passengers, phone) {
    try {
        console.log(`[API] ÇOKLU REZERVASYON: Sefer ${journeyId} | Kişi: ${passengers.length} | Fiyat/Kişi: ${fiyat} | Tel: ${phone}`);

        // 1. Önce o seferin koltuk haritasını çekip boş koltukları buluyoruz
        const seatsRes = await obusRequest('web/getjourneyseats', journeyId);
        let availableSeats = [];
        if (seatsRes && seatsRes.data && seatsRes.data.seats && seatsRes.data.seats.cells) {
            availableSeats = seatsRes.data.seats.cells
                .filter(c => (c.type === 'Available' || c.type === 'AvailableM') && c.seat > 0)
                .map(c => c.seat);
        }

        // Eğer müşterinin istediği kadar boş koltuk yoksa LLM'i uyarıyoruz
        if (availableSeats.length < passengers.length) {
            return `Maalesef bu seferde yeterli boş koltuk yok. Sadece ${availableSeats.length} koltuk kalmış. Müşteriden özür dile ve başka saat seçmesini iste.`;
        }

        // 2. Yolcuları sırayla boş koltuklara oturtuyoruz
        const preparePassengers = passengers.map((p, index) => {
            const isMale = (p.cinsiyet === "E") ? true : false;
            return {
                "gender": isMale,
                "seat-number": availableSeats[index],
                "price": parseFloat(fiyat),
                "name": p.name,
                "surname": p.surname,
                "full-name": `${p.name} ${p.surname}`
            };
        });

        // 3. Siparişi Hazırla (PrepareOrder)
        const prepRes = await obusRequest('web/PrepareOrder', { "journey-id": journeyId, "passengers": preparePassengers });
        console.log("\n[API DEBUG] PrepareOrder Yanıtı:\n", JSON.stringify(prepRes, null, 2));

        if (!prepRes || prepRes.success === false || !prepRes.data) {
            const hataMesaji = prepRes ? (prepRes['user-message'] || prepRes.message) : 'Bilinmiyor';
            return `Sistem şu an bu sefere bilet kesemiyor. Hata: ${hataMesaji}. Müşteriden özür dile.`;
        }

        let orderCode = null;
        if (prepRes.data['pos-order'] && prepRes.data['pos-order'].code) {
            orderCode = prepRes.data['pos-order'].code;
        } else if (prepRes.data['order-code']) {
            orderCode = prepRes.data['order-code'];
        }

        if (!orderCode) {
            return "Sistem bilet kesemedi. Obüs sipariş kodu döndürmedi. Müşteriden özür dile.";
        }

        // 4. Kesin Satın Alma (Reservation)
        const reservationPassengers = passengers.map((p, index) => {
            const isMale = (p.cinsiyet === "E") ? true : false;
            // PrepareOrder'dan dönen gerçek yolcu ID'lerini eşleştiriyoruz
            const pId = prepRes.data.passengers && prepRes.data.passengers[index] ? prepRes.data.passengers[index].id : null;
            return {
                "id": pId,
                "first-name": p.name,
                "last-name": p.surname,
                "full-name": `${p.name} ${p.surname}`,
                "email": "bilet@cortur.com",
                "phone": phone, // Tek numarayı herkese basıyoruz
                "gender": isMale,
                "pnr-code": null,
                "price": parseFloat(fiyat),
                "nationality": "TR",
                "passenger-type": 1,
                "seat-number": availableSeats[index],
                "gov-id": null,
                "service-id": null
            };
        });

        const resRes = await obusRequest('web/Reservation', {
            "journey-id": journeyId,
            "order-code": orderCode,
            "passengers": reservationPassengers
        });

        console.log("\n[API DEBUG] Reservation Yanıtı:\n", JSON.stringify(resRes, null, 2));

        if (!resRes || resRes.success === false) {
            const hataMesaji = resRes ? (resRes['user-message'] || resRes.message) : 'Bilinmeyen hata';
            return `Sistem ikinci aşamada (Satın Alma) hata verdi. Hata: ${hataMesaji}. Müşteriden özür dile.`;
        }

        const pnr = (resRes.data && resRes.data.pnr) ? resRes.data.pnr : orderCode;
        const alinanKoltuklar = availableSeats.slice(0, passengers.length).join(", ");

        return `Rezervasyon başarıyla tamamlandı! Ortak PNR Kodunuz: ${pnr}, Alınan Koltuk Numaraları: ${alinanKoltuklar}. Müşteriye PNR ve koltukları söyle, başka isteği var mı sor.`;
    } catch (error) {
        console.error("[API ERROR] Rezervasyon Patladı:", error.message);
        return "Rezervasyon sırasında veritabanında bir hata oluştu, müşteriden özür dile.";
    }
}

// Module exports'un aynı kaldığından emin ol
module.exports = { checkBusSchedule, makeReservation, getJourneyDetails };

async function getJourneyDetails(journeyId) {
    const j = journeyCache.get(journeyId);

    if (!j) {
        return "Sistemde bu seferin detayları şu an bulunamıyor, müşteriden özür dile.";
    }

    // Güzergahı saatleriyle beraber cillop gibi bir stringe çeviriyoruz
    const guzergah = j.route.map(r => {
        const time = r.time ? new Date(r.time).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '';
        return `${r.name || r['station-name'] || r.Name} (${time})`;
    }).filter(Boolean).join(" -> ");

    const busType = j.bus ? j.bus.type : "Standart";
    const features = j.features ? Object.values(j.features).join(", ") : "Belirtilmemiş";

    return `Seferin Güzergahı ve Tahmini Varış Saatleri: [${guzergah}]. Araç Tipi: ${busType}. Özellikler: ${features}. Bu verileri kullanarak müşterinin sorusuna kısa ve doğal bir cevap ver. Tüm durakları robot gibi sayma, sadece sorduğu durağı/detayı söyle.`;
}

// Module.exports'a eklemeyi unutma!
module.exports = { checkBusSchedule, makeReservation, getJourneyDetails };