require('dotenv').config();
const fs = require('fs');
const { execSync } = require('child_process');

const BASE_URL = process.env.OBUS_API_URL.replace(/\/$/, "");
const authEnv = process.env.OBUS_BASIC_AUTH;
const BASIC_AUTH = authEnv.startsWith("Basic ") ? authEnv : `Basic ${authEnv}`;
const PARTNER = process.env.OBUS_PARTNER_CODE;

async function nukleerRontgen() {
    try {
        console.log("⏳ 1. Adım: Session İsteniyor (Bu zaten sorunsuz çalışıyordu)...");
        const sessRes = await fetch(`${BASE_URL}/client/getsession`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": BASIC_AUTH },
            body: JSON.stringify({
                "type": 1,
                "connection": { "ip-address": "127.0.0.1", "port": "5117" },
                "browser": { "name": "Chrome" }
            })
        });

        if (!sessRes.ok) throw new Error(`GetSession Patladı! Kod: ${sessRes.status}`);
        const sessData = await sessRes.json();
        const sessionId = sessData.data["session-id"];
        const deviceId = sessData.data["device-id"];
        console.log(`✅ Session Geldi: ${sessionId}\n`);

        console.log("⏳ 2. Adım: NÜKLEER SİLAH (cURL) İLE DURAKLARA GİRİLİYOR...");

        // Postman'daki birebir durak json'unu hazırlıyoruz
        const payload = {
            "data": null,
            "token": null,
            "device-session": { "session-id": sessionId, "device-id": deviceId },
            "date": "2019-12-13T15:11:01.6608738+03:00", // Efsanevi tarih
            "language": "tr-TR"
        };

        // Windows CMD'sinde tırnak hatalarıyla uğraşmamak için JSON'u geçici bir dosyaya yazıyoruz
        fs.writeFileSync('payload.json', JSON.stringify(payload));

        // cURL komutunu hazırlıyoruz (Büyük-küçük harf aynen korunur!)
        const curlCommand = `curl -s -X POST "${BASE_URL}/web/getstations" -H "Content-Type: application/json" -H "Authorization: ${BASIC_AUTH}" -H "PartnerCode: ${PARTNER}" -d @payload.json`;

        // İşletim sistemine "Şu komutu çalıştır" diyoruz
        const result = execSync(curlCommand, { encoding: 'utf8' });

        // Geçici dosyayı siliyoruz, iz bırakmıyoruz
        fs.unlinkSync('payload.json');

        const statData = JSON.parse(result);

        if (statData.success && statData.data) {
            console.log("✅ SONUNDA AMK! Node.js'in zincirlerini kırdık ve durakları çektik!\n");
            const arananSehirler = ["çanakkale", "istanbul", "kadıköy", "gelibolu", "beylikdüzü"];

            const bizimDuraklar = statData.data.filter(durak => {
                const ad = (durak.name || durak['station-name'] || durak.Name || "").toLowerCase();
                return arananSehirler.some(sehir => ad.includes(sehir));
            });

            if (bizimDuraklar.length > 0) {
                console.log(JSON.stringify(bizimDuraklar, null, 2));
                console.log("\n👉 USTA: Al şu ID'leri de api.js'in içine beton gibi çivileyelim!");
            } else {
                console.log("🚨 Senin aradığın şehirler listede yok. İlk 5 durağı basıyorum:\n");
                console.log(JSON.stringify(statData.data.slice(0, 5), null, 2));
            }
        } else {
            console.log(`\n🚨 Nükleer silah da işe yaramadı amk! Gelen Kusmuk:\n`, statData);
        }

    } catch (error) {
        console.error("🚨 SİSTEM ÇÖKTÜ:", error.message);
    }
}

nukleerRontgen();