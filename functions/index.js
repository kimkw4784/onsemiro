const { setGlobalOptions } = require("firebase-functions");
const { onCall, HttpsError } = require("firebase-functions/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");
const { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

initializeApp();
const db = getFirestore();

// 토스 시크릿 키 (Firebase 비밀 값 보관함에서 꺼내 씀 - 코드에는 절대 적지 않음)
const TOSS_SECRET_KEY = defineSecret("TOSS_SECRET_KEY");

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
    thumbBytes: 2 * 1024 * 1024,         // 영상 썸네일
    memorialBytes: 20 * 1024 * 1024 * 1024 // 추모관 1곳 전체
};
const IMAGE_TYPES = ["image/webp", "image/jpeg", "image/png", "image/gif"];
const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

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
exports.confirmPayment = onCall({ secrets: [TOSS_SECRET_KEY, ...R2_SECRETS] }, async (request) => {
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
            story: `손바닥만 하던 ${callName(draft.petName)}가 처음 우리 집에 오던 날, 온 세상이 따뜻해졌어.`,
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
        const senderLabel = memory.isDirect ? "보호자" : `${memory.relation || ""} ${memory.sender || ""}`.trim();
        (memory.files || []).forEach((file, index) => {
            if (file.excluded) return;
            batch.set(galleryRef.doc(`${memoryId}_${index}`), {
                memoryId,
                fileIndex: index,
                type: file.type,
                path: file.path,
                thumbPath: file.thumbPath || "",
                story: memory.story || "",
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

    const sender = isDirect ? "보호자" : cleanText(data.sender, 20);
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
    if (used + totalBytes > UPLOAD_LIMITS.memorialBytes) {
        throw new HttpsError("resource-exhausted", "추모관 저장 공간이 가득 찼습니다. 보호자님께 문의해 주세요.");
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
                    excluded: Boolean(f.excluded)
                })),
                createdAt: d.createdAt ? d.createdAt.toMillis() : 0
            };
        })
        .filter((m) => m.status !== "uploading");
    memories.sort((a, b) => b.createdAt - a.createdAt);
    return { memories };
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

    const story = cleanText(request.data?.story, 1000);
    await ref.update({ story });
    await syncGallery(slug, ref.id, { ...snap.data(), story });
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