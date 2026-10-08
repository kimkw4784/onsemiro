// 이름 끝에 받침이 있으면 '이'를 붙여 부르는 이름으로 바꿔줍니다.
// (하임 → 하임이, 코코 → 코코) 뒤에 붙는 조사는 항상 받침 없는 형태(가/를/와/의/에게)로 쓰면 됩니다.
function callName(name) {
    if (!name) return '';
    const lastChar = name.charCodeAt(name.length - 1);
    if (lastChar < 0xAC00 || lastChar > 0xD7A3) return name;
    return (lastChar - 0xAC00) % 28 > 0 ? name + '이' : name;
}

let selectedFiles = [];     // prepareMediaFile 결과 목록
let uploadRoom = '';

// 기기 환경 감지 (모바일: 200MB, PC: 500MB)
function getMaxFileSize() {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    return {
        limit: isMobile ? 200 * 1024 * 1024 : 500 * 1024 * 1024,
        limitText: isMobile ? '200MB' : '500MB',
        isMobile: isMobile
    };
}

// 추모관 정보 불러와서 아이 이름, 돌아가기 링크 연결
document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    uploadRoom = (urlParams.get('room') || '').trim().toUpperCase();

    let memorial = null;
    if (uploadRoom) {
        try {
            const snap = await db.collection('memorials').doc(uploadRoom).get();
            if (snap.exists) memorial = snap.data();
        } catch (err) {
            console.error('추모관 불러오기 실패:', err);
        }
    }

    if (!memorial) {
        showUploadUnavailable();
        return;
    }

    const backLink = document.querySelector('.back-link');
    if (backLink) backLink.href = `memorial.html?room=${uploadRoom}`;

    const petName = memorial.petName || '아이';
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

// 주소가 잘못됐을 때
function showUploadUnavailable() {
    const card = document.querySelector('.upload-form-card');
    const header = document.querySelector('.upload-header');
    if (header) {
        header.innerHTML = `
            <span class="upload-badge">Memory Gathering</span>
            <h1 class="upload-title">추모관을 찾을 수 없어요</h1>
            <p class="upload-guide">주소가 정확한지 다시 한 번 확인해 주세요.<br>보호자님께 받으신 주소를 그대로 눌러 들어오시면 가장 정확합니다.</p>
        `;
    }
    if (card) card.style.display = 'none';
    const back = document.querySelector('.back-link-box');
    if (back) back.style.display = 'none';
}

function setLoader(visible, text) {
    const loader = document.getElementById('compressLoading');
    const progressText = document.getElementById('compressProgress');
    if (loader) loader.style.display = visible ? 'flex' : 'none';
    if (progressText && text) progressText.innerText = text;
}

function renderPreviews() {
    const grid = document.getElementById('previewGrid');
    if (!grid) return;
    grid.innerHTML = selectedFiles.map((item, idx) => `
        <div class="preview-item">
            <img src="${item.previewUrl}" alt="미리보기">
            ${item.type === 'video' ? '<span style="position:absolute; bottom:4px; right:4px; font-size:10px; background:rgba(0,0,0,0.6); color:#fff; padding:2px 4px; border-radius:4px;">VIDEO</span>' : ''}
            <button type="button" class="btn-remove-preview" onclick="removeFile(${idx})" aria-label="삭제"><svg viewBox="0 0 20 20" width="1em" height="1em" fill="none" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
        </div>
    `).join('');
}

function removeFile(index) {
    const [removed] = selectedFiles.splice(index, 1);
    if (removed && removed.previewUrl) URL.revokeObjectURL(removed.previewUrl);
    renderPreviews();
}

async function handleFileSelect(e) {
    const files = Array.from(e.target.files);

    if (selectedFiles.length + files.length > 3) {
        alert('추억 파일은 한 번에 최대 3개까지만 등록할 수 있습니다.');
        e.target.value = '';
        return;
    }

    const { limit, isMobile } = getMaxFileSize();

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

        setLoader(true, `"${file.name}" 준비 중...`);
        try {
            selectedFiles.push(await prepareMediaFile(file));
        } catch (err) {
            console.error('파일 준비 실패:', err);
            alert(`"${file.name}" 파일을 처리하지 못했습니다. 다른 파일로 시도해 주세요.`);
        }
    }

    setLoader(false);
    renderPreviews();
    e.target.value = '';
}

async function handleUploadSubmit(e) {
    e.preventDefault();

    if (selectedFiles.length === 0) {
        alert('사진이나 영상을 최소 1개 이상 등록해 주세요.');
        return;
    }

    const submitBtn = document.querySelector('.btn-submit-upload');
    if (submitBtn) submitBtn.disabled = true;
    setLoader(true, '업로드를 준비하고 있어요...');

    try {
        await uploadMemory({
            slug: uploadRoom,
            sender: document.getElementById('senderName').value.trim(),
            relation: document.getElementById('senderRelation').value.trim(),
            story: document.getElementById('memoryStory').value.trim(),
            items: selectedFiles,
            onProgress: (percent) => setLoader(true, `소중한 추억을 보내는 중... ${percent}%`)
        });

        setLoader(false);
        showToast('소중한 추억이 가족분들께 안전하게 전달되었습니다.');

        document.getElementById('memoryForm').reset();
        selectedFiles.forEach(item => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
        selectedFiles = [];
        renderPreviews();
    } catch (err) {
        console.error('업로드 실패:', err);
        setLoader(false);
        alert(`${err.message || '업로드 중 문제가 발생했습니다.'}\n잠시 후 다시 시도해 주세요.`);
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

function showToast(message) {
    const toast = document.getElementById('toastMessage');
    if (!toast) return;
    toast.innerText = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 2500);
}