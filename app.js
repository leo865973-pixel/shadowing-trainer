// FIREBASE IMPORTS
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCxP07UyljApuiaz3EQXvZrkKZguA870wA",
  authDomain: "shadow-training-tool.firebaseapp.com",
  databaseURL: "https://shadow-training-tool-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "shadow-training-tool",
  storageBucket: "shadow-training-tool.firebasestorage.app",
  messagingSenderId: "432658667170",
  appId: "1:432658667170:web:80ec24927d0d2a72f529fb"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const sessionId = 'session_' + Math.random().toString(36).substr(2, 9);

// DOM Elements
const setupScreen = document.getElementById('setup-screen');
const libraryScreen = document.getElementById('library-screen');
const trainingScreen = document.getElementById('training-screen');
const tabPractice = document.getElementById('tab-practice');
const tabLibrary = document.getElementById('tab-library');

const textInput = document.getElementById('text-input');
const btnStart = document.getElementById('btn-start');
const btnExit = document.getElementById('btn-exit');
const btnToggleMarkup = document.getElementById('btn-toggle-markup');
const currentSentenceEl = document.getElementById('current-sentence');
const progressBar = document.getElementById('progress-bar');
const pulseIndicator = document.getElementById('pulse-indicator');
const statusText = document.getElementById('status-text');
const userTranscript = document.getElementById('user-transcript');

const btnBack = document.getElementById('btn-back');
const btnPause = document.getElementById('btn-pause');
const btnReplay = document.getElementById('btn-replay');
const btnNext = document.getElementById('btn-next');
const btnSpeak = document.getElementById('btn-speak');

// State
let sentences = [];
let currentIndex = 0;
let mode = 'beginner';
let timerId = null;
let showMarkup = false;
let isPaused = false;

// Speech Recognition
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;
if (recognition) { recognition.continuous = false; recognition.interimResults = true; }

const LEVEL_CONFIG = {
  beginner: { rate: 0.8, pauseMs: 3000, autoNext: false },
  normal: { rate: 1.0, pauseMs: 2000, autoNext: false },
  fluency: { rate: 1.2, pauseMs: 500, autoNext: true }
};

// --- Voice Setup ---
const voiceSelect = document.getElementById('voice-select');
let availableVoices = [];
function populateVoices() {
  availableVoices = window.speechSynthesis.getVoices();
  const englishVoices = availableVoices.filter(v => v.lang.startsWith('en'));
  if (englishVoices.length > 0) {
    voiceSelect.innerHTML = '';
    englishVoices.forEach(voice => {
      const option = document.createElement('option');
      option.value = voice.voiceURI;
      let label = voice.name;
      if (label.includes('Natural') || label.includes('Online') || label.includes('Google') || label.includes('Premium')) {
        label = '⭐ ' + label + ' (Best)';
      }
      option.textContent = label;
      voiceSelect.appendChild(option);
    });
  }
}
window.speechSynthesis.onvoiceschanged = populateVoices;
populateVoices();

// --- KPI System ---
function loadKPIs() {
  const today = new Date().toDateString();
  let lastDate = localStorage.getItem('lastDate');
  let streak = parseInt(localStorage.getItem('streak') || '0');
  if (lastDate !== today) {
    if (lastDate === new Date(Date.now() - 86400000).toDateString()) streak++;
    else if (lastDate !== null) streak = 1;
    localStorage.setItem('lastDate', today);
    localStorage.setItem('streak', streak);
  }
  document.getElementById('kpi-streak').innerText = streak;
  document.getElementById('kpi-sentences').innerText = localStorage.getItem('totalSentences') || '0';
  document.getElementById('kpi-attempts').innerText = localStorage.getItem('totalAttempts') || '0';
}
function updateKPI(type) {
  localStorage.setItem(type, parseInt(localStorage.getItem(type) || '0') + 1);
  loadKPIs();
}

// --- Text Library System (Local Database) ---
let library = JSON.parse(localStorage.getItem('shadow_library')) || [];

function saveToLibrary(text) {
  const cleanText = text.trim();
  if (!cleanText) return;
  const existingIndex = library.findIndex(item => item.text === cleanText);
  const now = Date.now();
  
  if (existingIndex >= 0) {
    library[existingIndex].updatedAt = now; // Update time
  } else {
    library.push({
      id: 'txt_' + now,
      text: cleanText,
      status: 'learning', // learning, familiar, mastered
      createdAt: now,
      updatedAt: now,
      length: cleanText.length
    });
  }
  localStorage.setItem('shadow_library', JSON.stringify(library));
  renderLibrary();
}

function renderLibrary() {
  const listEl = document.getElementById('library-list');
  const searchQ = document.getElementById('search-input').value.toLowerCase();
  const sortQ = document.getElementById('sort-select').value;
  const filterQ = document.getElementById('filter-select').value;

  let filtered = library.filter(item => {
    const matchSearch = item.text.toLowerCase().includes(searchQ);
    const matchFilter = filterQ === 'all' || item.status === filterQ;
    return matchSearch && matchFilter;
  });

  filtered.sort((a, b) => {
    if (sortQ === 'edit-desc') return b.updatedAt - a.updatedAt;
    if (sortQ === 'edit-asc') return a.updatedAt - b.updatedAt;
    if (sortQ === 'create-desc') return b.createdAt - a.createdAt;
    if (sortQ === 'length-desc') return b.length - a.length;
    if (sortQ === 'length-asc') return a.length - b.length;
  });

  listEl.innerHTML = filtered.map(item => `
    <div class="lib-card glass" onclick="loadTextToPractice('${item.id}')">
      <div class="lib-text">${item.text}</div>
      <div class="lib-meta">
        <span class="badge ${item.status}">${item.status}</span>
        <span style="margin-left:auto; margin-right:10px;">${new Date(item.updatedAt).toLocaleDateString()}</span>
        <div class="lib-actions">
          <button onclick="event.stopPropagation(); openEditModal('${item.id}')">Edit</button>
          <button class="delete" onclick="event.stopPropagation(); deleteFromLibrary('${item.id}')">Delete</button>
        </div>
      </div>
    </div>
  `).join('');
}

window.loadTextToPractice = (id) => {
  const item = library.find(i => i.id === id);
  if (item) {
    textInput.value = item.text;
    tabPractice.click();
  }
};

window.deleteFromLibrary = (id) => {
  if(confirm("Delete this text?")) {
    library = library.filter(i => i.id !== id);
    localStorage.setItem('shadow_library', JSON.stringify(library));
    renderLibrary();
  }
};

// Edit Modal Logic
const editModal = document.getElementById('edit-modal');
const editTextArea = document.getElementById('edit-textarea');
const editStatus = document.getElementById('edit-status');
let editingId = null;

window.openEditModal = (id) => {
  const item = library.find(i => i.id === id);
  if (item) {
    editingId = id;
    editTextArea.value = item.text;
    editStatus.value = item.status;
    editModal.classList.add('active');
  }
};

document.getElementById('btn-cancel-edit').onclick = () => editModal.classList.remove('active');
document.getElementById('btn-save-edit').onclick = () => {
  const item = library.find(i => i.id === editingId);
  if (item) {
    item.text = editTextArea.value;
    item.status = editStatus.value;
    item.updatedAt = Date.now();
    item.length = item.text.length;
    localStorage.setItem('shadow_library', JSON.stringify(library));
    renderLibrary();
    editModal.classList.remove('active');
  }
};

document.getElementById('search-input').addEventListener('input', renderLibrary);
document.getElementById('sort-select').addEventListener('change', renderLibrary);
document.getElementById('filter-select').addEventListener('change', renderLibrary);

// --- Navigation ---
tabPractice.onclick = () => {
  tabPractice.classList.add('active'); tabLibrary.classList.remove('active');
  setupScreen.classList.add('active'); libraryScreen.classList.remove('active'); trainingScreen.classList.remove('active');
};
tabLibrary.onclick = () => {
  tabLibrary.classList.add('active'); tabPractice.classList.remove('active');
  libraryScreen.classList.add('active'); setupScreen.classList.remove('active'); trainingScreen.classList.remove('active');
  renderLibrary();
};

// --- NLP Engine ---
function analyzeSentence(sentence, showMarkup) {
  const functionWords = new Set(['a','an','the','and','but','or','for','nor','so','yet','at','by','in','of','on','to','with','as','from','into','like','over','after','before','between','out','up','down','he','she','it','they','we','you','i','me','him','her','us','them','my','your','his','its','our','their','is','am','are','was','were','be','been','being','have','has','had','do','does','did','can','could','shall','should','will','would','may','might','must','this','that','these','those']);
  const vowels = ['a','e','i','o','u'];
  let words = sentence.split(' ');
  let result = '';

  for(let i = 0; i < words.length; i++) {
    let word = words[i];
    let cleanWord = word.replace(/[^\w]/g, '').toLowerCase();
    let nextWord = words[i+1] ? words[i+1].replace(/[^\w]/g, '').toLowerCase() : '';

    let displayWord = word;
    if (showMarkup && cleanWord && !functionWords.has(cleanWord)) displayWord = `<strong>${word}</strong>`;

    let isLinking = false;
    if (cleanWord && nextWord) {
      let lastChar = cleanWord.slice(-1);
      if (lastChar === 'e' && cleanWord.length > 1) lastChar = cleanWord.slice(-2, -1);
      if (!vowels.includes(lastChar) && lastChar !== 'y' && lastChar !== 'w' && vowels.includes(nextWord.charAt(0))) isLinking = true;
    }

    let isPause = word.match(/[,.;:!?]/) || (nextWord && ['and','but','or','because','if','when'].includes(nextWord));
    let linkingHTML = (showMarkup && isLinking) ? '<span class="linking">_</span>' : '';
    let pauseHTML = (showMarkup && isPause) ? '<span class="pause">//</span>' : '';
    let space = (showMarkup && isLinking) ? '' : ' ';

    result += `<span class="word" data-index="${i}">${displayWord}</span>${linkingHTML}${pauseHTML}${space}`;
  }
  return result.trim();
}

// --- Core Training Engine ---
function setMetronomeState(state) {
  pulseIndicator.className = 'pulse ' + state;
  if (state === 'listening') { statusText.innerText = "🎧 LISTEN"; statusText.style.color = 'var(--accent)'; }
  else if (state === 'paused') { statusText.innerText = "⏳ GET READY"; statusText.style.color = 'var(--text-muted)'; }
  else if (state === 'speaking') { statusText.innerText = "🎤 REPEAT NOW"; statusText.style.color = 'var(--success)'; }
}

function playCurrentSentence() {
  clearTimeout(timerId); window.speechSynthesis.cancel(); if (recognition) recognition.stop();
  isPaused = false; btnPause.innerText = "⏸";

  const text = sentences[currentIndex];
  currentSentenceEl.innerHTML = analyzeSentence(text, showMarkup);
  userTranscript.innerText = "Waiting for you to speak...";
  progressBar.style.width = `${((currentIndex + 1) / sentences.length) * 100}%`;

  setMetronomeState('listening');
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US'; utterance.rate = LEVEL_CONFIG[mode].rate;
  
  const selectedVoice = availableVoices.find(v => v.voiceURI === voiceSelect.value);
  if (selectedVoice) utterance.voice = selectedVoice;

  utterance.onend = () => {
    updateKPI('totalSentences');
    addDoc(collection(db, "sessions"), { sentence: text, mode: mode, timestamp: Date.now(), sessionId: sessionId }).catch(()=>{});
    setMetronomeState('paused');
    timerId = setTimeout(startRecording, LEVEL_CONFIG[mode].pauseMs);
  };
  window.speechSynthesis.speak(utterance);
}

function startRecording() {
  if (!recognition) { userTranscript.innerText = "(Speech Recognition not supported. Just speak loud!)"; autoAdvanceCheck(); return; }
  setMetronomeState('speaking'); updateKPI('totalAttempts');
  try { recognition.start(); } catch(e) {}
  recognition.onresult = (e) => {
    let final = '';
    for (let i = e.resultIndex; i < e.results.length; ++i) if (e.results[i].isFinal) final += e.results[i][0].transcript;
    if (final) { userTranscript.innerText = final; userTranscript.style.color = 'var(--text-main)'; }
  };
  recognition.onend = () => { setMetronomeState('paused'); autoAdvanceCheck(); };
}

function autoAdvanceCheck() {
  if (LEVEL_CONFIG[mode].autoNext) {
    timerId = setTimeout(() => { if (currentIndex < sentences.length - 1) { currentIndex++; playCurrentSentence(); } }, 1500);
  }
}

// --- Event Listeners ---
btnStart.addEventListener('click', () => {
  const rawText = textInput.value.trim();
  if (!rawText) return alert("Please paste some text first!");
  
  saveToLibrary(rawText); // Save to Database
  
  sentences = rawText.match(/[^.?!]+[.?!]+/g) || rawText.split('\n');
  sentences = sentences.map(s => s.trim()).filter(s => s.length > 0);
  if(sentences.length === 0) return alert("Could not find any sentences!");

  mode = document.querySelector('input[name="level"]:checked').value;
  currentIndex = 0;
  setupScreen.classList.remove('active'); trainingScreen.classList.add('active');
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(''));
  playCurrentSentence();
});

btnExit.addEventListener('click', () => {
  window.speechSynthesis.cancel(); if (recognition) recognition.stop(); clearTimeout(timerId);
  trainingScreen.classList.remove('active'); setupScreen.classList.add('active'); loadKPIs();
});

btnToggleMarkup.addEventListener('click', () => {
  showMarkup = !showMarkup;
  btnToggleMarkup.style.color = showMarkup ? 'var(--accent)' : 'var(--text-muted)';
  if (sentences.length > 0) currentSentenceEl.innerHTML = analyzeSentence(sentences[currentIndex], showMarkup);
});

btnNext.addEventListener('click', () => { if (currentIndex < sentences.length - 1) { currentIndex++; playCurrentSentence(); } });
btnBack.addEventListener('click', () => { if (currentIndex > 0) { currentIndex--; playCurrentSentence(); } });
btnReplay.addEventListener('click', playCurrentSentence);
btnSpeak.addEventListener('click', () => { window.speechSynthesis.cancel(); clearTimeout(timerId); startRecording(); });

// Chunk Playback
currentSentenceEl.addEventListener('click', (e) => {
  const wordSpan = e.target.closest('.word');
  if (!wordSpan) return;
  const startIndex = parseInt(wordSpan.getAttribute('data-index'));
  const words = sentences[currentIndex].split(' ');
  let endIndex = startIndex;
  for (let i = startIndex; i < words.length; i++) {
    let w = words[i], nw = words[i+1] ? words[i+1].replace(/[^\w]/g, '').toLowerCase() : '';
    if (w.match(/[,.;:!?]/) || (nw && ['and','but','or','because','if','when'].includes(nw)) || i === words.length - 1) { endIndex = i; break; }
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(words.slice(startIndex, endIndex + 1).join(' '));
  utterance.lang = 'en-US'; utterance.rate = LEVEL_CONFIG[mode].rate;
  const selectedVoice = availableVoices.find(v => v.voiceURI === voiceSelect.value);
  if (selectedVoice) utterance.voice = selectedVoice;
  window.speechSynthesis.speak(utterance);
});

// Pause/Resume Logic
function togglePauseResume() {
  if (window.speechSynthesis.speaking) {
    if (isPaused) { window.speechSynthesis.resume(); isPaused = false; btnPause.innerText = "⏸"; statusText.innerText = "🎧 LISTEN"; statusText.style.color = 'var(--accent)'; }
    else { window.speechSynthesis.pause(); isPaused = true; btnPause.innerText = "▶️"; statusText.innerText = "⏸ PAUSED"; statusText.style.color = 'var(--text-muted)'; }
  }
}
btnPause.addEventListener('click', togglePauseResume);

// Keyboard Shortcuts
document.addEventListener('keydown', (e) => {
  if (!trainingScreen.classList.contains('active')) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.code === 'Space') { e.preventDefault(); togglePauseResume(); }
  else if (e.code === 'KeyA') btnBack.click();
  else if (e.code === 'KeyS') btnReplay.click();
  else if (e.code === 'KeyD') btnNext.click();
});

// Init
loadKPIs(); renderLibrary();

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.error('PWA failed', err));
  });
}