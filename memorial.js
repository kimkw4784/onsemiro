function callName(name) {
    if (!name) return '';
    const lastChar = name.charCodeAt(name.length - 1);
    if (lastChar < 0xAC00 || lastChar > 0xD7A3) return name;
    return (lastChar - 0xAC00) % 28 > 0 ? name + '이' : name;
}

let activeRoomSlug = '';
let activePetType = 'dog';

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatIsoDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${y}. ${m}. ${d}.`;
}

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
        bgmAudio.src = value;
    }
}

function addInteractCount(btn, type = 'default') {
    const cntEl = btn.querySelector('.cnt') || btn.querySelector('strong');
    if (!cntEl) return;

    let currentVal = parseInt(cntEl.innerText.replace(/[^\d]/g, ''), 10) || 0;
    cntEl.innerText = currentVal + 1;

    cntEl.classList.remove('count-bump');
    void cntEl.offsetWidth;
    cntEl.classList.add('count-bump');

    createFloatingParticle(btn, type);

    if (activeRoomSlug && ['treat', 'toy', 'candle'].includes(type)) {
        db.collection('memorials').doc(activeRoomSlug).update({
            [`counts.${type}`]: firebase.firestore.FieldValue.increment(1)
        }).catch(err => console.error('카운트 저장 실패:', err));
    }
}

function createFloatingParticle(targetEl, type) {
    const petType = activePetType;

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
            status: 'approved',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        nameInput.value = '';
        relationInput.value = '';
        msgInput.value = '';
        showToast('소중한 마음이 무지개 우체통에 걸렸어요.');
        await loadLetters();
    } catch (err) {
        console.error('편지 저장 실패:', err);
        alert('편지를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

const MEDIA_BASE = 'https://media.onsemiro.me';
function mediaUrl(path) {
    return path ? `${MEDIA_BASE}/${path}` : '';
}

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

    if (photoCount === 0) {
        photoGrid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 44px 16px; background: #FFF; border-radius: 14px; border: 1px dashed rgba(43, 38, 32, 0.12);">
                <p style="font-size: 13.5px; color: var(--text-sub); margin-bottom: 6px;">아직 전시된 기억의 사진이 없습니다.</p>
                <p style="font-size: 12px; color: var(--text-muted);">가족과 지인들이 보내온 사진은 보호자님 확인 후 공개됩니다.</p>
            </div>
        `;
    }

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
    pushModalHistory();

    player.load();
    const playPromise = player.play();
    if (playPromise !== undefined) {
        playPromise.catch(err => console.log('자동재생 차단됨:', err));
    }
}

function closeVideoModal(event) {
    if (event.target.id === 'videoModal') forceCloseModal();
}

function closeVideoModalNow() {
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

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = (urlParams.get('room') || '').trim().toUpperCase();
    const adminKey = urlParams.get('key');

    if (!roomParam) {
        showNotFound();
        return;
    }

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

    renderMedia();
    loadLetters();
});

function renderMemorial(memorial, adminKey) {
    const petName = memorial.petName || '아이';
    const counts = memorial.counts || {};
    const gifts = memorial.gifts || [];

    applySavedBgm(memorial.bgm);

    memorialShareInfo = {
        title: `${petName}의 온새미로`,
        description: `${callName(petName)}를 기억하는 마음을 함께 나눠주세요.`,
        imageUrl: memorial.photoUrl || ''
    };
    document.title = `${petName}의 추모관 | ONSEMIRO 온새미로`;

    document.getElementById('memorialTitleName').innerText = petName;
    document.getElementById('ctaPetName').innerText = callName(petName);

    const avatarImg = document.getElementById('introAvatar');
    if (avatarImg) {
        avatarImg.src = memorial.photoUrl || './images/coco4.png';
        avatarImg.alt = petName;
    }

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

    const quoteEl = document.getElementById('memorialQuote');
    if (quoteEl) {
        quoteEl.innerHTML = memorial.quote
            ? `“${escapeHtml(memorial.quote).replace(/\n/g, '<br>')}”`
            : '“우리 가족에게 와줘서 정말 행복했어. 영원히 사랑해.”';
    }

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

    document.getElementById('galleryUploadBtn').href = `upload.html?room=${activeRoomSlug}`;

    showAdminButtonIfVerified(adminKey);

    loadTimeline();
}

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

async function showAdminButtonIfVerified(urlKey) {
    const storageKey = `onsemiro_admin_${activeRoomSlug}`;
    let storedKey = '';
    try { storedKey = localStorage.getItem(storageKey) || ''; } catch (e) {  }

    const key = urlKey || storedKey;
    if (!key) return;

    try {
        await functions.httpsCallable('verifyAdmin')({ slug: activeRoomSlug, key });
    } catch (err) {
        if (!urlKey) {
            try { localStorage.removeItem(storageKey); } catch (e) {  }
        }
        return;
    }

    try { localStorage.setItem(storageKey, key); } catch (e) {  }

    if (urlKey) history.replaceState(null, '', `memorial.html?room=${activeRoomSlug}`);

    const adminBtn = document.getElementById('adminFloatingBtn');
    if (adminBtn) {
        adminBtn.href = `admin.html?room=${activeRoomSlug}`;
        adminBtn.style.display = 'inline-flex';
    }
}

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

function openImageModal(item) {
    setupGalleryNav();
    const items = getGalleryItems();
    const modal = document.getElementById('imageModal');
    modal.classList.toggle('single', items.length <= 1);
    showGalleryImage(Math.max(0, items.indexOf(item)));
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    pushModalHistory();
}

let galleryIndex = 0;

function getGalleryItems() {
    return Array.from(document.querySelectorAll('.gallery-grid .gallery-item'));
}

function showGalleryImage(index) {
    const items = getGalleryItems();
    if (items.length === 0) return;
    galleryIndex = (index + items.length) % items.length;
    const img = items[galleryIndex].querySelector('img');
    document.getElementById('modalFullImage').src = img.src;
    document.getElementById('modalImageCaption').innerText = img.alt || '';

    const counter = document.getElementById('galleryCounter');
    if (counter) counter.innerText = `${galleryIndex + 1} / ${items.length}`;
}

function moveGallery(step) {
    showGalleryImage(galleryIndex + step);
}

function setupGalleryNav() {
    const content = document.querySelector('#imageModal .image-modal-content');
    if (!content || document.getElementById('galleryPrevBtn')) return;

    const arrow = (d) => `<svg viewBox="0 0 20 20" width="1em" height="1em" fill="none" aria-hidden="true"><path d="${d}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    content.insertAdjacentHTML('beforeend', `
        <button type="button" id="galleryPrevBtn" class="btn-gallery-nav prev" aria-label="이전 사진" onclick="moveGallery(-1)">${arrow('M12.5 4.5L7 10l5.5 5.5')}</button>
        <button type="button" id="galleryNextBtn" class="btn-gallery-nav next" aria-label="다음 사진" onclick="moveGallery(1)">${arrow('M7.5 4.5L13 10l-5.5 5.5')}</button>
        <span id="galleryCounter" class="gallery-counter"></span>
    `);

    const box = content.querySelector('.image-box');
    let startX = 0;
    let startY = 0;
    box.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
    }, { passive: true });
    box.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - startX;
        const dy = e.changedTouches[0].clientY - startY;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) moveGallery(dx < 0 ? 1 : -1);
    }, { passive: true });

    document.addEventListener('keydown', (e) => {
        if (!document.getElementById('imageModal')?.classList.contains('active')) return;
        if (e.key === 'ArrowLeft') moveGallery(-1);
        else if (e.key === 'ArrowRight') moveGallery(1);
        else if (e.key === 'Escape') requestCloseModal();
    });
}

function closeImageModal(e) {
    if (e.target.id === 'imageModal') requestCloseModal();
}

function closeImageModalDirect() {
    requestCloseModal();
}

function forceCloseModal() {
    requestCloseModal();
}

let modalHistoryActive = false;

function pushModalHistory() {
    if (!modalHistoryActive) {
        history.pushState({ onsemiroModal: true }, '');
        modalHistoryActive = true;
    }
}

function requestCloseModal() {
    if (modalHistoryActive) {
        history.back();
    } else {
        closeOpenModals();
    }
}

function closeOpenModals() {
    if (document.getElementById('videoModal')?.classList.contains('active')) closeVideoModalNow();
    if (document.getElementById('imageModal')?.classList.contains('active')) closeImageModalNow();
}

window.addEventListener('popstate', () => {
    if (modalHistoryActive) {
        modalHistoryActive = false;
        closeOpenModals();
    }
});

function closeImageModalNow() {
    const modal = document.getElementById('imageModal');
    modal.classList.remove('active');
    document.getElementById('modalFullImage').src = '';
    document.body.style.overflow = '';
}

let memorialShareInfo = null;

function copyMemorialLink() {
    const url = `https://onsemiro.me/memorial.html?room=${activeRoomSlug}`;
    openShareSheet({ ...(memorialShareInfo || { title: '온새미로 추모관', description: '함께한 기억을 모아둔 추모관입니다.' }), url });
}

function showToast(msg) {
    const toast = document.getElementById("toastMessage");
    if (!toast) return;
    toast.innerText = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2500);
}
