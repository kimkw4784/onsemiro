function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('이미지 변환 실패'))), type, quality);
    });
}

function fitSize(width, height, maxDim) {
    if (width <= maxDim && height <= maxDim) return { width, height };
    const scale = maxDim / Math.max(width, height);
    return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

const HEIC_LIB_URL = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
let heicLibPromise = null;

function isHeicFile(file) {
    return /image\/hei(c|f)/i.test(file.type || '') || /\.(heic|heif)$/i.test(file.name || '');
}

function loadHeicLib() {
    if (window.heic2any) return Promise.resolve();
    if (!heicLibPromise) {
        heicLibPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = HEIC_LIB_URL;
            script.onload = resolve;
            script.onerror = () => {
                heicLibPromise = null;
                reject(new Error('HEIC 사진 변환 도구를 불러오지 못했습니다'));
            };
            document.head.appendChild(script);
        });
    }
    return heicLibPromise;
}

function loadImageElement(blob) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => resolve({ img, url });
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('사진을 읽지 못했습니다'));
        };
        img.src = url;
    });
}

async function decodeImageFile(file) {
    try {
        return await loadImageElement(file);
    } catch (err) {
        if (!isHeicFile(file)) throw err;
        await loadHeicLib();
        const converted = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
        return loadImageElement(Array.isArray(converted) ? converted[0] : converted);
    }
}

async function compressImageFile(file) {
    const { img, url } = await decodeImageFile(file);
    try {
        const { width, height } = fitSize(img.width, img.height, 1920);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);
        return await canvasToBlob(canvas, 'image/webp', 0.88);
    } finally {
        URL.revokeObjectURL(url);
    }
}

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

    if (file.type === 'image/gif') {
        return { type: 'image', blob: file, contentType: 'image/gif', thumbBlob: null, previewUrl: URL.createObjectURL(file), name: file.name };
    }

    const blob = await compressImageFile(file);
    return { type: 'image', blob, contentType: 'image/webp', thumbBlob: null, previewUrl: URL.createObjectURL(blob), name: file.name };
}

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

async function uploadMemory(options) {
    const { slug, key, sender, relation, story, items, onProgress } = options;

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

    const completed = await functions.httpsCallable('completeMemoryUpload')({ slug, memoryId });
    if (onProgress) onProgress(100);
    return completed.data;
}
