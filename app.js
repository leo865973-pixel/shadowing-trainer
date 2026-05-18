// DOM Elements
const screens = {
  setup: document.getElementById('setup-screen'),
  library: document.getElementById('library-screen'),
  vocab: document.getElementById('vocab-screen'),
  review: document.getElementById('review-screen'),
  training: document.getElementById('training-screen')
};
const tabs = {
  practice: document.getElementById('tab-practice'),
  library: document.getElementById('tab-library'),
  vocab: document.getElementById('tab-vocab')
};

const textInput = document.getElementById('text-input');
const currentSentenceEl = document.getElementById('current-sentence');
const progressBar = document.getElementById('progress-bar');
const pulseIndicator = document.getElementById('pulse-indicator');
const statusText = document.getElementById('status-text');
const userTranscript = document.getElementById('user-transcript');
const voiceSelect = document.getElementById('voice-select');

// 嚴格對齊所有按鈕 ID
const btnStart = document.getElementById('btn-start');
const btnExit = document.getElementById('btn-exit');
const btnNext = document.getElementById('btn-next');
const btnBack = document.getElementById('btn-back');
const btnReplay = document.getElementById('btn-replay');
const btnSpeak = document.getElementById('btn-speak');
const btnPause = document.getElementById('btn-pause');
const btnToggleMarkup = document.getElementById('btn-toggle-markup');

// State
let sentences = [];
let currentIndex = 0;
let mode = 'beginner';
let timerId = null;
let isPaused = false;
let showMarkup = false;
let currentTextId = null; 
let vocabShadowingMode = null; 

// Speech Recognition & Synthesis
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;
if (recognition) { recognition.continuous = false; recognition.interimResults = true; }

const LEVEL_CONFIG = { beginner: { rate: 0.8, pauseMs: 3000, autoNext: false }, normal: { rate: 1.0, pauseMs: 2000, autoNext: false }, fluency: { rate: 1.2, pauseMs: 500, autoNext: true } };
let availableVoices = [];
window.speechSynthesis.onvoiceschanged = () => {
  availableVoices = window.speechSynthesis.getVoices();
  const enVoices = availableVoices.filter(v => v.lang.startsWith('en'));
  if (enVoices.length > 0) {
    voiceSelect.innerHTML = '';
    enVoices.forEach(v => {
      let label = v.name;
      if (label.includes('Natural') || label.includes('Online')) label = '⭐ ' + label;
      voiceSelect.add(new Option(label, v.voiceURI));
    });
  }
};

// --- Data Storage ---
let library = JSON.parse(localStorage.getItem('shadow_library')) || [];
let vocabDB = JSON.parse(localStorage.getItem('shadow_vocab')) || [];

// --- KPI System ---
function loadKPIs() {
  const today = new Date().toDateString();
  let lastDate = localStorage.getItem('lastDate');
  let streak = parseInt(localStorage.getItem('streak') || '0');
  if (lastDate !== today) {
    if (lastDate === new Date(Date.now() - 86400000).toDateString()) streak++;
    else if (lastDate !== null) streak = 1;
    localStorage.setItem('lastDate', today); localStorage.setItem('streak', streak);
  }
  document.getElementById('kpi-streak').innerText = streak;

  if (currentTextId) {
    const textData = library.find(t => t.id === currentTextId);
    document.getElementById('label-sentences').innerText = "Text Sentences";
    document.getElementById('label-attempts').innerText = "Text Attempts";
    document.getElementById('kpi-sentences').innerText = textData?.stats?.sentences || 0;
    document.getElementById('kpi-attempts').innerText = textData?.stats?.attempts || 0;
  } else {
    document.getElementById('label-sentences').innerText = "Total Sentences";
    document.getElementById('label-attempts').innerText = "Total Attempts";
    document.getElementById('kpi-sentences').innerText = localStorage.getItem('totalSentences') || '0';
    document.getElementById('kpi-attempts').innerText = localStorage.getItem('totalAttempts') || '0';
  }
}

window.resetKPI = (type) => {
  if (!confirm(`Reset ${type} to 0?`)) return;
  if (type === 'streak') localStorage.setItem('streak', '0');
  else if (currentTextId) {
    const textData = library.find(t => t.id === currentTextId);
    if (textData) { textData.stats[type] = 0; localStorage.setItem('shadow_library', JSON.stringify(library)); }
  } else {
    localStorage.setItem(type === 'sentences' ? 'totalSentences' : 'totalAttempts', '0');
  }
  loadKPIs();
};

function updateKPI(type) {
  localStorage.setItem(type, parseInt(localStorage.getItem(type) || '0') + 1);
  if (currentTextId) {
    const textData = library.find(t => t.id === currentTextId);
    if (textData) {
      if (!textData.stats) textData.stats = { sentences: 0, attempts: 0 };
      textData.stats[type === 'totalSentences' ? 'sentences' : 'attempts']++;
      localStorage.setItem('shadow_library', JSON.stringify(library));
    }
  }
  loadKPIs();
}

// --- Library System ---
function saveToLibrary(text) {
  const cleanText = text.trim();
  if (!cleanText) return null;
  let item = library.find(i => i.text === cleanText);
  if (!item) {
    item = { id: 'txt_' + Date.now(), text: cleanText, status: 'learning', createdAt: Date.now(), stats: { sentences: 0, attempts: 0 } };
    library.push(item);
    localStorage.setItem('shadow_library', JSON.stringify(library));
  }
  return item.id;
}

function renderLibrary() {
  const q = document.getElementById('search-input').value.toLowerCase();
  document.getElementById('library-list').innerHTML = library.filter(i => i.text.toLowerCase().includes(q)).map(item => `
    <div class="lib-card glass" onclick="loadTextToPractice('${item.id}')">
      <div class="lib-text">${item.text}</div>
      <div class="lib-meta">
        <span class="badge ${item.status}">${item.status}</span>
        <span>Attempts: ${item.stats?.attempts || 0}</span>
      </div>
    </div>
  `).join('');
}

window.loadTextToPractice = (id) => {
  const item = library.find(i => i.id === id);
  if (item) {
    currentTextId = id; textInput.value = item.text;
    loadKPIs(); switchTab('practice');
  }
};

// --- Vocab & SRS System ---
const SRS_INTERVALS = [0, 1, 3, 7, 14, 999]; 

function renderVocab() {
  let weakCount = vocabDB.filter(v => v.isWeak).length;
  document.getElementById('vocab-total').innerText = vocabDB.length;
  document.getElementById('vocab-weak').innerText = weakCount;

  const q = document.getElementById('vocab-search').value.toLowerCase();
  document.getElementById('vocab-list').innerHTML = vocabDB.filter(v => v.word.toLowerCase().includes(q)).map(v => `
    <div class="vocab-card glass" onclick="openVocabDetail('${v.id}')">
      <span class="vc-word">${v.word}</span>
      <span class="badge ${v.pos || 'noun'}">${v.pos || 'noun'}</span>
      <span class="vc-trans">${v.translation}</span>
      ${v.isWeak ? '<span class="badge weak" style="margin-top:5px;">Weak</span>' : ''}
    </div>
  `).join('');
}

window.openVocabDetail = (id) => {
  const v = vocabDB.find(x => x.id === id);
  if (!v) return;
  document.getElementById('vd-word').innerText = v.word;
  document.getElementById('vd-pos').innerText = v.pos || 'noun';
  document.getElementById('vd-pos').className = `badge ${v.pos || 'noun'}`;
  document.getElementById('vd-trans').innerText = v.translation;
  document.getElementById('vd-example').innerText = v.example || 'No example provided.';
  document.getElementById('vd-level').innerText = `Level: ${v.level}`;
  document.getElementById('vd-status').innerText = v.isWeak ? '🔴 Weak' : '🟢 Good';
  
  document.getElementById('btn-vd-shadow').onclick = () => {
    document.getElementById('vocab-detail-modal').classList.remove('active');
    jumpToShadowing(v.id);
  };
  document.getElementById('btn-vd-delete').onclick = () => {
    if(confirm("Delete word?")) { 
      vocabDB = vocabDB.filter(x => x.id !== id); 
      localStorage.setItem('shadow_vocab', JSON.stringify(vocabDB)); 
      document.getElementById('vocab-detail-modal').classList.remove('active');
      renderVocab(); 
    }
  };
  document.getElementById('vocab-detail-modal').classList.add('active');
};

window.playVoice = (text) => {
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = availableVoices.find(v => v.voiceURI === voiceSelect.value);
  if (v) u.voice = v;
  window.speechSynthesis.speak(u);
};

document.getElementById('btn-add-vocab').onclick = () => {
  document.getElementById('v-word').value = '';
  document.getElementById('v-trans').value = '';
  document.getElementById('v-example').value = sentences[currentIndex] || '';
  document.getElementById('vocab-modal').classList.add('active');
};

document.getElementById('btn-save-vocab').onclick = () => {
  const word = document.getElementById('v-word').value.trim();
  const trans = document.getElementById('v-trans').value.trim();
  if (!word || !trans) return alert("Word and Translation required!");
  
  vocabDB.push({
    id: 'v_' + Date.now(), word: word, translation: trans, pos: document.getElementById('v-pos').value,
    example: document.getElementById('v-example').value, sourceTextId: currentTextId,
    level: 0, mistakes: 0, isWeak: false, addedAt: Date.now(), nextReview: Date.now()
  });
  localStorage.setItem('shadow_vocab', JSON.stringify(vocabDB));
  document.getElementById('vocab-modal').classList.remove('active');
  renderVocab(); alert("Added to Vocab!");
};

// SRS Review Logic (無限制 15 張卡片)
let reviewQueue = [];
let currentReviewWord = null;
let reviewTotal = 0;

document.getElementById('btn-start-review').onclick = () => {
  if (vocabDB.length === 0) return alert("Your vocabulary is empty!");
  
  // 優先抓取需要複習的，如果不夠就隨機抓，總共最多 15 個
  let sortedDB = [...vocabDB].sort((a, b) => a.nextReview - b.nextReview);
  reviewQueue = sortedDB.slice(0, 15);
  reviewTotal = reviewQueue.length;
  
  switchScreen('review');
  showNextReviewCard();
};

function showNextReviewCard() {
  if (reviewQueue.length === 0) { alert("Review Complete!"); switchScreen('vocab'); renderVocab(); return; }
  currentReviewWord = reviewQueue[0];
  
  document.getElementById('fc-word').innerText = currentReviewWord.word;
  document.getElementById('fc-pos').innerText = currentReviewWord.pos || 'noun';
  document.getElementById('fc-pos').className = `badge ${currentReviewWord.pos || 'noun'}`;
  document.getElementById('fc-trans').innerText = currentReviewWord.translation;
  document.getElementById('fc-example').innerText = currentReviewWord.example || '';
  
  document.getElementById('fc-answer').classList.add('hidden');
  document.getElementById('srs-controls').classList.add('hidden');
  document.getElementById('btn-show-answer').classList.remove('hidden');
  
  let currentNum = reviewTotal - reviewQueue.length + 1;
  document.getElementById('review-counter').innerText = `${currentNum} / ${reviewTotal}`;
  document.getElementById('review-progress').style.width = `${(currentNum / reviewTotal) * 100}%`;
}

document.getElementById('btn-show-answer').onclick = () => {
  document.getElementById('fc-answer').classList.remove('hidden');
  document.getElementById('btn-show-answer').classList.add('hidden');
  document.getElementById('srs-controls').classList.remove('hidden');
};

document.getElementById('btn-fc-voice').onclick = () => playVoice(currentReviewWord.word);

window.processReview = (remembered) => {
  const v = vocabDB.find(x => x.id === currentReviewWord.id);
  if (remembered) {
    v.level = Math.min(5, v.level + 1);
  } else {
    v.level = 0; v.mistakes++;
    if (v.mistakes >= 3) v.isWeak = true;
  }
  v.nextReview = Date.now() + (SRS_INTERVALS[v.level] * 86400000);
  localStorage.setItem('shadow_vocab', JSON.stringify(vocabDB));
  
  reviewQueue.shift(); 
  showNextReviewCard();
};

document.getElementById('btn-exit-review').onclick = () => { switchScreen('vocab'); renderVocab(); };

// --- Jump to Shadowing ---
window.jumpToShadowing = (vocabId) => {
  const v = vocabDB.find(x => x.id === vocabId);
  if (!v || !v.sourceTextId) return alert("Source text not found!");
  
  const textItem = library.find(t => t.id === v.sourceTextId);
  if (!textItem) return alert("Source text deleted!");

  currentTextId = textItem.id;
  textInput.value = textItem.text;
  sentences = textItem.text.match(/[^.?!]+[.?!]+/g) || textItem.text.split('\n');
  sentences = sentences.map(s => s.trim()).filter(s => s.length > 0);
  
  currentIndex = sentences.findIndex(s => s.toLowerCase().includes(v.word.toLowerCase()));
  if (currentIndex === -1) currentIndex = 0;

  vocabShadowingMode = { wordId: v.id, targetWord: v.word.toLowerCase() };
  
  switchScreen('training');
  document.getElementById('btn-return-vocab').classList.remove('hidden');
  document.getElementById('btn-exit').classList.add('hidden');
  
  playCurrentSentence();
};

document.getElementById('btn-return-vocab').onclick = () => {
  window.speechSynthesis.cancel(); clearTimeout(timerId);
  vocabShadowingMode = null;
  document.getElementById('btn-return-vocab').classList.add('hidden');
  document.getElementById('btn-exit').classList.remove('hidden');
  switchTab('vocab');
};

// --- Core Training Engine (含文本解析與高亮) ---
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

    let targetClass = (vocabShadowingMode && cleanWord === vocabShadowingMode.targetWord) ? 'target-word' : '';

    result += `<span class="word ${targetClass}" data-index="${i}">${displayWord}</span>${linkingHTML}${pauseHTML}${space}`;
  }
  return result.trim();
}

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
  const v = availableVoices.find(v => v.voiceURI === voiceSelect.value);
  if (v) utterance.voice = v;

  utterance.onend = () => {
    updateKPI('totalSentences');
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

// --- Event Listeners & Navigation ---
function switchScreen(screenId) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[screenId].classList.add('active');
}
function switchTab(tabId) {
  Object.values(tabs).forEach(t => t.classList.remove('active'));
  tabs[tabId].classList.add('active');
  if (tabId === 'practice') { switchScreen('setup'); loadKPIs(); }
  if (tabId === 'library') { switchScreen('library'); renderLibrary(); }
  if (tabId === 'vocab') { switchScreen('vocab'); renderVocab(); }
}

tabs.practice.onclick = () => switchTab('practice');
tabs.library.onclick = () => switchTab('library');
tabs.vocab.onclick = () => switchTab('vocab');

btnStart.addEventListener('click', () => {
  const rawText = textInput.value.trim();
  if (!rawText) return alert("Please paste some text first!");
  
  currentTextId = saveToLibrary(rawText) || currentTextId;
  sentences = rawText.match(/[^.?!]+[.?!]+/g) || rawText.split('\n');
  sentences = sentences.map(s => s.trim()).filter(s => s.length > 0);
  
  mode = document.querySelector('input[name="level"]:checked').value;
  currentIndex = 0;
  vocabShadowingMode = null; 
  document.getElementById('btn-return-vocab').classList.add('hidden');
  document.getElementById('btn-exit').classList.remove('hidden');

  switchScreen('training');
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(''));
  playCurrentSentence();
});

btnExit.addEventListener('click', () => {
  window.speechSynthesis.cancel(); if (recognition) recognition.stop(); clearTimeout(timerId);
  switchScreen('setup'); loadKPIs();
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

// Chunk Playback (點擊單字發音)
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

function togglePauseResume() {
  if (window.speechSynthesis.speaking) {
    if (isPaused) { window.speechSynthesis.resume(); isPaused = false; btnPause.innerText = "⏸"; statusText.innerText = "🎧 LISTEN"; statusText.style.color = 'var(--accent)'; }
    else { window.speechSynthesis.pause(); isPaused = true; btnPause.innerText = "▶️"; statusText.innerText = "⏸ PAUSED"; statusText.style.color = 'var(--text-muted)'; }
  }
}
btnPause.addEventListener('click', togglePauseResume);

document.addEventListener('keydown', (e) => {
  if (!screens.training.classList.contains('active')) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.code === 'Space') { e.preventDefault(); togglePauseResume(); }
  else if (e.code === 'KeyA') btnBack.click();
  else if (e.code === 'KeyS') btnReplay.click();
  else if (e.code === 'KeyD') btnNext.click();
});

// Init
loadKPIs(); renderLibrary(); renderVocab();
document.getElementById('search-input').addEventListener('input', renderLibrary);
document.getElementById('vocab-search').addEventListener('input', renderVocab);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(()=>{}));
}