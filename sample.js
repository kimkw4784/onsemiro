// 한글 받침 유무에 따른 주격 조사(이/가) 판별 함수
function getSubjectParticle(name) {
    if (!name) return '이';
    const lastChar = name.charCodeAt(name.length - 1);
    if (lastChar < 0xAC00 || lastChar > 0xD7A3) return '이';
    return (lastChar - 0xAC00) % 28 > 0 ? '이' : '가';
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
        }).catch(err => {
            console.log("오디오 재생 에러:", err);
        });
    }
}

function switchBgm() {
    const btn = document.getElementById('bgmToggleBtn');
    const select = document.getElementById('bgmSelect');

    if (!select.value) return;

    // ⭐️ 04. 배경음악 없음 선택 시 오디오 정지 및 버튼 초기화
    if (select.value === 'none') {
        bgmAudio.pause();
        bgmAudio.currentTime = 0;
        isBgmPlaying = false;
        btn.innerText = '재생';
        btn.style.opacity = '0.5';
        btn.style.pointerEvents = 'none'; // '없음' 상태에서는 재생 버튼 클릭 방지
        return;
    }

    // 일반 곡 선택 시 버튼 활성화 복원
    btn.style.opacity = '1';
    btn.style.pointerEvents = 'auto';

    bgmAudio.src = select.value;
    bgmAudio.play().then(() => {
        isBgmPlaying = true;
        btn.innerText = '정지';
    }).catch(err => {
        console.log("곡 변경 재생 대기:", err);
    });
}

function addInteractCount(btn, type = 'default') {
    const cntEl = btn.querySelector('.cnt') || btn.querySelector('strong');
    if (!cntEl) return;

    let currentVal = parseInt(cntEl.innerText.replace(/[^\d]/g, ''), 10) || 0;
    cntEl.innerText = currentVal + 1;

    // 숫자 팝 효과
    cntEl.classList.remove('count-bump');
    void cntEl.offsetWidth; // 리플로우 트리거
    cntEl.classList.add('count-bump');

    // 파티클 생성
    createFloatingParticle(btn, type);
}

function createFloatingParticle(targetEl, type) {
    // 1. 저장된 주문 정보나 파라미터에서 동물 종류 판별 (기본값: 'dog')
    let petType = 'dog';
    const rawOrder = localStorage.getItem('recentMemorialOrder');
    if (rawOrder) {
        try {
            const order = JSON.parse(rawOrder);
            if (order.petType) petType = order.petType;
        } catch (e) {
            console.error(e);
        }
    }

    // 2. 동물 종류별 전용 이모지 세트 정의
    const emojiPacks = {
        // 🐶 강아지 전용
        dog: {
            treat: ['🦴', '🍖', '🥩', '🍪', '🐾', '✨'],
            toy: ['🎾', '⚾', '🧸', '🥏', '⭐', '✨'],
            candle: ['🕯️', '✨', '🌟', '💛', '🌈'],
            default: ['🐾', '🤍', '✨', '🕊️']
        },
        // 🐱 고양이 전용 (뼈다귀 대신 생선, 츄르, 깃털/실뭉치, 상자)
        cat: {
            treat: ['🐟', '🍣', '🍗', '🥛', '🐾', '✨'],
            toy: ['🧶', '🪢', '📦', '🎈', '⭐', '✨'],
            candle: ['🕯️', '✨', '🌟', '💛', '🌈'],
            default: ['🐾', '🤍', '✨', '🕊️']
        },
        // 🐹 소동물 전용 (햄스터, 토끼, 새 등 - 해바라기씨, 당근, 사과)
        small: {
            treat: ['🌻', '🥕', '🍎', '🍓', '🌾', '✨'],
            toy: ['🎡', '🔔', '🎀', '⭐', '✨'],
            candle: ['🕯️', '✨', '🌟', '💛', '🌈'],
            default: ['🌿', '🤍', '✨', '🕊️']
        }
    };

    // 현재 선택된 동물의 팩 선택 (없으면 dog로 폴백)
    const currentPack = emojiPacks[petType] || emojiPacks.dog;
    const targetList = currentPack[type] || currentPack.default;
    const emoji = targetList[Math.floor(Math.random() * targetList.length)];

    const particle = document.createElement('span');
    particle.className = 'interactive-floating-particle';
    particle.innerText = emoji;

    // 좌우 무작위 오차
    const randomOffset = (Math.random() - 0.5) * 30;
    particle.style.left = `calc(50% + ${randomOffset}px)`;

    targetEl.appendChild(particle);

    setTimeout(() => {
        particle.remove();
    }, 950);
}

const DEFAULT_LETTERS = [
    { name: "수진", relation: "누나", msg: "네가 없으니 방이 너무 조용해. 꿈속에 꼭 한번 놀러 와줘. 보고 싶다.", date: "2026.08.16" },
    { name: "민규", relation: "삼촌", msg: "갈 때마다 반갑게 꼬리 흔들어주던 모습이 생생하다. 좋은 곳에서 편히 쉬렴.", date: "2026.08.15" }
];

function loadLetters() {
    const list = document.getElementById('letterList');
    if (!list) return;

    let saved = localStorage.getItem('memorial_letters');
    let letters = saved ? JSON.parse(saved) : DEFAULT_LETTERS;

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

    // 날짜 규격 통일 (YYYY. MM. DD.)
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const currentDate = `${yyyy}. ${mm}. ${dd}.`;

    // ⭐️ admin.js와 완벽히 호환되는 고유 ID 부여
    const newLetter = {
        id: 'LET-' + Date.now(),
        name: name,
        relation: relation,
        msg: msg,
        date: currentDate
    };

    let saved = localStorage.getItem('memorial_letters');
    let letters = saved ? JSON.parse(saved) : [...DEFAULT_LETTERS];
    letters.unshift(newLetter);

    localStorage.setItem('memorial_letters', JSON.stringify(letters));
    loadLetters();

    // 폼 초기화 및 완료 안내
    nameInput.value = '';
    relationInput.value = '';
    msgInput.value = '';

    if (typeof showToast === 'function') {
        showToast("소중한 마음이 우체통에 고이 전해졌습니다 ✉️");
    }

    // 최상단으로 등록된 새 편지 강조 애니메이션
    const firstCard = document.querySelector('#letterList .letter-card');
    if (firstCard) {
        firstCard.classList.add('new-arrival');
    }
}

function loadApprovedMemories() {
    const rawMemories = localStorage.getItem('pendingMemories');
    if (!rawMemories) return;

    const memories = JSON.parse(rawMemories);
    const approvedList = memories.filter(item => item.status === 'approved');

    const photoGrid = document.querySelector('.gallery-grid');
    const videoGrid = document.querySelector('.video-grid');

    approvedList.forEach(item => {
        if (!item.files || item.files.length === 0) return;

        item.files.filter(f => !f.excluded).forEach(f => {
            const senderTag = `${item.relation} ${item.sender}`;
            const captionText = item.story ? `${item.story} (${senderTag})` : senderTag;

            if (f.type === 'video' && videoGrid) {
                const videoCard = document.createElement('div');
                videoCard.className = 'video-card';
                videoCard.onclick = () => openVideoModal(f.data, `${item.submittedAt} · ${senderTag}`, item.story || '보내주신 소중한 영상입니다.');

                videoCard.innerHTML = `
                    <div class="video-wrapper">
                        <video src="${f.data}" loop muted playsinline preload="auto"></video>
                        <div class="video-play-overlay">
                            <span class="play-icon">▶</span>
                        </div>
                    </div>
                    <div class="video-info">
                        <span class="video-date">${item.submittedAt} · ${senderTag}</span>
                        <p class="video-desc">${item.story || '보내주신 소중한 영상입니다.'}</p>
                    </div>
                `;
                videoGrid.prepend(videoCard);

            } else if (photoGrid) {
                const photoItem = document.createElement('div');
                photoItem.className = 'gallery-item approved-memory';
                photoItem.onclick = function () { openImageModal(this); };

                photoItem.innerHTML = `
                    <img src="${f.data}" alt="${captionText}">
                `;
                photoGrid.prepend(photoItem);
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // 1. URL 쿼리 파싱
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    const isAdminParam = urlParams.get('admin') === 'true';

    // 2. 개설 추모관일 경우 세일즈 CTA 배너 숨김
    const ctaBanner = document.querySelector('.sample-cta-banner');
    if (roomParam && ctaBanner) {
        ctaBanner.style.display = 'none';
    }

    // 3. 주문 데이터 로드
    let rawData = localStorage.getItem('recentMemorialOrder');
    let order = rawData ? JSON.parse(rawData) : null;

    if (!order && roomParam) {
        const allOrders = localStorage.getItem('memorialOrders');
        if (allOrders) {
            try {
                const list = JSON.parse(allOrders);
                order = list.find(item => item.roomSlug === roomParam) || null;
            } catch (err) {
                console.log("주문 파싱 에러:", err);
            }
        }
    }

    // 4. 관리자 플로팅 버튼 활성화
    const adminFloatBtn = document.getElementById('adminFloatingBtn');
    if (adminFloatBtn && (order || isAdminParam || roomParam)) {
        const activeSlug = roomParam || (order && order.roomSlug) || '4K8F2G';
        adminFloatBtn.href = `admin.html?room=${activeSlug}`;
        adminFloatBtn.style.display = 'inline-flex';
    }

    // 5. 실제 주문 데이터 화면 바인딩 (주문 정보가 있을 때만 덮어씌움)
    if (order) {
        const petName = order.petName || '하임';
        const slug = roomParam || order.roomSlug || '4K8F2G';

        document.title = `${petName}의 온새미로 | ONSEMIRO`;

        const nameEl = document.getElementById('memorialPetName');
        if (nameEl) nameEl.innerText = petName;

        const introNameEl = document.querySelector('.intro-name');
        if (introNameEl) introNameEl.innerText = petName;

        const uploadBtn = document.getElementById('galleryUploadBtn');
        if (uploadBtn) uploadBtn.href = `upload.html?room=${slug}`;

        const letterMsgInput = document.getElementById('letterMsg');
        if (letterMsgInput) {
            letterMsgInput.placeholder = `${petName}에게 전하고 싶은 따뜻한 한마디를 남겨주세요. (최대 1,000자)`;
        }

        const quoteEl = document.querySelector('.intro-quote');
        if (quoteEl && order.quote) {
            quoteEl.innerHTML = `“${order.quote.replace(/\n/g, '<br>')}”`;
        }

        const datesEl = document.querySelector('.intro-dates');
        if (datesEl && (order.meetDate || order.farewellDate)) {
            const cleanMeet = order.meetDate ? order.meetDate.replace(/\s+/g, '').replace(/\.$/, '') : '';
            const cleanFarewell = order.farewellDate ? order.farewellDate.replace(/\s+/g, '').replace(/\.$/, '') : '';

            let daysText = '';
            if (cleanMeet && cleanFarewell) {
                const startDate = new Date(cleanMeet.replace(/\./g, '-'));
                const endDate = new Date(cleanFarewell.replace(/\./g, '-'));

                if (!isNaN(startDate) && !isNaN(endDate)) {
                    const diffTime = Math.abs(endDate - startDate);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
                    daysText = ` (함께한 <strong>${diffDays.toLocaleString()}일</strong>의 여정)`;
                }
            }
            datesEl.innerHTML = `${cleanMeet} — ${cleanFarewell}${daysText}`;
        }

        const interactBtns = document.querySelectorAll('.interactive-row .btn-interact');
        if (interactBtns.length >= 3) {
            const gift1Text = order.gift1 || '좋아하던 간식';
            const gift2Text = order.gift2 || '테니스공';

            interactBtns[0].innerHTML = `<span class="btn-dot"></span> ${gift1Text} <strong class="cnt">1</strong>`;
            interactBtns[1].innerHTML = `<span class="btn-dot"></span> ${gift2Text} <strong class="cnt">1</strong>`;
            interactBtns[2].innerHTML = `<span class="btn-dot"></span> 촛불 밝히기 <strong class="cnt">1</strong>`;
        }

        if (order.bgm) {
            const select = document.getElementById('bgmSelect');
            if (select) {
                for (let i = 0; i < select.options.length; i++) {
                    const optText = select.options[i].text;
                    if (order.bgm.includes("오르골") && optText.includes("오르골")) {
                        select.selectedIndex = i; break;
                    } else if (order.bgm.includes("기타") && optText.includes("기타")) {
                        select.selectedIndex = i; break;
                    } else if (order.bgm.includes("피아노") && optText.includes("피아노")) {
                        select.selectedIndex = i; break;
                    }
                }
            }
        }

        const avatarImg = document.querySelector('.intro-avatar-frame img');
        if (avatarImg && order.petPhoto) {
            avatarImg.src = order.petPhoto;
            avatarImg.alt = petName;
        }

        const welcomeKey = `welcomed_${slug}`;
        const interactRow = document.querySelector('.interactive-row');

        if (interactRow && !sessionStorage.getItem(welcomeKey)) {
            sessionStorage.setItem(welcomeKey, 'true');

            setTimeout(() => {
                const josa = getSubjectParticle(petName);

                const bubble = document.createElement('div');
                bubble.className = 'interact-welcome-bubble';
                bubble.innerHTML = `
                    <span>보호자님이 오실 때까지 ${petName}${josa} 외롭지 않게 온새미로가 먼저 촛불을 켜두었습니다 🕯️</span>
                    <button type="button" class="btn-bubble-close" aria-label="닫기">✕</button>
                `;

                interactRow.appendChild(bubble);

                const closeBubble = () => {
                    bubble.classList.remove('show');
                    setTimeout(() => bubble.remove(), 400);
                };

                const closeBtn = bubble.querySelector('.btn-bubble-close');
                if (closeBtn) closeBtn.addEventListener('click', closeBubble);

                requestAnimationFrame(() => {
                    bubble.classList.add('show');
                });

                setTimeout(closeBubble, 9000);
            }, 700);
        }
    }

    // ⭐️ [발자취 타임라인 바인딩]: order 유무에 구애받지 않고 항상 실행
    const timelineList = document.getElementById('memorialTimelineList') || document.querySelector('.timeline-list');
    if (timelineList) {
        const rawTL = localStorage.getItem('memorial_timeline_list');
        const activeName = (order && order.petName) ? order.petName : '코코';
        const josa = getSubjectParticle(activeName);

        // 관리자 추가 데이터가 있으면 그것을 사용, 없으면 기본값 노출
        let tlData = rawTL ? JSON.parse(rawTL) : [
            {
                date: (order && order.meetDate) ? order.meetDate.replace(/\./g, '. ').trim() : '2013. 05. 10.',
                story: `손바닥만 하던 ${activeName}${josa} 처음 우리 집에 오던 날, 온 세상이 따뜻해졌어.`
            },
            {
                date: (order && order.farewellDate) ? order.farewellDate.replace(/\./g, '. ').trim() : '2026. 02. 15.',
                story: '가족들의 품에서 조용히 눈을 감고, 가장 빛나는 별이 된 날.'
            }
        ];

        // 숫자 크기 기준 오름차순(과거 -> 최신) 정렬
        tlData.sort((a, b) => {
            const numA = parseInt(a.date.replace(/[^\d]/g, ''), 10) || 0;
            const numB = parseInt(b.date.replace(/[^\d]/g, ''), 10) || 0;
            return numA - numB;
        });

        timelineList.innerHTML = tlData.map(item => `
            <div class="timeline-item">
                <span class="timeline-date">${item.date}</span>
                <p class="timeline-text">${item.story}</p>
            </div>
        `).join('');
    }

    loadLetters();
    loadApprovedMemories();
});

let wasBgmPlayingBeforeVideo = false;

function openVideoModal(videoSrc, dateText, descText) {
    const modal = document.getElementById('videoModal');
    const player = document.getElementById('modalVideoPlayer');
    const dateElem = document.getElementById('modalVideoDate');
    const descElem = document.getElementById('modalVideoDesc');
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
    dateElem.innerText = dateText;
    descElem.innerText = descText;
    player.muted = false;

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    player.load();
    const playPromise = player.play();
    if (playPromise !== undefined) {
        playPromise.catch(err => console.log("자동재생 차단됨:", err));
    }
}

function closeVideoModal(event) {
    if (event.target.id === 'videoModal') {
        forceCloseModal();
    }
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
        }).catch(err => console.log("BGM 복구 에러:", err));
        wasBgmPlayingBeforeVideo = false;
    }
}

function openImageModal(item) {
    const img = item.querySelector('img');
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalFullImage');
    const caption = document.getElementById('modalImageCaption');

    modalImg.src = img.src;
    caption.innerText = img.alt || '';

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeImageModal(event) {
    if (event.target.id === 'imageModal') {
        closeImageModalDirect();
    }
}

function closeImageModalDirect() {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalFullImage');

    modal.classList.remove('active');
    modalImg.src = '';
    document.body.style.overflow = '';
}

function copyMemorialLink() {
    const currentUrl = window.location.href;

    navigator.clipboard.writeText(currentUrl).then(() => {
        showToast("추모관 링크가 복사되었습니다.");
    }).catch(() => {
        const tempInput = document.createElement("input");
        tempInput.value = currentUrl;
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand("copy");
        document.body.removeChild(tempInput);
        showToast("추모관 링크가 복사되었습니다.");
    });
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