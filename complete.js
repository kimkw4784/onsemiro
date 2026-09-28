document.addEventListener('DOMContentLoaded', () => {
    // 1. URL 파라미터(토스페이먼츠 리턴 값) 확인
    const urlParams = new URLSearchParams(window.location.search);
    const paymentKey = urlParams.get('paymentKey');
    const orderId = urlParams.get('orderId');
    const amount = urlParams.get('amount');

    // 2. 대기 중인 주문 데이터(pendingMemorialOrder) 확인
    let orderData = null;
    const pendingRaw = localStorage.getItem('pendingMemorialOrder');
    const recentRaw = localStorage.getItem('recentMemorialOrder');

    if (pendingRaw) {
        orderData = JSON.parse(pendingRaw);
        if (paymentKey) {
            orderData.paymentKey = paymentKey;
            orderData.paidAmount = amount;
            orderData.orderId = orderId || orderData.orderId;
        }
        // 결제 완료 상태로 확정 데이터 저장
        localStorage.setItem('recentMemorialOrder', JSON.stringify(orderData));
        localStorage.removeItem('pendingMemorialOrder');
    } else if (recentRaw) {
        orderData = JSON.parse(recentRaw);
    }

    // 기본 도메인 설정 (onsemiro.me)
    const BASE_DOMAIN = 'https://onsemiro.me';

    if (orderData) {
        // 상단 촛불 안내 배너 (주격 조사: 이/가)
        const noticeNameEl = document.getElementById('noticePetName');
        const noticeJosaEl = document.getElementById('noticePetJosa');

        if (noticeNameEl) {
            const name = orderData.petName || '아이';
            noticeNameEl.innerText = name;

            if (noticeJosaEl) {
                noticeJosaEl.innerText = getSubjectParticle(name);
            }
        }

        // 하단 알림톡 배너 (목적격 조사: 을/를)
        const smsNameEl = document.getElementById('smsPetName');
        const smsJosaEl = document.getElementById('smsPetJosa');

        if (smsNameEl) {
            const name = orderData.petName || '아이';
            smsNameEl.innerText = name;

            if (smsJosaEl) {
                smsJosaEl.innerText = getObjectParticle(name);
            }
        }

        // 주문 정보 및 링크 바인딩
        if (orderData.applicantName) {
            document.getElementById('applicantDisplay').innerText = orderData.applicantName;
        }
        if (orderData.petName) {
            document.getElementById('petNameDisplay').innerText = `${orderData.petName}의 온새미로`;
        }

        const slug = orderData.roomSlug || '4K8F2G';
        const adminKey = orderData.adminKey || 'sec_' + Math.random().toString(36).substring(2, 10);

        // onsemiro.me 도메인 반영 링크 생성
        document.getElementById('memorialLinkInput').value = `${BASE_DOMAIN}/memorial.html?room=${slug}`;
        document.getElementById('uploadLinkInput').value = `${BASE_DOMAIN}/upload.html?room=${slug}`;

        const adminLinkInput = document.getElementById('adminSecretLinkInput');
        if (adminLinkInput) {
            adminLinkInput.value = `${BASE_DOMAIN}/memorial.html?room=${slug}&key=${adminKey}`;
        }

        const viewBtn = document.getElementById('viewMemorialBtn');
        const adminBtn = document.getElementById('adminManageBtn');

        if (viewBtn) viewBtn.href = `memorial.html?room=${slug}`;
        if (adminBtn) adminBtn.href = `admin.html?room=${slug}&key=${adminKey}`;

        // 주문 번호
        const displayOrderId = orderData.orderId || orderData.merchantUid || `ORD-${slug}`;
        document.getElementById('orderNumberDisplay').innerText = displayOrderId;

        // 선택 플랜 및 금액
        if (orderData.plan) {
            const priceText = orderData.plan === 'heritage' ? '59,000원' : '19,500원';
            const planName = orderData.plan === 'heritage' ? '헤리티지 패키지' : '디지털 소장권';
            document.getElementById('planDisplay').innerText = `${planName} (${priceText})`;
        }
    } else {
        // 데이터가 없는 기본 예시 상태
        const defaultSlug = '4K8F2G';
        const defaultKey = 'sec_w9a2kL9';

        document.getElementById('orderNumberDisplay').innerText = "ORD-4K8F2G";
        document.getElementById('memorialLinkInput').value = `${BASE_DOMAIN}/memorial.html?room=${defaultSlug}`;
        document.getElementById('uploadLinkInput').value = `${BASE_DOMAIN}/upload.html?room=${defaultSlug}`;

        const adminLinkInput = document.getElementById('adminSecretLinkInput');
        if (adminLinkInput) {
            adminLinkInput.value = `${BASE_DOMAIN}/memorial.html?room=${defaultSlug}&key=${defaultKey}`;
        }

        const viewBtn = document.getElementById('viewMemorialBtn');
        const adminBtn = document.getElementById('adminManageBtn');
        if (viewBtn) viewBtn.href = `memorial.html?room=${defaultSlug}`;
        if (adminBtn) adminBtn.href = `admin.html?room=${defaultSlug}&key=${defaultKey}`;
    }
});

// 한글 받침 유무에 따른 주격 조사(이/가) 판별 함수
function getSubjectParticle(name) {
    if (!name) return '가';
    const lastChar = name.charCodeAt(name.length - 1);
    if (lastChar < 0xAC00 || lastChar > 0xD7A3) return '가';
    return (lastChar - 0xAC00) % 28 > 0 ? '이' : '가';
}

// 한글 받침 유무에 따른 목적격 조사(을/를) 판별 함수
function getObjectParticle(name) {
    if (!name) return '를';
    const lastChar = name.charCodeAt(name.length - 1);
    if (lastChar < 0xAC00 || lastChar > 0xD7A3) return '를';
    return (lastChar - 0xAC00) % 28 > 0 ? '을' : '를';
}

// 클립보드 복사 함수 (호환성 개선)
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