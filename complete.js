const BASE_DOMAIN = 'https://onsemiro.me';

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const paymentKey = urlParams.get('paymentKey');
    const orderId = urlParams.get('orderId');
    const amount = urlParams.get('amount');

    if (paymentKey && orderId && amount) {
        setCardState('loading');

        let pending = {};
        try {
            pending = JSON.parse(localStorage.getItem('pendingMemorialOrder') || '{}');
        } catch (e) {  }

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

            if (result.adminKey && result.slug) {
                try {
                    localStorage.setItem(`onsemiro_admin_${result.slug}`, result.adminKey);
                } catch (e) {  }
            }

            history.replaceState(null, '', 'complete.html');

            setCardState('done');
            renderOrder(orderData);
        } catch (error) {
            console.error('결제 승인 실패:', error);
            setCardState('error', error.message);
        }
        return;
    }

    let recent = null;
    try {
        recent = JSON.parse(localStorage.getItem('recentMemorialOrder') || 'null');
    } catch (e) {  }

    if (recent && recent.roomSlug) {
        renderOrder(recent);
    } else {
        setCardState('empty');
    }
});

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

function renderOrder(orderData) {
    const petName = orderData.petName || '우리 아이';
    const applicantName = orderData.applicantName || '보호자';
    const slug = orderData.roomSlug;
    const adminKey = orderData.adminKey;

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

    const applicantEl = document.getElementById('applicantDisplay');
    if (applicantEl) applicantEl.innerText = applicantName;

    const petNameEl = document.getElementById('petNameDisplay');
    if (petNameEl) petNameEl.innerText = `${petName}의 온새미로`;

    const orderNumEl = document.getElementById('orderNumberDisplay');
    if (orderNumEl) orderNumEl.innerText = orderData.orderId || '-';

    const planEl = document.getElementById('planDisplay');
    if (planEl && orderData.plan) {
        const planName = orderData.plan === 'signature' ? '시그니처 아카이브' : '에센셜 아카이브';
        const planPrice = orderData.plan === 'signature' ? '49,000원' : '19,500원';
        planEl.innerText = orderData.gift ? `${planName} (선물)` : `${planName} (${planPrice})`;
    }

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

    const viewBtn = document.getElementById('viewMemorialBtn');
    if (viewBtn) viewBtn.href = `memorial.html?room=${slug}`;

    const adminBtn = document.getElementById('adminManageBtn');
    if (adminBtn) adminBtn.href = adminKey ? `admin.html?room=${slug}&key=${adminKey}` : '#';
}

function callName(name) {
    if (!name) return '';
    const lastChar = name.charCodeAt(name.length - 1);
    if (lastChar < 0xAC00 || lastChar > 0xD7A3) return name;
    return (lastChar - 0xAC00) % 28 > 0 ? name + '이' : name;
}

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
