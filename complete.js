document.addEventListener('DOMContentLoaded', () => {
    // 1. URL 파라미터(토스페이먼츠 결제 성공 리턴 값) 확인
    const urlParams = new URLSearchParams(window.location.search);
    const paymentKey = urlParams.get('paymentKey');
    const orderId = urlParams.get('orderId');
    const amount = urlParams.get('amount');

    // 2. localStorage 데이터 조회 (pendingMemorialOrder 우선 확인)
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
        // 결제 완료 후 최종 데이터 확정 저장 및 대기 데이터 삭제
        localStorage.removeItem('pendingMemorialOrder');
        try {
            localStorage.setItem('recentMemorialOrder', JSON.stringify(orderData));
        } catch (e) {
            console.error('주문 정보 저장 실패:', e);
        }
    }

    // 온새미로 기본 도메인
    const BASE_DOMAIN = 'https://onsemiro.me';

    // 3. 데이터가 정상적으로 존재하는 경우 화면에 바인딩
    if (orderData) {
        const petName = orderData.petName || '우리 아이';
        const applicantName = orderData.applicantName || '보호자';
        const slug = orderData.roomSlug || '4K8F2G';
        const adminKey = orderData.adminKey || 'sec_' + Math.random().toString(36).substring(2, 10);

        // [상단/하단 배너] 아이 이름 및 조사 적용
        const noticeNameEl = document.getElementById('noticePetName');
        const noticeJosaEl = document.getElementById('noticePetJosa');
        if (noticeNameEl) {
            noticeNameEl.innerText = petName;
            if (noticeJosaEl) noticeJosaEl.innerText = getSubjectParticle(petName);
        }

        const smsNameEl = document.getElementById('smsPetName');
        const smsJosaEl = document.getElementById('smsPetJosa');
        if (smsNameEl) {
            smsNameEl.innerText = petName;
            if (smsJosaEl) smsJosaEl.innerText = getObjectParticle(petName);
        }

        // [주문 요약] 신청자, 추모관 명칭, 주문번호, 플랜
        const applicantEl = document.getElementById('applicantDisplay');
        if (applicantEl) applicantEl.innerText = applicantName;

        const petNameEl = document.getElementById('petNameDisplay');
        if (petNameEl) petNameEl.innerText = `${petName}의 온새미로`;

        const orderNumEl = document.getElementById('orderNumberDisplay');
        if (orderNumEl) {
            orderNumEl.innerText = orderData.orderId || `ORD-${slug}`;
        }

        const planEl = document.getElementById('planDisplay');
        if (planEl && orderData.plan) {
            const planText = orderData.plan === 'heritage' ? '헤리티지 패키지 (59,000원)' : '디지털 소장권 (19,500원)';
            planEl.innerText = planText;
        }

        // [링크 박스] onsemiro.me 도메인 바인딩
        const memorialInput = document.getElementById('memorialLinkInput');
        if (memorialInput) memorialInput.value = `${BASE_DOMAIN}/memorial.html?room=${slug}`;

        const uploadInput = document.getElementById('uploadLinkInput');
        if (uploadInput) uploadInput.value = `${BASE_DOMAIN}/upload.html?room=${slug}`;

        const adminInput = document.getElementById('adminSecretLinkInput');
        if (adminInput) adminInput.value = `${BASE_DOMAIN}/memorial.html?room=${slug}&key=${adminKey}`;

        // [하단 버튼] 이동 링크 연결
        const viewBtn = document.getElementById('viewMemorialBtn');
        if (viewBtn) viewBtn.href = `memorial.html?room=${slug}`;

        const adminBtn = document.getElementById('adminManageBtn');
        if (adminBtn) adminBtn.href = `admin.html?room=${slug}&key=${adminKey}`;

    } else {
        // 데이터가 아예 없을 때 (기본 예시 처리)
        const defaultSlug = '4K8F2G';
        const defaultKey = 'sec_w9a2kL9';

        document.getElementById('orderNumberDisplay').innerText = "ORD-4K8F2G";
        document.getElementById('memorialLinkInput').value = `${BASE_DOMAIN}/memorial.html?room=${defaultSlug}`;
        document.getElementById('uploadLinkInput').value = `${BASE_DOMAIN}/upload.html?room=${defaultSlug}`;

        const adminInput = document.getElementById('adminSecretLinkInput');
        if (adminInput) adminInput.value = `${BASE_DOMAIN}/memorial.html?room=${defaultSlug}&key=${defaultKey}`;

        const viewBtn = document.getElementById('viewMemorialBtn');
        if (viewBtn) viewBtn.href = `memorial.html?room=${defaultSlug}`;

        const adminBtn = document.getElementById('adminManageBtn');
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