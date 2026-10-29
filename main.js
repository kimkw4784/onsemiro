window.uploadedImageData = null;

document.addEventListener('DOMContentLoaded', () => {
    flatpickr(".custom-datepicker", {
        locale: "ko",
        dateFormat: "Y. m. d.",
        defaultDate: "today",
        maxDate: "today",
        static: true,
        onChange: function () {
            updateLivePreview();
        }
    });

    updateLivePreview();
    updateLiveGifts();
});

function valueOrExample(el) {
    if (!el) return '';
    return el.value.trim() || el.placeholder.replace(/^예:\s*/, '');
}

function updateLivePreview() {
    const name = valueOrExample(document.getElementById('petNameInput')) || '우리 아이';
    const meetDate = document.getElementById('petMeetInput').value;
    const farewellDate = document.getElementById('petFarewellInput').value;
    const quote = valueOrExample(document.getElementById('petQuoteInput')) || '영원히 기억할게.';

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

    const examples = {
        dog: ['좋아하던 간식', '테니스공'],
        cat: ['맛있는 츄르', '낚싯대'],
        small: ['해바라기씨', '신선한 건초']
    }[type] || ['좋아하던 간식', '테니스공'];

    g1.placeholder = `예: ${examples[0]}`;
    g2.placeholder = `예: ${examples[1]}`;
    updateLiveGifts();
}

function updateLiveGifts() {
    const g1Val = valueOrExample(document.getElementById('giftInput1')) || '첫 번째 선물';
    const g2Val = valueOrExample(document.getElementById('giftInput2')) || '두 번째 선물';

    const live1 = document.getElementById('liveGift1');
    const live2 = document.getElementById('liveGift2');
    if (live1) live1.innerText = g1Val;
    if (live2) live2.innerText = g2Val;
}

const HEIC_LIB_URL = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
let heicLibPromise = null;

function isHeicFile(file) {
    return /image\/hei(c|f)/i.test(file.type || '') || /\.(heic|heif)$/i.test(file.name || '');
}

function loadHeicLib() {
    if (window.heic2any) return Promise.resolve();
    if (!heicLibPromise) {
        heicLibPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = HEIC_LIB_URL;
            script.onload = resolve;
            script.onerror = () => {
                heicLibPromise = null;
                reject(new Error('HEIC 사진 변환 도구를 불러오지 못했습니다'));
            };
            document.head.appendChild(script);
        });
    }
    return heicLibPromise;
}

function loadImageElement(blob) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => resolve({ img, url });
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('사진을 읽지 못했습니다'));
        };
        img.src = url;
    });
}

async function decodeImageFile(file) {
    try {
        return await loadImageElement(file);
    } catch (err) {
        if (!isHeicFile(file)) throw err;
        await loadHeicLib();
        const converted = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
        return loadImageElement(Array.isArray(converted) ? converted[0] : converted);
    }
}

async function handlePhotoUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const hint = document.querySelector('.upload-hint-text');
    if (hint && isHeicFile(file)) hint.innerText = '사진을 변환하고 있어요...';

    try {
        const { img, url } = await decodeImageFile(file);
        const scale = Math.min(1, 800 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);

        window.uploadedImageData = canvas.toDataURL('image/jpeg', 0.85);
        document.getElementById('liveAvatar').innerHTML = `<img src="${window.uploadedImageData}" alt="업로드된 프로필">`;

        if (hint) {
            hint.innerHTML = '<svg viewBox="0 0 20 20" width="1em" height="1em" fill="none" aria-hidden="true" style="vertical-align:-0.15em"><path d="M4.5 10.5l3.5 3.5 7.5-8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> 사진이 등록됐어요';
            hint.classList.add('is-selected');
        }
        const btnText = document.querySelector('.btn-photo-upload span');
        if (btnText) btnText.textContent = '사진 바꾸기';
    } catch (err) {
        console.error('사진 불러오기 실패:', err);
        window.uploadedImageData = null;
        if (hint) {
            hint.innerText = '사진을 불러오지 못했어요';
            hint.classList.remove('is-selected');
        }
        alert('사진을 불러오지 못했어요. 다른 사진으로 다시 시도해 주세요.');
    } finally {
        event.target.value = '';
    }
}

function addCount(btn, type = 'treat') {
    const cntEl = btn.querySelector('.cnt') || btn.querySelector('strong');
    if (!cntEl) return;

    let currentVal = parseInt(cntEl.innerText.replace(/[^\d]/g, ''), 10) || 0;
    cntEl.innerText = currentVal + 1;

    cntEl.classList.remove('count-bump');
    void cntEl.offsetWidth;
    cntEl.classList.add('count-bump');

    const activePetBtn = document.querySelector('.pet-type-btn.active');
    let petType = 'dog';
    if (activePetBtn) {
        if (activePetBtn.innerText.includes('고양이')) petType = 'cat';
        else if (activePetBtn.innerText.includes('소동물')) petType = 'small';
    }

    createHeroParticle(btn, type, petType);
}

function createHeroParticle(targetEl, type, petType) {
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
    const targetList = currentPack[type] || currentPack.treat;
    const iconName = targetList[Math.floor(Math.random() * targetList.length)];

    const particle = document.createElement('span');
    particle.className = 'interactive-floating-particle';
    particle.innerHTML = `<iconify-icon icon="${iconName}"></iconify-icon>`;

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

    const file = BGM_PREVIEW_FILES[bgmSelect.value];
    const btn = document.getElementById('bgmPreviewBtn');
    if (btn) btn.disabled = !file;
    if (bgmPreviewing) {
        if (file) playBgmPreview(file);
        else stopBgmPreview();
    }
}

const BGM_PREVIEW_FILES = {
    '별빛 아래 너와 나 (잔잔한 피아노)': './audio/bgm-piano.mp3',
    '따뜻한 봄날의 산책 (어쿠스틱 기타)': './audio/bgm-guitar.mp3',
    '영원한 안식처 (서정적인 오르골)': './audio/bgm-musicbox.mp3'
};
const bgmPreviewAudio = new Audio();
bgmPreviewAudio.volume = 0.5;
let bgmPreviewing = false;

bgmPreviewAudio.addEventListener('ended', stopBgmPreview);

function playBgmPreview(file) {
    const btn = document.getElementById('bgmPreviewBtn');
    if (!bgmPreviewAudio.src.endsWith(file.replace('./', '/'))) {
        bgmPreviewAudio.src = file;
    }
    bgmPreviewAudio.play().then(() => {
        bgmPreviewing = true;
        if (btn) {
            btn.innerText = '정지';
            btn.classList.add('playing');
        }
    }).catch(err => console.log('미리듣기 재생 실패:', err));
}

function stopBgmPreview() {
    const btn = document.getElementById('bgmPreviewBtn');
    bgmPreviewAudio.pause();
    bgmPreviewAudio.currentTime = 0;
    bgmPreviewing = false;
    if (btn) {
        btn.innerText = '미리듣기';
        btn.classList.remove('playing');
    }
}

function toggleBgmPreview() {
    const select = document.getElementById('petBgmSelect');
    const file = BGM_PREVIEW_FILES[select.value];
    if (!file) return;
    if (bgmPreviewing) stopBgmPreview();
    else playBgmPreview(file);
}

function toggleFaq(buttonEl) {
    const currentItem = buttonEl.closest('.faq-item');
    const wrap = currentItem.querySelector('.faq-a-wrap');
    const isActive = currentItem.classList.contains('active');

    document.querySelectorAll('.faq-item').forEach(item => {
        item.classList.remove('active');
        const aWrap = item.querySelector('.faq-a-wrap');
        if (aWrap) aWrap.style.maxHeight = null;
    });

    if (!isActive) {
        currentItem.classList.add('active');
        wrap.style.maxHeight = wrap.scrollHeight + 'px';
    }
}

function switchFaqTab(category, element) {
    const tabs = document.querySelectorAll('.faq-tab');
    tabs.forEach(tab => tab.classList.remove('active'));
    element.classList.add('active');

    const items = document.querySelectorAll('.faq-item');
    items.forEach(item => {
        const itemCategory = item.getAttribute('data-category');

        if (category === 'all' || itemCategory === category) {
            item.classList.remove('hide');
        } else {
            item.classList.add('hide');
            item.classList.remove('open');
        }
    });
}
