const { setGlobalOptions } = require("firebase-functions");
const { onCall, HttpsError } = require("firebase-functions/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");
const { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand, ListObjectsV2Command, DeleteObjectsCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { SolapiMessageService } = require("solapi");

initializeApp();
const db = getFirestore();

// 토스 시크릿 키 (Firebase 비밀 값 보관함에서 꺼내 씀 - 코드에는 절대 적지 않음)
const TOSS_SECRET_KEY = defineSecret("TOSS_SECRET_KEY");

// 운영자 전용 비밀번호 (관리자 링크 재발급 등 운영자 기능에만 사용)
const OPERATOR_KEY = defineSecret("OPERATOR_KEY");

// 솔라피 (문자·알림톡 발송)
const SOLAPI_API_KEY = defineSecret("SOLAPI_API_KEY");
const SOLAPI_API_SECRET = defineSecret("SOLAPI_API_SECRET");
const SMS_SECRETS = [SOLAPI_API_KEY, SOLAPI_API_SECRET];

// 솔라피에 등록한 발신번호 (받는 사람에게 보이는 번호라 비밀 값이 아님)
// ※ 비어 있으면 문자를 보내지 않고 건너뜀 → 발신번호 등록 후 숫자만 입력하고 다시 배포
const SMS_SENDER = "01028004784";

const SITE_BASE = "https://onsemiro.me";

// Cloudflare R2 (사진·영상 저장소) 접근 정보
const R2_ACCESS_KEY_ID = defineSecret("R2_ACCESS_KEY_ID");
const R2_SECRET_ACCESS_KEY = defineSecret("R2_SECRET_ACCESS_KEY");
const R2_ACCOUNT_ID = defineSecret("R2_ACCOUNT_ID");
const R2_SECRETS = [R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID];
const R2_BUCKET = "onsemiro-media";
const MEDIA_BASE = "https://media.onsemiro.me";

// 업로드 제한 (악용 방지용 안전장치)
const UPLOAD_LIMITS = {
    maxFilesPerMemory: 10,
    imageBytes: 30 * 1024 * 1024,        // 사진 1장 (압축 후라 넉넉함)
    videoBytes: 500 * 1024 * 1024,       // 영상 1개
    thumbBytes: 2 * 1024 * 1024          // 영상 썸네일
    // 추모관 전체 한도는 요금제별 (PLANS.storageBytes)
};
const IMAGE_TYPES = ["image/webp", "image/jpeg", "image/png", "image/gif"];
const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

// 모든 함수를 서울 리전에서 실행, 동시 실행 개수 제한(비용 안전장치)
setGlobalOptions({ region: "asia-northeast3", maxInstances: 10 });

// =========================================
// 가격표 - 금액은 오직 서버의 이 표로만 정해짐
// =========================================
const PLANS = {
    essential: { price: 19500, name: "에센셜 아카이브", storageBytes: 20 * 1024 * 1024 * 1024 },
    signature: { price: 49000, name: "시그니처 아카이브", storageBytes: 50 * 1024 * 1024 * 1024 }
    // heritage: 헤리티지 아카이브 (출시 예정)
};

// 요금제별 저장 한도 (알 수 없는 요금제는 에센셜 기준)
function storageLimitOf(plan) {
    return (PLANS[plan] || PLANS.essential).storageBytes;
}

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

// 받침이 있으면 '이'를 붙여 부르는 이름 (하임 → 하임이, 코코 → 코코)
function callName(name) {
    if (!name) return "";
    const code = name.charCodeAt(name.length - 1);
    if (code < 0xAC00 || code > 0xD7A3) return name;
    return (code - 0xAC00) % 28 > 0 ? name + "이" : name;
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

// R2 연결 (S3 호환 방식)
let r2Client = null;
function getR2() {
    if (!r2Client) {
        r2Client = new S3Client({
            region: "auto",
            endpoint: `https://${R2_ACCOUNT_ID.value().trim()}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: R2_ACCESS_KEY_ID.value().trim(),
                secretAccessKey: R2_SECRET_ACCESS_KEY.value().trim()
            }
        });
    }
    return r2Client;
}

function mediaUrl(path) {
    return path ? `${MEDIA_BASE}/${path}` : "";
}

async function deleteR2Object(path) {
    if (!path) return;
    try {
        await getR2().send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: path }));
    } catch (err) {
        console.error("R2 파일 삭제 실패:", path, err);
    }
}

// base64 대표 사진을 R2에 저장하고 { path, url } 돌려주기
// (같은 주소를 덮어쓰면 캐시 때문에 예전 사진이 보일 수 있어서, 저장할 때마다 새 이름 사용)
async function saveProfilePhoto(slug, dataUrl) {
    const match = /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(dataUrl || "");
    if (!match) return null;

    const contentType = match[1];
    const extension = match[2] === "jpeg" ? "jpg" : match[2];
    const path = `memorials/${slug}/profile-${Date.now()}.${extension}`;

    await getR2().send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: path,
        Body: Buffer.from(match[3], "base64"),
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable"
    }));

    return { path, url: mediaUrl(path) };
}

// 문자 발송 (긴 문자는 솔라피가 자동으로 LMS로 보냄)
// 결과: "sent" | "skipped"(발신번호 미설정) | "failed"
async function sendSms(to, text) {
    const from = SMS_SENDER.replace(/[^\d]/g, "");
    if (!from || !to) return "skipped";
    try {
        const service = new SolapiMessageService(SOLAPI_API_KEY.value().trim(), SOLAPI_API_SECRET.value().trim());
        await service.send({ to, from, text, subject: "[온새미로] 추모관 안내" });
        return "sent";
    } catch (err) {
        console.error("문자 발송 실패:", err);
        return "failed";
    }
}

function openingMessage({ applicantName, petName, slug, adminKey }) {
    return [
        "[온새미로] 추모관 개설 안내",
        "",
        `${applicantName}님, ${petName}의 온새미로가 개설되었습니다.`,
        "아래 주소로 언제든 다시 찾아오실 수 있습니다.",
        "",
        "■ 추모관 (가족·지인 공유용)",
        `${SITE_BASE}/memorial.html?room=${slug}`,
        "",
        "■ 사진·영상 모으기 (가족·지인 공유용)",
        `${SITE_BASE}/upload.html?room=${slug}`,
        "",
        "■ 관리자 주소 (보호자 전용)",
        `${SITE_BASE}/admin.html?room=${slug}&key=${adminKey}`,
        "관리 권한이 포함된 주소이니 다른 분께 공유하지 마세요.",
        "",
        "이 문자는 지우지 말고 보관해 주세요."
    ].join("\n");
}

function reissueMessage({ petName, slug, adminKey }) {
    return [
        "[온새미로] 관리자 주소 재발급 안내",
        "",
        `${petName}의 온새미로 관리자 주소가 새로 발급되었습니다.`,
        "이전 관리자 주소는 더 이상 사용할 수 없습니다.",
        "",
        "■ 새 관리자 주소 (보호자 전용)",
        `${SITE_BASE}/admin.html?room=${slug}&key=${adminKey}`,
        "관리 권한이 포함된 주소이니 다른 분께 공유하지 마세요."
    ].join("\n");
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
exports.confirmPayment = onCall({ secrets: [TOSS_SECRET_KEY, ...R2_SECRETS, ...SMS_SECRETS] }, async (request) => {
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
    let photo = null;
    try {
        photo = await saveProfilePhoto(slug, draft.photo);
    } catch (err) {
        console.error("대표 사진 저장 실패:", err);
    }
    const photoUrl = photo ? photo.url : "";

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
        photoPath: photo ? photo.path : "",
        storageBytes: 0,
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

    // 기본 발자취 두 개 (만난 날, 별이 된 날) - 관리자 화면에서 수정·삭제 가능
    const timelineRef = db.collection("memorials").doc(slug).collection("timeline");
    if (draft.meetDate) {
        batch.set(timelineRef.doc(), {
            date: draft.meetDate,
            story: `${callName(draft.petName)}가 우리 가족이 된 날. 그날부터 모든 날이 선물이었어.`,
            createdAt: FieldValue.serverTimestamp()
        });
    }
    if (draft.farewellDate) {
        batch.set(timelineRef.doc(), {
            date: draft.farewellDate,
            story: "가족들의 품에서 조용히 눈을 감고, 가장 빛나는 별이 된 날.",
            createdAt: FieldValue.serverTimestamp()
        });
    }

    batch.update(orderRef, {
        status: "paid",
        slug,
        paymentKey,
        method: payment.method || "",
        approvedAt: payment.approvedAt || "",
        "memorialDraft.photo": FieldValue.delete()
    });

    await batch.commit();

    // 개설 안내 문자 (실패해도 결제·추모관 생성에는 영향 없음)
    const smsResult = await sendSms(order.applicant?.phone, openingMessage({
        applicantName: order.applicant?.name || "보호자",
        petName: draft.petName,
        slug,
        adminKey
    }));
    await orderRef.update({ notification: { sms: smsResult, at: FieldValue.serverTimestamp() } });

    // 관리자 키 원본은 이 응답에서 딱 한 번만 전달됨
    return {
        slug,
        adminKey,
        photoUrl,
        smsSent: smsResult === "sent",
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

    const secret = snap.data();
    const keyHash = hashKey(key);
    const expected = Buffer.from(secret.adminKeyHash || "", "hex");
    const actual = Buffer.from(keyHash, "hex");

    // 글자를 하나씩 비교하는 시간 차이로 키를 추측하지 못하도록 일정한 시간으로 비교
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        // 재발급 전의 예전 키로 들어온 경우에만 '재발급됨'을 알려줌
        if ((secret.previousKeyHashes || []).includes(keyHash)) {
            throw new HttpsError("permission-denied", "관리자 링크가 재발급되었습니다.", { reason: "reissued" });
        }
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
        plan: m.plan || "essential",
        counts: m.counts || {},
        storageBytes: m.storageBytes || 0,
        storageLimit: storageLimitOf(m.plan)
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
exports.updateMemorialInfo = onCall({ secrets: R2_SECRETS }, async (request) => {
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
        const photo = await saveProfilePhoto(slug, info.photo);
        if (photo) {
            update.photoUrl = photo.url;
            update.photoPath = photo.path;
        }
    }

    const ref = db.collection("memorials").doc(slug);
    const before = (await ref.get()).data() || {};
    await ref.update(update);

    // 대표 사진을 바꿨다면 예전 사진 파일 정리
    if (update.photoPath && before.photoPath && before.photoPath !== update.photoPath) {
        await deleteR2Object(before.photoPath);
    }

    const saved = await ref.get();
    return { memorial: pickMemorial(saved.data()) };
});


// =========================================
// 5. 발자취 등록·수정·삭제 (관리자)
// =========================================
exports.adminSaveTimeline = onCall(async (request) => {
    const { slug, key, id } = request.data || {};
    await assertAdmin(slug, key);

    const date = String(request.data?.date || "");
    const story = cleanText(request.data?.story, 200);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !story) {
        throw new HttpsError("invalid-argument", "날짜와 내용을 확인해 주세요.");
    }

    const col = db.collection("memorials").doc(slug).collection("timeline");
    if (id) {
        const ref = col.doc(String(id));
        if (!(await ref.get()).exists) {
            throw new HttpsError("not-found", "발자취를 찾을 수 없습니다.");
        }
        await ref.update({ date, story });
        return { id: ref.id };
    }

    const ref = await col.add({ date, story, createdAt: FieldValue.serverTimestamp() });
    return { id: ref.id };
});

exports.adminDeleteTimeline = onCall(async (request) => {
    const { slug, key, id } = request.data || {};
    await assertAdmin(slug, key);
    if (!id) throw new HttpsError("invalid-argument", "삭제할 발자취를 확인해 주세요.");

    await db.collection("memorials").doc(slug).collection("timeline").doc(String(id)).delete();
    return { ok: true };
});

// =========================================
// 6. 우체통 편지 목록·상태 변경 (관리자)
// - 방문객에게는 '공개(approved)' 편지만 보이고, 관리자는 전체를 봄
// =========================================
exports.adminListLetters = onCall(async (request) => {
    const { slug, key } = request.data || {};
    await assertAdmin(slug, key);

    const snap = await db.collection("memorials").doc(slug).collection("letters").get();
    const letters = snap.docs.map((doc) => {
        const d = doc.data();
        return {
            id: doc.id,
            name: d.name || "",
            relation: d.relation || "",
            message: d.message || "",
            status: d.status || "pending",
            createdAt: d.createdAt ? d.createdAt.toMillis() : 0
        };
    });
    letters.sort((a, b) => b.createdAt - a.createdAt);
    return { letters };
});

exports.adminUpdateLetter = onCall(async (request) => {
    const { slug, key, id, status, remove } = request.data || {};
    await assertAdmin(slug, key);
    if (!id) throw new HttpsError("invalid-argument", "편지를 확인해 주세요.");

    const ref = db.collection("memorials").doc(slug).collection("letters").doc(String(id));

    if (remove) {
        await ref.delete();
        return { ok: true };
    }
    if (!["pending", "approved", "excluded"].includes(status)) {
        throw new HttpsError("invalid-argument", "상태 값이 올바르지 않습니다.");
    }
    await ref.update({ status, reviewedAt: FieldValue.serverTimestamp() });
    return { ok: true };
});


// =========================================
// 사진·영상 (추억) - Cloudflare R2
// - memories: 보낸 원본 기록 (비공개, 관리자만 서버 함수로 접근)
// - gallery : 승인된 파일만 모아 둔 공개 목록 (추모관 갤러리가 읽음)
// =========================================

// 갤러리 공개 목록을 추억 기록 상태에 맞게 다시 만들기
async function syncGallery(slug, memoryId, memory) {
    const galleryRef = db.collection("memorials").doc(slug).collection("gallery");
    const old = await galleryRef.where("memoryId", "==", memoryId).get();
    const batch = db.batch();
    old.docs.forEach((doc) => batch.delete(doc.ref));

    if (memory && memory.status === "approved") {
        const baseLabel = memory.isDirect ? (memory.sender || "보호자") : `${memory.relation || ""} ${memory.sender || ""}`.trim();
        (memory.files || []).forEach((file, index) => {
            if (file.excluded) return;
            // 사진 한 장만 따로 고친 경우 그 내용이 우선
            const story = typeof file.story === "string" ? file.story : (memory.story || "");
            const senderLabel = memory.isDirect && file.sender ? file.sender : baseLabel;
            batch.set(galleryRef.doc(`${memoryId}_${index}`), {
                memoryId,
                fileIndex: index,
                type: file.type,
                path: file.path,
                thumbPath: file.thumbPath || "",
                story,
                senderLabel,
                createdAt: memory.createdAt || FieldValue.serverTimestamp()
            });
        });
    }
    await batch.commit();
}

// 업로드 주소 발급 (지인 업로드 = 키 없음 / 보호자 바로 업로드 = 관리자 키)
exports.createMemoryUpload = onCall({ secrets: R2_SECRETS }, async (request) => {
    const data = request.data || {};
    const slug = String(data.slug || "").toUpperCase();
    const isDirect = Boolean(data.key);

    if (isDirect) {
        await assertAdmin(slug, data.key);
    }

    const memorialRef = db.collection("memorials").doc(slug);
    const memorialSnap = await memorialRef.get();
    if (!/^[A-Z0-9]{6}$/.test(slug) || !memorialSnap.exists) {
        throw new HttpsError("not-found", "추모관을 찾을 수 없습니다.");
    }

    const files = Array.isArray(data.files) ? data.files : [];
    if (files.length === 0 || files.length > UPLOAD_LIMITS.maxFilesPerMemory) {
        throw new HttpsError("invalid-argument", "파일 개수를 확인해 주세요.");
    }

    // 보호자 바로 업로드는 표시 이름을 직접 정할 수 있음 (비우면 "보호자")
    const sender = isDirect ? (cleanText(data.sender, 20) || "보호자") : cleanText(data.sender, 20);
    const relation = isDirect ? "" : cleanText(data.relation, 20);
    const story = cleanText(data.story, 1000);
    if (!isDirect && (!sender || !relation)) {
        throw new HttpsError("invalid-argument", "보내는 분 성함과 관계를 입력해 주세요.");
    }

    // 파일 하나하나 검사
    let totalBytes = 0;
    const plan = files.map((file, index) => {
        const type = file.type === "video" ? "video" : "image";
        const contentType = String(file.contentType || "");
        const size = Number(file.size) || 0;
        const thumbSize = Number(file.thumbSize) || 0;

        const allowedTypes = type === "video" ? VIDEO_TYPES : IMAGE_TYPES;
        const maxBytes = type === "video" ? UPLOAD_LIMITS.videoBytes : UPLOAD_LIMITS.imageBytes;
        if (!allowedTypes.includes(contentType) || size <= 0 || size > maxBytes) {
            throw new HttpsError("invalid-argument", `${index + 1}번째 파일의 형식이나 용량을 확인해 주세요.`);
        }
        if (type === "video" && (thumbSize <= 0 || thumbSize > UPLOAD_LIMITS.thumbBytes)) {
            throw new HttpsError("invalid-argument", "영상 썸네일을 만들지 못했습니다.");
        }

        totalBytes += size + thumbSize;
        return { type, contentType, size, thumbSize };
    });

    const used = memorialSnap.data().storageBytes || 0;
    const limit = storageLimitOf(memorialSnap.data().plan);
    if (used + totalBytes > limit) {
        throw new HttpsError("resource-exhausted", isDirect
            ? "추모관 저장 공간이 부족합니다. 확인 대기 중이거나 필요 없는 사진·영상을 정리해 주세요."
            : "추모관 저장 공간이 가득 찼습니다. 보호자님께 문의해 주세요.");
    }

    const memoryRef = memorialRef.collection("memories").doc();
    const extOf = (ct) => ({
        "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif",
        "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm"
    }[ct] || "bin");

    const storedFiles = plan.map((p, i) => ({
        type: p.type,
        contentType: p.contentType,
        size: p.size,
        path: `memorials/${slug}/memories/${memoryRef.id}/${i}.${extOf(p.contentType)}`,
        thumbPath: p.type === "video" ? `memorials/${slug}/memories/${memoryRef.id}/${i}_thumb.webp` : "",
        thumbSize: p.thumbSize,
        excluded: false
    }));

    await memoryRef.set({
        sender,
        relation,
        story,
        isDirect,
        status: "uploading",
        files: storedFiles,
        totalBytes,
        createdAt: FieldValue.serverTimestamp()
    });

    // 1시간짜리 1회용 업로드 주소
    const sign = (key, contentType) => getSignedUrl(
        getR2(),
        new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: contentType }),
        { expiresIn: 3600 }
    );

    const uploads = await Promise.all(storedFiles.map(async (f) => ({
        url: await sign(f.path, f.contentType),
        thumbUrl: f.thumbPath ? await sign(f.thumbPath, "image/webp") : ""
    })));

    return { memoryId: memoryRef.id, uploads };
});

// 업로드 완료 확인 → 지인은 '확인 대기', 보호자는 바로 '전시'
exports.completeMemoryUpload = onCall({ secrets: R2_SECRETS }, async (request) => {
    const slug = String(request.data?.slug || "").toUpperCase();
    const memoryId = String(request.data?.memoryId || "");
    if (!/^[A-Z0-9]{6}$/.test(slug) || !memoryId) {
        throw new HttpsError("invalid-argument", "업로드 정보가 올바르지 않습니다.");
    }

    const memorialRef = db.collection("memorials").doc(slug);
    const memoryRef = memorialRef.collection("memories").doc(memoryId);
    const snap = await memoryRef.get();
    if (!snap.exists || snap.data().status !== "uploading") {
        throw new HttpsError("failed-precondition", "이미 처리되었거나 없는 업로드입니다.");
    }
    const memory = snap.data();

    // 실제로 R2에 올라갔는지, 신고한 크기와 맞는지 확인
    const check = async (path, expectedSize, maxBytes) => {
        const head = await getR2().send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: path }));
        const size = Number(head.ContentLength) || 0;
        if (size <= 0 || size > maxBytes || size > expectedSize * 1.01 + 1024) {
            throw new Error("size mismatch");
        }
        return size;
    };

    let realBytes = 0;
    try {
        for (const f of memory.files) {
            const max = f.type === "video" ? UPLOAD_LIMITS.videoBytes : UPLOAD_LIMITS.imageBytes;
            realBytes += await check(f.path, f.size, max);
            if (f.thumbPath) realBytes += await check(f.thumbPath, f.thumbSize, UPLOAD_LIMITS.thumbBytes);
        }
    } catch (err) {
        console.error("업로드 확인 실패:", err);
        await Promise.all(memory.files.flatMap((f) => [deleteR2Object(f.path), deleteR2Object(f.thumbPath)]));
        await memoryRef.delete();
        throw new HttpsError("failed-precondition", "파일이 끝까지 올라가지 않았습니다. 다시 시도해 주세요.");
    }

    const status = memory.isDirect ? "approved" : "pending";
    await memoryRef.update({ status, totalBytes: realBytes });
    await memorialRef.update({ storageBytes: FieldValue.increment(realBytes) });

    if (status === "approved") {
        await syncGallery(slug, memoryId, { ...memory, status });
    }
    return { status };
});

// 관리자: 추억 전체 목록 (확인 대기·전시·제외 모두)
exports.adminListMemories = onCall(async (request) => {
    const { slug, key } = request.data || {};
    await assertAdmin(slug, key);

    const snap = await db.collection("memorials").doc(slug).collection("memories").get();
    const memories = snap.docs
        .map((doc) => {
            const d = doc.data();
            return {
                id: doc.id,
                sender: d.sender || "",
                relation: d.relation || "",
                story: d.story || "",
                isDirect: Boolean(d.isDirect),
                status: d.status,
                files: (d.files || []).map((f) => ({
                    type: f.type,
                    url: mediaUrl(f.path),
                    thumbUrl: mediaUrl(f.thumbPath),
                    excluded: Boolean(f.excluded),
                    story: typeof f.story === "string" ? f.story : null,
                    sender: f.sender || null
                })),
                createdAt: d.createdAt ? d.createdAt.toMillis() : 0
            };
        })
        .filter((m) => m.status !== "uploading");
    memories.sort((a, b) => b.createdAt - a.createdAt);

    // 저장 공간 사용량도 함께 전달 (관리자 화면 표시용)
    const memorial = (await db.collection("memorials").doc(slug).get()).data() || {};
    return {
        memories,
        storageBytes: memorial.storageBytes || 0,
        storageLimit: storageLimitOf(memorial.plan)
    };
});

// 관리자: 검수 결정 (선택한 파일만 전시 / 전부 제외 / 다시 검수)
exports.adminReviewMemory = onCall(async (request) => {
    const { slug, key, id, action } = request.data || {};
    await assertAdmin(slug, key);

    const ref = db.collection("memorials").doc(slug).collection("memories").doc(String(id || ""));
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "추억을 찾을 수 없습니다.");
    const memory = snap.data();
    const files = memory.files || [];

    if (action === "revert") {
        files.forEach((f) => { f.excluded = false; });
        await ref.update({ status: "pending", files });
        await syncGallery(slug, ref.id, null);
        return { status: "pending" };
    }

    if (action !== "apply") throw new HttpsError("invalid-argument", "처리 방식이 올바르지 않습니다.");

    const excluded = Array.isArray(request.data.excluded) ? request.data.excluded : [];
    files.forEach((f, i) => { f.excluded = Boolean(excluded[i]); });
    const status = files.some((f) => !f.excluded) ? "approved" : "unposted";

    await ref.update({ status, files, reviewedAt: FieldValue.serverTimestamp() });
    await syncGallery(slug, ref.id, { ...memory, files, status });
    return { status };
});

// 관리자: 사연 수정
exports.adminUpdateMemoryStory = onCall(async (request) => {
    const { slug, key, id } = request.data || {};
    await assertAdmin(slug, key);

    const ref = db.collection("memorials").doc(slug).collection("memories").doc(String(id || ""));
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "추억을 찾을 수 없습니다.");

    const memory = snap.data();
    const story = cleanText(request.data?.story, 1000);
    const hasSender = memory.isDirect && typeof request.data?.sender === "string";
    const sender = hasSender ? (cleanText(request.data.sender, 20) || "보호자") : null;
    const fileIndex = Number(request.data?.fileIndex);

    let update;
    if (Number.isInteger(fileIndex) && memory.files && memory.files[fileIndex]) {
        // 사진(영상) 한 장만 수정: 같이 올린 다른 사진은 그대로
        const files = memory.files.map((f) => ({ ...f }));
        files[fileIndex].story = story;
        if (hasSender) files[fileIndex].sender = sender;
        update = { files };
    } else {
        // 묶음 전체 수정 (예전 방식)
        update = { story };
        if (hasSender) update.sender = sender;
    }

    await ref.update(update);
    await syncGallery(slug, ref.id, { ...memory, ...update });
    return { ok: true };
});

// 관리자: 갤러리에서 파일 하나 삭제 (R2 원본까지 완전히 삭제)
exports.adminDeleteMemoryFile = onCall({ secrets: R2_SECRETS }, async (request) => {
    const { slug, key, id } = request.data || {};
    const fileIndex = Number(request.data?.fileIndex);
    await assertAdmin(slug, key);

    const memorialRef = db.collection("memorials").doc(slug);
    const ref = memorialRef.collection("memories").doc(String(id || ""));
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "추억을 찾을 수 없습니다.");

    const memory = snap.data();
    const files = memory.files || [];
    const target = files[fileIndex];
    if (!target) throw new HttpsError("not-found", "파일을 찾을 수 없습니다.");

    await deleteR2Object(target.path);
    await deleteR2Object(target.thumbPath);
    const freed = (target.size || 0) + (target.thumbSize || 0);

    files.splice(fileIndex, 1);
    if (files.length === 0) {
        await ref.delete();
        await syncGallery(slug, ref.id, null);
    } else {
        await ref.update({ files, totalBytes: FieldValue.increment(-freed) });
        await syncGallery(slug, ref.id, { ...memory, files });
    }
    await memorialRef.update({ storageBytes: FieldValue.increment(-freed) });
    return { ok: true };
});

// =========================================
// 운영자 기능 (고객 문의 대응용)
// - 브라우저 콘솔에서 운영자 비밀번호와 함께 호출
// =========================================
function assertOperator(key) {
    const expected = Buffer.from(OPERATOR_KEY.value().trim());
    const actual = Buffer.from(String(key || ""));
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        throw new HttpsError("permission-denied", "운영자 인증에 실패했습니다.");
    }
}

// 휴대폰 번호로 주문 찾기 (본인 확인용)
exports.operatorFindOrders = onCall({ secrets: [OPERATOR_KEY] }, async (request) => {
    assertOperator(request.data?.operatorKey);

    const phone = String(request.data?.phone || "").replace(/[^\d]/g, "");
    if (!/^01\d{8,9}$/.test(phone)) {
        throw new HttpsError("invalid-argument", "휴대폰 번호를 확인해 주세요.");
    }

    const snap = await db.collection("orders").where("applicant.phone", "==", phone).get();
    const orders = snap.docs
        .map((doc) => {
            const d = doc.data();
            return {
                orderId: doc.id,
                status: d.status,
                slug: d.slug || "",
                applicantName: d.applicant?.name || "",
                petName: d.memorialDraft?.petName || "",
                plan: d.plan,
                createdAt: d.createdAt ? d.createdAt.toDate().toISOString() : ""
            };
        })
        .filter((o) => o.status === "paid");
    return { orders };
});

// 관리자 링크 재발급 (예전 링크는 즉시 무효)
exports.operatorReissueAdminKey = onCall({ secrets: [OPERATOR_KEY, ...SMS_SECRETS] }, async (request) => {
    assertOperator(request.data?.operatorKey);

    const slug = String(request.data?.slug || "").toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(slug)) {
        throw new HttpsError("invalid-argument", "추모관 주소를 확인해 주세요.");
    }
    const secretRef = db.collection("secrets").doc(slug);
    const secretSnap = await secretRef.get();
    if (!secretSnap.exists) {
        throw new HttpsError("not-found", "추모관을 찾을 수 없습니다.");
    }

    const adminKey = crypto.randomBytes(24).toString("base64url");
    const oldHash = secretSnap.data().adminKeyHash;
    await secretRef.update({
        adminKeyHash: hashKey(adminKey),
        // 예전 키는 '재발급됨' 안내를 위해 기록만 해둠 (예전 키로는 접속 불가)
        previousKeyHashes: oldHash ? FieldValue.arrayUnion(oldHash) : [],
        reissuedAt: FieldValue.serverTimestamp()
    });

    const adminLink = `${SITE_BASE}/admin.html?room=${slug}&key=${adminKey}`;

    // sendSms: true 로 호출하면 결제 때 등록한 번호로 새 주소를 문자 발송
    let sms = "not_requested";
    if (request.data?.sendSms) {
        const orderId = secretSnap.data().orderId;
        const order = orderId ? (await db.collection("orders").doc(orderId).get()).data() : null;
        const memorial = (await db.collection("memorials").doc(slug).get()).data() || {};
        sms = await sendSms(order?.applicant?.phone, reissueMessage({
            petName: memorial.petName || "아이",
            slug,
            adminKey
        }));
    }

    return { adminLink, sms };
});


// =========================================
// 운영자: 추모관 영구 삭제 (보호자 삭제 요청 대응)
// - R2의 사진·영상 전체, 추모관 데이터(발자취·편지·갤러리·추억), 관리자 키를 모두 삭제
// - 주문 기록은 전자상거래법상 보관 의무(5년)가 있어 결제·신청자 정보만 남기고 아이 정보는 지움
// - 실수 방지를 위해 confirm 값에 추모관 주소를 한 번 더 입력해야 실행됨
// =========================================
exports.operatorDeleteMemorial = onCall({ secrets: [OPERATOR_KEY, ...R2_SECRETS], timeoutSeconds: 300 }, async (request) => {
    assertOperator(request.data?.operatorKey);

    const slug = String(request.data?.slug || "").toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(slug)) {
        throw new HttpsError("invalid-argument", "추모관 주소를 확인해 주세요.");
    }
    if (String(request.data?.confirm || "").toUpperCase() !== slug) {
        throw new HttpsError("failed-precondition", "확인을 위해 confirm에 추모관 주소를 똑같이 입력해 주세요.");
    }

    const memorialRef = db.collection("memorials").doc(slug);
    const secretRef = db.collection("secrets").doc(slug);
    const secretSnap = await secretRef.get();
    if (!(await memorialRef.get()).exists && !secretSnap.exists) {
        throw new HttpsError("not-found", "추모관을 찾을 수 없습니다.");
    }

    // 1. R2에서 이 추모관 폴더의 파일 전부 삭제 (1,000개씩 나눠서)
    let deletedFiles = 0;
    let token;
    do {
        const list = await getR2().send(new ListObjectsV2Command({
            Bucket: R2_BUCKET,
            Prefix: `memorials/${slug}/`,
            ContinuationToken: token
        }));
        const keys = (list.Contents || []).map((obj) => ({ Key: obj.Key }));
        if (keys.length > 0) {
            await getR2().send(new DeleteObjectsCommand({ Bucket: R2_BUCKET, Delete: { Objects: keys, Quiet: true } }));
            deletedFiles += keys.length;
        }
        token = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (token);

    // 2. 추모관 데이터 전체 삭제 (발자취·편지·갤러리·추억 하위 데이터 포함)
    await db.recursiveDelete(memorialRef);

    // 3. 주문 기록: 결제·신청자 정보는 법정 보관, 아이 정보는 삭제
    const orderId = secretSnap.exists ? secretSnap.data().orderId : null;
    if (orderId) {
        await db.collection("orders").doc(orderId).update({
            memorialDraft: FieldValue.delete(),
            memorialDeletedAt: FieldValue.serverTimestamp()
        }).catch((err) => console.error("주문 기록 정리 실패:", err));
    }

    // 4. 관리자 키 삭제 (기존 관리자 링크도 모두 무효)
    await secretRef.delete();

    return { deleted: true, slug, deletedFiles };
});


// =========================================
// 관리자: 원본 사진·영상 내려받기 목록 (백업용)
// - 파일마다 1시간짜리 내려받기 주소를 만들어 줌 (브라우저가 바로 파일로 저장)
// =========================================
const DOWNLOAD_EXT = {
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm"
};

function downloadDisposition(filename) {
    // 한글 파일 이름이 깨지지 않도록 두 가지 방식으로 함께 지정
    const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

exports.adminListDownloads = onCall({ secrets: R2_SECRETS }, async (request) => {
    const { slug, key } = request.data || {};
    await assertAdmin(slug, key);

    const memorialRef = db.collection("memorials").doc(slug);
    const memorial = (await memorialRef.get()).data() || {};
    const petName = String(memorial.petName || "onsemiro").replace(/[\\/:*?"<>|]/g, "").trim() || "onsemiro";

    const sign = (path, filename) => getSignedUrl(
        getR2(),
        new GetObjectCommand({ Bucket: R2_BUCKET, Key: path, ResponseContentDisposition: downloadDisposition(filename) }),
        { expiresIn: 3600 }
    );

    const files = [];
    let totalBytes = 0;

    // 대표 사진
    if (memorial.photoPath) {
        const ext = (memorial.photoPath.match(/\.[a-z0-9]+$/i) || [".jpg"])[0];
        files.push({
            name: `${petName}_대표사진${ext}`,
            type: "image",
            group: "대표 사진",
            size: 0,
            previewUrl: mediaUrl(memorial.photoPath),
            url: await sign(memorial.photoPath, `${petName}_대표사진${ext}`)
        });
    }

    // 갤러리·지인이 보낸 사진·영상 (오래된 순)
    const memSnap = await memorialRef.collection("memories").get();
    const memories = memSnap.docs
        .map((doc) => doc.data())
        .filter((m) => m.status !== "uploading")
        .sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));

    const groupOf = (m, f) => {
        if (m.status === "approved" && !f.excluded) return "갤러리 전시 중";
        if (m.status === "pending") return "확인 대기";
        return "전시하지 않음";
    };

    let count = 0;
    for (const m of memories) {
        for (const f of (m.files || [])) {
            if (!f.path) continue;
            count++;
            const ext = DOWNLOAD_EXT[f.contentType] || (f.type === "video" ? ".mp4" : ".jpg");
            const label = f.type === "video" ? "영상" : "사진";
            const name = `${petName}_${label}_${String(count).padStart(3, "0")}${ext}`;
            totalBytes += f.size || 0;
            files.push({
                name,
                type: f.type,
                group: groupOf(m, f),
                size: f.size || 0,
                previewUrl: mediaUrl(f.type === "video" ? f.thumbPath : f.path),
                url: await sign(f.path, name)
            });
        }
    }

    return { files, totalBytes };
});