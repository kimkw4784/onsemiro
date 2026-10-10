// =========================================
// 추모 기록집 (memorial-book.html?room=슬러그)
// - 추모관에 공개된 내용만 불러와 책 형태로 보여주고, 인쇄 창에서 PDF로 저장
// =========================================

const MEDIA_BASE = 'https://media.onsemiro.me';
const SITE_BASE = 'https://onsemiro.me';

function mediaUrl(path) {
    return path ? `${MEDIA_BASE}/${path}` : '';
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// 받침이 있으면 '이'를 붙여 부르는 이름 (하임 → 하임이)
function callName(name) {
    if (!name) return '';
    const code = name.charCodeAt(name.length - 1);
    if (code < 0xAC00 || code > 0xD7A3) return name;
    return (code - 0xAC00) % 28 > 0 ? name + '이' : name;
}

// "2013-05-10" → "2013. 05. 10."
function formatIsoDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${y}. ${m}. ${d}.`;
}

function formatTimestamp(ts) {
    const d = ts?.toDate?.();
    if (!d) return '';
    return `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}.`;
}

function setStatus(text) {
    const el = document.getElementById('bookStatus');
    if (el) el.innerText = text;
}

function pageFooter(petName, label) {
    return `
        <div class="page-footer">
            <span>ONSEMIRO</span>
            <span>${escapeHtml(petName)} · ${label}</span>
        </div>
    `;
}

document.addEventListener('DOMContentLoaded', async () => {
    const room = (new URLSearchParams(window.location.search).get('room') || '').trim().toUpperCase();
    const book = document.getElementById('book');

    if (!room) {
        book.innerHTML = `<div class="book-error">추모관 주소가 올바르지 않습니다.</div>`;
        setStatus('추모관을 찾을 수 없어요');
        return;
    }

    let memorial = null;
    let timeline = [];
    let gallery = [];
    let letters = [];

    try {
        const ref = db.collection('memorials').doc(room);
        const snap = await ref.get();
        if (snap.exists) memorial = snap.data();

        if (memorial) {
            const [tlSnap, gallerySnap, letterSnap] = await Promise.all([
                ref.collection('timeline').get(),
                ref.collection('gallery').get(),
                ref.collection('letters').where('status', '==', 'approved').get()
            ]);
            timeline = tlSnap.docs.map(d => d.data());
            gallery = gallerySnap.docs.map(d => d.data());
            letters = letterSnap.docs.map(d => d.data());
        }
    } catch (err) {
        console.error('기록집 불러오기 실패:', err);
    }

    if (!memorial) {
        book.innerHTML = `<div class="book-error">추모관을 찾을 수 없습니다.<br>주소를 다시 확인해 주세요.</div>`;
        setStatus('추모관을 찾을 수 없어요');
        return;
    }

    const petName = memorial.petName || '아이';
    document.title = `${petName}의 추모 기록집 | ONSEMIRO 온새미로`;

    // 정렬: 발자취는 날짜순, 갤러리는 올린 순서, 편지는 오래된 순
    timeline.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    gallery.sort((a, b) => {
        const diff = (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0);
        return diff !== 0 ? diff : (a.fileIndex || 0) - (b.fileIndex || 0);
    });
    letters.sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));

    book.innerHTML = [
        renderCover(memorial),
        renderTimeline(petName, timeline),
        renderGallery(petName, gallery),
        renderLetters(petName, letters),
        renderClosing(petName, room)
    ].join('');

    await waitForImages(book);
    setStatus(`${petName}의 기록이 준비되었어요`);
    document.getElementById('btnSavePdf').disabled = false;
});

// 1. 표지
function renderCover(m) {
    const petName = m.petName || '아이';
    const meet = formatIsoDate(m.meetDate);
    const farewell = formatIsoDate(m.farewellDate);

    let days = '';
    if (m.meetDate && m.farewellDate) {
        const diff = new Date(m.farewellDate) - new Date(m.meetDate);
        if (!isNaN(diff) && diff >= 0) {
            days = `함께한 ${(Math.ceil(diff / 86400000) + 1).toLocaleString()}일의 여정`;
        }
    }

    return `
        <section class="page page-cover">
            <p class="cover-brand">ONSEMIRO</p>
            ${m.photoUrl ? `<div class="cover-photo"><img src="${escapeHtml(m.photoUrl)}" alt="${escapeHtml(petName)}"></div>` : ''}
            <p class="cover-badge">IN LOVING MEMORY</p>
            <h1 class="cover-name">${escapeHtml(petName)}</h1>
            ${meet || farewell ? `<p class="cover-dates">${meet} — ${farewell}</p>` : ''}
            ${days ? `<p class="cover-days">${days}</p>` : ''}
            ${m.quote ? `<p class="cover-quote">“${escapeHtml(m.quote)}”</p>` : ''}
            <p class="cover-footer">${escapeHtml(petName)}의 온새미로 · 추모 기록집</p>
        </section>
    `;
}

// 2. 발자취
function renderTimeline(petName, items) {
    const body = items.length === 0
        ? `<p class="empty-note">기록된 발자취가 없습니다.</p>`
        : `<div class="timeline">${items.map(item => `
            <div class="timeline-item">
                <span class="timeline-date">${formatIsoDate(item.date)}</span>
                <p class="timeline-text">${escapeHtml(item.story)}</p>
            </div>`).join('')}</div>`;

    return `
        <section class="page page-flow">
            <div class="chapter-head">
                <span class="chapter-tag">TIMELINE</span>
                <h2 class="chapter-title">함께 걸어온 발자취</h2>
            </div>
            ${body}
            ${pageFooter(petName, '발자취')}
        </section>
    `;
}

// 3. 갤러리 (영상은 썸네일과 함께 '영상' 표시)
function renderGallery(petName, items) {
    if (items.length === 0) return '';

    const cards = items.map(item => {
        const isVideo = item.type === 'video';
        const src = isVideo ? mediaUrl(item.thumbPath) : mediaUrl(item.path);
        return `
            <figure class="gallery-item">
                <div class="gallery-photo">
                    ${src ? `<img src="${escapeHtml(src)}" alt="">` : ''}
                    ${isVideo ? `<span class="gallery-video-label">영상</span>` : ''}
                </div>
                <figcaption class="gallery-caption">
                    ${escapeHtml(item.story || '')}
                    ${item.senderLabel ? `<span class="gallery-sender">${escapeHtml(item.senderLabel)}</span>` : ''}
                </figcaption>
            </figure>
        `;
    }).join('');

    return `
        <section class="page page-flow">
            <div class="chapter-head">
                <span class="chapter-tag">PHOTO GALLERY</span>
                <h2 class="chapter-title">기억의 갤러리</h2>
            </div>
            <div class="gallery">${cards}</div>
            ${pageFooter(petName, '갤러리')}
        </section>
    `;
}

// 4. 우체통 편지
function renderLetters(petName, items) {
    if (items.length === 0) return '';

    return `
        <section class="page page-flow">
            <div class="chapter-head">
                <span class="chapter-tag">POSTBOX</span>
                <h2 class="chapter-title">무지개 우체통</h2>
            </div>
            <div class="letters">${items.map(letter => `
                <article class="letter">
                    <div class="letter-head">
                        <span class="letter-author">${escapeHtml(letter.relation)} ${escapeHtml(letter.name)}</span>
                        <span class="letter-date">${formatTimestamp(letter.createdAt)}</span>
                    </div>
                    <p class="letter-body">${escapeHtml(letter.message)}</p>
                </article>`).join('')}</div>
            ${pageFooter(petName, '우체통')}
        </section>
    `;
}

// 5. 맺음
function renderClosing(petName, room) {
    const today = new Date();
    const made = `${today.getFullYear()}. ${String(today.getMonth() + 1).padStart(2, '0')}. ${String(today.getDate()).padStart(2, '0')}.`;
    const url = `${SITE_BASE}/memorial.html?room=${room}`;

    return `
        <section class="page page-closing">
            <p class="closing-text">
                <span class="nb">${escapeHtml(callName(petName))}와 함께한 모든 날을</span><br>
                <span class="nb">언제나 변함없이 기억하겠습니다.</span>
            </p>
            <div class="closing-meta">
                <p>기록집을 만든 날 · ${made}</p>
                <p>온라인 추모관에서 더 많은 기억을 만나보세요</p>
                <a class="closing-link" href="${url}">${url}</a>
            </div>
            <p class="closing-brand">ONSEMIRO</p>
        </section>
    `;
}

// 사진이 모두 불러와진 뒤에 저장 버튼을 켜서, PDF에 빈 사진이 들어가지 않게 함
function waitForImages(container) {
    const imgs = Array.from(container.querySelectorAll('img'));
    let done = 0;
    setStatus(imgs.length ? `사진을 불러오는 중... (0/${imgs.length})` : '거의 다 됐어요');

    return Promise.all(imgs.map(img => new Promise(resolve => {
        const finish = () => {
            done++;
            setStatus(`사진을 불러오는 중... (${done}/${imgs.length})`);
            resolve();
        };
        if (img.complete) finish();
        else {
            img.addEventListener('load', finish, { once: true });
            img.addEventListener('error', finish, { once: true });
        }
    })));
}

function saveAsPdf() {
    window.print();
}