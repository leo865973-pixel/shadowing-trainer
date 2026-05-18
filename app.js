// FIREBASE IMPORTS (Using CDNs for vanilla JS support)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// FIREBASE CONFIG
const firebaseConfig = {
  apiKey: "AIzaSyCxP07UyljApuiaz3EQXvZrkKZguA870wA",
  authDomain: "shadow-training-tool.firebaseapp.com",
  databaseURL: "https://shadow-training-tool-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "shadow-training-tool",
  storageBucket: "shadow-training-tool.firebasestorage.app",
  messagingSenderId: "432658667170",
  appId: "1:432658667170:web:80ec24927d0d2a72f529fb",
  measurementId: "G-WV735PKJQV"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const sessionId = 'session_' + Math.random().toString(36).substr(2, 9);

// DOM Elements
const setupScreen = document.getElementById('setup-screen');
const trainingScreen = document.getElementById('training-screen');
const textInput = document.getElementById('text-input');
const btnStart = document.getElementById('btn-start');
const btnExit = document.getElementById('btn-exit');
const btnToggleMarkup = document.getElementById('btn-toggle-markup');
const currentSentenceEl = document.getElementById('current-sentence');
const progressBar = document.getElementById('progress-bar');
const sentenceCounter = document.getElementById('sentence-counter');
const pulseIndicator = document.getElementById('pulse-indicator');
const statusText = document.getElementById('status-text');
const userTranscript = document.getElementById('user-transcript');
const voiceSelect = document.getElementById('voice-select');
let availableVoices = [];

// 抓取並過濾出英文語音，標註出高品質的神經網路聲音
function populateVoices() {
  availableVoices = window.speechSynthesis.getVoices();
  
  // 只篩選英文發音
  const englishVoices = availableVoices.filter(v => v.lang.startsWith('en'));
  
  if (englishVoices.length > 0) {
    voiceSelect.innerHTML = '';
    englishVoices.forEach(voice => {
      const option = document.createElement('option');
      option.value = voice.voiceURI;
      
      // 尋找各平台的高音質特徵關鍵字並加上星星
      let label = voice.name;
      if (label.includes('Natural') || label.includes('Online') || label.includes('Google') || label.includes('Premium')) {
        label = '⭐ ' + label + ' (Best)';
      }
      
      option.textContent = label;
      voiceSelect.appendChild(option);
    });
  }
}

// 瀏覽器需要一點時間載入語音，所以要用 onvoiceschanged 監聽
window.speechSynthesis.onvoiceschanged = populateVoices;
// 網頁載入時也嘗試抓一次
populateVoices();

const btnBack = document.getElementById('btn-back');
const btnPause = document.getElementById('btn-pause');
const btnNext = document.getElementById('btn-next');
const btnReplay = document.getElementById('btn-replay');
const btnSpeak = document.getElementById('btn-speak');

// State
let sentences = [];
let currentIndex = 0;
let mode = 'beginner';
let showMarkup = false;
let timerId = null;

// Speech Recognition setup
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;
if (recognition) {
  recognition.continuous = false;
  recognition.interimResults = true;
}

// Configuration Levels
const LEVEL_CONFIG = {
  beginner: { rate: 0.8, pauseMs: 3000, autoNext: false },
  normal: { rate: 1.0, pauseMs: 2000, autoNext: false },
  fluency: { rate: 1.2, pauseMs: 500, autoNext: true }
};

// --- KPI SYSTEM (LocalStorage) ---
function loadKPIs() {
  const today = new Date().toDateString();
  let lastDate = localStorage.getItem('lastDate');
  let streak = parseInt(localStorage.getItem('streak') || '0');
  
  if (lastDate !== today) {
    if (lastDate === new Date(Date.now() - 86400000).toDateString()) {
      streak++; // Next consecutive day
    } else if (lastDate !== null) {
      streak = 1; // Streak broken
    }
    localStorage.setItem('lastDate', today);
    localStorage.setItem('streak', streak);
  }

  document.getElementById('kpi-streak').innerText = streak;
  document.getElementById('kpi-sentences').innerText = localStorage.getItem('totalSentences') || '0';
  document.getElementById('kpi-attempts').innerText = localStorage.getItem('totalAttempts') || '0';
}

function updateKPI(type) {
  let val = parseInt(localStorage.getItem(type) || '0') + 1;
  localStorage.setItem(type, val);
  loadKPIs();
}

// --- FIREBASE BACKUP ---
async function backupToFirebase(sentence, modeText) {
  try {
    await addDoc(collection(db, "sessions"), {
      sentence: sentence,
      mode: modeText,
      timestamp: Date.now(),
      sessionId: sessionId
    });
  } catch (e) {
    console.warn("Firebase sync failed (Offline mode active)", e);
  }
}

// --- CORE RHYTHM ENGINE ---
function setMetronomeState(state) {
  pulseIndicator.className = 'pulse ' + state;
  if (state === 'listening') {
    statusText.innerText = "🎧 LISTEN";
    statusText.style.color = 'var(--blue)';
  } else if (state === 'paused') {
    statusText.innerText = "⏳ GET READY...";
    statusText.style.color = 'var(--gray-dark)';
  } else if (state === 'speaking') {
    statusText.innerText = "🎤 REPEAT NOW!";
    statusText.style.color = 'var(--green)';
  }
}

function playCurrentSentence() {
	isPaused = false;
  btnPause.innerText = "⏸";
  clearTimeout(timerId);
  window.speechSynthesis.cancel();
  if (recognition) recognition.stop();

  const text = sentences[currentIndex];
  currentSentenceEl.innerHTML = analyzeSentence(text, showMarkup);
  userTranscript.innerText = "Waiting for you to speak...";
  sentenceCounter.innerText = `${currentIndex + 1} / ${sentences.length}`;
  progressBar.style.width = `${((currentIndex + 1) / sentences.length) * 100}%`;

  setMetronomeState('listening');

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = LEVEL_CONFIG[mode].rate;
  
  // 套用使用者選擇的語音
  const selectedVoiceURI = voiceSelect.value;
  const selectedVoice = availableVoices.find(v => v.voiceURI === selectedVoiceURI);
  if (selectedVoice) {
    utterance.voice = selectedVoice;
  }
 
  utterance.onend = () => {
    updateKPI('totalSentences');
    backupToFirebase(text, mode); // Sync data
    
    setMetronomeState('paused');
    
    // Rhythm Pause
    timerId = setTimeout(() => {
      startRecording();
    }, LEVEL_CONFIG[mode].pauseMs);
  };

  window.speechSynthesis.speak(utterance);
}

function startRecording() {
  if (!recognition) {
    userTranscript.innerText = "(Speech Recognition not supported on this browser. Just speak loud!)";
    autoAdvanceCheck();
    return;
  }

  setMetronomeState('speaking');
  updateKPI('totalAttempts');
  
  try {
    recognition.start();
  } catch(e) {} // Ignore if already started

  recognition.onresult = (event) => {
    let finalTranscript = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
    }
    if (finalTranscript) {
      userTranscript.innerText = finalTranscript;
      userTranscript.style.color = 'var(--text-main)';
    }
  };

  recognition.onend = () => {
    setMetronomeState('paused');
    autoAdvanceCheck();
  };
}

function autoAdvanceCheck() {
  if (LEVEL_CONFIG[mode].autoNext) {
    timerId = setTimeout(() => {
      if (currentIndex < sentences.length - 1) {
        currentIndex++;
        playCurrentSentence();
      }
    }, 1500); // short wait before auto-next
  }
}

// --- EVENT LISTENERS ---
btnStart.addEventListener('click', () => {
  const rawText = textInput.value.trim();
  if (!rawText) return alert("Please paste some text first!");

  // Parse sentences by splitting on ., ! or ?
  sentences = rawText.match(/[^.?!]+[.?!]+/g) || rawText.split('\n');
  sentences = sentences.map(s => s.trim()).filter(s => s.length > 0);
  
  if(sentences.length === 0) return alert("Could not find any sentences!");

  mode = document.querySelector('input[name="level"]:checked').value;
  currentIndex = 0;

  setupScreen.classList.remove('active');
  trainingScreen.classList.add('active');
  
  // Warm up TTS engine
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(''));

  playCurrentSentence();
});

btnExit.addEventListener('click', () => {
  window.speechSynthesis.cancel();
  if (recognition) recognition.stop();
  clearTimeout(timerId);
  trainingScreen.classList.remove('active');
  setupScreen.classList.add('active');
  loadKPIs();
});

btnNext.addEventListener('click', () => {
  if (currentIndex < sentences.length - 1) {
    currentIndex++;
    playCurrentSentence();
  }
});

btnBack.addEventListener('click', () => {
  if (currentIndex > 0) {
    currentIndex--;
    playCurrentSentence();
  }
});

btnReplay.addEventListener('click', playCurrentSentence);
btnSpeak.addEventListener('click', () => {
  window.speechSynthesis.cancel();
  clearTimeout(timerId);
  startRecording();
});

// Initialization
loadKPIs();


// 切換文本解析開關
btnToggleMarkup.addEventListener('click', () => {
  showMarkup = !showMarkup;
  btnToggleMarkup.innerText = showMarkup ? '👁️ 解析: 開' : '👁️ 解析: 關';
  btnToggleMarkup.style.background = showMarkup ? 'var(--blue)' : 'var(--gray)';
  btnToggleMarkup.style.color = showMarkup ? 'white' : 'var(--text-main)';
  
  // 立即更新當前句子的畫面
  if (sentences.length > 0) currentSentenceEl.innerHTML = analyzeSentence(sentences[currentIndex], showMarkup);

});

// --- 文本解析引擎 (支援點擊與開關) ---
function analyzeSentence(sentence, showMarkup) {
  const functionWords = new Set(['a','an','the','and','but','or','for','nor','so','yet','at','by','in','of','on','to','with','as','from','into','like','over','after','before','between','out','up','down','he','she','it','they','we','you','i','me','him','her','us','them','my','your','his','its','our','their','is','am','are','was','were','be','been','being','have','has','had','do','does','did','can','could','shall','should','will','would','may','might','must','this','that','these','those']);
  const vowels = ['a','e','i','o','u'];

  let words = sentence.split(' ');
  let result = '';

  for(let i = 0; i < words.length; i++) {
    let word = words[i];
    let cleanWord = word.replace(/[^\w]/g, '').toLowerCase();
    let nextWord = words[i+1] ? words[i+1].replace(/[^\w]/g, '').toLowerCase() : '';

    // 1. 重音
    let displayWord = word;
    if (showMarkup && cleanWord && !functionWords.has(cleanWord)) {
      displayWord = `<strong>${word}</strong>`;
    }

    // 2. 連音
    let isLinking = false;
    if (cleanWord && nextWord) {
      let lastChar = cleanWord.slice(-1);
      if (lastChar === 'e' && cleanWord.length > 1) lastChar = cleanWord.slice(-2, -1);
      let nextFirstChar = nextWord.charAt(0);
      if (!vowels.includes(lastChar) && lastChar !== 'y' && lastChar !== 'w' && vowels.includes(nextFirstChar)) {
        isLinking = true;
      }
    }

    // 3. 停頓
    let isPause = false;
    if (word.match(/[,.;:!?]/) || (nextWord && ['and','but','or','because','if','when'].includes(nextWord))) {
      isPause = true;
    }

    let linkingHTML = (showMarkup && isLinking) ? '<span class="linking">_</span>' : '';
    let pauseHTML = (showMarkup && isPause) ? '<span class="pause">//</span>' : '';
    let space = (showMarkup && isLinking) ? '' : ' ';

    // 將每個單字包裝成可點擊的 span，並記錄它的 index
    result += `<span class="word" data-index="${i}">${displayWord}</span>${linkingHTML}${pauseHTML}${space}`;
  }
  return result.trim();
}

// --- 點擊單字播放到停頓點 (Chunk Playback) ---
currentSentenceEl.addEventListener('click', (e) => {
  const wordSpan = e.target.closest('.word');
  if (!wordSpan) return;

  const startIndex = parseInt(wordSpan.getAttribute('data-index'));
  const words = sentences[currentIndex].split(' ');
  
  // 往後尋找停頓點
  let endIndex = startIndex;
  for (let i = startIndex; i < words.length; i++) {
    let word = words[i];
    let nextWord = words[i+1] ? words[i+1].replace(/[^\w]/g, '').toLowerCase() : '';
    let isPause = word.match(/[,.;:!?]/) || (nextWord && ['and','but','or','because','if','when'].includes(nextWord));
    
    if (isPause || i === words.length - 1) {
      endIndex = i;
      break;
    }
  }

  // 組合要播放的片段
  const chunkText = words.slice(startIndex, endIndex + 1).join(' ');
  
  // 停止目前的語音，只播放該片段
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(chunkText);
  utterance.lang = 'en-US';
  utterance.rate = LEVEL_CONFIG[mode].rate;
  
  const selectedVoiceURI = voiceSelect.value;
  const selectedVoice = availableVoices.find(v => v.voiceURI === selectedVoiceURI);
  if (selectedVoice) utterance.voice = selectedVoice;

  window.speechSynthesis.speak(utterance);
});

// --- 暫停/繼續 核心邏輯 ---
let isPaused = false;
function togglePauseResume() {
  if (window.speechSynthesis.speaking) {
    if (isPaused) {
      window.speechSynthesis.resume();
      isPaused = false;
      btnPause.innerText = "⏸"; // 播放中顯示暫停符號
      statusText.innerText = "🎧 LISTEN";
      statusText.style.color = 'var(--blue)';
    } else {
      window.speechSynthesis.pause();
      isPaused = true;
      btnPause.innerText = "▶️"; // 暫停中顯示播放符號
      statusText.innerText = "⏸ PAUSED";
      statusText.style.color = 'var(--gray-dark)';
    }
  }
}

// 綁定實體暫停按鈕
btnPause.addEventListener('click', togglePauseResume);

// --- 鍵盤快捷鍵 (A, S, D, Space) ---
document.addEventListener('keydown', (e) => {
  if (!trainingScreen.classList.contains('active')) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  const key = e.code;

  if (key === 'Space') {
    e.preventDefault(); // 防止網頁往下捲動
    togglePauseResume();
  } else if (key === 'KeyA') {
    btnBack.click();
  } else if (key === 'KeyS') {
    btnReplay.click();
  } else if (key === 'KeyD') {
    btnNext.click();
  }
});

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('PWA ServiceWorker registered'))
      .catch(err => console.error('PWA ServiceWorker failed', err));
  });
}