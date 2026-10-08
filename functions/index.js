const { setGlobalOptions } = require("firebase-functions");
const { onCall, HttpsError } = require("firebase-functions/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const crypto = require("crypto");

initializeApp();
const db = getFirestore();

// 토스 시크릿 키 (Firebase 비밀 값 보관함에서 꺼내 씀 - 코드에는 절대 적지 않음)
const TOSS_SECRET_KEY = defineSecret("TOSS_SECRET_KEY");

// 모든 함수를 서울 리전에서 실행, 동시 실행 개수 제한(비용 안전장치)
setGlobalOptions({ region: "asia-northeast3", maxInstances: 10 });

// =========================================
// 가격표 - 금액은 오직 서버의 이 표로만 정해짐
// =========================================
const PLANS = {
    digital: { price: 19500, name: "디지털 소장권" },
    heritage: { price: 59000, name: "헤리티지 패키지" }
};

const PET_TYPES = ["dog", "cat", "small"];
const BGM_KEYS = ["piano", "guitar", "musicbox", "none"];
const BGM_TITLE_TO_KEY = {
    "별빛 아래 너와 나 (잔잔한 피아노)": "piano",
    "따뜻한 봄날의 산책 (어쿠스틱 기타)": "guitar",
    "영원한 안식처 (서정적인 오르골)": "musicbox",
    "음악 없음 (조용한 추모)": "none"
};

// =========================================
// 공통 도우미
// =========================================

// 문자열 정리 (앞뒤 공백 제거 + 최대 길이 자르기)
function cleanText(value, maxLength) {
    return String(value || "").trim().slice(0, maxLength);
}

// "2013. 05. 10." → "2013-05-10"
function toIsoDate(value) {
    const digits = String(value || "").replace(/[^\d]/g, "");
    if (digits.length !== 8) return "";
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

// 헷갈리는 글자(0, O, 1, I 등)를 뺀 6자리 추모관 주소
function generateSlug() {
    const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    let slug = "";
    for (let i = 0; i < 6; i++) {
        slug += chars[crypto.randomInt(chars.length)];
    }
    return slug;
}

// 아직 쓰이지 않은 슬러그를 찾을 때까지 다시 뽑기
async function generateUniqueSlug() {
    for (let i = 0; i < 10; i++) {
        const slug = generateSlug();
        const exists = await db.collection("memorials").doc(slug).get();
        if (!exists.exists) return slug;
    }
    throw new HttpsError("internal", "추모관 주소를 만들지 못했습니다. 다시 시도해 주세요.");
}

// 관리자 키는 원본 대신 해시로만 저장 (유출돼도 원래 키를 알 수 없음)
function hashKey(key) {
    return crypto.createHash("sha256").update(key).digest("hex");
}

// base64 대표 사진을 Storage에 저장하고 공개 주소 돌려주기
async function saveProfilePhoto(slug, dataUrl) {
    const match = /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(dataUrl || "");
    if (!match) return "";

    const contentType = match[1];
    const extension = match[2] === "jpeg" ? "jpg" : match[2];
    const buffer = Buffer.from(match[3], "base64");
    const path = `memorials/${slug}/profile.${extension}`;
    const token = crypto.randomUUID();

    const bucket = getStorage().bucket();
    await bucket.file(path).save(buffer, {
        contentType,
        metadata: { metadata: { firebaseStorageDownloadTokens: token } }
    });

    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

// =========================================
// 1. 주문 등록 (결제창을 열기 직전에 호출)
// - 브라우저는 플랜 이름만 보내고, 금액은 서버가 가격표로 정함
// =========================================
exports.createOrder = onCall(async (request) => {
    const data = request.data || {};
    const plan = PLANS[data.plan];
    if (!plan) {
        throw new HttpsError("invalid-argument", "선택한 플랜을 확인해 주세요.");
    }

    const memorial = data.memorial || {};
    const applicant = data.applicant || {};

    const petName = cleanText(memorial.petName, 20);
    const applicantName = cleanText(applicant.name, 20);
    const applicantPhone = String(applicant.phone || "").replace(/[^\d]/g, "");

    if (!petName) {
        throw new HttpsError("invalid-argument", "아이 이름을 입력해 주세요.");
    }
    if (!applicantName) {
        throw new HttpsError("invalid-argument", "신청자 성함을 입력해 주세요.");
    }
    if (!/^01\d{8,9}$/.test(applicantPhone)) {
        throw new HttpsError("invalid-argument", "휴대폰 번호를 확인해 주세요.");
    }

    // 대표 사진은 압축된 이미지만 허용 (약 700KB 이하)
    const photo = typeof memorial.photo === "string" && memorial.photo.startsWith("data:image/")
        && memorial.photo.length < 700000 ? memorial.photo : "";

    const bgmRaw = String(memorial.bgm || "");
    const bgm = BGM_KEYS.includes(bgmRaw) ? bgmRaw : (BGM_TITLE_TO_KEY[bgmRaw] || "piano");

    const orderId = `ONSEMIRO_${Date.now()}_${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const orderName = `온새미로 ${plan.name} (${petName})`;

    await db.collection("orders").doc(orderId).set({
        status: "pending",
        plan: data.plan,
        amount: plan.price,
        orderName,
        applicant: { name: applicantName, phone: applicantPhone },
        memorialDraft: {
            petName,
            petType: PET_TYPES.includes(memorial.petType) ? memorial.petType : "dog",
            meetDate: toIsoDate(memorial.meetDate),
            farewellDate: toIsoDate(memorial.farewellDate),
            quote: cleanText(memorial.quote, 100),
            gift1: cleanText(memorial.gift1, 15),
            gift2: cleanText(memorial.gift2, 15),
            bgm,
            photo
        },
        createdAt: FieldValue.serverTimestamp()
    });

    return { orderId, amount: plan.price, orderName };
});

// =========================================
// 2. 결제 승인 (결제 성공 후 complete.html에서 호출)
// - 토스에 실제 결제를 확인하고, 금액이 맞을 때만 추모관 생성
// =========================================
exports.confirmPayment = onCall({ secrets: [TOSS_SECRET_KEY] }, async (request) => {
    const { paymentKey, orderId } = request.data || {};
    const amount = Number(request.data?.amount);

    if (!paymentKey || !orderId || !amount) {
        throw new HttpsError("invalid-argument", "결제 정보가 올바르지 않습니다.");
    }

    const orderRef = db.collection("orders").doc(orderId);

    // 같은 주문이 동시에 두 번 처리되지 않도록 '처리 중'으로 먼저 잠금
    const order = await db.runTransaction(async (tx) => {
        const snap = await tx.get(orderRef);
        if (!snap.exists) {
            throw new HttpsError("not-found", "주문 정보를 찾을 수 없습니다.");
        }
        const current = snap.data();
        if (current.status === "paid") {
            return { ...current, alreadyPaid: true };
        }
        if (current.status !== "pending") {
            throw new HttpsError("failed-precondition", "이미 처리 중이거나 종료된 주문입니다.");
        }
        tx.update(orderRef, { status: "confirming" });
        return current;
    });

    // 새로고침 등으로 다시 호출된 경우: 추모관은 이미 만들어져 있음
    if (order.alreadyPaid) {
        return {
            alreadyPaid: true,
            slug: order.slug,
            orderId,
            plan: order.plan,
            petName: order.memorialDraft?.petName || "",
            applicantName: order.applicant?.name || ""
        };
    }

    // ⚠ 핵심: 결제창에서 넘어온 금액이 서버에 저장해 둔 금액과 다르면 승인하지 않음
    if (amount !== order.amount) {
        await orderRef.update({ status: "amount_mismatch", requestedAmount: amount });
        throw new HttpsError("failed-precondition", "결제 금액이 주문 금액과 일치하지 않습니다.");
    }

    // 토스페이먼츠에 결제 승인 요청 (시크릿 키는 서버에서만 사용)
    const authorization = "Basic " + Buffer.from(`${TOSS_SECRET_KEY.value().trim()}:`).toString("base64");
    const response = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
        method: "POST",
        headers: { Authorization: authorization, "Content-Type": "application/json" },
        body: JSON.stringify({ paymentKey, orderId, amount: order.amount })
    });
    const payment = await response.json();

    if (!response.ok || payment.status !== "DONE" || payment.totalAmount !== order.amount) {
        await orderRef.update({
            status: "failed",
            failure: { code: payment.code || "", message: payment.message || "" }
        });
        throw new HttpsError("failed-precondition", payment.message || "결제 승인에 실패했습니다.");
    }

    // 결제 확인 완료 → 추모관 주소와 관리자 키 생성
    const slug = await generateUniqueSlug();
    const adminKey = crypto.randomBytes(24).toString("base64url");
    const draft = order.memorialDraft || {};

    // 대표 사진 저장 (실패해도 추모관 생성은 계속 진행)
    let photoUrl = "";
    try {
        photoUrl = await saveProfilePhoto(slug, draft.photo);
    } catch (err) {
        console.error("대표 사진 저장 실패:", err);
    }

    const batch = db.batch();

    batch.set(db.collection("memorials").doc(slug), {
        petName: draft.petName,
        petType: draft.petType,
        meetDate: draft.meetDate,
        farewellDate: draft.farewellDate,
        quote: draft.quote,
        gifts: [draft.gift1, draft.gift2],
        bgm: draft.bgm,
        photoUrl,
        plan: order.plan,
        // 보호자가 오기 전 온새미로가 먼저 켜둔 촛불과 선물
        counts: { treat: 1, toy: 1, candle: 1 },
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
    });

    batch.set(db.collection("secrets").doc(slug), {
        adminKeyHash: hashKey(adminKey),
        orderId,
        createdAt: FieldValue.serverTimestamp()
    });

    batch.update(orderRef, {
        status: "paid",
        slug,
        paymentKey,
        method: payment.method || "",
        approvedAt: payment.approvedAt || "",
        "memorialDraft.photo": FieldValue.delete()
    });

    await batch.commit();

    // 관리자 키 원본은 이 응답에서 딱 한 번만 전달됨
    return {
        slug,
        adminKey,
        photoUrl,
        orderId,
        plan: order.plan,
        petName: draft.petName,
        applicantName: order.applicant?.name || ""
    };
});


// =========================================
// 관리자 공통: 관리자 키 확인
// =========================================
async function assertAdmin(slug, key) {
    const denied = new HttpsError("permission-denied", "관리자 링크가 올바르지 않습니다.");

    if (typeof slug !== "string" || !/^[A-Z0-9]{6}$/.test(slug)) throw denied;
    if (typeof key !== "string" || key.length < 20 || key.length > 100) throw denied;

    const snap = await db.collection("secrets").doc(slug).get();
    if (!snap.exists) throw denied;

    const expected = Buffer.from(snap.data().adminKeyHash || "", "hex");
    const actual = Buffer.from(hashKey(key), "hex");

    // 글자를 하나씩 비교하는 시간 차이로 키를 추측하지 못하도록 일정한 시간으로 비교
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        throw denied;
    }
}

// 화면으로 돌려줄 추모관 정보만 골라내기 (서버 전용 값·시간 객체 제외)
function pickMemorial(m) {
    return {
        petName: m.petName || "",
        petType: m.petType || "dog",
        meetDate: m.meetDate || "",
        farewellDate: m.farewellDate || "",
        quote: m.quote || "",
        gifts: m.gifts || ["", ""],
        bgm: m.bgm || "piano",
        photoUrl: m.photoUrl || "",
        plan: m.plan || "digital",
        counts: m.counts || {}
    };
}

// =========================================
// 3. 관리자 확인 (관리자 화면 입장, 추모관의 관리자 버튼 표시 여부)
// =========================================
exports.verifyAdmin = onCall(async (request) => {
    const { slug, key } = request.data || {};
    await assertAdmin(slug, key);

    const snap = await db.collection("memorials").doc(slug).get();
    if (!snap.exists) {
        throw new HttpsError("not-found", "추모관을 찾을 수 없습니다.");
    }
    return { memorial: pickMemorial(snap.data()) };
});

// =========================================
// 4. 추모관 기본 정보 수정 (관리자 화면 '추모관 정보' 탭)
// =========================================
exports.updateMemorialInfo = onCall(async (request) => {
    const { slug, key } = request.data || {};
    const info = request.data?.info || {};
    await assertAdmin(slug, key);

    const petName = cleanText(info.petName, 20);
    if (!petName) {
        throw new HttpsError("invalid-argument", "아이 이름을 입력해 주세요.");
    }

    const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? v : "");
    const meetDate = isoDate(info.meetDate);
    const farewellDate = isoDate(info.farewellDate);
    if (meetDate && farewellDate && farewellDate < meetDate) {
        throw new HttpsError("invalid-argument", "별이 된 날이 처음 만난 날보다 앞서 있습니다.");
    }

    const update = {
        petName,
        petType: PET_TYPES.includes(info.petType) ? info.petType : "dog",
        meetDate,
        farewellDate,
        quote: cleanText(info.quote, 100),
        gifts: [cleanText(info.gift1, 15), cleanText(info.gift2, 15)],
        bgm: BGM_KEYS.includes(info.bgm) ? info.bgm : "piano",
        updatedAt: FieldValue.serverTimestamp()
    };

    // 대표 사진을 새로 고른 경우에만 Storage에 다시 저장
    if (typeof info.photo === "string" && info.photo.startsWith("data:image/")) {
        if (info.photo.length > 700000) {
            throw new HttpsError("invalid-argument", "사진 용량이 너무 큽니다. 다른 사진으로 시도해 주세요.");
        }
        update.photoUrl = await saveProfilePhoto(slug, info.photo);
    }

    const ref = db.collection("memorials").doc(slug);
    await ref.update(update);

    const saved = await ref.get();
    return { memorial: pickMemorial(saved.data()) };
});