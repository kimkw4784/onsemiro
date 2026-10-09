// order.js

let currentSelectedPlan = 'digital';
let currentPayMethod = 'CARD';   // CARD(카드·간편결제) / TRANSFER(계좌이체) / MOBILE_PHONE(휴대폰)
const PLAN_PRICES = {
    digital: 19500,   // 화면 표시용 (실제 결제 금액은 서버 가격표로 정해짐)
    archive: 49000
};

// 토스페이먼츠 클라이언트 키 설정 (테스트용 키)
const TOSS_CLIENT_KEY = 'test_ck_LlDJaYngro5x6xkBPvBn3ezGdRpX';

// 빌더에서 선택한 반려동물 종류 (dog / cat / small)
const PET_TYPE_ICONS = {
    dog: 'fluent-emoji-flat:dog-face',
    cat: 'fluent-emoji-flat:cat-face',
    small: 'fluent-emoji-flat:hamster'
};

function getSelectedPetType() {
    const activeBtn = document.querySelector('.pet-type-btn.active');
    const match = activeBtn?.getAttribute('onclick')?.match(/'(dog|cat|small)'/);
    return match ? match[1] : 'dog';
}

// 빌더에 아이 이름을 직접 입력했는지 확인
function isBuilderFilled() {
    const nameEl = document.getElementById('petNameInput');
    if (!nameEl) return true;
    return nameEl.value.trim() !== '';
}

// 빌더로 안내: 부드럽게 스크롤하고 안내 문구를 잠깐 보여준 뒤 이름 칸에 커서
function guideToBuilder() {
    const formBox = document.querySelector('.builder-form-box');
    if (!formBox) return;

    let notice = document.getElementById('builderGuideNotice');
    if (!notice) {
        notice = document.createElement('div');
        notice.id = 'builderGuideNotice';
        notice.className = 'builder-guide-notice';
        notice.setAttribute('role', 'status');
        notice.innerText = '먼저 우리 아이의 정보를 입력해 주세요. 입력한 모습 그대로 추모관이 만들어져요.';
        formBox.prepend(notice);
    }
    notice.classList.remove('show');
    void notice.offsetWidth;
    notice.classList.add('show');

    const top = formBox.getBoundingClientRect().top + window.scrollY - 90;
    window.scrollTo({ top, behavior: 'smooth' });

    setTimeout(() => {
        const nameEl = document.getElementById('petNameInput');
        if (nameEl) nameEl.focus({ preventScroll: true });
    }, 600);
}

// 모달 열기 (빌더에 입력된 최신 정보 및 사진 동기화)
function openOrderModal(planType = 'digital') {
    // 빌더를 건드리지 않고 요금제 버튼을 누른 경우: 먼저 정보 입력 안내
    if (!isBuilderFilled()) {
        guideToBuilder();
        return;
    }

    currentSelectedPlan = planType;
    currentPayMethod = 'CARD';

    // 기존 모달이 남아있다면 제거
    const oldModal = document.getElementById('orderModal');
    if (oldModal) oldModal.remove();

    // 1. 빌더 입력값 가져오기
    const petName = document.getElementById('petNameInput')?.value || '우리 아이';
    const meetDate = document.getElementById('petMeetInput')?.value || '2013. 05. 10.';
    const farewellDate = document.getElementById('petFarewellInput')?.value || '2026. 02. 15.';

    // 2. 사진 데이터 확인
    let photoData = window.uploadedImageData;
    if (!photoData) {
        const previewImg = document.querySelector('#liveAvatar img');
        if (previewImg && previewImg.src && !previewImg.src.startsWith('data:image/svg')) {
            photoData = previewImg.src;
        }
    }

    // 썸네일 렌더링
    let thumbHtml = `<iconify-icon icon="${PET_TYPE_ICONS[getSelectedPetType()]}" aria-hidden="true"></iconify-icon>`;
    if (photoData) {
        thumbHtml = `<img src="${photoData}" alt="${petName}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
    }

    // 3. 모달 마크업 동적 삽입
    const modalHtml = `
    <div id="orderModal" class="order-modal-backdrop">
        <div class="order-modal-card">
            <div class="order-modal-header">
                <h3>우리 아이 추모관 평생 소장하기</h3>
                <button type="button" class="btn-modal-close" onclick="closeOrderModal()" aria-label="닫기"><svg viewBox="0 0 20 20" width="1em" height="1em" fill="none" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
            </div>

            <div class="order-modal-body">
                <div class="order-summary-box">
                    <div class="summary-thumb" id="summaryAvatar">${thumbHtml}</div>
                    <div class="summary-info">
                        <p class="summary-name"><strong id="summaryPetName">${petName}</strong>의 추모관</p>
                        <p class="summary-sub" id="summaryPetDates">${meetDate} — ${farewellDate}</p>
                    </div>
                </div>

                <form id="orderForm" onsubmit="handleOrderSubmit(event)">
                    <div class="form-group">
                        <label class="form-label" for="applicantName">신청자 성함 (보호자)</label>
                        <input type="text" id="applicantName" class="form-input" placeholder="예: 홍길동" required>
                    </div>

                    <div class="form-group">
                        <label class="form-label" for="applicantPhone">휴대폰 번호 (알림톡 수신용)</label>
                        <input type="tel" id="applicantPhone" class="form-input" placeholder="예: 01012345678 (- 없이 입력)" required>
                    </div>

                    <div class="form-group">
                        <label class="form-label">선택 플랜</label>
                        <div class="plan-card-group" id="planCardGroup">
                            <label class="plan-card ${currentSelectedPlan === 'digital' ? 'active' : ''}" onclick="selectPlanInModal(this, 'digital')">
                                <input type="radio" name="orderPlan" value="digital" ${currentSelectedPlan === 'digital' ? 'checked' : ''}>
                                <div class="plan-card-content">
                                    <div class="plan-card-top">
                                        <span class="plan-name">디지털 소장권</span>
                                        <span class="plan-badge">인기</span>
                                    </div>
                                    <div class="plan-price">19,500<span>원</span></div>
                                    <p class="plan-desc">20GB · 사진과 영상을 담는 웹 추모관</p>
                                </div>
                            </label>

                            <label class="plan-card ${currentSelectedPlan === 'archive' ? 'active' : ''}" onclick="selectPlanInModal(this, 'archive')">
                                <input type="radio" name="orderPlan" value="archive" ${currentSelectedPlan === 'archive' ? 'checked' : ''}>
                                <div class="plan-card-content">
                                    <div class="plan-card-top">
                                        <span class="plan-name">평생 아카이브</span>
                                    </div>
                                    <div class="plan-price">49,000<span>원</span></div>
                                    <p class="plan-desc">50GB · 영상까지 넉넉한 대용량</p>
                                </div>
                            </label>
                        </div>
                    </div>

                    <div class="form-group">
                        <label class="form-label">결제 수단</label>
                        <div class="plan-card-group" id="payMethodGroup" style="grid-template-columns: repeat(2, 1fr);">
                            <label class="plan-card active" onclick="selectPayMethod(this, 'CARD')">
                                <input type="radio" name="payMethod" value="CARD" checked>
                                <div class="plan-card-content">
                                    <span class="plan-name">카드·간편결제</span>
                                    <p class="plan-desc">카카오페이·토스페이 등</p>
                                </div>
                            </label>
                            <label class="plan-card" onclick="selectPayMethod(this, 'TRANSFER')">
                                <input type="radio" name="payMethod" value="TRANSFER">
                                <div class="plan-card-content">
                                    <span class="plan-name">계좌이체</span>
                                    <p class="plan-desc">내 계좌에서 바로</p>
                                </div>
                            </label>                            
                        </div>
                    </div>

                    <div class="order-notice">
                        <p><svg viewBox="0 0 20 20" width="1em" height="1em" fill="none" aria-hidden="true"><path d="M4.5 10.5l3.5 3.5 7.5-8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> 개설 완료 즉시 비공개 관리자 링크와 가족 전용 주소가 발급됩니다.</p>
                    </div>

                    <button type="submit" id="orderSubmitBtn" class="btn btn-primary btn-full">
                        ${PLAN_PRICES[currentSelectedPlan].toLocaleString()}원 결제 및 생성하기
                    </button>
                </form>
            </div>
        </div>
    </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    document.body.style.overflow = 'hidden';
}

// 모달 닫기
function closeOrderModal() {
    const modal = document.getElementById('orderModal');
    if (modal) modal.remove();
    document.body.style.overflow = '';
}

// 플랜 선택 토글
function selectPlanInModal(cardElement, planValue) {
    currentSelectedPlan = planValue;
    document.querySelectorAll('#planCardGroup .plan-card').forEach(el => el.classList.remove('active'));
    cardElement.classList.add('active');

    const radio = cardElement.querySelector('input[type="radio"]');
    if (radio) radio.checked = true;

    const submitBtn = document.getElementById('orderSubmitBtn');
    if (submitBtn) {
        submitBtn.innerText = `${PLAN_PRICES[planValue].toLocaleString()}원 결제 및 생성하기`;
    }
}

// 결제 수단 선택 토글
function selectPayMethod(cardElement, method) {
    currentPayMethod = method;
    document.querySelectorAll('#payMethodGroup .plan-card').forEach(el => el.classList.remove('active'));
    cardElement.classList.add('active');

    const radio = cardElement.querySelector('input[type="radio"]');
    if (radio) radio.checked = true;
}

// 폼 최종 제출 → 서버에 주문 등록 → 토스 결제창 열기
async function handleOrderSubmit(event) {
    event.preventDefault();

    if (typeof TossPayments === 'undefined') {
        alert('결제 모듈을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
        return;
    }

    const submitBtn = document.getElementById('orderSubmitBtn');
    const originalBtnText = submitBtn ? submitBtn.innerText : '';
    const setLoading = (isLoading) => {
        if (!submitBtn) return;
        submitBtn.disabled = isLoading;
        if (isLoading) {
            submitBtn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span>결제를 준비하고 있어요...';
        } else {
            submitBtn.innerText = originalBtnText;
        }
    };

    const applicantName = document.getElementById('applicantName')?.value.trim() || '';
    const applicantPhone = document.getElementById('applicantPhone')?.value.trim() || '';

    // 서버로 보낼 추모관 정보 (사진은 직접 고른 경우에만 전송)
    const memorial = {
        petName: document.getElementById('petNameInput')?.value.trim() || '우리 아이',
        petType: getSelectedPetType(),
        meetDate: document.getElementById('petMeetInput')?.value || '',
        farewellDate: document.getElementById('petFarewellInput')?.value || '',
        // 선물을 비워두면 미리보기에 보이던 예시 그대로 사용
        gift1: valueOrExample(document.getElementById('giftInput1')),
        gift2: valueOrExample(document.getElementById('giftInput2')),
        quote: valueOrExample(document.getElementById('petQuoteInput')),
        bgm: document.getElementById('petBgmSelect')?.value || '',
        photo: window.uploadedImageData || ''
    };

    setLoading(true);

    // 1. 서버에 주문 등록 (금액은 서버가 가격표로 정해서 돌려줌)
    let order;
    try {
        const result = await functions.httpsCallable('createOrder')({
            plan: currentSelectedPlan,
            memorial,
            applicant: { name: applicantName, phone: applicantPhone }
        });
        order = result.data;
    } catch (error) {
        console.error('주문 등록 실패:', error);
        alert(error.message || '주문을 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        setLoading(false);
        return;
    }

    // 2. 완료 화면에서 바로 보여줄 정보만 임시 저장 (사진·연락처 제외)
    const { photo, ...memorialWithoutPhoto } = memorial;
    localStorage.setItem('pendingMemorialOrder', JSON.stringify({
        ...memorialWithoutPhoto,
        orderId: order.orderId,
        plan: currentSelectedPlan,
        applicantName
    }));

    // 3. 서버가 정한 주문번호·금액으로 토스 결제창 열기
    try {
        const tossPayments = TossPayments(TOSS_CLIENT_KEY);
        const payment = tossPayments.payment({ customerKey: TossPayments.ANONYMOUS });

        await payment.requestPayment({
            method: currentPayMethod,   // 선택한 결제 수단의 결제창 열기
            amount: { currency: 'KRW', value: order.amount },
            orderId: order.orderId,
            orderName: order.orderName,
            successUrl: window.location.origin + '/complete.html',
            failUrl: window.location.origin + '/fail.html',
            customerName: applicantName,
            customerMobilePhone: applicantPhone.replace(/[^\d]/g, '')
        });
    } catch (error) {
        console.error('결제 요청 에러:', error);
        if (error.code !== 'USER_CANCEL') {
            alert('결제창을 여는 중 오류가 발생했습니다: ' + error.message);
        }
        setLoading(false);
    }
}