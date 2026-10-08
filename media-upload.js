// =========================================
// 사진·영상 업로드 공통 도우미 (upload.html, admin.html에서 함께 사용)
// - 사진: 브라우저에서 WebP로 압축 (GIF는 움직임 유지를 위해 원본)
// - 영상: 원본 그대로 + 썸네일 한 장
// - 서버에서 1회용 업로드 주소를 받아 Cloudflare R2에 직접 올림
// =========================================

const MEDIA_BASE = 'https://media.onsemiro.me';

function mediaUrl(path) {
    return path ? `${MEDIA_BASE}/${path}` : '';
}

// 캔버스 → Blob
function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('이미지 변환 실패'))), type, quality);
    });
}

// 크기를 비율 유지하며 줄이기
function fitSize(width, height, maxDim) {
    if (width <= maxDim && height <= maxDim) return { width, height };
    const scale = maxDim / Math.max(width, height);
    return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// 사진 → WebP (최대 1920px, 화질 0.88)
function compressImageFile(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = async () => {
            try {
                const { width, height } = fitSize(img.width, img.height, 1920);
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, width, height);
                const blob = await canvasToBlob(canvas, 'image/webp', 0.88);
                URL.revokeObjectURL(url);
                resolve(blob);
            } catch (err) {
                reject(err);
            }
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('사진을 읽지 못했습니다'));
        };
        img.src = url;
    });
}

// 영상 → 썸네일 WebP (최대 1280px)
function extractVideoThumb(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.muted = true;
        video.playsInline = true;
        video.src = url;

        video.onloadedmetadata = () => {
            video.currentTime = Math.min(1.0, (video.duration || 2) / 2);
        };
        video.onseeked = async () => {
            try {
                const { width, height } = fitSize(video.videoWidth, video.videoHeight, 1280);
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(video, 0, 0, width, height);
                const blob = await canvasToBlob(canvas, 'image/webp', 0.85);
                URL.revokeObjectURL(url);
                resolve(blob);
            } catch (err) {
                reject(err);
            }
        };
        video.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('영상을 읽지 못했습니다'));
        };
    });
}

// 올리기 전 준비: { type, blob, contentType, thumbBlob, previewUrl, name }
async function prepareMediaFile(file) {
    const isVideo = file.type.startsWith('video/');

    if (isVideo) {
        const thumbBlob = await extractVideoThumb(file);
        let contentType = file.type;
        if (!['video/mp4', 'video/quicktime', 'video/webm'].includes(contentType)) {
            contentType = /\.mov$/i.test(file.name) ? 'video/quicktime' : 'video/mp4';
        }
        return {
            type: 'video',
            blob: file,
            contentType,
            thumbBlob,
            previewUrl: URL.createObjectURL(thumbBlob),
            name: file.name
        };
    }

    // GIF는 압축하면 움직임이 사라져서 원본 그대로
    if (file.type === 'image/gif') {
        return { type: 'image', blob: file, contentType: 'image/gif', thumbBlob: null, previewUrl: URL.createObjectURL(file), name: file.name };
    }

    const blob = await compressImageFile(file);
    return { type: 'image', blob, contentType: 'image/webp', thumbBlob: null, previewUrl: URL.createObjectURL(blob), name: file.name };
}

// R2로 파일 하나 올리기 (진행률 표시를 위해 XMLHttpRequest 사용)
function putToR2(url, blob, contentType, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url);
        xhr.setRequestHeader('Content-Type', contentType);
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && onProgress) onProgress(e.loaded);
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300)
            ? resolve()
            : reject(new Error(`업로드 실패 (${xhr.status})`));
        xhr.onerror = () => reject(new Error('네트워크 연결이 끊겼습니다'));
        xhr.send(blob);
    });
}

// 추억 한 묶음 올리기
// options: { slug, key(보호자일 때만), sender, relation, story, items(prepareMediaFile 결과), onProgress(0~100) }
async function uploadMemory(options) {
    const { slug, key, sender, relation, story, items, onProgress } = options;

    // 1. 서버에 업로드 주소 요청 (형식·용량 검사)
    const created = await functions.httpsCallable('createMemoryUpload')({
        slug,
        key: key || '',
        sender,
        relation,
        story,
        files: items.map(item => ({
            type: item.type,
            contentType: item.contentType,
            size: item.blob.size,
            thumbSize: item.thumbBlob ? item.thumbBlob.size : 0
        }))
    });
    const { memoryId, uploads } = created.data;

    // 2. 파일들을 R2에 직접 올리기 (전체 진행률 계산)
    const total = items.reduce((sum, item) => sum + item.blob.size + (item.thumbBlob ? item.thumbBlob.size : 0), 0);
    let done = 0;
    const report = (loadedNow) => {
        if (onProgress) onProgress(Math.min(99, Math.round(((done + loadedNow) / total) * 100)));
    };

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.thumbBlob) {
            await putToR2(uploads[i].thumbUrl, item.thumbBlob, 'image/webp', report);
            done += item.thumbBlob.size;
        }
        await putToR2(uploads[i].url, item.blob, item.contentType, report);
        done += item.blob.size;
    }

    // 3. 서버에 완료 알리기 (실제로 올라갔는지 확인 후 상태 변경)
    const completed = await functions.httpsCallable('completeMemoryUpload')({ slug, memoryId });
    if (onProgress) onProgress(100);
    return completed.data;
}