const firebaseConfig = {
    apiKey: "AIzaSyDpwo_f0DKiaNw3PrFt6Kxo_VsJck8yHnQ",
    authDomain: "onsemiro-memorial.firebaseapp.com",
    projectId: "onsemiro-memorial",
    messagingSenderId: "822970044569",
    appId: "1:822970044569:web:97c9b587c08ff24c4da808"
};

const RECAPTCHA_SITE_KEY = '6Lc9OgYuAAAAAEoSf2bPMacm4ybmUr7Uj0Zs7SVc';

if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

function startAppCheck() {
    try {
        if (typeof firebase.appCheck === 'function') {
            firebase.appCheck().activate(new firebase.appCheck.ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY), true);
        } else {
            console.error('App Check 도구를 불러오지 못했습니다.');
        }
    } catch (err) {
        console.error('App Check 시작 실패:', err);
    }
}

if (document.body) {
    startAppCheck();
} else {
    document.addEventListener('DOMContentLoaded', startAppCheck);
}

window.db = firebase.firestore();
window.functions = firebase.app().functions('asia-northeast3');