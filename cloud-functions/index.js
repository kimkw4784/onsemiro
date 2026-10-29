const { setGlobalOptions } = require("firebase-functions");
const { onCall, HttpsError } = require("firebase-functions/https");
const { onSchedule } = require("firebase-functions/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");
const { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand, ListObjectsV2Command, DeleteObjectsCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { SolapiMessageService } = require("solapi");

const ENFORCE_APP_CHECK = false;

initializeApp();
const db = getFirestore();

const TOSS_SECRET_KEY = defineSecret("TOSS_SECRET_KEY");

const OPERATOR_KEY = defineSecret("OPERATOR_KEY");

const SOLAPI_API_KEY = defineSecret("SOLAPI_API_KEY");
const SOLAPI_API_SECRET = defineSecret("SOLAPI_API_SECRET");
const SMS_SECRETS = [SOLAPI_API_KEY, SOLAPI_API_SECRET];

const SMS_SENDER = "01025544784";

const SITE_BASE = "https://onsemiro.me";

const KAKAO_PF_ID = "KA01PF261027003134109LR1B22qL6zZ";
const KAKAO_TEMPLATES = {
    opening: "KA01TP261027004805061x7xkQdiZu9t",
    reissue: "KA01TP261027005325313ua2cVZoeBvo",
    farewell: "KA01TP2610270057360245XN6RgWO0Z6",
    meet: "KA01TP261027005844224VARDYZSvupl"
};

const R2_ACCESS_KEY_ID = defineSecret("R2_ACCESS_KEY_ID");
const R2_SECRET_ACCESS_KEY = defineSecret("R2_SECRET_ACCESS_KEY");
const R2_ACCOUNT_ID = defineSecret("R2_ACCOUNT_ID");
const R2_SECRETS = [R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID];
const R2_BUCKET = "onsemiro-media";
const MEDIA_BASE = "https://media.onsemiro.me";

const UPLOAD_LIMITS = {
    maxFilesPerMemory: 10,
    imageBytes: 30 * 1024 * 1024,
    videoBytes: 500 * 1024 * 1024,
    thumbBytes: 2 * 1024 * 1024
};
const IMAGE_TYPES = ["image/webp", "image/jpeg", "image/png", "image/gif"];
const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

setGlobalOptions({ region: "asia-northeast3", maxInstances: 10 });

const PLANS = {
    essential: { price: 19500, name: "에센셜 아카이브", storageBytes: 20 * 1024 * 1024 * 1024 },
    signature: { price: 49000, name: "시그니처 아카이브", storageBytes: 50 * 1024 * 1024 * 1024 }
};

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

function cleanText(value, maxLength) {
    return String(value || "").trim().slice(0, maxLength);
}

function toIsoDate(value) {
    const digits = String(value || "").replace(/[^\d]/g, "");
    if (digits.length !== 8) return "";
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function callName(name) {
    if (!name) return "";
    const code = name.charCodeAt(name.length - 1);
    if (code < 0xAC00 || code > 0xD7A3) return name;
    return (code - 0xAC00) % 28 > 0 ? name + "이" : name;
}

function generateSlug() {
    const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    let slug = "";
    for (let i = 0; i < 6; i++) {
        slug += chars[crypto.randomInt(chars.length)];
    }
    return slug;
}

async function generateUniqueSlug() {
    for (let i = 0; i < 10; i++) {
        const slug = generateSlug();
        const exists = await db.collection("memorials").doc(slug).get();
        if (!exists.exists) return slug;
    }
    throw new HttpsError("internal", "추모관 주소를 만들지 못했습니다. 다시 시도해 주세요.");
}

function hashKey(key) {
    return crypto.createHash("sha256").update(key).digest("hex");
}

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

async function sendSms(to, text, subject = "[온새미로] 추모관 안내") {
    const from = SMS_SENDER.replace(/[^\d]/g, "");
    if (!from || !to) return "skipped";
    try {
        const service = new SolapiMessageService(SOLAPI_API_KEY.value().trim(), SOLAPI_API_SECRET.value().trim());
        await service.send({ to, from, text, subject });
        return "sent";
    } catch (err) {
        console.error("문자 발송 실패:", err);
        return "failed";
    }
}

async function sendNotice(to, { template, variables, fallbackText, subject }) {
    const from = SMS_SENDER.replace(/[^\d]/g, "");
    if (!from || !to) return "skipped";
    try {
        const service = new SolapiMessageService(SOLAPI_API_KEY.value().trim(), SOLAPI_API_SECRET.value().trim());
        await service.send({
            to,
            from,
            kakaoOptions: {
                pfId: KAKAO_PF_ID,
                templateId: KAKAO_TEMPLATES[template],
                variables,
                disableSms: false
            }
        });
        return "sent";
    } catch (err) {
        console.error("알림톡 발송 실패, 문자로 대체:", err);
        return sendSms(to, fallbackText, subject);
    }
}

function openingMessage({ applicantName, petName, slug, adminKey }) {
    return [
        "[온새미로] 추모관 개설 안내",
        "",
        `${applicantName}님, 신청하신 ${petName}의 온새미로 추모관 개설이 완료되었습니다.`,
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

exports.createOrder = onCall({ enforceAppCheck: ENFORCE_APP_CHECK, secrets: [...R2_SECRETS, ...SMS_SECRETS] }, async (request) => {
    const data = request.data || {};
    const giftCode = String(data.giftCode || "").trim().toUpperCase();
    let giftPlan = null;
    if (giftCode) {
        const giftSnap = await db.collection("giftCodes").doc(giftCode).get();
        if (!giftSnap.exists || giftSnap.data().used) {
            throw new HttpsError("failed-precondition", "사용할 수 없는 선물 코드예요. 코드를 다시 확인해 주세요.");
        }
        giftPlan = giftSnap.data().plan;
    }
    const planKey = giftPlan || data.plan;
    const plan = PLANS[planKey];
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

    const photo = typeof memorial.photo === "string" && memorial.photo.startsWith("data:image/")
        && memorial.photo.length < 700000 ? memorial.photo : "";

    const bgmRaw = String(memorial.bgm || "");
    const bgm = BGM_KEYS.includes(bgmRaw) ? bgmRaw : (BGM_TITLE_TO_KEY[bgmRaw] || "piano");

    const orderId = `ONSEMIRO_${Date.now()}_${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const orderName = `온새미로 ${plan.name} (${petName})`;

    const orderRef = db.collection("orders").doc(orderId);
    await orderRef.set({
        status: giftCode ? "confirming" : "pending",
        plan: planKey,
        amount: giftCode ? 0 : plan.price,
        giftCode: giftCode || null,
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
            photo,
            reminder: memorial.reminder === true
        },
        createdAt: FieldValue.serverTimestamp()
    });

    if (!giftCode) {
        return { orderId, amount: plan.price, orderName };
    }

    const giftRef = db.collection("giftCodes").doc(giftCode);
    try {
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(giftRef);
            if (!snap.exists || snap.data().used) {
                throw new HttpsError("failed-precondition", "사용할 수 없는 선물 코드예요. 코드를 다시 확인해 주세요.");
            }
            tx.update(giftRef, { used: true, usedAt: FieldValue.serverTimestamp(), orderId });
        });
    } catch (err) {
        await orderRef.update({ status: "failed", failure: { code: "GIFT_CODE", message: err.message || "" } });
        throw err;
    }

    const savedOrder = (await orderRef.get()).data();
    const result = await openMemorial(orderRef, orderId, savedOrder, { status: "paid", method: "GIFT" });
    return { ...result, gift: true };
});

async function openMemorial(orderRef, orderId, order, paidFields) {
    const slug = await generateUniqueSlug();
    const adminKey = crypto.randomBytes(24).toString("base64url");
    const draft = order.memorialDraft || {};

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
        reminderEnabled: draft.reminder === true,
        photoUrl,
        photoPath: photo ? photo.path : "",
        storageBytes: 0,
        plan: order.plan,
        counts: { treat: 1, toy: 1, candle: 1 },
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
    });

    batch.set(db.collection("secrets").doc(slug), {
        adminKeyHash: hashKey(adminKey),
        orderId,
        createdAt: FieldValue.serverTimestamp()
    });

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
        ...paidFields,
        slug,
        "memorialDraft.photo": FieldValue.delete()
    });

    await batch.commit();

    const applicantName = order.applicant?.name || "보호자";
    const smsResult = await sendNotice(order.applicant?.phone, {
        template: "opening",
        variables: {
            "#{신청자}": applicantName,
            "#{아이이름}": draft.petName,
            "#{추모관주소}": `${SITE_BASE}/memorial.html?room=${slug}`,
            "#{모으기주소}": `${SITE_BASE}/upload.html?room=${slug}`,
            "#{관리자주소}": `${SITE_BASE}/admin.html?room=${slug}&key=${adminKey}`
        },
        fallbackText: openingMessage({ applicantName, petName: draft.petName, slug, adminKey })
    });
    await orderRef.update({ notification: { sms: smsResult, at: FieldValue.serverTimestamp() } });

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
}

exports.confirmPayment = onCall({ enforceAppCheck: ENFORCE_APP_CHECK, secrets: [TOSS_SECRET_KEY, ...R2_SECRETS, ...SMS_SECRETS] }, async (request) => {
    const { paymentKey, orderId } = request.data || {};
    const amount = Number(request.data?.amount);

    if (!paymentKey || !orderId || !amount) {
        throw new HttpsError("invalid-argument", "결제 정보가 올바르지 않습니다.");
    }

    const orderRef = db.collection("orders").doc(orderId);

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

    if (amount !== order.amount) {
        await orderRef.update({ status: "amount_mismatch", requestedAmount: amount });
        throw new HttpsError("failed-precondition", "결제 금액이 주문 금액과 일치하지 않습니다.");
    }

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

    return openMemorial(orderRef, orderId, order, {
        status: "paid",
        paymentKey,
        method: payment.method || "",
        approvedAt: payment.approvedAt || ""
    });
});

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

    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        if ((secret.previousKeyHashes || []).includes(keyHash)) {
            throw new HttpsError("permission-denied", "관리자 링크가 재발급되었습니다.", { reason: "reissued" });
        }
        throw denied;
    }
}

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
        storageLimit: storageLimitOf(m.plan),
        reminderEnabled: m.reminderEnabled === true
    };
}

exports.verifyAdmin = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    const { slug, key } = request.data || {};
    await assertAdmin(slug, key);

    const snap = await db.collection("memorials").doc(slug).get();
    if (!snap.exists) {
        throw new HttpsError("not-found", "추모관을 찾을 수 없습니다.");
    }
    return { memorial: pickMemorial(snap.data()) };
});

exports.updateMemorialInfo = onCall({ enforceAppCheck: ENFORCE_APP_CHECK, secrets: R2_SECRETS }, async (request) => {
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

    if (update.photoPath && before.photoPath && before.photoPath !== update.photoPath) {
        await deleteR2Object(before.photoPath);
    }

    const saved = await ref.get();
    return { memorial: pickMemorial(saved.data()) };
});

exports.adminSaveTimeline = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
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

exports.adminDeleteTimeline = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    const { slug, key, id } = request.data || {};
    await assertAdmin(slug, key);
    if (!id) throw new HttpsError("invalid-argument", "삭제할 발자취를 확인해 주세요.");

    await db.collection("memorials").doc(slug).collection("timeline").doc(String(id)).delete();
    return { ok: true };
});

exports.adminListLetters = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
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

exports.adminUpdateLetter = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
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

async function syncGallery(slug, memoryId, memory) {
    const galleryRef = db.collection("memorials").doc(slug).collection("gallery");
    const old = await galleryRef.where("memoryId", "==", memoryId).get();
    const batch = db.batch();
    old.docs.forEach((doc) => batch.delete(doc.ref));

    if (memory && memory.status === "approved") {
        const baseLabel = memory.isDirect ? (memory.sender || "보호자") : `${memory.relation || ""} ${memory.sender || ""}`.trim();
        (memory.files || []).forEach((file, index) => {
            if (file.excluded) return;
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

exports.createMemoryUpload = onCall({ enforceAppCheck: ENFORCE_APP_CHECK, secrets: R2_SECRETS }, async (request) => {
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

    const sender = isDirect ? (cleanText(data.sender, 20) || "보호자") : cleanText(data.sender, 20);
    const relation = isDirect ? "" : cleanText(data.relation, 20);
    const story = cleanText(data.story, 1000);
    if (!isDirect && (!sender || !relation)) {
        throw new HttpsError("invalid-argument", "보내는 분 성함과 관계를 입력해 주세요.");
    }

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

exports.completeMemoryUpload = onCall({ enforceAppCheck: ENFORCE_APP_CHECK, secrets: R2_SECRETS }, async (request) => {
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

exports.adminListMemories = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
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

    const memorial = (await db.collection("memorials").doc(slug).get()).data() || {};
    return {
        memories,
        storageBytes: memorial.storageBytes || 0,
        storageLimit: storageLimitOf(memorial.plan)
    };
});

exports.adminReviewMemory = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
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

exports.adminUpdateMemoryStory = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
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
        const files = memory.files.map((f) => ({ ...f }));
        files[fileIndex].story = story;
        if (hasSender) files[fileIndex].sender = sender;
        update = { files };
    } else {
        update = { story };
        if (hasSender) update.sender = sender;
    }

    await ref.update(update);
    await syncGallery(slug, ref.id, { ...memory, ...update });
    return { ok: true };
});

exports.adminDeleteMemoryFile = onCall({ enforceAppCheck: ENFORCE_APP_CHECK, secrets: R2_SECRETS }, async (request) => {
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

function assertOperator(key) {
    const expected = Buffer.from(OPERATOR_KEY.value().trim());
    const actual = Buffer.from(String(key || ""));
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        throw new HttpsError("permission-denied", "운영자 인증에 실패했습니다.");
    }
}

exports.operatorFindOrders = onCall({ enforceAppCheck: ENFORCE_APP_CHECK, secrets: [OPERATOR_KEY] }, async (request) => {
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

exports.operatorReissueAdminKey = onCall({ enforceAppCheck: ENFORCE_APP_CHECK, secrets: [OPERATOR_KEY, ...SMS_SECRETS] }, async (request) => {
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
        previousKeyHashes: oldHash ? FieldValue.arrayUnion(oldHash) : [],
        reissuedAt: FieldValue.serverTimestamp()
    });

    const adminLink = `${SITE_BASE}/admin.html?room=${slug}&key=${adminKey}`;

    let sms = "not_requested";
    if (request.data?.sendSms) {
        const orderId = secretSnap.data().orderId;
        const order = orderId ? (await db.collection("orders").doc(orderId).get()).data() : null;
        const memorial = (await db.collection("memorials").doc(slug).get()).data() || {};
        const petName = memorial.petName || "아이";
        sms = await sendNotice(order?.applicant?.phone, {
            template: "reissue",
            variables: {
                "#{아이이름}": petName,
                "#{관리자주소}": adminLink
            },
            fallbackText: reissueMessage({ petName, slug, adminKey })
        });
    }

    return { adminLink, sms };
});

exports.operatorDeleteMemorial = onCall({ enforceAppCheck: ENFORCE_APP_CHECK, secrets: [OPERATOR_KEY, ...R2_SECRETS], timeoutSeconds: 300 }, async (request) => {
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

    await db.recursiveDelete(memorialRef);

    const orderId = secretSnap.exists ? secretSnap.data().orderId : null;
    if (orderId) {
        await db.collection("orders").doc(orderId).update({
            memorialDraft: FieldValue.delete(),
            memorialDeletedAt: FieldValue.serverTimestamp()
        }).catch((err) => console.error("주문 기록 정리 실패:", err));
    }

    await secretRef.delete();

    return { deleted: true, slug, deletedFiles };
});

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
    const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

exports.adminListDownloads = onCall({ enforceAppCheck: ENFORCE_APP_CHECK, secrets: R2_SECRETS }, async (request) => {
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

exports.adminSetReminder = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async (request) => {
    const { slug, key, enabled } = request.data || {};
    await assertAdmin(slug, key);
    await db.collection("memorials").doc(slug).update({
        reminderEnabled: Boolean(enabled),
        updatedAt: FieldValue.serverTimestamp()
    });
    return { reminderEnabled: Boolean(enabled) };
});

function kstToday() {
    const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

function isLeapYear(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function anniversaryYears(iso, today) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!match) return 0;
    const year = Number(match[1]);
    const month = Number(match[2]);
    let day = Number(match[3]);
    if (month === 2 && day === 29 && !isLeapYear(today.y)) day = 28;
    if (month !== today.m || day !== today.d) return 0;
    return today.y - year;
}

function sendReminder(phone, type, petName, years, slug) {
    return sendNotice(phone, {
        template: type === "farewell" ? "farewell" : "meet",
        variables: {
            "#{부르는이름}": callName(petName),
            "#{햇수}": String(years),
            "#{아이이름}": petName,
            "#{추모관주소}": `${SITE_BASE}/memorial.html?room=${slug}`
        },
        fallbackText: reminderMessage(type, petName, years, slug),
        subject: "[온새미로] 기념일 안내"
    });
}

function reminderMessage(type, petName, years, slug) {
    const name = callName(petName);
    const line = type === "farewell"
        ? `오늘은 ${name}가 별이 된 지 ${years}년이 되는 날이에요.`
        : `오늘은 ${name}를 처음 만난 지 ${years}년이 되는 날이에요.`;
    return [
        type === "farewell" ? "[온새미로] 기일 안내" : "[온새미로] 기념일 안내",
        "",
        line,
        `${name}를 떠올리며 추모관에 따뜻한 마음을 남겨주세요.`,
        "",
        `■ ${petName}의 추모관`,
        `${SITE_BASE}/memorial.html?room=${slug}`,
        "",
        type === "farewell"
            ? "이 메시지는 고객님께서 신청하신 기일 알림으로, 등록하신 별이 된 날이 되면 매년 발송됩니다."
            : "이 메시지는 고객님께서 신청하신 기념일 알림으로, 등록하신 처음 만난 날이 되면 매년 발송됩니다.",
        "알림을 원하지 않으시면 관리자 화면의 정보 수정에서 끌 수 있어요."
    ].join("\n");
}

exports.sendAnniversaryReminders = onSchedule({
    schedule: "0 10 * * *",
    timeZone: "Asia/Seoul",
    secrets: SMS_SECRETS,
    timeoutSeconds: 540
}, async () => {
    const today = kstToday();
    const todayKey = `${today.y}-${String(today.m).padStart(2, "0")}-${String(today.d).padStart(2, "0")}`;
    const snap = await db.collection("memorials").get();

    for (const doc of snap.docs) {
        const memorial = doc.data();
        if (memorial.reminderEnabled !== true) continue;

        const events = [];
        const farewellYears = anniversaryYears(memorial.farewellDate, today);
        if (farewellYears > 0) events.push(["farewell", farewellYears]);
        const meetYears = anniversaryYears(memorial.meetDate, today);
        if (meetYears > 0) events.push(["meet", meetYears]);
        if (events.length === 0) continue;

        const secretRef = db.collection("secrets").doc(doc.id);
        const secret = (await secretRef.get()).data() || {};
        if (!secret.orderId || secret.lastReminderDate === todayKey) continue;

        const order = (await db.collection("orders").doc(secret.orderId).get()).data() || {};
        const phone = order.applicant?.phone;
        if (!phone) continue;

        for (const [type, years] of events) {
            const result = await sendReminder(phone, type, memorial.petName || "아이", years, doc.id);
            console.log(`기념일 알림 ${doc.id} ${type}: ${result}`);
        }
        await secretRef.update({ lastReminderDate: todayKey });
    }
});

exports.operatorTestReminder = onCall({ enforceAppCheck: ENFORCE_APP_CHECK, secrets: [OPERATOR_KEY, ...SMS_SECRETS] }, async (request) => {
    assertOperator(request.data?.operatorKey);

    const slug = String(request.data?.slug || "").toUpperCase();
    const type = request.data?.type === "meet" ? "meet" : "farewell";
    const memorial = (await db.collection("memorials").doc(slug).get()).data();
    if (!memorial) throw new HttpsError("not-found", "추모관을 찾을 수 없습니다.");

    const secret = (await db.collection("secrets").doc(slug).get()).data() || {};
    const order = secret.orderId ? (await db.collection("orders").doc(secret.orderId).get()).data() || {} : {};
    const phone = order.applicant?.phone;
    if (!phone) throw new HttpsError("failed-precondition", "등록된 휴대폰 번호가 없습니다.");

    const sms = await sendReminder(phone, type, memorial.petName || "아이", 1, slug);
    return { sms };
});

const GIFT_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomGiftPart(length) {
    const bytes = crypto.randomBytes(length);
    return Array.from(bytes, (b) => GIFT_CODE_CHARS[b % GIFT_CODE_CHARS.length]).join("");
}

exports.operatorCreateGiftCodes = onCall({ enforceAppCheck: ENFORCE_APP_CHECK, secrets: [OPERATOR_KEY] }, async (request) => {
    assertOperator(request.data?.operatorKey);

    const plan = PLANS[request.data?.plan] ? request.data.plan : "essential";
    const note = cleanText(request.data?.note, 100);
    const count = Math.min(20, Math.max(1, Number(request.data?.count) || 1));

    const codes = [];
    for (let i = 0; i < count; i++) {
        let code;
        let ref;
        do {
            code = `GIFT-${randomGiftPart(4)}-${randomGiftPart(4)}`;
            ref = db.collection("giftCodes").doc(code);
        } while ((await ref.get()).exists);
        await ref.set({ plan, note, used: false, createdAt: FieldValue.serverTimestamp() });
        codes.push(code);
    }
    return { plan, codes };
});
