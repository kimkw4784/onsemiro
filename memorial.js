// 이름 끝에 받침이 있으면 '이'를 붙여 부르는 이름으로 바꿔줍니다.
// (하임 → 하임이, 코코 → 코코) 뒤에 붙는 조사는 항상 받침 없는 형태(가/를/와/의/에게)로 쓰면 됩니다.
function callName(name) {
    if (!name) return '';
    const lastChar = name.charCodeAt(name.length - 1);
    if (lastChar < 0xAC00 || lastChar > 0xD7A3) return name;
    return (lastChar - 0xAC00) % 28 > 0 ? name + '이' : name;
}

let activeRoomSlug = '';
let activePetType = 'dog';

// 화면에 넣기 전에 HTML 특수문자를 바꿔서, 입력값에 섞인 태그가 실행되지 않게 함
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// "2013-05-10" → "2013. 05. 10."
function formatIsoDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${y}. ${m}. ${d}.`;
}

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
// 저장된 배경음악을 추모관 선택창에 반영
// (빌더는 곡 제목을, 관리자 정보 탭은 키 값을 저장하므로 둘 다 처리)
// =========================================
const BGM_FILES = {
    piano: './audio/bgm-piano.mp3',
    guitar: './audio/bgm-guitar.mp3',
    musicbox: './audio/bgm-musicbox.mp3',
    none: 'none'
};
const BGM_TITLE_TO_KEY = {
    '별빛 아래 너와 나 (잔잔한 피아노)': 'piano',
    '따뜻한 봄날의 산책 (어쿠스틱 기타)': 'guitar',
    '영원한 안식처 (서정적인 오르골)': 'musicbox',
    '음악 없음 (조용한 추모)': 'none'
};

function applySavedBgm(saved) {
    const select = document.getElementById('bgmSelect');
    if (!select || !saved) return;

    const key = BGM_TITLE_TO_KEY[saved] || saved;
    const value = BGM_FILES[key];
    if (!value) return;

    select.value = value;
    const btn = document.getElementById('bgmToggleBtn');
    if (value === 'none') {
        if (btn) {
            btn.style.opacity = '0.5';
            btn.style.pointerEvents = 'none';
        }
    } else {
        bgmAudio.src = value; // 자동재생은 브라우저가 막기 때문에 곡만 준비해 두고, 재생 버튼으로 시작
    }
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

    // 서버에 +1 저장 (보안 규칙상 카운트를 1씩 올리는 것만 허용됨)
    if (activeRoomSlug && ['treat', 'toy', 'candle'].includes(type)) {
        db.collection('memorials').doc(activeRoomSlug).update({
            [`counts.${type}`]: firebase.firestore.FieldValue.increment(1)
        }).catch(err => console.error('카운트 저장 실패:', err));
    }
}

function createFloatingParticle(targetEl, type) {
    // 추모관 정보에서 읽어온 동물 종류 (기본값: 'dog')
    const petType = activePetType;

    // 동물 종류별 아이콘 세트 (Iconify Noto Emoji)
    const iconPacks = {
        dog: {
            treat: ['noto:bone', 'noto:meat-on-bone', 'noto:cookie', 'fxemoji:sparkles'],
            toy: ['noto:soccer-ball', 'twemoji:teddy-bear', 'noto:balloon'],
            candle: ['noto:candle', 'fxemoji:sparkles', 'noto:star', 'fluent-emoji-flat:pink-heart', 'noto:rainbow'],
            default: ['noto:paw-prints', 'fluent-emoji-flat:pink-heart', 'fxemoji:sparkles']
        },
        cat: {
            treat: ['noto-v1:fish', 'streamline-plump-color:fish', 'fluent-emoji-flat:glass-of-milk'],
            toy: ['noto:yarn', 'noto:package', 'noto:balloon'],
            candle: ['noto:candle', 'fxemoji:sparkles', 'noto:star', 'fluent-emoji-flat:pink-heart', 'noto:rainbow'],
            default: ['noto:paw-prints', 'fluent-emoji-flat:pink-heart', 'fxemoji:sparkles']
        },
        small: {
            treat: ['noto:sunflower', 'noto:carrot', 'noto:red-apple'],
            toy: ['noto:bell', 'noto:ribbon', 'noto:balloon'],
            candle: ['noto:candle', 'fxemoji:sparkles', 'noto:star', 'fluent-emoji-flat:pink-heart', 'noto:rainbow'],
            default: ['noto:herb', 'fluent-emoji-flat:pink-heart', 'fxemoji:sparkles']
        }
    };

    const currentPack = iconPacks[petType] || iconPacks.dog;
    const targetList = currentPack[type] || currentPack.default;
    const iconName = targetList[Math.floor(Math.random() * targetList.length)];

    const particle = document.createElement('span');
    particle.className = 'interactive-floating-particle';
    particle.innerHTML = `<iconify-icon icon="${iconName}"></iconify-icon>`;

    const randomOffset = (Math.random() - 0.5) * 30;
    particle.style.left = `calc(50% + ${randomOffset}px)`;
    targetEl.appendChild(particle);

    setTimeout(() => particle.remove(), 950);
}

// =========================================
// 무지개 우체통 (방명록 격리 저장)
// =========================================
// 공개된 편지만 불러오기 (보안 규칙상 'approved' 편지만 읽을 수 있음)
async function loadLetters() {
    const list = document.getElementById('letterList');
    if (!list) return;

    let letters = [];
    try {
        const snap = await db.collection('memorials').doc(activeRoomSlug)
            .collection('letters').where('status', '==', 'approved').get();
        letters = snap.docs.map(doc => doc.data());
    } catch (err) {
        console.error('편지 불러오기 실패:', err);
    }

    if (letters.length === 0) {
        list.innerHTML = `
            <div style="text-align:center; padding: 32px 0; color: var(--text-muted); font-size: 13px;">
                아직 도착한 편지가 없습니다.<br>아이에게 전하는 첫 번째 따뜻한 마음을 남겨주세요.
            </div>
        `;
        return;
    }

    // 최신 편지가 위로
    letters.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

    list.innerHTML = letters.map(letter => {
        const d = letter.createdAt?.toDate?.();
        const date = d ? `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}.` : '';
        return `
            <div class="letter-card">
                <div class="letter-header">
                    <span class="letter-author">${escapeHtml(letter.relation)} ${escapeHtml(letter.name)}</span>
                    <span class="letter-date">${date}</span>
                </div>
                <p class="letter-content">${escapeHtml(letter.message).replace(/\n/g, '<br>')}</p>
            </div>
        `;
    }).join('');
}

// 편지 보내기 → 보호자 확인 대기 상태로 저장
async function handleLetterSubmit(e) {
    e.preventDefault();
    const nameInput = document.getElementById('letterName');
    const relationInput = document.getElementById('letterRelation');
    const msgInput = document.getElementById('letterMsg');
    const submitBtn = e.target.querySelector('button[type="submit"]');

    const name = nameInput.value.trim().slice(0, 20);
    const relation = relationInput.value.trim().slice(0, 20);
    const message = msgInput.value.trim().slice(0, 1000);
    if (!name || !relation || !message) return;

    if (submitBtn) submitBtn.disabled = true;
    try {
        await db.collection('memorials').doc(activeRoomSlug).collection('letters').add({
            name,
            relation,
            message,
            status: 'pending',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        nameInput.value = '';
        relationInput.value = '';
        msgInput.value = '';
        showToast('편지가 전해졌어요. 보호자님 확인 후 우체통에 걸립니다.');
    } catch (err) {
        console.error('편지 저장 실패:', err);
        alert('편지를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

// =========================================
// 갤러리 및 미디어 렌더링
// =========================================
const MEDIA_BASE = 'https://media.onsemiro.me';
function mediaUrl(path) {
    return path ? `${MEDIA_BASE}/${path}` : '';
}

// 승인된 사진·영상 불러오기 (보호자가 전시한 것만 모아 둔 gallery 목록)
async function renderMedia() {
    const photoGrid = document.getElementById('galleryGrid');
    const videoGrid = document.getElementById('videoGrid');
    const videoSection = document.getElementById('videoSection');
    if (!photoGrid) return;

    let items = [];
    try {
        const snap = await db.collection('memorials').doc(activeRoomSlug).collection('gallery').get();
        items = snap.docs.map(doc => doc.data());
    } catch (err) {
        console.error('갤러리 불러오기 실패:', err);
    }

    // 최신 추억이 앞으로, 같은 묶음 안에서는 올린 순서대로
    items.sort((a, b) => {
        const diff = (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0);
        return diff !== 0 ? diff : (a.fileIndex || 0) - (b.fileIndex || 0);
    });

    photoGrid.innerHTML = '';
    if (videoGrid) videoGrid.innerHTML = '';

    let photoCount = 0;
    let videoCount = 0;

    items.forEach(item => {
        const d = item.createdAt?.toDate?.();
        const dateText = d ? `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}.` : '';
        const caption = item.story ? `${item.story} (${item.senderLabel})` : item.senderLabel;

        if (item.type === 'video') {
            if (!videoGrid) return;
            videoCount++;
            videoGrid.appendChild(createVideoElement(
                mediaUrl(item.path),
                mediaUrl(item.thumbPath),
                [dateText, item.senderLabel].filter(Boolean).join(' · '),
                item.story || '보내주신 영상입니다.'
            ));
        } else {
            photoCount++;
            const el = createPhotoElement(mediaUrl(item.path), caption);
            el.classList.add('approved-memory');
            photoGrid.appendChild(el);
        }
    });

    // 전시된 사진이 없을 때의 안내
    if (photoCount === 0) {
        photoGrid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 44px 16px; background: #FFF; border-radius: 14px; border: 1px dashed rgba(43, 38, 32, 0.12);">
                <p style="font-size: 13.5px; color: var(--text-sub); margin-bottom: 6px;">아직 전시된 기억의 사진이 없습니다.</p>
                <p style="font-size: 12px; color: var(--text-muted);">가족과 지인들이 보내온 사진은 보호자님 확인 후 공개됩니다.</p>
            </div>
        `;
    }

    // 영상이 있을 때만 영상 섹션 열기
    if (videoSection) {
        videoSection.style.display = videoCount > 0 ? 'block' : 'none';
    }
}

function createPhotoElement(src, caption) {
    const div = document.createElement('div');
    div.className = 'gallery-item';
    div.onclick = function () { openImageModal(this); };
    div.innerHTML = `<img src="${src}" alt="${escapeHtml(caption)}" loading="lazy">`;
    return div;
}

// 영상은 썸네일만 먼저 보여주고, 눌렀을 때 영상을 불러옴 (데이터 절약)
function createVideoElement(src, thumb, date, desc) {
    const div = document.createElement('div');
    div.className = 'video-card';
    div.onclick = () => openVideoModal(src, date, desc);
    div.innerHTML = `
        <div class="video-wrapper">
            <img src="${thumb}" alt="" loading="lazy" style="width:100%; height:100%; object-fit:cover; display:block;">
            <div class="video-play-overlay"><span class="play-icon"><svg viewBox="0 0 20 20" width="1em" height="1em" aria-hidden="true"><path d="M6.5 4.5l9 5.5-9 5.5z" fill="currentColor"/></svg></span></div>
        </div>
        <div class="video-info">
            <span class="video-date">${escapeHtml(date)}</span>
            <p class="video-desc">${escapeHtml(desc)}</p>
        </div>
    `;
    return div;
}

// 영상 모달 (재생 중에는 배경음악을 잠시 멈췄다가, 닫으면 다시 재생)
let wasBgmPlayingBeforeVideo = false;

function openVideoModal(videoSrc, dateText, descText) {
    const modal = document.getElementById('videoModal');
    const player = document.getElementById('modalVideoPlayer');
    const bgmBtn = document.getElementById('bgmToggleBtn');

    if (isBgmPlaying) {
        wasBgmPlayingBeforeVideo = true;
        bgmAudio.pause();
        isBgmPlaying = false;
        if (bgmBtn) bgmBtn.innerText = '재생';
    } else {
        wasBgmPlayingBeforeVideo = false;
    }

    player.src = videoSrc;
    document.getElementById('modalVideoDate').innerText = dateText;
    document.getElementById('modalVideoDesc').innerText = descText;
    player.muted = false;

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    player.load();
    const playPromise = player.play();
    if (playPromise !== undefined) {
        playPromise.catch(err => console.log('자동재생 차단됨:', err));
    }
}

function closeVideoModal(event) {
    if (event.target.id === 'videoModal') forceCloseModal();
}

function forceCloseModal() {
    const modal = document.getElementById('videoModal');
    const player = document.getElementById('modalVideoPlayer');
    const bgmBtn = document.getElementById('bgmToggleBtn');

    player.pause();
    player.removeAttribute('src');
    player.load();

    modal.classList.remove('active');
    document.body.style.overflow = '';

    if (wasBgmPlayingBeforeVideo) {
        bgmAudio.play().then(() => {
            isBgmPlaying = true;
            if (bgmBtn) bgmBtn.innerText = '정지';
        }).catch(err => console.log('BGM 복구 에러:', err));
        wasBgmPlayingBeforeVideo = false;
    }
}

// =========================================
// 초기화 및 데이터 바인딩
// =========================================
document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = (urlParams.get('room') || '').trim().toUpperCase();
    const adminKey = urlParams.get('key');

    if (!roomParam) {
        showNotFound();
        return;
    }

    // Firestore에서 추모관 정보 읽기
    let memorial = null;
    try {
        const snap = await db.collection('memorials').doc(roomParam).get();
        if (snap.exists) memorial = snap.data();
    } catch (err) {
        console.error('추모관 불러오기 실패:', err);
    }

    if (!memorial) {
        showNotFound();
        return;
    }

    activeRoomSlug = roomParam;
    activePetType = memorial.petType || 'dog';
    renderMemorial(memorial, adminKey);

    // 갤러리·우체통
    renderMedia();
    loadLetters();
});

// 추모관 기본 정보를 화면에 채우기
function renderMemorial(memorial, adminKey) {
    const petName = memorial.petName || '아이';
    const counts = memorial.counts || {};
    const gifts = memorial.gifts || [];

    applySavedBgm(memorial.bgm);
    document.title = `${petName}의 온새미로 | ONSEMIRO`;

    document.getElementById('memorialTitleName').innerText = petName;
    document.getElementById('ctaPetName').innerText = callName(petName);

    // 인트로 프로필 사진
    const avatarImg = document.getElementById('introAvatar');
    if (avatarImg) {
        avatarImg.src = memorial.photoUrl || './images/coco4.png';
        avatarImg.alt = petName;
    }

    // 날짜 및 함께한 날 계산
    const meet = formatIsoDate(memorial.meetDate);
    const farewell = formatIsoDate(memorial.farewellDate);
    let daysText = '';
    if (memorial.meetDate && memorial.farewellDate) {
        const diff = new Date(memorial.farewellDate) - new Date(memorial.meetDate);
        if (!isNaN(diff) && diff >= 0) {
            const diffDays = Math.ceil(diff / (1000 * 60 * 60 * 24)) + 1;
            daysText = ` (함께한 <strong>${diffDays.toLocaleString()}일</strong>의 여정)`;
        }
    }
    document.getElementById('memorialDates').innerHTML = `${meet} — ${farewell}${daysText}`;

    // 한 줄 메시지
    const quoteEl = document.getElementById('memorialQuote');
    if (quoteEl) {
        quoteEl.innerHTML = memorial.quote
            ? `“${escapeHtml(memorial.quote).replace(/\n/g, '<br>')}”`
            : '“우리 가족에게 와줘서 정말 행복했어. 영원히 사랑해.”';
    }

    // 선물·촛불 버튼 (카운트는 서버에 저장된 값)
    const row = document.getElementById('interactiveRow');
    if (row) {
        const g1 = escapeHtml(gifts[0] || '좋아하던 간식');
        const g2 = escapeHtml(gifts[1] || '노란 장난감');
        row.innerHTML = `
            <button type="button" class="btn-interact" onclick="addInteractCount(this, 'treat')">
                <span class="btn-dot"></span> ${g1} <strong class="cnt">${counts.treat || 0}</strong>
            </button>
            <button type="button" class="btn-interact" onclick="addInteractCount(this, 'toy')">
                <span class="btn-dot"></span> ${g2} <strong class="cnt">${counts.toy || 0}</strong>
            </button>
            <button type="button" class="btn-interact" onclick="addInteractCount(this, 'candle')">
                <span class="btn-dot"></span> 촛불 밝히기 <strong class="cnt">${counts.candle || 0}</strong>
            </button>
        `;
    }

    // 사진 모으기 링크
    document.getElementById('galleryUploadBtn').href = `upload.html?room=${activeRoomSlug}`;

    // 관리자 버튼: 이 기기가 관리자 키를 기억하고 있고, 서버에서 확인되면 표시
    showAdminButtonIfVerified(adminKey);

    // 발자취 타임라인
    loadTimeline();
}

// 발자취 불러오기 (날짜 순으로 정렬)
async function loadTimeline() {
    const tlList = document.getElementById('memorialTimelineList');
    if (!tlList) return;

    let items = [];
    try {
        const snap = await db.collection('memorials').doc(activeRoomSlug).collection('timeline').get();
        items = snap.docs.map(doc => doc.data());
    } catch (err) {
        console.error('발자취 불러오기 실패:', err);
    }

    if (items.length === 0) {
        tlList.innerHTML = `
            <div style="text-align:center; padding: 24px 0; color: var(--text-muted); font-size: 13px;">
                아직 기록된 발자취가 없습니다.
            </div>
        `;
        return;
    }

    items.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    tlList.innerHTML = items.map(item => `
        <div class="timeline-item">
            <span class="timeline-date">${formatIsoDate(item.date)}</span>
            <p class="timeline-text">${escapeHtml(item.story)}</p>
        </div>
    `).join('');
}

// 관리자 버튼 표시 여부 확인
// - 주소의 key 또는 이 기기에 기억된 키를 서버에 확인해서 맞을 때만 버튼 표시
async function showAdminButtonIfVerified(urlKey) {
    const storageKey = `onsemiro_admin_${activeRoomSlug}`;
    let storedKey = '';
    try { storedKey = localStorage.getItem(storageKey) || ''; } catch (e) { /* 무시 */ }

    const key = urlKey || storedKey;
    if (!key) return;

    try {
        await functions.httpsCallable('verifyAdmin')({ slug: activeRoomSlug, key });
    } catch (err) {
        // 키가 틀렸거나 재발급된 경우: 기억해 둔 예전 키 정리
        if (!urlKey) {
            try { localStorage.removeItem(storageKey); } catch (e) { /* 무시 */ }
        }
        return;
    }

    try { localStorage.setItem(storageKey, key); } catch (e) { /* 무시 */ }

    // 주소에 키가 있었다면 지워서, 이 화면을 공유하거나 캡처해도 키가 드러나지 않게 함
    if (urlKey) history.replaceState(null, '', `memorial.html?room=${activeRoomSlug}`);

    const adminBtn = document.getElementById('adminFloatingBtn');
    if (adminBtn) {
        adminBtn.href = `admin.html?room=${activeRoomSlug}`;
        adminBtn.style.display = 'inline-flex';
    }
}

// 주소가 잘못됐거나 없는 추모관일 때
function showNotFound() {
    const main = document.querySelector('.sample-container');
    if (!main) return;
    main.innerHTML = `
        <section class="memorial-intro" style="padding: 120px 20px;">
            <span class="intro-badge">NOT FOUND</span>
            <h1 class="intro-name" style="font-size: 24px;">추모관을 찾을 수 없어요</h1>
            <p class="intro-dates">주소가 정확한지 다시 한 번 확인해 주세요.<br>알림톡으로 받으신 주소를 그대로 눌러 들어오시면 가장 정확합니다.</p>
            <a href="index.html" class="btn-banner" style="display:inline-block; margin-top: 24px;">온새미로 메인으로</a>
        </section>
    `;
}

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
    // 관리자 키(&key=...)가 함께 복사되지 않도록 공개 주소만 복사
    const publicUrl = `${window.location.origin}/memorial.html?room=${activeRoomSlug}`;
    navigator.clipboard.writeText(publicUrl).then(() => showToast("추모관 링크가 복사되었습니다."));
}

function showToast(msg) {
    const toast = document.getElementById("toastMessage");
    if (!toast) return;
    toast.innerText = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2500);
}