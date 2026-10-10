// 온새미로 기본 도메인
const BASE_DOMAIN = 'https://onsemiro.me';

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const paymentKey = urlParams.get('paymentKey');
    const orderId = urlParams.get('orderId');
    const amount = urlParams.get('amount');

    // 1. 토스 결제창에서 막 돌아온 경우 → 서버에 결제 승인 요청
    if (paymentKey && orderId && amount) {
        setCardState('loading');

        let pending = {};
        try {
            pending = JSON.parse(localStorage.getItem('pendingMemorialOrder') || '{}');
        } catch (e) { /* 빈 값으로 진행 */ }

        try {
            const response = await functions.httpsCallable('confirmPayment')({
                paymentKey,
                orderId,
                amount: Number(amount)
            });
            const result = response.data;

            const orderData = {
                ...pending,
                orderId: result.orderId,
                roomSlug: result.slug,
                adminKey: result.adminKey || '',
                petName: result.petName || pending.petName,
                applicantName: result.applicantName || pending.applicantName,
                plan: result.plan || pending.plan,
                petPhoto: result.photoUrl || ''
            };

            localStorage.removeItem('pendingMemorialOrder');
            try {
                localStorage.setItem('recentMemorialOrder', JSON.stringify(orderData));
            } catch (e) {
                console.error('주문 정보 저장 실패:', e);
            }

            // 결제한 이 기기는 바로 관리자로 기억 (추모관에서 관리자 버튼이 보이게)
            if (result.adminKey && result.slug) {
                try {
                    localStorage.setItem(`onsemiro_admin_${result.slug}`, result.adminKey);
                } catch (e) { /* 저장 실패 시 무시 */ }
            }

            // 주소창의 결제 정보를 지워서 새로고침 시 다시 승인 요청하지 않도록
            history.replaceState(null, '', 'complete.html');

            setCardState('done');
            renderOrder(orderData);
        } catch (error) {
            console.error('결제 승인 실패:', error);
            setCardState('error', error.message);
        }
        return;
    }

    // 2. 완료 화면을 새로고침하거나 다시 연 경우 → 저장해 둔 정보로 표시
    let recent = null;
    try {
        recent = JSON.parse(localStorage.getItem('recentMemorialOrder') || 'null');
    } catch (e) { /* 무시 */ }

    if (recent && recent.roomSlug) {
        renderOrder(recent);
    } else {
        setCardState('empty');
    }
});

// 카드 상태 전환: loading(확인 중) / done(완료) / error(실패) / empty(정보 없음)
let originalCardTexts = null;

function setCardState(state, message = '') {
    const titleEl = document.querySelector('.complete-title');
    const descEl = document.querySelector('.complete-desc');
    const tagEl = document.querySelector('.complete-tag');
    const iconEl = document.querySelector('.complete-check-icon');
    const sections = document.querySelectorAll('.complete-group-box, .complete-actions');

    if (!originalCardTexts) {
        originalCardTexts = {
            title: titleEl?.innerHTML,
            desc: descEl?.innerHTML,
            tag: tagEl?.innerHTML,
            icon: iconEl?.innerHTML
        };
    }

    if (state === 'done') {
        if (titleEl) titleEl.innerHTML = originalCardTexts.title;
        if (descEl) descEl.innerHTML = originalCardTexts.desc;
        if (tagEl) tagEl.innerHTML = originalCardTexts.tag;
        if (iconEl) iconEl.innerHTML = originalCardTexts.icon;
        sections.forEach(el => { el.style.display = ''; });
        return;
    }

    sections.forEach(el => { el.style.display = 'none'; });

    const texts = {
        loading: {
            tag: 'CONFIRMING',
            title: '결제를 확인하고 있어요',
            desc: '<span class="nb">추모관을 준비하는 중입니다.</span> <span class="nb">잠시만 기다려 주세요.</span><br><span class="nb">이 창을 닫지 말아 주세요.</span>',
            icon: '<span class="complete-spinner" aria-hidden="true"></span>'
        },
        error: {
            tag: 'PAYMENT FAILED',
            title: '결제를 완료하지 못했어요',
            desc: `${message || '결제 승인 중 문제가 발생했습니다.'}<br>승인되지 않은 결제는 청구되지 않습니다.<br><a href="index.html#pricing" class="btn btn-primary btn-full" style="margin-top:20px;">다시 시도하기</a>`,
            icon: '!'
        },
        empty: {
            tag: 'NO ORDER',
            title: '주문 정보를 찾을 수 없어요',
            desc: '개설 안내는 알림톡으로 보내드린 주소에서 다시 확인하실 수 있습니다.<br><a href="index.html" class="btn btn-primary btn-full" style="margin-top:20px;">메인으로 가기</a>',
            icon: '?'
        }
    }[state];

    if (tagEl) tagEl.innerText = texts.tag;
    if (titleEl) titleEl.innerText = texts.title;
    if (descEl) descEl.innerHTML = texts.desc;
    if (iconEl) iconEl.innerHTML = texts.icon;
}

// 주문 정보를 화면에 채우기
function renderOrder(orderData) {
    const petName = orderData.petName || '우리 아이';
    const applicantName = orderData.applicantName || '보호자';
    const slug = orderData.roomSlug;
    const adminKey = orderData.adminKey;

    // [상단/하단 배너] 아이 이름 및 조사 적용
    const noticeNameEl = document.getElementById('noticePetName');
    const noticeJosaEl = document.getElementById('noticePetJosa');
    if (noticeNameEl) {
        noticeNameEl.innerText = callName(petName);
        if (noticeJosaEl) noticeJosaEl.innerText = '가';
    }

    const smsNameEl = document.getElementById('smsPetName');
    const smsJosaEl = document.getElementById('smsPetJosa');
    if (smsNameEl) {
        smsNameEl.innerText = callName(petName);
        if (smsJosaEl) smsJosaEl.innerText = '를';
    }

    // [주문 요약] 신청자, 추모관 명칭, 주문번호, 플랜
    const applicantEl = document.getElementById('applicantDisplay');
    if (applicantEl) applicantEl.innerText = applicantName;

    const petNameEl = document.getElementById('petNameDisplay');
    if (petNameEl) petNameEl.innerText = `${petName}의 온새미로`;

    const orderNumEl = document.getElementById('orderNumberDisplay');
    if (orderNumEl) orderNumEl.innerText = orderData.orderId || '-';

    const planEl = document.getElementById('planDisplay');
    if (planEl && orderData.plan) {
        planEl.innerText = orderData.plan === 'signature' ? '시그니처 아카이브 (49,000원)' : '에센셜 아카이브 (19,500원)';
    }

    // [링크 박스]
    const memorialInput = document.getElementById('memorialLinkInput');
    if (memorialInput) memorialInput.value = `${BASE_DOMAIN}/memorial.html?room=${slug}`;

    const uploadInput = document.getElementById('uploadLinkInput');
    if (uploadInput) uploadInput.value = `${BASE_DOMAIN}/upload.html?room=${slug}`;

    const adminInput = document.getElementById('adminSecretLinkInput');
    if (adminInput) {
        adminInput.value = adminKey
            ? `${BASE_DOMAIN}/admin.html?room=${slug}&key=${adminKey}`
            : '알림톡으로 보내드린 관리자 주소를 확인해 주세요.';
    }

    // [하단 버튼]
    const viewBtn = document.getElementById('viewMemorialBtn');
    if (viewBtn) viewBtn.href = `memorial.html?room=${slug}`;

    const adminBtn = document.getElementById('adminManageBtn');
    if (adminBtn) adminBtn.href = adminKey ? `admin.html?room=${slug}&key=${adminKey}` : '#';
}

// 이름 끝에 받침이 있으면 '이'를 붙여 부르는 이름으로 바꿔줍니다.
// (하임 → 하임이, 코코 → 코코) 뒤에 붙는 조사는 항상 받침 없는 형태(가/를/와/의/에게)로 쓰면 됩니다.
function callName(name) {
    if (!name) return '';
    const lastChar = name.charCodeAt(name.length - 1);
    if (lastChar < 0xAC00 || lastChar > 0xD7A3) return name;
    return (lastChar - 0xAC00) % 28 > 0 ? name + '이' : name;
}


// 링크 클립보드 복사 함수
function copyLink(inputId) {
    const copyInput = document.getElementById(inputId);
    if (!copyInput) return;

    copyInput.select();
    copyInput.setSelectionRange(0, 99999);

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(copyInput.value).then(() => {
            alert('링크가 클립보드에 복사되었습니다.');
        }).catch(() => {
            document.execCommand('copy');
            alert('링크가 클립보드에 복사되었습니다.');
        });
    } else {
        document.execCommand('copy');
        alert('링크가 클립보드에 복사되었습니다.');
    }
}