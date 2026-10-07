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
        // 결제 완료 후 대기 데이터를 먼저 비워 공간을 확보한 뒤 최종 데이터 저장
        localStorage.removeItem('pendingMemorialOrder');
        try {
            localStorage.setItem('recentMemorialOrder', JSON.stringify(orderData));
        } catch (e) {
            console.error('주문 정보 저장 실패:', e);
        }
    } else if (recentRaw) {
        orderData = JSON.parse(recentRaw);
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