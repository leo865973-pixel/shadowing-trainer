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
const currentSentenceEl = document.getElementById('current-sentence');
const progressBar = document.getElementById('progress-bar');
const sentenceCounter = document.getElementById('sentence-counter');
const pulseIndicator = document.getElementById('pulse-indicator');
const statusText = document.getElementById('status-text');
const userTranscript = document.getElementById('user-transcript');

const btnBack = document.getElementById('btn-back');
const btnNext = document.getElementById('btn-next');
const btnReplay = document.getElementById('btn-replay');
const btnSpeak = document.getElementById('btn-speak');

// State
let sentences = [];
let currentIndex = 0;
let mode = 'beginner';
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
  clearTimeout(timerId);
  window.speechSynthesis.cancel();
  if (recognition) recognition.stop();

  const text = sentences[currentIndex];
  currentSentenceEl.innerText = `"${text}"`;
  userTranscript.innerText = "Waiting for you to speak...";
  sentenceCounter.innerText = `${currentIndex + 1} / ${sentences.length}`;
  progressBar.style.width = `${((currentIndex + 1) / sentences.length) * 100}%`;

  setMetronomeState('listening');

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = LEVEL_CONFIG[mode].rate;

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

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('PWA ServiceWorker registered'))
      .catch(err => console.error('PWA ServiceWorker failed', err));
  });
}