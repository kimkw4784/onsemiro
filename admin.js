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
        showAdminLocked(err.details?.reason);
        return;
    }

    adminRoom = room;
    adminKey = key;
    storeAdminKey(room, key);

    // 주소창에서 키를 지워 화면 공유·방문 기록에 남지 않게 함
    if (urlKey) history.replaceState(null, '', `admin.html?room=${room}`);

    const nameEl = document.getElementById('adminPetName');
    if (nameEl) nameEl.innerText = adminMemorial.petName || '아이';

    // 추모 기록집(PDF) 페이지 연결
    const bookLink = document.getElementById('bookLink');
    if (bookLink) bookLink.href = `memorial-book.html?room=${room}`;

    // "추모관 메인으로 이동" → 공개 추모관 주소 (이 기기는 관리자 키를 기억하므로 관리자 버튼이 보임)
    const backLink = document.querySelector('.admin-footer-links .link-btn');
    if (backLink) backLink.href = `memorial.html?room=${room}`;

    updateMainTabBadges();
    loadMemorialInfo(adminMemorial);

    // 사진·영상은 서버에서 불러옴
    loadMemories();

    // 발자취·우체통은 서버에서 불러옴
    loadTimeline();
    loadLetters();

    document.querySelector('.admin-container')?.classList.remove('is-verifying');
});

// 관리자 키가 없거나 틀렸을 때 (reason이 'reissued'면 재발급 안내)
function showAdminLocked(reason) {
    const container = document.querySelector('.admin-container');
    if (!container) return;
    container.classList.remove('is-verifying');

    const isReissued = reason === 'reissued';
    const title = isReissued ? '관리자 링크가 재발급되었습니다' : '관리자 링크로 들어와 주세요';
    const desc = isReissued
        ? '이 주소는 더 이상 사용할 수 없습니다.<br>새로 발급된 <strong>관리자 주소</strong>로 들어와 주세요.'
        : '이 화면은 보호자님만 열 수 있습니다.<br>추모관 개설 때 받으신 <strong>관리자 주소</strong>를 눌러 들어와 주세요.';

    container.innerHTML = `
        <div class="admin-locked">
            <span class="header-tag">FAMILY ARCHIVE ADMIN</span>
            <h1 class="admin-main-title">${title}</h1>
            <p class="admin-main-desc">
                ${desc}
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

    // 탭을 누를 때마다 서버에서 최신 내용을 다시 불러옴 (새로고침 없이 바로 확인)
    refreshTab(tabKey);
}

// 너무 자주 불러오지 않도록 같은 탭은 3초 안에 다시 불러오지 않음
const lastTabRefresh = {};

function refreshTab(tabKey) {
    if (!adminRoom) return;
    const now = Date.now();
    const group = (tabKey === 'direct' || tabKey === 'media') ? 'memories' : tabKey;
    if (lastTabRefresh[group] && now - lastTabRefresh[group] < 3000) return;
    lastTabRefresh[group] = now;

    if (group === 'memories') loadMemories();
    else if (group === 'timeline') loadTimeline();
    else if (group === 'postbox') loadLetters();
}

function updateMainTabBadges() {
    const memories = memoriesCache;

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
    const badgeTimeline = document.getElementById('badgeTimelineMain');
    if (badgeTimeline) {
        badgeTimeline.innerText = timelineCache.length;
    }

    // 4) 우체통: 추모관에 공개 중인 편지 개수
    const publicLetters = lettersCache.filter(l => l.status === 'approved').length;
    const badgePostbox = document.getElementById('badgePostboxMain');
    if (badgePostbox) {
        badgePostbox.innerText = publicLetters;
    }
}

// =========================================
// 1. 지인 사진/영상 검수 로직 (보호자 업로드 제외)
// =========================================
let memoriesCache = [];   // 서버에서 불러온 추억(사진·영상) 목록

async function loadMemories() {
    try {
        const result = await functions.httpsCallable('adminListMemories')({ slug: adminRoom, key: adminKey });
        memoriesCache = result.data.memories || [];
        renderStorageUsage(result.data.storageBytes, result.data.storageLimit);
    } catch (err) {
        console.error('추억 불러오기 실패:', err);
        memoriesCache = [];
    }
    renderCards();
    renderDirectGallery();
}

// 저장 공간 사용량 표시 (예: 3.2GB / 20GB)
function renderStorageUsage(used, limit) {
    const textEl = document.getElementById('storageUsageText');
    const barEl = document.getElementById('storageUsageBar');
    if (!textEl || !barEl || !limit) return;

    const GB = 1024 * 1024 * 1024;
    const usedGb = used / GB;
    const usedText = usedGb < 0.1 ? `${Math.max(0, Math.round(used / (1024 * 1024)))}MB` : `${usedGb.toFixed(1)}GB`;
    const percent = Math.min(100, (used / limit) * 100);

    textEl.innerText = `${usedText} / ${Math.round(limit / GB)}GB 사용 중`;
    barEl.style.width = `${percent}%`;
    barEl.style.background = percent >= 90 ? '#C0704A' : 'var(--accent-brown, #B89065)';
}

function setFilter(filter) {
    currentFilter = filter;
    document.querySelectorAll('#panel-media .filter-tab').forEach(btn => btn.classList.remove('active'));

    const clickedBtn = Array.from(document.querySelectorAll('#panel-media .filter-tab')).find(btn =>
        btn.getAttribute('onclick')?.includes(`'${filter}'`)
    );
    if (clickedBtn) clickedBtn.classList.add('active');

    renderCards();
}

function updateCounts(list) {
    // 보호자 직접 등록 항목은 지인 검수 카운트에서 제외
    const guestMemories = list.filter(item => !item.isDirect);

    const setCount = (id, n) => { const el = document.getElementById(id); if (el) el.innerText = n; };
    setCount('countPending', guestMemories.filter(item => item.status === 'pending').length);
    setCount('countApproved', guestMemories.filter(item => item.status === 'approved').length);
    setCount('countUnposted', guestMemories.filter(item => item.status === 'unposted').length);

    updateMainTabBadges();
}

// 검수 대기 중 파일 선택/해제 (화면에서만 바뀌고, '전시하기'를 눌러야 저장됨)
function toggleFileExclude(itemId, fileIndex) {
    const item = memoriesCache.find(m => m.id === itemId);
    if (!item || !item.files[fileIndex]) return;
    item.files[fileIndex].excluded = !item.files[fileIndex].excluded;
    renderCards();
}

function toggleAllFiles(itemId) {
    const item = memoriesCache.find(m => m.id === itemId);
    if (!item || !item.files || item.files.length === 0) return;
    const hasChecked = item.files.some(f => !f.excluded);
    item.files.forEach(f => { f.excluded = hasChecked; });
    renderCards();
}

async function applyMediaDecision(itemId, btn) {
    const item = memoriesCache.find(m => m.id === itemId);
    if (!item) return;

    setBtnLoading(btn, true, '처리 중');
    try {
        const result = await functions.httpsCallable('adminReviewMemory')({
            slug: adminRoom,
            key: adminKey,
            id: itemId,
            action: 'apply',
            excluded: item.files.map(f => Boolean(f.excluded))
        });
        const shown = item.files.filter(f => !f.excluded).length;
        const hidden = item.files.length - shown;
        showToast(result.data.status === 'approved'
            ? (hidden > 0 ? `${shown}개는 전시, ${hidden}개는 제외했습니다.` : '모든 사진이 전시되었습니다.')
            : '모든 사진을 제외 처리했습니다.');
        await loadMemories();
    } catch (err) {
        console.error(err);
        setBtnLoading(btn, false);
        alert(err.message || '처리하지 못했습니다.');
    }
}

async function revertStatus(itemId, btn) {
    setBtnLoading(btn, true, '복원 중');
    try {
        await functions.httpsCallable('adminReviewMemory')({ slug: adminRoom, key: adminKey, id: itemId, action: 'revert' });
        showToast('대기함으로 복원되었습니다.');
        currentFilter = 'pending';
        await loadMemories();
        setFilter('pending');
    } catch (err) {
        console.error(err);
        setBtnLoading(btn, false);
        alert(err.message || '복원하지 못했습니다.');
    }
}

function formatMs(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    return `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}.`;
}

function mediaTagFor(f, forList) {
    if (f.type === 'video') {
        return forList
            ? `<video src="${f.url}" poster="${f.thumbUrl}" controls playsinline preload="none"></video>`
            : `<video src="${f.url}" poster="${f.thumbUrl}" muted playsinline preload="none"></video>`;
    }
    return `<img src="${f.url}" alt="추억 사진" loading="lazy">`;
}

function renderCards() {
    const list = memoriesCache;
    updateCounts(list);

    // 보호자 직접 등록 항목은 지인 검수 목록에서 제외
    const filtered = list.filter(item => !item.isDirect && item.status === currentFilter);

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
                        ${mediaTagFor(f, currentFilter !== 'pending')}
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
            : `<button type="button" class="btn-revert-mini" onclick="revertStatus('${item.id}', this)">다시 검수</button>`;

        let actionBarHtml = '';
        if (currentFilter === 'pending') {
            const hasChecked = checkedCount > 0;
            const toggleBtnText = (checkedCount === totalFiles) ? '전체 해제' : '전체 선택';
            const approveBtnText = hasChecked ? `<iconify-icon icon="noto:herb" aria-hidden="true"></iconify-icon> 선택한 ${checkedCount}개 전시하기` : `<iconify-icon icon="noto:prohibited" aria-hidden="true"></iconify-icon> 전시 제외하고 보관`;
            const approveBtnClass = hasChecked ? 'btn-approve-submit' : 'btn-approve-submit mode-reject';

            actionBarHtml = `
                <div class="card-action-bar">
                    <button type="button" class="btn-status btn-toggle-all" onclick="toggleAllFiles('${item.id}')">
                        ${toggleBtnText}
                    </button>
                    <button type="button" class="btn-status ${approveBtnClass}" onclick="applyMediaDecision('${item.id}', this)">
                        ${approveBtnText}
                    </button>
                </div>
            `;
        }

        card.innerHTML = `
            <div class="card-top-info">
                <div class="sender-profile">
                    <span class="sender-name">${escapeHtml(item.sender)}</span>
                    <span class="sender-relation">${escapeHtml(item.relation)}</span>
                    <span class="submit-date">${formatMs(item.createdAt)}</span>
                </div>
                ${topActionHtml}
            </div>
            ${mediaHtml}
            <div class="card-story-text">${escapeHtml(item.story)}</div>
            ${actionBarHtml}
        `;

        container.appendChild(card);
    });
}

// =========================================
// 2. 보호자 직접 업로드 및 갤러리 관리
// =========================================
let currentSelectedFiles = [];

const DIRECT_MAX_FILES = 30;   // 한 번에 선택할 수 있는 개수
const DIRECT_BATCH_SIZE = 10;  // 서버에는 10개씩 나눠서 올림

function handleFileSelect(input) {
    if (!input.files || input.files.length === 0) return;
    let files = Array.from(input.files);
    if (files.length > DIRECT_MAX_FILES) {
        alert(`한 번에 최대 ${DIRECT_MAX_FILES}개까지 올릴 수 있어요.\n앞의 ${DIRECT_MAX_FILES}개만 선택되었습니다.`);
        files = files.slice(0, DIRECT_MAX_FILES);
    }
    currentSelectedFiles = files;
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

async function handleDirectUpload() {
    if (!currentSelectedFiles || currentSelectedFiles.length === 0) {
        alert('업로드할 사진이나 영상을 선택해 주세요.');
        return;
    }

    const tooBig = currentSelectedFiles.find(f => f.size > 500 * 1024 * 1024);
    if (tooBig) {
        alert(`"${tooBig.name}" 파일이 500MB를 넘어 올릴 수 없습니다.`);
        return;
    }

    const submitBtn = document.getElementById('btnDirectSubmit');
    const storyInput = document.getElementById('directStoryInput');
    const senderInput = document.getElementById('directSenderInput');
    const senderName = senderInput ? senderInput.value.trim() : '';
    const storyText = storyInput.value.trim() || `${senderName || '보호자'}가 남긴 소중한 순간`;

    submitBtn.disabled = true;
    submitBtn.innerText = '준비 중...';

    try {
        const items = [];
        for (let i = 0; i < currentSelectedFiles.length; i++) {
            submitBtn.innerText = `준비 중 ${i + 1}/${currentSelectedFiles.length}`;
            items.push(await prepareMediaFile(currentSelectedFiles[i]));
        }

        // 10개씩 나눠서 차례로 올리기
        const batches = [];
        for (let i = 0; i < items.length; i += DIRECT_BATCH_SIZE) {
            batches.push(items.slice(i, i + DIRECT_BATCH_SIZE));
        }
        for (let b = 0; b < batches.length; b++) {
            await uploadMemory({
                slug: adminRoom,
                key: adminKey,
                sender: senderName,
                story: storyText,
                items: batches[b],
                onProgress: (percent) => {
                    const overall = Math.round(((b + percent / 100) / batches.length) * 100);
                    submitBtn.innerText = `올리는 중 ${Math.min(99, overall)}%`;
                }
            });
        }

        // 폼 초기화 (올리는 분 이름은 다음에도 쓰도록 유지)
        currentSelectedFiles = [];
        renderSelectedPreviews();
        storyInput.value = '';
        document.getElementById('directFileInput').value = '';

        showToast('갤러리에 등록되었습니다.');
        await loadMemories();
    } catch (err) {
        console.error(err);
        alert(`${err.message || '업로드 중 문제가 발생했습니다.'}\n잠시 후 다시 시도해 주세요.`);
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = '즉시 등록';
    }
}

function renderDirectGallery() {
    const container = document.getElementById('directGalleryList');
    const countEl = document.getElementById('directGalleryCount');
    if (!container) return;

    const approvedMemories = memoriesCache.filter(item => item.status === 'approved');

    let totalCount = 0;
    let html = '<div class="direct-media-grid">';

    approvedMemories.forEach(item => {
        if (!item.files) return;
        const baseLabel = item.isDirect ? (item.sender || '보호자') : `${item.relation} ${item.sender}`.trim();

        item.files.forEach((f, fIdx) => {
            if (f.excluded) return;
            totalCount++;

            // 사진 한 장만 따로 고친 내용이 있으면 그걸 보여줌
            const senderLabel = item.isDirect && f.sender ? f.sender : baseLabel;
            const story = typeof f.story === 'string' ? f.story : item.story;

            html += `
                <div class="direct-media-card" id="mediaCard-${item.id}-${fIdx}">
                    <div class="direct-media-thumb">
                        ${mediaTagFor(f, false)}
                        <button type="button" class="btn-direct-delete" title="삭제" onclick="deleteGalleryItem('${item.id}', ${fIdx}, this)" aria-label="삭제"><svg viewBox="0 0 20 20" width="1em" height="1em" fill="none" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
                    </div>
                    <div class="direct-media-info">
                        <span class="direct-media-tag">${escapeHtml(senderLabel)}</span>
                        <div class="story-display-box">
                            <p class="direct-media-desc">${escapeHtml(story || '남겨진 추억')}</p>
                            <button type="button" class="btn-story-action" onclick="startEditStory('${item.id}', '${fIdx}')">수정</button>
                        </div>
                    </div>
                </div>
            `;
        });
    });

    html += '</div>';
    if (countEl) countEl.innerText = totalCount;

    container.innerHTML = totalCount === 0
        ? `<div class="empty-state" style="padding: 30px;"><span class="nb">현재 갤러리에 전시 중인 사진이 없습니다.</span><br><span class="nb">위에서 직접 등록해보세요.</span></div>`
        : html;

    updateMainTabBadges();
}

// 사진(영상) 한 장의 이름·이야기만 입력창으로 전환
function startEditStory(itemId, fIdx) {
    const item = memoriesCache.find(m => m.id === itemId);
    if (!item) return;
    const idx = Number(fIdx);
    const file = item.files[idx] || {};
    const currentStory = typeof file.story === 'string' ? file.story : (item.story || '');
    const currentSender = file.sender || item.sender || '보호자';
    const uid = `${itemId}-${idx}`;

    const card = document.getElementById(`mediaCard-${itemId}-${idx}`);
    const storyBox = card.querySelector('.story-display-box');

    // 보호자가 직접 올린 사진은 표시 이름도 함께 수정
    const senderRow = item.isDirect
        ? `<label class="direct-edit-row">
                <span class="direct-edit-label">이름</span>
                <input type="text" id="editSenderInput-${uid}" class="direct-edit-input" value="${escapeHtml(currentSender)}" maxlength="20" placeholder="올리는 분 이름">
           </label>`
        : '';

    storyBox.innerHTML = `
        <div class="direct-edit-box">
            ${senderRow}
            <label class="direct-edit-row">
                <span class="direct-edit-label">이야기</span>
                <input type="text" id="editStoryInput-${uid}" class="direct-edit-input" value="${escapeHtml(currentStory)}" maxlength="1000" placeholder="이야기 입력">
            </label>
            <div class="direct-edit-actions">
                <button type="button" class="btn-edit-save" onclick="saveEditStory('${itemId}', ${idx}, this)">저장</button>
                <button type="button" class="btn-story-action" onclick="renderDirectGallery()">취소</button>
            </div>
        </div>
    `;

    const input = document.getElementById(`editStoryInput-${uid}`);
    if (input) {
        input.focus();
        input.select();
    }
}

async function saveEditStory(itemId, fIdx, btn) {
    const uid = `${itemId}-${fIdx}`;
    const input = document.getElementById(`editStoryInput-${uid}`);
    if (!input) return;
    const senderInput = document.getElementById(`editSenderInput-${uid}`);

    setBtnLoading(btn, true, '저장 중');
    try {
        const payload = { slug: adminRoom, key: adminKey, id: itemId, fileIndex: Number(fIdx), story: input.value.trim() };
        if (senderInput) payload.sender = senderInput.value.trim();
        await functions.httpsCallable('adminUpdateMemoryStory')(payload);
        showToast('수정되었습니다.');
        await loadMemories();
    } catch (err) {
        console.error(err);
        setBtnLoading(btn, false);
        alert(err.message || '수정하지 못했습니다.');
    }
}

async function deleteGalleryItem(itemId, fileIndex, btn) {
    if (!confirm('이 사진(영상)을 완전히 삭제하시겠습니까?\n삭제한 파일은 되돌릴 수 없습니다.')) return;

    setBtnLoading(btn, true, '');
    try {
        await functions.httpsCallable('adminDeleteMemoryFile')({
            slug: adminRoom, key: adminKey, id: itemId, fileIndex
        });
        showToast('삭제되었습니다.');
        await loadMemories();
    } catch (err) {
        console.error(err);
        setBtnLoading(btn, false);
        alert(err.message || '삭제하지 못했습니다.');
    }
}

// =========================================
// 3. 발자취 타임라인 관리 로직 (CRUD)
// =========================================
let timelineCache = [];   // 서버에서 불러온 발자취
let lettersCache = [];    // 서버에서 불러온 편지
let currentLetterFilter = 'approved';

// 화면에 넣기 전에 HTML 특수문자를 바꿔서, 입력값에 섞인 태그가 실행되지 않게 함
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// 발자취 목록 불러오기 (발자취는 공개 정보라 바로 읽을 수 있음)
async function loadTimeline() {
    try {
        const snap = await db.collection('memorials').doc(adminRoom).collection('timeline').get();
        timelineCache = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
        console.error('발자취 불러오기 실패:', err);
        timelineCache = [];
    }
    renderAdminTimeline();
}

function renderAdminTimeline() {
    const container = document.getElementById('adminTimelineList');
    if (!container) return;

    const list = [...timelineCache].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    if (list.length === 0) {
        container.innerHTML = `<div class="empty-state" style="padding: 24px;">등록된 발자취가 없습니다.</div>`;
    } else {
        container.innerHTML = list.map(item => `
            <div class="admin-timeline-item" id="tlItem-${item.id}">
                <div class="admin-tl-meta">
                    <span class="admin-tl-date">${normalizeDate(item.date)}</span>
                    <span class="admin-tl-text">${escapeHtml(item.story)}</span>
                </div>
                <div class="admin-tl-actions">
                    <button type="button" class="btn-tl-edit" onclick="startEditTimeline('${item.id}')">수정</button>
                    <button type="button" class="btn-tl-delete" onclick="deleteTimelineItem('${item.id}', this)">삭제</button>
                </div>
            </div>
        `).join('');
    }

    updateMainTabBadges();
}

async function handleAddTimeline(e) {
    e.preventDefault();
    const dateInput = document.getElementById('timelineDate');
    const storyInput = document.getElementById('timelineStory');
    const submitBtn = e.target.querySelector('button[type="submit"]');

    const date = dateInput.value;
    const story = storyInput.value.trim();
    if (!date) { alert('날짜를 선택해 주세요.'); return; }
    if (!story) return;

    setBtnLoading(submitBtn, true, '등록 중');
    try {
        await functions.httpsCallable('adminSaveTimeline')({ slug: adminRoom, key: adminKey, date, story });
        setDatepickerValue('timelineDate', '');
        storyInput.value = '';
        showToast('발자취가 등록되었습니다.');
        await loadTimeline();
    } catch (err) {
        console.error(err);
        alert(err.message || '발자취를 등록하지 못했습니다.');
    } finally {
        setBtnLoading(submitBtn, false);
    }
}

function startEditTimeline(id) {
    const target = timelineCache.find(item => item.id === id);
    const itemEl = document.getElementById(`tlItem-${id}`);
    if (!target || !itemEl) return;

    itemEl.classList.add('editing');
    itemEl.innerHTML = `
        <form class="edit-mode-form" onsubmit="saveEditTimeline(event, '${id}')">
            <input type="text" id="editDate-${id}" class="edit-input-date admin-datepicker" value="${escapeHtml(target.date)}" placeholder="날짜 선택">
            <input type="text" id="editStory-${id}" class="edit-input-story" value="${escapeHtml(target.story)}" maxlength="200" required>
            <div class="edit-action-row">
                <button type="submit" class="btn-edit-save">완료</button>
                <button type="button" class="btn-edit-cancel" onclick="renderAdminTimeline()">취소</button>
            </div>
        </form>
    `;
    initAdminDatepickers(itemEl);
}

async function saveEditTimeline(e, id) {
    e.preventDefault();
    const date = document.getElementById(`editDate-${id}`).value;
    const story = document.getElementById(`editStory-${id}`).value.trim();
    if (!date) { alert('날짜를 선택해 주세요.'); return; }
    if (!story) return;
    const btn = e.target.querySelector('button[type="submit"]');

    setBtnLoading(btn, true, '저장 중');
    try {
        await functions.httpsCallable('adminSaveTimeline')({ slug: adminRoom, key: adminKey, id, date, story });
        showToast('발자취가 수정되었습니다.');
        await loadTimeline();
    } catch (err) {
        console.error(err);
        setBtnLoading(btn, false);
        alert(err.message || '발자취를 수정하지 못했습니다.');
    }
}

async function deleteTimelineItem(id, btn) {
    if (!confirm('이 발자취를 삭제하시겠습니까?')) return;
    setBtnLoading(btn, true, '삭제 중');
    try {
        await functions.httpsCallable('adminDeleteTimeline')({ slug: adminRoom, key: adminKey, id });
        showToast('발자취가 삭제되었습니다.');
        await loadTimeline();
    } catch (err) {
        console.error(err);
        setBtnLoading(btn, false);
        alert(err.message || '발자취를 삭제하지 못했습니다.');
    }
}

// =========================================
// 4. 무지개 우체통 관리 (공개 중 / 숨김)
// - 편지는 쓰는 즉시 공개되고, 보호자는 숨기거나 삭제할 수 있음
// - 예전 방식(확인 대기)으로 들어온 편지는 '숨김'에서 공개할 수 있게 함
// =========================================
async function loadLetters() {
    try {
        const result = await functions.httpsCallable('adminListLetters')({ slug: adminRoom, key: adminKey });
        lettersCache = result.data.letters || [];
    } catch (err) {
        console.error('편지 불러오기 실패:', err);
        lettersCache = [];
    }
    renderAdminPostbox();
}

function setLetterFilter(filter) {
    currentLetterFilter = filter;
    document.querySelectorAll('#panel-postbox .filter-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
    });
    renderAdminPostbox();
}

function formatLetterDate(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    return `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}.`;
}

function renderAdminPostbox() {
    const container = document.getElementById('adminPostboxList');

    const isHidden = (l) => l.status !== 'approved';
    const setCount = (id, n) => { const el = document.getElementById(id); if (el) el.innerText = n; };
    setCount('countLetterApproved', lettersCache.filter(l => !isHidden(l)).length);
    setCount('countLetterExcluded', lettersCache.filter(isHidden).length);

    if (!container) return;

    const list = lettersCache.filter(l => currentLetterFilter === 'approved' ? !isHidden(l) : isHidden(l));
    const emptyText = currentLetterFilter === 'approved'
        ? '아직 도착한 편지가 없습니다.'
        : '숨긴 편지가 없습니다.';

    if (list.length === 0) {
        container.innerHTML = `<div class="empty-state" style="padding: 24px;">${emptyText}</div>`;
        updateMainTabBadges();
        return;
    }

    container.innerHTML = list.map(letter => {
        const actions = letter.status === 'approved'
            ? `<button type="button" class="btn-tl-edit" onclick="changeLetterStatus('${letter.id}', 'excluded', this)">숨기기</button>`
            : `<button type="button" class="btn-tl-edit" onclick="changeLetterStatus('${letter.id}', 'approved', this)">공개하기</button>`;

        return `
            <div class="admin-postbox-card" id="postbox-${letter.id}">
                <div class="postbox-card-top">
                    <div class="postbox-author-info">
                        <span class="postbox-author-tag">${escapeHtml(letter.relation)}</span>
                        <strong class="postbox-author-name">${escapeHtml(letter.name)}</strong>
                        <span class="postbox-date">${formatLetterDate(letter.createdAt)}</span>
                    </div>
                    <div class="admin-tl-actions">
                        ${actions}
                        <button type="button" class="btn-postbox-delete" onclick="deletePostboxLetter('${letter.id}', this)">삭제</button>
                    </div>
                </div>
                <p class="postbox-msg-content">${escapeHtml(letter.message).replace(/\n/g, '<br>')}</p>
            </div>
        `;
    }).join('');

    updateMainTabBadges();
}

async function changeLetterStatus(id, status, btn) {
    setBtnLoading(btn, true, '처리 중');
    try {
        await functions.httpsCallable('adminUpdateLetter')({ slug: adminRoom, key: adminKey, id, status });
        const target = lettersCache.find(l => l.id === id);
        if (target) target.status = status;
        renderAdminPostbox();
        showToast(status === 'approved' ? '편지를 추모관에 공개했습니다.' : '편지를 숨겼습니다.');
    } catch (err) {
        console.error(err);
        setBtnLoading(btn, false);
        alert(err.message || '상태를 바꾸지 못했습니다.');
    }
}

async function deletePostboxLetter(id, btn) {
    if (!confirm('이 편지를 우체통에서 완전히 삭제하시겠습니까?\n삭제한 편지는 되돌릴 수 없습니다.')) return;
    setBtnLoading(btn, true, '삭제 중');
    try {
        await functions.httpsCallable('adminUpdateLetter')({ slug: adminRoom, key: adminKey, id, remove: true });
        lettersCache = lettersCache.filter(l => l.id !== id);
        renderAdminPostbox();
        showToast('편지가 삭제되었습니다.');
    } catch (err) {
        console.error(err);
        setBtnLoading(btn, false);
        alert(err.message || '편지를 삭제하지 못했습니다.');
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
    setDatepickerValue('infoMeetDate', m.meetDate);
    setDatepickerValue('infoFarewellDate', m.farewellDate);
    document.getElementById('infoQuote').value = m.quote || '';
    document.getElementById('infoGift1').value = gifts[0] || '';
    document.getElementById('infoGift2').value = gifts[1] || '';
    document.getElementById('infoBgm').value = m.bgm || 'piano';


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

// 대표 사진용 압축 (최대 800px) - HEIC 사진도 자동 변환 (media-upload.js의 decodeImageFile 사용)
async function compressProfilePhoto(file) {
    const { img, url } = await decodeImageFile(file);
    try {
        const scale = Math.min(1, 800 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.85);
    } finally {
        URL.revokeObjectURL(url);
    }
}

// 대표 사진 교체
async function handleInfoPhoto(input) {
    const file = input.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/') && !isHeicFile(file)) {
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
    saveBtn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span>저장하는 중...';

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

// =========================================
// 버튼 로딩 표시: 처리하는 동안 빙글빙글 + 다시 누르지 못하게
// =========================================
function setBtnLoading(btn, loading, text) {
    if (!btn) return;
    if (loading) {
        btn.dataset.originalHtml = btn.innerHTML;
        btn.disabled = true;
        // 버튼 배경이 어두우면 흰색, 밝으면 진한색 표시
        const rgb = (getComputedStyle(btn).backgroundColor.match(/\d+/g) || [255, 255, 255]).map(Number);
        const isDarkBg = (rgb[3] === undefined || rgb[3] > 0) && (rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114) < 140;
        btn.innerHTML = `<span class="btn-spinner${isDarkBg ? '' : ' is-dark'}" aria-hidden="true"></span>${text || ''}`;
    } else {
        btn.disabled = false;
        if (btn.dataset.originalHtml !== undefined) btn.innerHTML = btn.dataset.originalHtml;
    }
}

// =========================================
// 날짜 선택: 메인 빌더와 같은 달력 (휴대폰에서는 기기 기본 날짜 화면)
// - 실제 값은 2026-10-11 형식, 화면에는 2026. 10. 11.로 표시
// =========================================
function initAdminDatepickers(root = document) {
    if (typeof flatpickr === 'undefined') return;
    root.querySelectorAll('.admin-datepicker').forEach(el => {
        if (el._flatpickr) return;
        flatpickr(el, {
            locale: 'ko',
            dateFormat: 'Y-m-d',
            altInput: true,
            altFormat: 'Y. m. d.',
            altInputClass: el.className.replace('admin-datepicker', '').trim(),
            maxDate: 'today',
            onChange: () => el.dispatchEvent(new Event('input', { bubbles: true }))
        });
    });
}

function setDatepickerValue(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el._flatpickr) el._flatpickr.setDate(value || null, false);
    else el.value = value || '';
}

document.addEventListener('DOMContentLoaded', () => initAdminDatepickers());
// =========================================
// 원본 사진·영상 내려받기 (백업)
// - 서버가 파일마다 1시간짜리 내려받기 주소를 만들어 줌
// - 파일을 브라우저가 직접 저장해서, 큰 영상도 휴대폰 메모리와 상관없이 받아짐
// =========================================
let downloadList = [];

function formatBytes(bytes) {
    if (!bytes) return '';
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

async function openDownloadModal() {
    let modal = document.getElementById('downloadModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'downloadModal';
        modal.className = 'download-modal-backdrop';
        modal.addEventListener('click', (e) => { if (e.target === modal) closeDownloadModal(); });
        document.body.appendChild(modal);
    }
    modal.innerHTML = `
        <div class="download-modal" role="dialog" aria-modal="true" aria-labelledby="downloadTitle">
            <div class="download-head">
                <p class="download-title" id="downloadTitle">원본 사진·영상 내려받기</p>
                <button type="button" class="btn-download-close" onclick="closeDownloadModal()" aria-label="닫기"><svg viewBox="0 0 20 20" width="1em" height="1em" fill="none" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
            </div>
            <div class="download-body"><p class="download-loading"><span class="btn-spinner is-dark" aria-hidden="true"></span>파일 목록을 준비하고 있어요...</p></div>
        </div>
    `;
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    try {
        const result = await functions.httpsCallable('adminListDownloads')({ slug: adminRoom, key: adminKey });
        downloadList = result.data.files || [];
        renderDownloadList(result.data.totalBytes || 0);
    } catch (err) {
        console.error(err);
        modal.querySelector('.download-body').innerHTML = `<p class="download-empty">${escapeHtml(err.message || '목록을 불러오지 못했습니다.')}</p>`;
    }
}

function renderDownloadList(totalBytes) {
    const body = document.querySelector('#downloadModal .download-body');
    if (!body) return;

    if (downloadList.length === 0) {
        body.innerHTML = '<p class="download-empty">아직 저장된 사진이나 영상이 없습니다.</p>';
        return;
    }

    const rows = downloadList.map((f, i) => `
        <li class="download-item">
            <div class="download-thumb">${f.previewUrl ? `<img src="${escapeHtml(f.previewUrl)}" alt="" loading="lazy">` : ''}${f.type === 'video' ? '<span class="download-video-label">영상</span>' : ''}</div>
            <div class="download-info">
                <span class="download-name">${escapeHtml(f.name)}</span>
                <span class="download-meta">${escapeHtml(f.group)}${f.size ? ` · ${formatBytes(f.size)}` : ''}</span>
            </div>
            <a class="btn-download-one" href="${escapeHtml(f.url)}" download="${escapeHtml(f.name)}" onclick="markDownloaded(${i})">내려받기</a>
        </li>
    `).join('');

    body.innerHTML = `
        <p class="download-summary">
            <span class="nb">모두 ${downloadList.length}개 · ${formatBytes(totalBytes)}</span>
            <span class="nb">영상은 원본, 사진은 저장된 그대로 받아져요.</span>
        </p>
        <button type="button" id="btnDownloadAll" class="btn-download-all" onclick="downloadAll(this)">전체 내려받기</button>
        <p class="download-tip">
            <span class="nb">파일이 많거나 영상이 크다면 PC에서 받는 것을 추천해요.</span>
            <span class="nb">브라우저가 '여러 파일 내려받기'를 물어보면 허용해 주세요.</span>
            <span class="nb">내려받기 주소는 1시간 동안 유효해요.</span>
        </p>
        <ul class="download-list">${rows}</ul>
    `;
}

function markDownloaded(index) {
    const items = document.querySelectorAll('#downloadModal .download-item');
    if (items[index]) items[index].classList.add('done');
}

// 전체 내려받기: 브라우저가 막지 않도록 하나씩 간격을 두고 차례로 저장
async function downloadAll(btn) {
    btn.disabled = true;
    for (let i = 0; i < downloadList.length; i++) {
        btn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span>내려받는 중 ${i + 1}/${downloadList.length}`;
        const a = document.createElement('a');
        a.href = downloadList[i].url;
        a.download = downloadList[i].name;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        markDownloaded(i);
        await new Promise(resolve => setTimeout(resolve, 1500));
    }
    btn.innerText = '전체 내려받기 완료';
    setTimeout(() => {
        btn.disabled = false;
        btn.innerText = '전체 다시 내려받기';
    }, 2000);
}

function closeDownloadModal() {
    document.getElementById('downloadModal')?.classList.remove('active');
    document.body.style.overflow = '';
}