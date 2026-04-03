// SAHTE api.js (MOCK DATA)
// Obüs API düzelene kadar Buse'yi test etmek için kullanılır.

const CITY_CODES = {
    "çanakkale": 206,
    "istanbul": 215,
    "gelibolu": 207,
    "kadıköy": 301,
    "beylikdüzü": 302
};

async function checkBusSchedule(departureCity, destinationCity, date) {
    try {
        console.log(`[API-DUMMY] SORGULAMA: ${departureCity} -> ${destinationCity} | ${date}`);

        const origin = departureCity.toLowerCase();
        const dest = destinationCity.toLowerCase();

        if (!CITY_CODES[origin] || !CITY_CODES[dest]) {
            return `Sistemimizde ${departureCity} veya ${destinationCity} için bir durak bulunamadı. Lütfen Çanakkale, Gelibolu, İstanbul, Kadıköy veya Beylikdüzü güzergahlarını deneyin.`;
        }

        await new Promise(resolve => setTimeout(resolve, 1000));

        const sahteSeferler = [
            `Saat: 08:30, Fiyat: 450 Lira`,
            `Saat: 14:00, Fiyat: 450 Lira`,
            `Saat: 23:45, Fiyat: 500 Lira`
        ].join(" | ");

        return `Şu seferleri buldum: ${sahteSeferler}. Müşteriye bunları insan gibi oku, saat seçmesini iste.`;

    } catch (error) {
        return "Şu anda sistemsel bir hata var, seferleri göremiyorum.";
    }
}

// YENİ EKLENEN SAHTE REZERVASYON FONKSİYONU
async function makeReservation(passengerName, departureCity, destinationCity, date, time) {
    try {
        console.log(`[API-DUMMY] REZERVASYON İSTEĞİ: ${passengerName} | ${departureCity} -> ${destinationCity} | ${date} Saat: ${time}`);

        // 1.5 saniye düşünme payı, sanki veritabanına yazıyormuş gibi
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Sallamasyon bir PNR kodu üretiyoruz
        const pnr = "CRT" + Math.floor(1000 + Math.random() * 9000);

        return `Rezervasyon başarıyla tamamlandı! Yolcu: ${passengerName}, Güzergah: ${departureCity} - ${destinationCity}, Tarih: ${date} Saat: ${time}. PNR Kodunuz: ${pnr}. Buse, müşteriye PNR kodunu ilet ve biletin seferden 30 dakika önce perondan alınması gerektiğini söyle.`;
    } catch (error) {
        return "Rezervasyon işlemi sırasında bir hata oluştu, lütfen müşteriden özür dile ve tekrar denemesini iste.";
    }
}

module.exports = { checkBusSchedule, makeReservation };