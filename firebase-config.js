// Firebase 설정 정보 및 초기화만 따로 분리
const firebaseConfig = {
    apiKey: "AIzaSyDpwo_f0DKiaNw3PrFt6Kxo_VsJck8yHnQ",
    authDomain: "onsemiro-memorial.firebaseapp.com",
    projectId: "onsemiro-memorial",
    storageBucket: "onsemiro-memorial.firebasestorage.app",
    messagingSenderId: "822970044569",
    appId: "1:822970044569:web:97c9b587c08ff24c4da808"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
window.db = firebase.firestore();
window.storage = firebase.storage();
window.functions = firebase.app().functions('asia-northeast3');