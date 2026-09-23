window.uploadedImageData = null; // order.js에서도 참조할 수 있도록 window 객체에 할당

document.addEventListener('DOMContentLoaded', () => {
    flatpickr(".custom-datepicker", {
        locale: "ko",
        dateFormat: "Y. m. d.",
        defaultDate: "today",
        disableMobile: "true",
        static: true,
        onChange: function () {
            updateLivePreview();
        }
    });

    updateLivePreview();
});

function updateLivePreview() {
    const name = document.getElementById('petNameInput').value || '우리 아이';
    const meetDate = document.getElementById('petMeetInput').value;
    const farewellDate = document.getElementById('petFarewellInput').value;
    const quote = document.getElementById('petQuoteInput').value || '영원히 기억할게.';

    document.getElementById('liveName').innerText = name;
    document.getElementById('liveQuoteText').innerText = quote;

    if (meetDate && farewellDate) {
        const cleanStart = meetDate.replace(/\./g, '').trim().replace(/\s+/g, '-');
        const cleanEnd = farewellDate.replace(/\./g, '').trim().replace(/\s+/g, '-');

        const start = new Date(cleanStart);
        const end = new Date(cleanEnd);

        if (!isNaN(start) && !isNaN(end)) {
            const diffTime = Math.abs(end - start);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            document.getElementById('liveDates').innerHTML = `
                <span>${meetDate} — ${farewellDate}</span>
                <span class="dates-dday">함께한 ${diffDays.toLocaleString()}일의 여정</span>
            `;
        }
    }
}

function selectPetType(btn, type) {
    document.querySelectorAll('.pet-type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const g1 = document.getElementById('giftInput1');
    const g2 = document.getElementById('giftInput2');

    if (type === 'dog') {
        g1.value = '좋아하던 간식';
        g2.value = '테니스공';
    } else if (type === 'cat') {
        g1.value = '맛있는 츄르';
        g2.value = '낚싯대';
    } else if (type === 'small') {
        g1.value = '해바라기씨';
        g2.value = '신선한 건초';
    }
    updateLiveGifts();
}

function updateLiveGifts() {
    const g1Val = document.getElementById('giftInput1').value || '첫 번째 선물';
    const g2Val = document.getElementById('giftInput2').value || '두 번째 선물';

    const live1 = document.getElementById('liveGift1');
    const live2 = document.getElementById('liveGift2');
    if (live1) live1.innerText = g1Val;
    if (live2) live2.innerText = g2Val;
}

// 빌더 사진 첨부 시 Base64 저장 및 미리보기 갱신
function handlePhotoUpload(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            window.uploadedImageData = e.target.result;
            const avatar = document.getElementById('liveAvatar');
            avatar.innerHTML = `<img src="${window.uploadedImageData}" alt="업로드된 프로필">`;
        };
        reader.readAsDataURL(file);
    }
}

function addCount(btn, type = 'treat') {
    const cntEl = btn.querySelector('.cnt') || btn.querySelector('strong');
    if (!cntEl) return;

    let currentVal = parseInt(cntEl.innerText.replace(/[^\d]/g, ''), 10) || 0;
    cntEl.innerText = currentVal + 1;

    // 숫자 팝 범프 효과
    cntEl.classList.remove('count-bump');
    void cntEl.offsetWidth;
    cntEl.classList.add('count-bump');

    // 현재 빌더에서 선택된 동물 타입 읽기 (기본값 dog)
    const activePetBtn = document.querySelector('.pet-type-btn.active');
    let petType = 'dog';
    if (activePetBtn) {
        if (activePetBtn.innerText.includes('고양이')) petType = 'cat';
        else if (activePetBtn.innerText.includes('소동물')) petType = 'small';
    }

    createHeroParticle(btn, type, petType);
}

function createHeroParticle(targetEl, type, petType) {
    const emojiPacks = {
        dog: {
            treat: ['🦴', '🍖', '🥩', '🍪', '✨'],
            toy: ['🎾', '⚾', '🧸', '⭐', '✨'],
            candle: ['🕯️', '✨', '🌟', '💛']
        },
        cat: {
            treat: ['🐟', '🍣', '🍗', '🥛', '✨'],
            toy: ['🧶', '🪢', '📦', '🎈', '✨'],
            candle: ['🕯️', '✨', '🌟', '💛']
        },
        small: {
            treat: ['🌻', '🥕', '🍎', '🍓', '✨'],
            toy: ['🎡', '🔔', '🎀', '⭐', '✨'],
            candle: ['🕯️', '✨', '🌟', '💛']
        }
    };

    const currentPack = emojiPacks[petType] || emojiPacks.dog;
    const targetList = currentPack[type] || currentPack.treat;
    const emoji = targetList[Math.floor(Math.random() * targetList.length)];

    const particle = document.createElement('span');
    particle.className = 'interactive-floating-particle';
    particle.innerText = emoji;

    const randomOffset = (Math.random() - 0.5) * 24;
    particle.style.left = `calc(50% + ${randomOffset}px)`;

    targetEl.appendChild(particle);

    setTimeout(() => {
        particle.remove();
    }, 950);
}

function updateLiveBgm() {
    const bgmSelect = document.getElementById('petBgmSelect');
    const liveBgmText = document.getElementById('liveBgmText');
    if (bgmSelect && liveBgmText) {
        liveBgmText.innerText = bgmSelect.value;
    }
}

// FAQ 아코디언 토글
function toggleFaq(buttonEl) {
    const currentItem = buttonEl.closest('.faq-item');
    const wrap = currentItem.querySelector('.faq-a-wrap');
    const isActive = currentItem.classList.contains('active');

    // 다른 열려있는 항목 모두 닫기
    document.querySelectorAll('.faq-item').forEach(item => {
        item.classList.remove('active');
        const aWrap = item.querySelector('.faq-a-wrap');
        if (aWrap) aWrap.style.maxHeight = null;
    });

    // 이미 열려있던 항목을 누른 게 아니라면 열기
    if (!isActive) {
        currentItem.classList.add('active');
        wrap.style.maxHeight = wrap.scrollHeight + 'px';
    }
}

// FAQ 탭 전환 함수
function switchFaqTab(category, element) {
    // 1. 모든 탭에서 active 클래스 제거 후 클릭한 탭에 추가
    const tabs = document.querySelectorAll('.faq-tab');
    tabs.forEach(tab => tab.classList.remove('active'));
    element.classList.add('active');

    // 2. 카테고리에 맞춰 항목 노출/숨김 처리
    const items = document.querySelectorAll('.faq-item');
    items.forEach(item => {
        const itemCategory = item.getAttribute('data-category');

        if (category === 'all' || itemCategory === category) {
            item.classList.remove('hide');
        } else {
            item.classList.add('hide');
            // 숨겨지는 항목의 열려있는 아코디언은 닫아줌 (선택사항)
            item.classList.remove('open');
        }
    });
}