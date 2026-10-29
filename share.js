const KAKAO_JS_KEY = '54f68fc94018022dd760523c591d8d42';

const SHARE_DEFAULT_IMAGE = 'https://onsemiro.me/images/og-share.png';

function initKakaoShare() {
    if (!KAKAO_JS_KEY || !window.Kakao) return false;
    try {
        if (!window.Kakao.isInitialized()) window.Kakao.init(KAKAO_JS_KEY);
        return true;
    } catch (err) {
        console.error('카카오 공유 준비 실패:', err);
        return false;
    }
}

function openShareSheet(info) {
    let sheet = document.getElementById('shareSheet');
    if (!sheet) {
        sheet = document.createElement('div');
        sheet.id = 'shareSheet';
        sheet.className = 'share-sheet-backdrop';
        sheet.innerHTML = `
            <div class="share-sheet" role="dialog" aria-modal="true" aria-labelledby="shareSheetTitle">
                <p class="share-sheet-title" id="shareSheetTitle">추모관 공유하기</p>
                <button type="button" class="share-option share-kakao" data-action="kakao">
                    <iconify-icon icon="simple-icons:kakaotalk" aria-hidden="true"></iconify-icon>
                    카카오톡으로 보내기
                </button>
                <button type="button" class="share-option" data-action="native">
                    <iconify-icon icon="ph:share-network" aria-hidden="true"></iconify-icon>
                    다른 앱으로 공유하기
                </button>
                <button type="button" class="share-option" data-action="copy">
                    <iconify-icon icon="ph:link" aria-hidden="true"></iconify-icon>
                    링크 복사하기
                </button>
                <button type="button" class="share-cancel" data-action="close">닫기</button>
            </div>
        `;
        document.body.appendChild(sheet);

        sheet.addEventListener('click', (e) => {
            if (e.target === sheet) closeShareSheet();
        });
    }

    sheet.querySelector('[data-action="kakao"]').hidden = !initKakaoShare();
    sheet.querySelector('[data-action="native"]').hidden = !navigator.share;

    sheet.querySelectorAll('[data-action]').forEach(btn => {
        btn.onclick = () => handleShareAction(btn.dataset.action, info);
    });

    sheet.classList.add('active');
}

function closeShareSheet() {
    document.getElementById('shareSheet')?.classList.remove('active');
}

async function handleShareAction(action, info) {
    if (action === 'close') {
        closeShareSheet();
        return;
    }

    if (action === 'kakao') {
        try {
            window.Kakao.Share.sendDefault({
                objectType: 'feed',
                content: {
                    title: info.title,
                    description: info.description,
                    imageUrl: info.imageUrl || SHARE_DEFAULT_IMAGE,
                    link: { mobileWebUrl: info.url, webUrl: info.url }
                },
                buttons: [
                    { title: '추모관 보기', link: { mobileWebUrl: info.url, webUrl: info.url } }
                ]
            });
        } catch (err) {
            console.error('카카오톡 공유 실패:', err);
            alert('카카오톡 공유를 열지 못했습니다. 링크 복사를 이용해 주세요.');
        }
        closeShareSheet();
        return;
    }

    if (action === 'native') {
        try {
            await navigator.share({ title: info.title, text: info.description, url: info.url });
        } catch (err) {
            if (err.name !== 'AbortError') console.error('공유 실패:', err);
        }
        closeShareSheet();
        return;
    }

    if (action === 'copy') {
        try {
            await navigator.clipboard.writeText(info.url);
        } catch (err) {
            const temp = document.createElement('textarea');
            temp.value = info.url;
            document.body.appendChild(temp);
            temp.select();
            document.execCommand('copy');
            temp.remove();
        }
        closeShareSheet();
        if (typeof showToast === 'function') showToast('추모관 링크가 복사되었습니다.');
    }
}
