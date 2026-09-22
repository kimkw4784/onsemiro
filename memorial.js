// 한글 받침 유무에 따른 조사 판별 함수
function getSubjectParticle(name) {
    if (!name) return '이';
    const lastChar = name.charCodeAt(name.length - 1);
    if (lastChar < 0xAC00 || lastChar > 0xD7A3) return '이';
    return (lastChar - 0xAC00) % 28 > 0 ? '이' : '가';
}

function normalizeDateStr(dateStr) {
    if (!dateStr) return '';
    const cleaned = dateStr.replace(/[^\d]/g, '');
    if (cleaned.length === 8) {
        return `${cleaned.slice(0, 4)}. ${cleaned.slice(4, 6)}. ${cleaned.slice(6, 8)}.`;
    }
    return dateStr.trim();
}

let activeRoomSlug = 'default';

// =========================================
// 오디오 BGM 컨트롤러
// =========================================
const bgmAudio = new Audio();
bgmAudio.loop = true;
bgmAudio.volume = 0.4;
let isBgmPlaying = false;

function toggleBgmPlay() {
    const btn = document.getElementById('bgmToggleBtn');
    const select = document.getElementById('bgmSelect');

    if (!select.value) {
        select.selectedIndex = 1;
        bgmAudio.src = select.value;
    }
    if (!bgmAudio.src) {
        bgmAudio.src = select.value;
    }

    if (isBgmPlaying) {
        bgmAudio.pause();
        isBgmPlaying = false;
        btn.innerText = '재생';
    } else {
        bgmAudio.play().then(() => {
            isBgmPlaying = true;
            btn.innerText = '정지';
        }).catch(err => console.log("BGM 재생 에러:", err));
    }
}

function switchBgm() {
    const btn = document.getElementById('bgmToggleBtn');
    const select = document.getElementById('bgmSelect');
    if (!select.value) return;

    if (select.value === 'none') {
        bgmAudio.pause();
        bgmAudio.currentTime = 0;
        isBgmPlaying = false;
        btn.innerText = '재생';
        btn.style.opacity = '0.5';
        btn.style.pointerEvents = 'none';
        return;
    }

    btn.style.opacity = '1';
    btn.style.pointerEvents = 'auto';
    bgmAudio.src = select.value;
    bgmAudio.play().then(() => {
        isBgmPlaying = true;
        btn.innerText = '정지';
    }).catch(err => console.log("곡 재생 대기:", err));
}

// =========================================
// 인터랙션 (헌화/간식)
// =========================================
function addInteractCount(btn, type = 'default') {
    const cntEl = btn.querySelector('.cnt') || btn.querySelector('strong');
    if (!cntEl) return;

    let currentVal = parseInt(cntEl.innerText.replace(/[^\d]/g, ''), 10) || 0;
    cntEl.innerText = currentVal + 1;

    cntEl.classList.remove('count-bump');
    void cntEl.offsetWidth;
    cntEl.classList.add('count-bump');

    createFloatingParticle(btn, type);
}

function createFloatingParticle(targetEl, type) {
    const emojiPacks = {
        dog: {
            treat: ['🦴', '🍖', '🥩', '🍪', '🐾', '✨'],
            toy: ['🎾', '⚾', '🧸', '🥏', '⭐', '✨'],
            candle: ['🕯️', '✨', '🌟', '💛', '🌈'],
            default: ['🐾', '🤍', '✨', '🕊️']
        },
        cat: {
            treat: ['🐟', '🍣', '🍗', '🥛', '🐾', '✨'],
            toy: ['🧶', '🪢', '📦', '🎈', '⭐', '✨'],
            candle: ['🕯️', '✨', '🌟', '💛', '🌈'],
            default: ['🐾', '🤍', '✨', '🕊️']
        }
    };

    const targetList = emojiPacks.dog[type] || emojiPacks.dog.default;
    const emoji = targetList[Math.floor(Math.random() * targetList.length)];

    const particle = document.createElement('span');
    particle.className = 'interactive-floating-particle';
    particle.innerText = emoji;

    const randomOffset = (Math.random() - 0.5) * 30;
    particle.style.left = `calc(50% + ${randomOffset}px)`;
    targetEl.appendChild(particle);

    setTimeout(() => particle.remove(), 950);
}

// =========================================
// 무지개 우체통 (방명록 격리 저장)
// =========================================
function getLettersKey() {
    return `letters_${activeRoomSlug}`;
}

function loadLetters() {
    const list = document.getElementById('letterList');
    if (!list) return;

    const saved = localStorage.getItem(getLettersKey());
    const letters = saved ? JSON.parse(saved) : [];

    if (letters.length === 0) {
        list.innerHTML = `
            <div style="text-align:center; padding: 32px 0; color: var(--text-muted); font-size: 13px;">
                아직 도착한 편지가 없습니다.<br>아이에게 전하는 첫 번째 따뜻한 마음을 남겨주세요.
            </div>
        `;
        return;
    }

    list.innerHTML = letters.map(letter => `
        <div class="letter-card">
            <div class="letter-header">
                <span class="letter-author">${letter.relation} ${letter.name}</span>
                <span class="letter-date">${letter.date}</span>
            </div>
            <p class="letter-content">${letter.msg}</p>
        </div>
    `).join('');
}

function handleLetterSubmit(e) {
    e.preventDefault();
    const nameInput = document.getElementById('letterName');
    const relationInput = document.getElementById('letterRelation');
    const msgInput = document.getElementById('letterMsg');

    const name = nameInput.value.trim();
    const relation = relationInput.value.trim();
    const msg = msgInput.value.trim();
    if (!name || !relation || !msg) return;

    const today = new Date();
    const currentDate = `${today.getFullYear()}. ${String(today.getMonth() + 1).padStart(2, '0')}. ${String(today.getDate()).padStart(2, '0')}.`;

    const newLetter = {
        id: 'LET-' + Date.now(),
        name,
        relation,
        msg,
        date: currentDate
    };

    const saved = localStorage.getItem(getLettersKey());
    const letters = saved ? JSON.parse(saved) : [];
    letters.unshift(newLetter);
    localStorage.setItem(getLettersKey(), JSON.stringify(letters));

    // 전체 어드민 호환용
    localStorage.setItem('memorial_letters', JSON.stringify(letters));

    loadLetters();

    nameInput.value = '';
    relationInput.value = '';
    msgInput.value = '';
    showToast("소중한 마음이 우체통에 고이 전해졌습니다 ✉️");
}

// =========================================
// 갤러리 및 미디어 렌더링
// =========================================
function renderMedia(order) {
    const photoGrid = document.getElementById('galleryGrid');
    const videoGrid = document.getElementById('videoGrid');
    const videoSection = document.getElementById('videoSection');

    if (!photoGrid) return;
    photoGrid.innerHTML = '';
    if (videoGrid) videoGrid.innerHTML = '';

    const rawMemories = localStorage.getItem('pendingMemories');
    const memories = rawMemories ? JSON.parse(rawMemories) : [];
    const approvedList = memories.filter(item => item.status === 'approved');

    let photoCount = 0;
    let videoCount = 0;

    // ⭐️ 대표 사진(order.petPhoto)은 상단 원형 프로필에만 노출하고, 갤러리에는 주입하지 않습니다.
    // 관리자(보호자)가 승인한 지인 사진/영상만 갤러리에 노출
    approvedList.forEach(item => {
        if (!item.files) return;
        item.files.filter(f => !f.excluded).forEach(f => {
            const senderTag = `${item.relation} ${item.sender}`;
            const captionText = item.story ? `${item.story} (${senderTag})` : senderTag;

            if (f.type === 'video' && videoGrid) {
                videoCount++;
                videoGrid.prepend(createVideoElement(f.data, `${item.submittedAt} · ${senderTag}`, item.story || '보내주신 영상입니다.'));
            } else {
                photoCount++;
                const el = createPhotoElement(f.data, captionText);
                el.classList.add('approved-memory');
                photoGrid.prepend(el);
            }
        });
    });

    // 승인된 사진이 0장일 때의 빈 화면 안내
    if (photoCount === 0) {
        photoGrid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 44px 16px; background: #FFF; border-radius: 14px; border: 1px dashed rgba(43, 38, 32, 0.12);">
                <p style="font-size: 13.5px; color: var(--text-sub); margin-bottom: 6px;">아직 전시 승인된 기억의 사진이 없습니다.</p>
                <p style="font-size: 12px; color: var(--text-muted);">지인들이 보내온 사진은 관리자 화면에서 승인 후 공개됩니다.</p>
            </div>
        `;
    }

    // 영상이 있을 때만 비디오 섹션 오픈
    if (videoSection) {
        videoSection.style.display = videoCount > 0 ? 'block' : 'none';
    }
}

function createPhotoElement(src, caption) {
    const div = document.createElement('div');
    div.className = 'gallery-item';
    div.onclick = function () { openImageModal(this); };
    div.innerHTML = `<img src="${src}" alt="${caption}">`;
    return div;
}

function createVideoElement(src, date, desc) {
    const div = document.createElement('div');
    div.className = 'video-card';
    div.onclick = () => openVideoModal(src, date, desc);
    div.innerHTML = `
        <div class="video-wrapper">
            <video src="${src}" loop muted playsinline preload="auto"></video>
            <div class="video-play-overlay"><span class="play-icon">▶</span></div>
        </div>
        <div class="video-info">
            <span class="video-date">${date}</span>
            <p class="video-desc">${desc}</p>
        </div>
    `;
    return div;
}

// =========================================
// 초기화 및 데이터 바인딩
// =========================================
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');

    const rawData = localStorage.getItem('recentMemorialOrder');
    let order = rawData ? JSON.parse(rawData) : null;

    activeRoomSlug = roomParam || (order && order.roomSlug) || 'active_room';

    if (order) {
        const petName = order.petName || '아이';
        const josa = getSubjectParticle(petName);

        document.title = `${petName}의 온새미로 | ONSEMIRO`;

        document.getElementById('memorialTitleName').innerText = petName;
        document.getElementById('ctaPetName').innerText = petName;

        // 인트로 프로필 사진
        const avatarImg = document.getElementById('introAvatar');
        if (avatarImg) {
            avatarImg.src = order.petPhoto || './images/coco4.png';
            avatarImg.alt = petName;
        }

        // 날짜 및 경과일 계산
        const cleanMeet = order.meetDate ? order.meetDate.replace(/\s+/g, '').replace(/\.$/, '') : '';
        const cleanFarewell = order.farewellDate ? order.farewellDate.replace(/\s+/g, '').replace(/\.$/, '') : '';
        let daysText = '';
        if (cleanMeet && cleanFarewell) {
            const startDate = new Date(cleanMeet.replace(/\./g, '-'));
            const endDate = new Date(cleanFarewell.replace(/\./g, '-'));
            if (!isNaN(startDate) && !isNaN(endDate)) {
                const diffDays = Math.ceil(Math.abs(endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
                daysText = ` (함께한 <strong>${diffDays.toLocaleString()}일</strong>의 여정)`;
            }
        }
        document.getElementById('memorialDates').innerHTML = `${cleanMeet} — ${cleanFarewell}${daysText}`;

        // 추모글/문구
        const quoteEl = document.getElementById('memorialQuote');
        if (quoteEl) {
            quoteEl.innerHTML = order.quote
                ? `“${order.quote.replace(/\n/g, '<br>')}”`
                : `“우리 가족에게 와줘서 정말 행복했어. 영원히 사랑해.”`;
        }

        // 헌정 인터랙션 버튼
        const row = document.getElementById('interactiveRow');
        if (row) {
            const g1 = order.gift1 || '좋아하던 간식';
            const g2 = order.gift2 || '노란 장난감';
            row.innerHTML = `
                <button type="button" class="btn-interact" onclick="addInteractCount(this, 'treat')">
                    <span class="btn-dot"></span> ${g1} <strong class="cnt">1</strong>
                </button>
                <button type="button" class="btn-interact" onclick="addInteractCount(this, 'toy')">
                    <span class="btn-dot"></span> ${g2} <strong class="cnt">1</strong>
                </button>
                <button type="button" class="btn-interact" onclick="addInteractCount(this, 'candle')">
                    <span class="btn-dot"></span> 촛불 밝히기 <strong class="cnt">1</strong>
                </button>
            `;
        }

        // 취합 링크 및 관리자 버튼
        document.getElementById('galleryUploadBtn').href = `upload.html?room=${activeRoomSlug}`;
        const adminBtn = document.getElementById('adminFloatingBtn');
        if (adminBtn) {
            adminBtn.href = `admin.html?room=${activeRoomSlug}`;
            adminBtn.style.display = 'inline-flex';
        }

        // 발자취 타임라인
        const tlList = document.getElementById('memorialTimelineList');
        if (tlList) {
            const currentSlug = activeRoomSlug || (order && order.roomSlug) || 'default';
            const roomTlKey = `timeline_${currentSlug}`;
            const rawTL = localStorage.getItem(roomTlKey);
            let tlData = [];

            if (rawTL) {
                tlData = JSON.parse(rawTL);
            } else {
                tlData = [
                    {
                        date: normalizeDateStr(order.meetDate) || '2025. 09. 18.',
                        story: `손바닥만 하던 ${petName}${josa} 처음 우리 집에 오던 날, 온 세상이 따뜻해졌어.`
                    },
                    {
                        date: normalizeDateStr(order.farewellDate) || '2026. 09. 17.',
                        story: '가족들의 품에서 조용히 눈을 감고, 가장 빛나는 별이 된 날.'
                    }
                ];
                localStorage.setItem(roomTlKey, JSON.stringify(tlData));
                localStorage.setItem('memorial_timeline_list', JSON.stringify(tlData));
            }

            tlData.sort((a, b) => (parseInt(a.date.replace(/[^\d]/g, ''), 10) || 0) - (parseInt(b.date.replace(/[^\d]/g, ''), 10) || 0));
            tlList.innerHTML = tlData.map(item => `
                <div class="timeline-item">
                    <span class="timeline-date">${item.date}</span>
                    <p class="timeline-text">${item.story}</p>
                </div>
            `).join('');
        }
    }

    renderMedia(order);
    loadLetters();
});

// 모달 및 유틸리티
function openImageModal(item) {
    const img = item.querySelector('img');
    const modal = document.getElementById('imageModal');
    document.getElementById('modalFullImage').src = img.src;
    document.getElementById('modalImageCaption').innerText = img.alt || '';
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeImageModal(e) {
    if (e.target.id === 'imageModal') closeImageModalDirect();
}

function closeImageModalDirect() {
    const modal = document.getElementById('imageModal');
    modal.classList.remove('active');
    document.getElementById('modalFullImage').src = '';
    document.body.style.overflow = '';
}

function copyMemorialLink() {
    navigator.clipboard.writeText(window.location.href).then(() => showToast("추모관 링크가 복사되었습니다."));
}

function showToast(msg) {
    const toast = document.getElementById("toastMessage");
    if (!toast) return;
    toast.innerText = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2500);
}