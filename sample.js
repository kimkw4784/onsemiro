// =========================================
// 샘플(체험용) 추모관 - 코코
// - 누가 열어도 항상 같은 체험용 화면을 보여줍니다.
// - 실제 추모관은 memorial.html이 담당하므로, 여기서는 서버나 브라우저 저장소를 쓰지 않습니다.
// =========================================

const SAMPLE_PET_NAME = '코코';

// 이름 끝에 받침이 있으면 '이'를 붙여 부르는 이름으로 바꿔줍니다. (하임 → 하임이, 코코 → 코코)
function callName(name) {
    if (!name) return '';
    const lastChar = name.charCodeAt(name.length - 1);
    if (lastChar < 0xAC00 || lastChar > 0xD7A3) return name;
    return (lastChar - 0xAC00) % 28 > 0 ? name + '이' : name;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// =========================================
// 배경음악
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
        }).catch(err => console.log('BGM 재생 에러:', err));
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
    }).catch(err => console.log('곡 재생 대기:', err));
}

// =========================================
// 선물·촛불 버튼 (체험용이라 화면에서만 숫자가 올라감)
// =========================================
function addInteractCount(btn, type = 'default') {
    const cntEl = btn.querySelector('.cnt');
    if (cntEl) {
        cntEl.innerText = (parseInt(cntEl.innerText, 10) || 0) + 1;
        cntEl.classList.remove('count-bump');
        void cntEl.offsetWidth;
        cntEl.classList.add('count-bump');
    }
    createFloatingParticle(btn, type);
}

function createFloatingParticle(targetEl, type) {
    // 메인 빌더·실제 추모관과 같은 강아지용 아이콘 세트
    const iconPack = {
        treat: ['noto:bone', 'noto:meat-on-bone', 'noto:cookie', 'fxemoji:sparkles'],
        toy: ['noto:soccer-ball', 'twemoji:teddy-bear', 'noto:balloon'],
        candle: ['noto:candle', 'fxemoji:sparkles', 'noto:star', 'fluent-emoji-flat:pink-heart', 'noto:rainbow'],
        default: ['noto:paw-prints', 'fluent-emoji-flat:pink-heart', 'fxemoji:sparkles']
    };

    const list = iconPack[type] || iconPack.default;
    const iconName = list[Math.floor(Math.random() * list.length)];

    const particle = document.createElement('span');
    particle.className = 'interactive-floating-particle';
    particle.innerHTML = `<iconify-icon icon="${iconName}"></iconify-icon>`;
    particle.style.left = `calc(50% + ${(Math.random() - 0.5) * 30}px)`;
    targetEl.appendChild(particle);

    setTimeout(() => particle.remove(), 950);
}

// =========================================
// 발자취 타임라인 (체험용 고정 내용)
// =========================================
const SAMPLE_TIMELINE = [
    { date: '2013. 05. 10.', story: `손바닥만 하던 ${callName(SAMPLE_PET_NAME)}가 처음 우리 집에 오던 날, 온 세상이 따뜻해졌어.` },
    { date: '2016. 08. 21.', story: '처음으로 바다를 본 날. 파도가 무서워 한참을 뒷걸음질 쳤지.' },
    { date: '2026. 02. 15.', story: '가족들의 품에서 조용히 눈을 감고, 가장 빛나는 별이 된 날.' }
];

function renderTimeline() {
    const list = document.getElementById('memorialTimelineList');
    if (!list) return;
    list.innerHTML = SAMPLE_TIMELINE.map(item => `
        <div class="timeline-item">
            <span class="timeline-date">${item.date}</span>
            <p class="timeline-text">${escapeHtml(item.story)}</p>
        </div>
    `).join('');
}

// =========================================
// 무지개 우체통 (체험용: 화면에만 잠깐 추가되고 저장되지 않음)
// =========================================
const sampleLetters = [
    { name: '수진', relation: '누나', msg: '네가 없으니 방이 너무 조용해. 꿈속에 꼭 한번 놀러 와줘. 보고 싶다.', date: '2026. 02. 18.' },
    { name: '민규', relation: '삼촌', msg: '갈 때마다 반갑게 꼬리 흔들어주던 모습이 생생하다. 좋은 곳에서 편히 쉬렴.', date: '2026. 02. 16.' }
];

function renderLetters() {
    const list = document.getElementById('letterList');
    if (!list) return;
    list.innerHTML = sampleLetters.map(letter => `
        <div class="letter-card">
            <div class="letter-header">
                <span class="letter-author">${escapeHtml(letter.relation)} ${escapeHtml(letter.name)}</span>
                <span class="letter-date">${letter.date}</span>
            </div>
            <p class="letter-content">${escapeHtml(letter.msg).replace(/\n/g, '<br>')}</p>
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

    const d = new Date();
    sampleLetters.unshift({
        name,
        relation,
        msg,
        date: `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}.`
    });
    renderLetters();

    nameInput.value = '';
    relationInput.value = '';
    msgInput.value = '';
    showToast('체험용 페이지라 실제로 전달되지는 않아요. 내 추모관에서는 보호자 확인 후 우체통에 걸립니다.');
}

// =========================================
// 사진·영상 창 + 휴대폰 뒤로가기 처리
// - 창을 열 때 방문 기록에 한 칸을 추가해서, 뒤로가기를 누르면 페이지 이동 대신 창이 닫히게 함
// =========================================
let modalHistoryActive = false;
let wasBgmPlayingBeforeVideo = false;

function pushModalHistory() {
    if (!modalHistoryActive) {
        history.pushState({ onsemiroModal: true }, '');
        modalHistoryActive = true;
    }
}

function requestCloseModal() {
    if (modalHistoryActive) {
        history.back(); // popstate에서 실제로 닫힘
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

function openVideoModal(videoSrc, dateText, descText) {
    const modal = document.getElementById('videoModal');
    const player = document.getElementById('modalVideoPlayer');
    const bgmBtn = document.getElementById('bgmToggleBtn');

    wasBgmPlayingBeforeVideo = isBgmPlaying;
    if (isBgmPlaying) {
        bgmAudio.pause();
        isBgmPlaying = false;
        if (bgmBtn) bgmBtn.innerText = '재생';
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
    if (event.target.id === 'videoModal') requestCloseModal();
}

function forceCloseModal() {
    requestCloseModal();
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

// =========================================
// 확대한 사진에서 이전/다음 넘기기 (화살표, 좌우로 밀기, 키보드 방향키)
// =========================================
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

// 이전/다음 버튼과 순서 표시를 사진 창에 한 번만 추가
function setupGalleryNav() {
    const content = document.querySelector('#imageModal .image-modal-content');
    if (!content || document.getElementById('galleryPrevBtn')) return;

    const arrow = (d) => `<svg viewBox="0 0 20 20" width="1em" height="1em" fill="none" aria-hidden="true"><path d="${d}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    content.insertAdjacentHTML('beforeend', `
        <button type="button" id="galleryPrevBtn" class="btn-gallery-nav prev" aria-label="이전 사진" onclick="moveGallery(-1)">${arrow('M12.5 4.5L7 10l5.5 5.5')}</button>
        <button type="button" id="galleryNextBtn" class="btn-gallery-nav next" aria-label="다음 사진" onclick="moveGallery(1)">${arrow('M7.5 4.5L13 10l-5.5 5.5')}</button>
        <span id="galleryCounter" class="gallery-counter"></span>
    `);

    // 휴대폰: 사진을 좌우로 밀어서 넘기기
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

    // PC: 키보드 방향키로 넘기기, Esc로 닫기
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

function closeImageModalNow() {
    const modal = document.getElementById('imageModal');
    modal.classList.remove('active');
    document.getElementById('modalFullImage').src = '';
    document.body.style.overflow = '';
}

// =========================================
// 공유·안내
// =========================================
// 공유하기: 카카오톡 카드 / 다른 앱 / 링크 복사 (share.js)
function copyMemorialLink() {
    openShareSheet({
        title: `${SAMPLE_PET_NAME}의 온새미로 (체험하기)`,
        description: '반려동물과의 추억을 영원히 간직하는 온새미로 추모관을 미리 둘러보세요.',
        imageUrl: `${window.location.origin}/images/coco4.png`,
        url: `${window.location.origin}/sample.html`
    });
}

function showToast(message) {
    const toast = document.getElementById('toastMessage');
    if (!toast) return;
    toast.innerText = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

document.addEventListener('DOMContentLoaded', () => {
    const nameEl = document.getElementById('memorialPetName');
    if (nameEl) nameEl.innerText = callName(SAMPLE_PET_NAME);

    const letterMsg = document.getElementById('letterMsg');
    if (letterMsg) {
        letterMsg.placeholder = `${callName(SAMPLE_PET_NAME)}에게 전하고 싶은 따뜻한 한마디를 남겨주세요. (최대 1,000자)`;
    }

    // 사진·영상 보내기: 체험용 페이지라 안내만
    const uploadBtn = document.getElementById('galleryUploadBtn');
    if (uploadBtn) {
        uploadBtn.href = '#';
        uploadBtn.addEventListener('click', (e) => {
            e.preventDefault();
            showToast('체험용 페이지예요. 추모관을 개설하면 이 버튼으로 가족·지인에게 사진과 영상을 받을 수 있어요.');
        });
    }

    // 관리자 버튼은 체험용 페이지에서 항상 숨김
    const adminBtn = document.getElementById('adminFloatingBtn');
    if (adminBtn) adminBtn.style.display = 'none';

    renderTimeline();
    renderLetters();
});