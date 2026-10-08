let currentFilter = 'pending';
let currentMainTab = 'direct';

// 이름 끝에 받침이 있으면 '이'를 붙여 부르는 이름으로 바꿔줍니다.
// (하임 → 하임이, 코코 → 코코) 뒤에 붙는 조사는 항상 받침 없는 형태(가/를/와/의/에게)로 쓰면 됩니다.
function callName(name) {
    if (!name) return '';
    const lastChar = name.charCodeAt(name.length - 1);
    if (lastChar < 0xAC00 || lastChar > 0xD7A3) return name;
    return (lastChar - 0xAC00) % 28 > 0 ? name + '이' : name;
}

function normalizeDate(dateStr) {
    if (!dateStr) return '';
    const cleaned = dateStr.replace(/[^\d]/g, '');
    if (cleaned.length === 8) {
        return `${cleaned.slice(0, 4)}. ${cleaned.slice(4, 6)}. ${cleaned.slice(6, 8)}.`;
    }
    return dateStr.trim();
}

// =========================================
// 관리자 인증 상태
// - 관리자 링크(?room=...&key=...)로 한 번 들어오면 이 기기에 키를 기억하고,
//   이후에는 주소에 키가 없어도 관리자 화면과 추모관의 관리자 버튼을 쓸 수 있음
// =========================================
const ADMIN_KEY_PREFIX = 'onsemiro_admin_';
let adminRoom = '';
let adminKey = '';
let adminMemorial = null;

function getStoredAdminKey(room) {
    try { return localStorage.getItem(ADMIN_KEY_PREFIX + room) || ''; } catch (e) { return ''; }
}

function storeAdminKey(room, key) {
    try { localStorage.setItem(ADMIN_KEY_PREFIX + room, key); } catch (e) { /* 저장 실패 시 무시 */ }
}

function clearAdminKey(room) {
    try { localStorage.removeItem(ADMIN_KEY_PREFIX + room); } catch (e) { /* 무시 */ }
}

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const room = (params.get('room') || '').trim().toUpperCase();
    const urlKey = params.get('key') || '';
    const key = urlKey || getStoredAdminKey(room);

    if (!room || !key) {
        showAdminLocked();
        return;
    }

    // 서버에 관리자 키 확인
    try {
        const result = await functions.httpsCallable('verifyAdmin')({ slug: room, key });
        adminMemorial = result.data.memorial;
    } catch (err) {
        console.error('관리자 확인 실패:', err);
        if (!urlKey) clearAdminKey(room); // 기기에 남아 있던 예전 키는 정리
        showAdminLocked();
        return;
    }

    adminRoom = room;
    adminKey = key;
    storeAdminKey(room, key);

    // 주소창에서 키를 지워 화면 공유·방문 기록에 남지 않게 함
    if (urlKey) history.replaceState(null, '', `admin.html?room=${room}`);

    const nameEl = document.getElementById('adminPetName');
    if (nameEl) nameEl.innerText = adminMemorial.petName || '아이';

    // "추모관 메인으로 이동" → 공개 추모관 주소 (이 기기는 관리자 키를 기억하므로 관리자 버튼이 보임)
    const backLink = document.querySelector('.admin-footer-links .link-btn');
    if (backLink) backLink.href = `memorial.html?room=${room}`;

    renderCards();
    renderDirectGallery();
    renderAdminTimeline();
    renderAdminPostbox();
    updateMainTabBadges();
    loadMemorialInfo(adminMemorial);

    document.querySelector('.admin-container')?.classList.remove('is-verifying');
});

// 관리자 키가 없거나 틀렸을 때
function showAdminLocked() {
    const container = document.querySelector('.admin-container');
    if (!container) return;
    container.classList.remove('is-verifying');
    container.innerHTML = `
        <div class="admin-locked">
            <span class="header-tag">FAMILY ARCHIVE ADMIN</span>
            <h1 class="admin-main-title">관리자 링크로 들어와 주세요</h1>
            <p class="admin-main-desc">
                이 화면은 보호자님만 열 수 있습니다.<br>
                추모관 개설 때 알림톡으로 보내드린 <strong>관리자 주소</strong>를 눌러 들어와 주세요.
            </p>
            <a href="index.html" class="btn-timeline-add admin-locked-btn">온새미로 메인으로</a>
        </div>
    `;
}

// 이 기기에서 관리자 모드 해제
function forgetThisDevice() {
    const ok = confirm('이 기기에서 관리자 모드를 해제할까요?\n다시 관리하려면 알림톡으로 받으신 관리자 주소로 들어와야 합니다.');
    if (!ok) return;
    clearAdminKey(adminRoom);
    window.location.href = `memorial.html?room=${adminRoom}`;
}

// =========================================
// 0. 메인 5단 탭 전환 및 배지 동기화
// =========================================
function switchMainTab(tabKey) {
    currentMainTab = tabKey;

    const buttons = document.querySelectorAll('.main-tab-btn');
    buttons.forEach(btn => {
        const isTarget = btn.getAttribute('onclick')?.includes(`'${tabKey}'`);
        btn.classList.toggle('active', isTarget);
    });

    const panels = document.querySelectorAll('.admin-tab-panel');
    panels.forEach(panel => panel.classList.remove('active'));

    const targetPanel = document.getElementById(`panel-${tabKey}`);
    if (targetPanel) targetPanel.classList.add('active');
}

function updateMainTabBadges() {
    const memories = getMemories();

    // 1) 지인 검수 대기 건수 (보호자 직접 업로드 항목 제외)
    const pendingCount = memories.filter(item => item.status === 'pending' && !item.isDirect).length;
    const badgePending = document.getElementById('badgePendingMain');
    if (badgePending) {
        badgePending.innerText = pendingCount;
        badgePending.classList.toggle('has-items', pendingCount > 0);
    }

    // 2) 갤러리 전시 건수 (보호자 직접 업로드 + 지인 승인 항목 전체)
    const approvedList = memories.filter(item => item.status === 'approved');
    let totalApprovedFiles = 0;
    approvedList.forEach(m => {
        if (m.files) totalApprovedFiles += m.files.filter(f => !f.excluded).length;
    });
    const badgeDirect = document.getElementById('badgeDirectMain');
    if (badgeDirect) {
        badgeDirect.innerText = totalApprovedFiles;
    }

    // 3) 발자취 개수
    const timelineList = getTimelineList();
    const badgeTimeline = document.getElementById('badgeTimelineMain');
    if (badgeTimeline) {
        badgeTimeline.innerText = timelineList.length;
    }

    // 4) 우체통 편지 개수
    const letters = getMemorialLetters();
    const badgePostbox = document.getElementById('badgePostboxMain');
    if (badgePostbox) {
        badgePostbox.innerText = letters.length;
    }
}

// =========================================
// 1. 지인 사진/영상 검수 로직 (보호자 업로드 제외)
// =========================================
function getMemories() {
    return JSON.parse(localStorage.getItem('pendingMemories') || '[]');
}

function saveMemories(list) {
    localStorage.setItem('pendingMemories', JSON.stringify(list));
    updateMainTabBadges();
}

function setFilter(filter) {
    currentFilter = filter;
    document.querySelectorAll('.filter-tab').forEach(btn => btn.classList.remove('active'));

    const clickedBtn = Array.from(document.querySelectorAll('.filter-tab')).find(btn =>
        btn.getAttribute('onclick')?.includes(`'${filter}'`)
    );
    if (clickedBtn) clickedBtn.classList.add('active');

    renderCards();
}

function updateCounts(list) {
    // 보호자 직접 등록 항목(!item.isDirect)은 지인 검수 카운트에서 제외
    const guestMemories = list.filter(item => !item.isDirect);

    const pCount = guestMemories.filter(item => item.status === 'pending').length;
    const aCount = guestMemories.filter(item => item.status === 'approved').length;
    const uCount = guestMemories.filter(item => item.status === 'unposted' || item.status === 'private').length;

    const pEl = document.getElementById('countPending');
    const aEl = document.getElementById('countApproved');
    const uEl = document.getElementById('countUnposted');

    if (pEl) pEl.innerText = pCount;
    if (aEl) aEl.innerText = aCount;
    if (uEl) uEl.innerText = uCount;

    updateMainTabBadges();
}

function toggleFileExclude(itemId, fileIndex) {
    const list = getMemories();
    const item = list.find(m => m.id === itemId);
    if (!item || !item.files[fileIndex]) return;

    item.files[fileIndex].excluded = !item.files[fileIndex].excluded;
    saveMemories(list);
    renderCards();
}

function toggleAllFiles(itemId) {
    const list = getMemories();
    const item = list.find(m => m.id === itemId);
    if (!item || !item.files || item.files.length === 0) return;

    const hasChecked = item.files.some(f => !f.excluded);
    item.files.forEach(f => f.excluded = hasChecked);

    saveMemories(list);
    renderCards();
}

function applyMediaDecision(itemId) {
    const list = getMemories();
    const index = list.findIndex(m => m.id === itemId);
    if (index === -1) return;

    const currentItem = list[index];
    const approvedFiles = currentItem.files.filter(f => !f.excluded);
    const unpostedFiles = currentItem.files.filter(f => f.excluded);

    const originId = currentItem.originId || currentItem.id;
    const fullOriginalFiles = currentItem.originFiles || JSON.parse(JSON.stringify(currentItem.files));

    list.splice(index, 1);

    if (approvedFiles.length > 0 && unpostedFiles.length > 0) {
        const approvedItem = {
            ...currentItem,
            id: 'MEM-APP-' + Date.now(),
            originId: originId,
            originFiles: fullOriginalFiles,
            files: approvedFiles.map(f => ({ ...f, excluded: false })),
            status: 'approved'
        };
        const unpostedItem = {
            ...currentItem,
            id: 'MEM-UNP-' + (Date.now() + 1),
            originId: originId,
            originFiles: fullOriginalFiles,
            files: unpostedFiles.map(f => ({ ...f, excluded: true })),
            status: 'unposted'
        };

        list.unshift(approvedItem);
        list.unshift(unpostedItem);
        showToast(`${approvedFiles.length}장은 전시 승인, ${unpostedFiles.length}장은 제외 처리되었습니다.`);
    } else if (approvedFiles.length > 0 && unpostedFiles.length === 0) {
        currentItem.status = 'approved';
        currentItem.files.forEach(f => f.excluded = false);
        list.unshift(currentItem);
        showToast("모든 사진이 전시 승인되었습니다.");
    } else {
        currentItem.status = 'unposted';
        currentItem.files.forEach(f => f.excluded = true);
        list.unshift(currentItem);
        showToast("모든 사진이 제외 처리되었습니다.");
    }

    saveMemories(list);
    renderCards();
    renderDirectGallery();
}

function revertStatus(itemId) {
    let list = getMemories();
    const targetItem = list.find(m => m.id === itemId);
    if (!targetItem) return;

    if (targetItem.originId && targetItem.originFiles) {
        const oId = targetItem.originId;
        const restoredOriginalItem = {
            ...targetItem,
            id: oId,
            status: 'pending',
            files: targetItem.originFiles.map(f => ({ ...f, excluded: false })),
            originId: undefined,
            originFiles: undefined
        };

        list = list.filter(m => m.id !== itemId && m.originId !== oId && m.id !== oId);
        list.unshift(restoredOriginalItem);
    } else {
        targetItem.status = 'pending';
        if (targetItem.files) {
            targetItem.files.forEach(f => f.excluded = false);
        }
    }

    saveMemories(list);
    showToast("대기함으로 복원되었습니다.");
    setFilter('pending');
    renderDirectGallery();
}

function renderCards() {
    const list = getMemories();
    updateCounts(list);

    // 보호자 직접 등록 항목(!item.isDirect)은 지인 검수 목록에서 완전 제외
    const filtered = list.filter(item => {
        if (item.isDirect) return false;
        if (currentFilter === 'unposted') {
            return item.status === 'unposted' || item.status === 'private';
        }
        return item.status === currentFilter;
    });

    const container = document.getElementById('memoryCardList');
    if (!container) return;
    container.innerHTML = '';

    if (filtered.length === 0) {
        container.innerHTML = `<div class="empty-state">해당하는 추억 조각이 없습니다.</div>`;
        return;
    }

    filtered.forEach(item => {
        const card = document.createElement('div');
        card.className = 'archive-card';

        let mediaHtml = '';
        let checkedCount = 0;
        const totalFiles = item.files ? item.files.length : 0;

        if (totalFiles > 0) {
            mediaHtml = '<div class="media-preview-box">';
            item.files.forEach((f, idx) => {
                const isExcluded = f.excluded === true;
                if (!isExcluded) checkedCount++;

                const mediaTag = f.type === 'video'
                    ? `<video src="${f.data}" controls playsinline></video>`
                    : `<img src="${f.data}" alt="추억 사진">`;

                const checkSvg = `
                    <svg viewBox="0 0 16 16" fill="none" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3.5 8.5 6.5 11.5 12.5 5"></polyline>
                    </svg>
                `;

                const clickAction = (currentFilter === 'pending')
                    ? `onclick="toggleFileExclude('${item.id}', ${idx})"`
                    : '';

                mediaHtml += `
                    <div class="media-thumbnail ${isExcluded ? 'excluded' : ''}" ${clickAction}>
                        ${mediaTag}
                        ${currentFilter === 'pending' ? `
                            <button type="button" class="btn-toggle-check ${isExcluded ? 'unchecked' : 'checked'}">
                                ${checkSvg}
                            </button>
                        ` : ''}
                    </div>
                `;
            });
            mediaHtml += '</div>';
        }

        const topActionHtml = (currentFilter === 'pending')
            ? ''
            : `<button type="button" class="btn-revert-mini" onclick="revertStatus('${item.id}')">다시 검수</button>`;

        let actionBarHtml = '';
        if (currentFilter === 'pending') {
            const hasChecked = checkedCount > 0;
            const toggleBtnText = (checkedCount === totalFiles) ? '전체 해제' : '전체 선택';
            const approveBtnText = hasChecked ? `<iconify-icon icon="noto:herb" aria-hidden="true"></iconify-icon> 선택한 ${checkedCount}장 전시하기` : `<iconify-icon icon="noto:prohibited" aria-hidden="true"></iconify-icon> 전시 제외하고 보관`;
            const approveBtnClass = hasChecked ? 'btn-approve-submit' : 'btn-approve-submit mode-reject';

            actionBarHtml = `
                <div class="card-action-bar">
                    <button type="button" class="btn-status btn-toggle-all" onclick="toggleAllFiles('${item.id}')">
                        ${toggleBtnText}
                    </button>
                    <button type="button" class="btn-status ${approveBtnClass}" onclick="applyMediaDecision('${item.id}')">
                        ${approveBtnText}
                    </button>
                </div>
            `;
        }

        card.innerHTML = `
            <div class="card-top-info">
                <div class="sender-profile">
                    <span class="sender-name">${item.sender}</span>
                    <span class="sender-relation">${item.relation}</span>
                    <span class="submit-date">${item.submittedAt}</span>
                </div>
                ${topActionHtml}
            </div>
            ${mediaHtml}
            <div class="card-story-text">${item.story}</div>
            ${actionBarHtml}
        `;

        container.appendChild(card);
    });
}

// =========================================
// 2. 보호자 직접 업로드 및 갤러리 관리
// =========================================
let currentSelectedFiles = [];

function handleFileSelect(input) {
    if (!input.files || input.files.length === 0) return;
    currentSelectedFiles = Array.from(input.files);
    renderSelectedPreviews();
}

function renderSelectedPreviews() {
    const grid = document.getElementById('selectedPreviewGrid');
    if (!grid) return;

    if (currentSelectedFiles.length === 0) {
        grid.style.display = 'none';
        grid.innerHTML = '';
        return;
    }

    grid.style.display = 'flex';
    grid.innerHTML = currentSelectedFiles.map((file, idx) => {
        const isVideo = file.type.startsWith('video');
        const objectUrl = URL.createObjectURL(file);
        return `
            <div class="preview-thumb-wrap">
                ${isVideo ? `<video src="${objectUrl}"></video>` : `<img src="${objectUrl}">`}
                <button type="button" class="btn-remove-preview" onclick="removeSelectedFile(${idx})" aria-label="선택 취소"><svg viewBox="0 0 20 20" width="1em" height="1em" fill="none" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
            </div>
        `;
    }).join('');
}

function removeSelectedFile(index) {
    currentSelectedFiles.splice(index, 1);
    renderSelectedPreviews();
}

function compressImage(file) {
    return new Promise((resolve) => {
        if (file.type.startsWith('video') || file.size < 400 * 1024) {
            const reader = new FileReader();
            reader.onload = e => resolve({ data: e.target.result, type: file.type.startsWith('video') ? 'video' : 'photo' });
            reader.readAsDataURL(file);
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const maxDim = 1200;
                let width = img.width;
                let height = img.height;

                if (width > maxDim || height > maxDim) {
                    if (width > height) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    } else {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.82);
                resolve({ data: compressedDataUrl, type: 'photo' });
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

async function handleDirectUpload() {
    if (!currentSelectedFiles || currentSelectedFiles.length === 0) {
        alert("업로드할 사진이나 영상을 선택해 주세요.");
        return;
    }

    const submitBtn = document.getElementById('btnDirectSubmit');
    const storyInput = document.getElementById('directStoryInput');
    const storyText = storyInput.value.trim() || '보호자가 남긴 소중한 순간';

    submitBtn.disabled = true;
    submitBtn.innerText = "처리 중...";

    try {
        const fileObjects = [];
        for (const file of currentSelectedFiles) {
            const compressed = await compressImage(file);
            fileObjects.push({
                data: compressed.data,
                type: compressed.type,
                excluded: false
            });
        }

        const today = new Date();
        const dateStr = `${today.getFullYear()}. ${String(today.getMonth() + 1).padStart(2, '0')}. ${String(today.getDate()).padStart(2, '0')}.`;

        const newMemory = {
            id: 'DIR-' + Date.now(),
            sender: '보호자', // 2번 워딩: '보호자' 적용
            relation: '',
            story: storyText,
            submittedAt: dateStr,
            status: 'approved',
            isDirect: true,   // 1번 분리: 지인 검수 탭에 뜨지 않도록 플래그 지정
            files: fileObjects
        };

        const list = getMemories();
        list.unshift(newMemory);
        saveMemories(list);

        // 폼 초기화
        currentSelectedFiles = [];
        renderSelectedPreviews();
        storyInput.value = '';
        document.getElementById('directFileInput').value = '';

        renderDirectGallery();
        renderCards();
        showToast("갤러리에 등록되었습니다.");
    } catch (err) {
        console.error(err);
        alert("업로드 처리 중 오류가 발생했습니다. 파일 용량을 확인해 주세요.");
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = "즉시 등록";
    }
}

function renderDirectGallery() {
    const container = document.getElementById('directGalleryList');
    const countEl = document.getElementById('directGalleryCount');
    if (!container) return;

    const list = getMemories();
    const approvedMemories = list.filter(item => item.status === 'approved');

    let totalCount = 0;
    let html = '<div class="direct-media-grid">';

    approvedMemories.forEach(item => {
        if (!item.files) return;
        item.files.forEach((f, fIdx) => {
            if (f.excluded) return;
            totalCount++;

            const mediaTag = f.type === 'video'
                ? `<video src="${f.data}" muted playsinline></video>`
                : `<img src="${f.data}" alt="갤러리 사진">`;

            // 라벨 표기: 보호자 업로드 항목은 깔끔하게 '보호자'로 표기
            const senderLabel = (item.isDirect || item.sender === '보호자' || item.sender === '가족' || item.sender === '가족의 기록')
                ? '보호자'
                : `${item.relation} ${item.sender}`.trim();

            html += `
                <div class="direct-media-card" id="mediaCard-${item.id}-${fIdx}">
                    <div class="direct-media-thumb">
                        ${mediaTag}
                        <button type="button" class="btn-direct-delete" title="삭제" onclick="deleteGalleryItem('${item.id}', ${fIdx})" aria-label="삭제"><svg viewBox="0 0 20 20" width="1em" height="1em" fill="none" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
                    </div>
                    <div class="direct-media-info">
                        <span class="direct-media-tag">${senderLabel}</span>
                        <div class="story-display-box">
                            <p class="direct-media-desc">${item.story || '남겨진 추억'}</p>
                            <button type="button" class="btn-story-action" onclick="startEditStory('${item.id}', '${fIdx}')">수정</button>
                        </div>
                    </div>
                </div>
            `;
        });
    });

    html += '</div>';
    if (countEl) countEl.innerText = totalCount;

    if (totalCount === 0) {
        container.innerHTML = `<div class="empty-state" style="padding: 30px;">현재 갤러리에 전시 중인 사진이 없습니다. 위에서 직접 등록해보세요.</div>`;
    } else {
        container.innerHTML = html;
    }

    updateMainTabBadges();
}

// 3번: '보호자' 라벨 태그는 온전히 유지하고, 사연 텍스트 영역만 인풋창으로 전환
function startEditStory(itemId, fIdx) {
    const list = getMemories();
    const item = list.find(m => m.id === itemId);
    if (!item) return;

    const card = document.getElementById(`mediaCard-${itemId}-${fIdx}`);
    const storyBox = card.querySelector('.story-display-box');

    storyBox.innerHTML = `
        <div class="direct-edit-box">
            <input type="text" id="editStoryInput-${itemId}" class="direct-edit-input" value="${item.story || ''}" placeholder="이야기 입력">
            <button type="button" class="btn-timeline-add" style="padding: 2px 8px; font-size: 11px;" onclick="saveEditStory('${itemId}')">저장</button>
        </div>
        <button type="button" class="btn-story-action" onclick="renderDirectGallery()">취소</button>
    `;

    const input = document.getElementById(`editStoryInput-${itemId}`);
    if (input) {
        input.focus();
        input.select();
    }
}

function saveEditStory(itemId) {
    const input = document.getElementById(`editStoryInput-${itemId}`);
    if (!input) return;

    const newText = input.value.trim();
    const list = getMemories();
    const item = list.find(m => m.id === itemId);
    if (item) {
        item.story = newText;
        saveMemories(list);
        showToast("사연이 수정되었습니다.");
    }
    renderDirectGallery();
}

function deleteGalleryItem(itemId, fileIndex) {
    if (!confirm("이 사진을 갤러리에서 삭제하시겠습니까?")) return;

    const list = getMemories();
    const target = list.find(m => m.id === itemId);
    if (!target || !target.files) return;

    target.files.splice(fileIndex, 1);

    if (target.files.length === 0) {
        const idx = list.findIndex(m => m.id === itemId);
        if (idx !== -1) list.splice(idx, 1);
    }

    saveMemories(list);
    renderDirectGallery();
    renderCards();
    showToast("갤러리에서 삭제되었습니다.");
}

// =========================================
// 3. 발자취 타임라인 관리 로직 (CRUD)
// =========================================
function getTimelineList() {
    const raw = localStorage.getItem('memorial_timeline_list');
    if (raw) return JSON.parse(raw);

    // 기본 문구는 서버에서 확인한 추모관 정보로 만듦 (발자취 저장은 다음 단계에서 서버로 이동)
    const order = adminMemorial || {};
    const name = order.petName || '아이';

    const defaultList = [
        {
            id: 'TL-1',
            date: normalizeDate(order.meetDate) || '2025. 09. 18.',
            story: `손바닥만 하던 ${callName(name)}가 처음 우리 집에 오던 날, 온 세상이 따뜻해졌어.`
        },
        {
            id: 'TL-2',
            date: normalizeDate(order.farewellDate) || '2026. 09. 17.',
            story: '가족들의 품에서 조용히 눈을 감고, 가장 빛나는 별이 된 날.'
        }
    ];
    localStorage.setItem('memorial_timeline_list', JSON.stringify(defaultList));
    return defaultList;
}

function renderAdminTimeline() {
    const list = getTimelineList();
    const container = document.getElementById('adminTimelineList');
    if (!container) return;

    if (list.length === 0) {
        container.innerHTML = `<div class="empty-state" style="padding: 24px;">등록된 발자취가 없습니다.</div>`;
        return;
    }

    list.sort((a, b) => {
        const numA = parseInt(a.date.replace(/[^\d]/g, ''), 10) || 0;
        const numB = parseInt(b.date.replace(/[^\d]/g, ''), 10) || 0;
        return numA - numB;
    });

    container.innerHTML = list.map(item => `
        <div class="admin-timeline-item" id="tlItem-${item.id}">
            <div class="admin-tl-meta">
                <span class="admin-tl-date">${item.date}</span>
                <span class="admin-tl-text">${item.story}</span>
            </div>
            <div class="admin-tl-actions">
                <button type="button" class="btn-tl-edit" onclick="startEditTimeline('${item.id}')">수정</button>
                <button type="button" class="btn-tl-delete" onclick="deleteTimelineItem('${item.id}')">삭제</button>
            </div>
        </div>
    `).join('');

    updateMainTabBadges();
}

function handleAddTimeline(e) {
    e.preventDefault();
    const dateInput = document.getElementById('timelineDate');
    const storyInput = document.getElementById('timelineStory');

    const formattedDate = normalizeDate(dateInput.value);
    const storyVal = storyInput.value.trim();

    if (!formattedDate || !storyVal) return;

    const list = getTimelineList();
    list.push({
        id: 'TL-' + Date.now(),
        date: formattedDate,
        story: storyVal
    });

    localStorage.setItem('memorial_timeline_list', JSON.stringify(list));
    renderAdminTimeline();
    showToast("발자취가 등록되었습니다.");

    dateInput.value = '';
    storyInput.value = '';
}

function startEditTimeline(id) {
    const list = getTimelineList();
    const target = list.find(item => item.id === id);
    if (!target) return;

    const itemEl = document.getElementById(`tlItem-${id}`);
    if (!itemEl) return;

    itemEl.classList.add('editing');
    const nums = target.date.replace(/[^\d]/g, '');
    const pickerVal = `${nums.slice(0, 4)}-${nums.slice(4, 6)}-${nums.slice(6, 8)}`;

    itemEl.innerHTML = `
        <form class="edit-mode-form" onsubmit="saveEditTimeline(event, '${id}')">
            <input type="date" id="editDate-${id}" class="edit-input-date" value="${pickerVal}" required>
            <input type="text" id="editStory-${id}" class="edit-input-story" value="${target.story}" required>
            <div class="edit-action-row">
                <button type="submit" class="btn-edit-save">완료</button>
                <button type="button" class="btn-edit-cancel" onclick="renderAdminTimeline()">취소</button>
            </div>
        </form>
    `;
}

function saveEditTimeline(e, id) {
    e.preventDefault();
    const dateVal = document.getElementById(`editDate-${id}`).value;
    const storyVal = document.getElementById(`editStory-${id}`).value.trim();

    if (!dateVal || !storyVal) return;

    let list = getTimelineList();
    const idx = list.findIndex(item => item.id === id);
    if (idx !== -1) {
        list[idx].date = normalizeDate(dateVal);
        list[idx].story = storyVal;
        localStorage.setItem('memorial_timeline_list', JSON.stringify(list));
        showToast("발자취가 수정되었습니다.");
    }

    renderAdminTimeline();
}

function deleteTimelineItem(id) {
    if (!confirm("이 발자취를 삭제하시겠습니까?")) return;
    let list = getTimelineList();
    list = list.filter(item => item.id !== id);
    localStorage.setItem('memorial_timeline_list', JSON.stringify(list));
    renderAdminTimeline();
    showToast("발자취가 삭제되었습니다.");
}

// =========================================
// 4. 무지개 우체통 관리 로직
// =========================================
function getMemorialLetters() {
    const saved = localStorage.getItem('memorial_letters');
    if (!saved) return [];
    try {
        const list = JSON.parse(saved);
        return list.map((item, idx) => ({
            ...item,
            id: item.id || `LET-${idx + 1}`
        }));
    } catch (e) {
        return [];
    }
}

function renderAdminPostbox() {
    const list = getMemorialLetters();
    const countEl = document.getElementById('postboxCount');
    const container = document.getElementById('adminPostboxList');

    if (countEl) countEl.innerText = list.length;
    if (!container) return;

    if (list.length === 0) {
        container.innerHTML = `<div class="empty-state" style="padding: 24px;">남겨진 편지가 없습니다.</div>`;
        updateMainTabBadges();
        return;
    }

    container.innerHTML = list.map(letter => `
        <div class="admin-postbox-card" id="postbox-${letter.id}">
            <div class="postbox-card-top">
                <div class="postbox-author-info">
                    <span class="postbox-author-tag">${letter.relation}</span>
                    <strong class="postbox-author-name">${letter.name}</strong>
                    <span class="postbox-date">${letter.date}</span>
                </div>
                <button type="button" class="btn-postbox-delete" onclick="deletePostboxLetter('${letter.id}')">삭제</button>
            </div>
            <p class="postbox-msg-content">${letter.msg}</p>
        </div>
    `).join('');

    updateMainTabBadges();
}

function deletePostboxLetter(letterId) {
    if (!confirm("이 편지를 우체통에서 완전히 삭제하시겠습니까?")) return;

    let list = getMemorialLetters();
    list = list.filter(item => item.id !== letterId);

    localStorage.setItem('memorial_letters', JSON.stringify(list));
    renderAdminPostbox();
    showToast("편지가 삭제되었습니다.");
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

// =========================================
// 5. 추모관 정보 수정
// -----------------------------------------
// 서버(verifyAdmin)에서 받은 정보로 채우고, 저장은 updateMemorialInfo 함수로 처리
// =========================================

let infoOriginal = null;   // 불러온 당시 값 (변경 여부 비교용)
let infoPetType = 'dog';
let infoPhotoData = '';

function loadMemorialInfo(memorial) {
    const m = memorial || {};
    const gifts = m.gifts || [];

    infoPetType = m.petType || 'dog';
    infoPhotoData = m.photoUrl || '';

    document.getElementById('infoPetName').value = m.petName || '';
    document.getElementById('infoMeetDate').value = m.meetDate || '';
    document.getElementById('infoFarewellDate').value = m.farewellDate || '';
    document.getElementById('infoQuote').value = m.quote || '';
    document.getElementById('infoGift1').value = gifts[0] || '';
    document.getElementById('infoGift2').value = gifts[1] || '';
    document.getElementById('infoBgm').value = m.bgm || 'piano';

    document.getElementById('infoHeritageNotice').hidden = m.plan !== 'heritage';

    renderInfoAvatar();
    renderInfoPetType();
    infoOriginal = collectInfoValues();
    markInfoDirty();
}

// 현재 입력값을 하나의 객체로 모으기
function collectInfoValues() {
    return {
        petName: document.getElementById('infoPetName').value.trim(),
        petType: infoPetType,
        petPhoto: infoPhotoData,
        meetDate: document.getElementById('infoMeetDate').value,
        farewellDate: document.getElementById('infoFarewellDate').value,
        quote: document.getElementById('infoQuote').value.trim(),
        gift1: document.getElementById('infoGift1').value.trim(),
        gift2: document.getElementById('infoGift2').value.trim(),
        bgm: document.getElementById('infoBgm').value
    };
}

function renderInfoAvatar() {
    const avatar = document.getElementById('infoAvatar');
    avatar.innerHTML = infoPhotoData
        ? `<img src="${infoPhotoData}" alt="대표 사진">`
        : '<span class="info-avatar-empty">사진 없음</span>';
}

function renderInfoPetType() {
    document.querySelectorAll('.info-type-btn').forEach(btn => {
        const isActive = btn.dataset.type === infoPetType;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-checked', isActive);
    });
}

function selectInfoPetType(type) {
    infoPetType = type;
    renderInfoPetType();
    markInfoDirty();
}

// 대표 사진용 압축 (최대 800px, 추모관 원형 사진에 충분한 크기)
function compressProfilePhoto(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const scale = Math.min(1, 800 / Math.max(img.width, img.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.85));
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// 대표 사진 교체
async function handleInfoPhoto(input) {
    const file = input.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        alert('대표 사진은 이미지 파일만 등록할 수 있습니다.');
        input.value = '';
        return;
    }
    try {
        infoPhotoData = await compressProfilePhoto(file);
    } catch (e) {
        alert('사진을 불러오지 못했습니다. 다른 사진으로 시도해 주세요.');
        input.value = '';
        return;
    }
    renderInfoAvatar();
    markInfoDirty();
    input.value = '';
}

// 함께한 날 계산 + 글자 수 + 변경 여부 표시
function markInfoDirty() {
    const values = collectInfoValues();

    // 함께한 날
    const daysEl = document.getElementById('infoDaysText');
    if (values.meetDate && values.farewellDate) {
        const diff = new Date(values.farewellDate) - new Date(values.meetDate);
        daysEl.innerText = diff >= 0
            ? `함께한 ${Math.ceil(diff / 86400000).toLocaleString()}일의 여정`
            : '별이 된 날이 처음 만난 날보다 앞서 있어요. 날짜를 확인해 주세요.';
    } else {
        daysEl.innerText = '';
    }

    // 메시지 글자 수
    document.getElementById('infoQuoteCount').innerText = `${values.quote.length} / 100`;

    // 변경 여부
    if (!infoOriginal) return;
    const isDirty = JSON.stringify(values) !== JSON.stringify(infoOriginal);
    const statusEl = document.getElementById('infoSaveStatus');
    statusEl.innerText = isDirty ? '저장하지 않은 변경 사항이 있어요' : '변경 사항 없음';
    statusEl.classList.toggle('is-dirty', isDirty);
    document.getElementById('btnInfoSave').disabled = !isDirty;
}

async function saveMemorialInfo() {
    const values = collectInfoValues();

    if (!values.petName) {
        alert('아이 이름을 입력해 주세요.');
        document.getElementById('infoPetName').focus();
        return;
    }
    if (values.meetDate && values.farewellDate && values.farewellDate < values.meetDate) {
        alert('별이 된 날이 처음 만난 날보다 앞서 있습니다. 날짜를 확인해 주세요.');
        return;
    }

    const saveBtn = document.getElementById('btnInfoSave');
    saveBtn.disabled = true;
    saveBtn.innerText = '저장하는 중...';

    try {
        const { petPhoto, ...rest } = values;
        const result = await functions.httpsCallable('updateMemorialInfo')({
            slug: adminRoom,
            key: adminKey,
            info: {
                ...rest,
                // 새로 고른 사진(data:...)일 때만 보내고, 기존 사진 주소는 보내지 않음
                photo: petPhoto && petPhoto.startsWith('data:') ? petPhoto : ''
            }
        });

        adminMemorial = result.data.memorial;
        loadMemorialInfo(adminMemorial);

        const nameEl = document.getElementById('adminPetName');
        if (nameEl) nameEl.innerText = adminMemorial.petName;

        showToast('추모관 정보를 저장했습니다.');
    } catch (err) {
        console.error('정보 저장 실패:', err);
        alert(err.message || '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        markInfoDirty();
    } finally {
        saveBtn.innerText = '변경 내용 저장';
    }
}