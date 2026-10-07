// 이름 끝에 받침이 있으면 '이'를 붙여 부르는 이름으로 바꿔줍니다.
// (하임 → 하임이, 코코 → 코코) 뒤에 붙는 조사는 항상 받침 없는 형태(가/를/와/의/에게)로 쓰면 됩니다.
function callName(name) {
    if (!name) return '';
    const lastChar = name.charCodeAt(name.length - 1);
    if (lastChar < 0xAC00 || lastChar > 0xD7A3) return name;
    return (lastChar - 0xAC00) % 28 > 0 ? name + '이' : name;
}

let selectedFiles = [];

// 기기 환경 감지 (모바일: 200MB, PC: 500MB)
function getMaxFileSize() {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    return {
        limit: isMobile ? 200 * 1024 * 1024 : 500 * 1024 * 1024,
        limitText: isMobile ? '200MB' : '500MB',
        isMobile: isMobile
    };
}

// 아이 이름, 룸 파라미터 및 되돌아가기 링크 연동
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');

    const backLink = document.querySelector('.back-link');
    if (backLink && roomParam) {
        backLink.href = `sample.html?room=${roomParam}`;
    }

    let petName = '코코';
    const rawData = localStorage.getItem('recentMemorialOrder');
    if (rawData) {
        try {
            const order = JSON.parse(rawData);
            if (order.petName) petName = order.petName;
        } catch (e) {
            console.error(e);
        }
    } else if (roomParam) {
        const allOrders = localStorage.getItem('memorialOrders');
        if (allOrders) {
            try {
                const list = JSON.parse(allOrders);
                const matched = list.find(item => item.roomSlug === roomParam);
                if (matched && matched.petName) petName = matched.petName;
            } catch (e) {
                console.error(e);
            }
        }
    }

    document.title = `${callName(petName)}와의 추억 모으기 | 온새미로`;
    const nameEl = document.getElementById('targetPetName');
    const guideEl = document.getElementById('targetPetGuide');
    if (nameEl) nameEl.innerText = callName(petName);
    if (guideEl) guideEl.innerText = callName(petName);

    // '코코와의 관계' 라벨과 이야기 입력칸 안내 문구도 아이 이름으로 교체
    const relationLabel = document.getElementById('senderRelation')?.closest('.form-group')?.querySelector('.form-label');
    if (relationLabel && relationLabel.firstChild) {
        relationLabel.firstChild.textContent = `${callName(petName)}와의 관계 `;
    }
    const storyInput = document.getElementById('memoryStory');
    if (storyInput) {
        storyInput.placeholder = `언제 찍은 사진인지, 또는 ${callName(petName)}와 함께했던 소중한 추억 이야기를 자유롭게 적어주세요.`;
    }
});

// 이미지 -> WebP 고화질 보존 압축 (최대 FHD 1920px, 퀄리티 0.88)
function compressImageToWebp(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (e) => {
            const img = new Image();
            img.src = e.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                const maxDim = 1920; // FHD 고해상도 규격

                if (width > maxDim || height > maxDim) {
                    if (width > height) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    } else {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');

                // 렌더링 스무딩 품질 극대화
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, width, height);

                // 시각적 무손실 구간 (0.88)
                const webpDataUrl = canvas.toDataURL('image/webp', 0.88);
                resolve({ dataUrl: webpDataUrl, type: 'image' });
            };
            img.onerror = reject;
        };
        reader.onerror = reject;
    });
}

// 비디오 프레임 추출 -> 고화질 WebP 변환
function extractVideoThumbnailToWebp(file) {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.muted = true;
        video.playsInline = true;
        video.src = URL.createObjectURL(file);

        video.onloadedmetadata = () => {
            video.currentTime = Math.min(1.0, video.duration / 2);
        };

        video.onseeked = () => {
            const canvas = document.createElement('canvas');
            let width = video.videoWidth;
            let height = video.videoHeight;
            const maxDim = 1280; // 비디오 썸네일 HD 규격

            if (width > maxDim || height > maxDim) {
                if (width > height) {
                    height = Math.round((height * maxDim) / width);
                    width = maxDim;
                } else {
                    width = Math.round((width * maxDim) / height);
                    height = maxDim;
                }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(video, 0, 0, width, height);

            const webpDataUrl = canvas.toDataURL('image/webp', 0.88);
            URL.revokeObjectURL(video.src);
            resolve({ dataUrl: webpDataUrl, type: 'video' });
        };

        video.onerror = reject;
    });
}

function appendPreviewItem(container, src, type, fileName) {
    const item = document.createElement('div');
    item.className = 'preview-item';

    item.innerHTML = `
        <img src="${src}" alt="미리보기">
        ${type === 'video' ? '<span style="position:absolute; bottom:4px; right:4px; font-size:10px; background:rgba(0,0,0,0.6); color:#fff; padding:2px 4px; border-radius:4px;">VIDEO</span>' : ''}
        <button type="button" class="btn-remove-preview" onclick="removeFile(this, '${fileName}')">✕</button>
    `;
    container.appendChild(item);
}

function removeFile(btn, fileName) {
    selectedFiles = selectedFiles.filter(f => f.name !== fileName);
    btn.parentElement.remove();
}

async function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    const grid = document.getElementById('previewGrid');

    if (selectedFiles.length + files.length > 3) {
        alert("추억 파일은 한 번에 최대 3개까지만 등록할 수 있습니다.");
        e.target.value = '';
        return;
    }

    const { limit, isMobile } = getMaxFileSize();
    const loader = document.getElementById('compressLoading');
    const progressText = document.getElementById('compressProgress');

    for (const file of files) {
        // 원본 선택 용량 체크 (모바일 200MB / PC 500MB)
        if (file.size > limit) {
            const currentMB = (file.size / (1024 * 1024)).toFixed(1);
            if (isMobile) {
                alert(`"${file.name}" 파일(${currentMB}MB)이 200MB를 초과했습니다.\n현재 링크 그대로 PC에서 접속하시면 500MB까지 등록하실 수 있습니다.`);
            } else {
                alert(`"${file.name}" 파일이 500MB를 초과하여 첨부할 수 없습니다.`);
            }
            continue;
        }

        if (loader) loader.style.display = 'flex';
        if (progressText) progressText.innerText = `"${file.name}" 고화질로 변환 중...`;

        try {
            if (file.type.startsWith('image/')) {
                const compressed = await compressImageToWebp(file);
                selectedFiles.push({
                    name: file.name,
                    data: compressed.dataUrl,
                    type: 'image',
                    excluded: false
                });
                appendPreviewItem(grid, compressed.dataUrl, 'image', file.name);
            } else if (file.type.startsWith('video/')) {
                const compressed = await extractVideoThumbnailToWebp(file);
                selectedFiles.push({
                    name: file.name,
                    data: compressed.dataUrl,
                    type: 'video',
                    excluded: false
                });
                appendPreviewItem(grid, compressed.dataUrl, 'video', file.name);
            }
        } catch (err) {
            console.error("고화질 변환 실패:", err);
            alert(`"${file.name}" 파일을 처리하지 못했습니다. 다른 파일로 시도해 주세요.`);
        }
    }

    if (loader) loader.style.display = 'none';
    e.target.value = '';
}

function handleUploadSubmit(e) {
    e.preventDefault();

    if (selectedFiles.length === 0) {
        alert("사진이나 영상을 최소 1개 이상 등록해 주세요.");
        return;
    }

    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const formattedDate = `${yyyy}. ${mm}. ${dd}.`;

    const newMemory = {
        id: 'MEM-' + Date.now(),
        sender: document.getElementById('senderName').value.trim(),
        relation: document.getElementById('senderRelation').value.trim(),
        story: document.getElementById('memoryStory').value.trim(),
        files: selectedFiles,
        status: 'pending',
        submittedAt: formattedDate
    };

    try {
        const existingList = JSON.parse(localStorage.getItem('pendingMemories') || '[]');
        existingList.unshift(newMemory);
        localStorage.setItem('pendingMemories', JSON.stringify(existingList));

        showToast("소중한 추억이 가족분들께 안전하게 전달되었습니다.");

        setTimeout(() => {
            document.getElementById('memoryForm').reset();
            document.getElementById('previewGrid').innerHTML = '';
            selectedFiles = [];
        }, 800);
    } catch (err) {
        console.error("스토리지 저장 실패:", err);
        alert("브라우저 저장 공간이 가득 찼습니다. 기존 항목을 검수한 후 다시 시도해 주세요.");
    }
}

function showToast(message) {
    const toast = document.getElementById("toastMessage");
    if (!toast) return;
    toast.innerText = message;
    toast.classList.add("show");
    setTimeout(() => {
        toast.classList.remove("show");
    }, 2500);
}