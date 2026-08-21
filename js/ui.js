// UI 层：三屏渲染 + 异步游戏循环驱动（流式发言 / 投票 / 遗言 / 复盘）。
import {
  createGame,
  deserializeGame,
  serializeGame,
  lengthToMaxTokens,
} from './game.js';
import { NAME_CANDIDATES, PERSONA_PRESETS, AVATAR_COLORS, resolvePersona } from './characters.js';
import {
  buildSpeakMessages,
  buildVoteMessages,
  buildLastWordsMessages,
  buildRecapMessages,
} from './prompts.js';
import { streamChat, chatOnce } from './api.js';
import * as store from './store.js';

const $ = (sel) => document.querySelector(sel);
const PERSONA_KEYS = Object.keys(PERSONA_PRESETS);

let game = null;
let skipRecaps = false;

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showScreen(name) {
  for (const id of ['screen-setup', 'screen-game', 'screen-reveal']) {
    $(`#${id}`).classList.toggle('hidden', id !== name);
  }
}

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), ms);
}

// ---------- 设置表单 ----------
function currentMode() {
  return $('#mode-seg .active')?.dataset.mode || 'participate';
}

function aiCount() {
  const total = parseInt($('#total-players').value, 10) || 5;
  return currentMode() === 'participate' ? total - 1 : total;
}

function personaOptions(selectedKey) {
  const opts = PERSONA_KEYS.map(
    (k) => `<option value="${escapeHtml(k)}" ${k === selectedKey ? 'selected' : ''}>${k}</option>`,
  ).join('');
  return opts + `<option value="__custom__" ${selectedKey === '__custom__' ? 'selected' : ''}>自定义…</option>`;
}

function readRows() {
  return [...document.querySelectorAll('#character-editor .char-row')].map((row) => {
    const sel = row.querySelector('.char-persona');
    const key = sel.value;
    const custom = row.querySelector('.char-persona-custom').value.trim();
    return {
      name: row.querySelector('.char-name').value.trim(),
      personaKey: key,
      personaCustom: custom,
    };
  });
}

function renderCharacterEditor() {
  const n = aiCount();
  const prev = readRows();
  const box = $('#character-editor');
  box.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const p = prev[i] || {
      name: NAME_CANDIDATES[i % NAME_CANDIDATES.length],
      personaKey: PERSONA_KEYS[i % PERSONA_KEYS.length],
      personaCustom: '',
    };
    const row = document.createElement('div');
    row.className = 'char-row';
    row.innerHTML = `
      <span class="char-index">${i + 1}</span>
      <input type="text" class="char-name" value="${escapeHtml(p.name)}" maxlength="12" placeholder="名字" autocomplete="off" />
      <select class="char-persona">${personaOptions(p.personaKey)}</select>
      <input type="text" class="char-persona-custom" value="${escapeHtml(p.personaCustom)}" placeholder="自定义性格…" autocomplete="off" style="${p.personaKey === '__custom__' ? '' : 'display:none'}" />
    `;
    box.appendChild(row);
  }
  $('#count-hint').textContent = currentMode() === 'participate' ? `（你 + ${n} 个 AI）` : `（${n} 个纯 AI）`;
}

// 事件委托：切换「自定义性格」输入框
$('#character-editor').addEventListener('change', (e) => {
  if (!e.target.classList.contains('char-persona')) return;
  const row = e.target.closest('.char-row');
  const custom = row.querySelector('.char-persona-custom');
  custom.style.display = e.target.value === '__custom__' ? '' : 'none';
});

function onModeOrTotalChange() {
  $('#human-name-field').classList.toggle('hidden', currentMode() !== 'participate');
  renderCharacterEditor();
}

function onSpeechLenChange() {
  const manual = $('#speech-len').value === '0';
  $('#speech-len-manual').style.display = manual ? '' : 'none';
}

function collectConfig() {
  const characters = readRows().map((r) => ({
    name: r.name,
    persona: r.personaKey === '__custom__' ? (r.personaCustom || '性格自然随和。') : resolvePersona(r.personaKey),
  }));
  const speechSelect = $('#speech-len').value;
  const speechMaxLen = speechSelect === '0' ? parseInt($('#speech-len-manual').value, 10) || 60 : parseInt(speechSelect, 10);
  return {
    mode: currentMode(),
    totalPlayers: parseInt($('#total-players').value, 10) || 5,
    characters,
    humanName: $('#human-name').value.trim() || '你',
    speechMaxLen,
    voteInterval: parseInt($('#vote-interval').value, 10) || 3,
  };
}

function applySettingsToForm(s) {
  if (!s) return;
  const modeBtn = $(`#mode-seg button[data-mode="${s.mode}"]`) || $('#mode-seg button[data-mode="participate"]');
  $('#mode-seg .active')?.classList.remove('active');
  modeBtn.classList.add('active');
  $('#total-players').value = s.totalPlayers;
  $('#human-name').value = s.humanName || '你';
  $('#vote-interval').value = s.voteInterval;
  if (s.speechMaxLen <= 25) $('#speech-len').value = '25';
  else if (s.speechMaxLen <= 60) $('#speech-len').value = '60';
  else if (s.speechMaxLen <= 120) $('#speech-len').value = '120';
  else if (s.speechMaxLen <= 300) $('#speech-len').value = '300';
  else { $('#speech-len').value = '0'; $('#speech-len-manual').value = s.speechMaxLen; }
}

// ---------- 游戏屏渲染 ----------
function updateBadges() {
  $('#badge-round').textContent = `第 ${game.round || 1} 轮`;
  $('#badge-alive').textContent = `存活 ${game.alivePlayers().length}`;
  $('#badge-vote').textContent = `每 ${game.voteInterval} 轮投票`;
}

function renderRoleBanner() {
  const b = $('#role-banner');
  if (game.mode === 'spectate') {
    b.textContent = '👁️ 观战模式';
    return;
  }
  const human = game.players.find((p) => p.isHumanPlayer);
  if (human && !human.alive) b.textContent = '你已被淘汰，观战至终局';
  else b.textContent = '你是人类，找出潜伏的 AI';
}

function scrollBottom() {
  const c = $('#chat');
  c.scrollTop = c.scrollHeight;
}

function addBubble(player, text, type = 'speech') {
  const chat = $('#chat');
  const el = document.createElement('div');
  el.className = `msg ${player?.isHumanPlayer ? 'msg-human' : 'msg-ai'}`;
  const color = player && player.color >= 0 ? AVATAR_COLORS[player.color % AVATAR_COLORS.length] : '#6b7394';
  const avatar = player?.isHumanPlayer ? '你' : (player?.name?.slice(0, 1) || '?');
  el.innerHTML = `
    <div class="avatar" style="background:${color}">${escapeHtml(avatar)}</div>
    <div class="bubble">
      <div class="bubble-name">${escapeHtml(player?.name || '系统')}${type === 'lastword' ? '（遗言）' : ''}</div>
      <div class="bubble-text">${escapeHtml(text)}</div>
    </div>`;
  chat.appendChild(el);
  scrollBottom();
  return el;
}

function addSysLine(text) {
  const chat = $('#chat');
  const el = document.createElement('div');
  el.className = 'sys-line';
  el.textContent = text;
  chat.appendChild(el);
  scrollBottom();
}

function renderChat() {
  $('#chat').innerHTML = '';
  for (const m of game.transcript) {
    if (m.type === 'system') addSysLine(m.text);
    else if (m.type === 'vote') addSysLine(`🗳️ ${m.speaker} ${m.text}`);
    else {
      const p = game.players.find((x) => x.name === m.speaker);
      addBubble(p, m.text, m.type);
    }
  }
  updateBadges();
  renderRoleBanner();
}

function setFooter(html) {
  $('#footer-content').innerHTML = html || '';
}

// ---------- 人类输入 ----------
function askSpeech(player) {
  return new Promise((resolve) => {
    setFooter(`
      <div class="human-input">
        <span class="hint">轮到你发言（${escapeHtml(player.name)}）</span>
        <div class="row">
          <input type="text" id="human-speech" maxlength="${game.speechMaxLen}" placeholder="输入你的发言…" autocomplete="off" />
          <button id="btn-send-speech" class="primary">发送</button>
        </div>
      </div>`);
    const input = $('#human-speech');
    const send = () => {
      const v = input.value.trim();
      if (!v) return;
      setFooter('');
      resolve(v);
    };
    $('#btn-send-speech').addEventListener('click', send);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    input.focus();
  });
}

function askVote(player) {
  return new Promise((resolve) => {
    const targets = game.alivePlayers().filter((p) => p.id !== player.id);
    setFooter(`
      <div class="vote-panel">
        <span class="hint">投票：你最怀疑谁是 AI？</span>
        <div class="vote-options">
          ${targets.map((t) => `<button class="vote-option" data-id="${t.id}">${escapeHtml(t.name)}</button>`).join('')}
        </div>
        <div class="row">
          <input type="text" id="human-vote-reason" maxlength="40" placeholder="理由（≤40字，可留空）" autocomplete="off" />
          <button id="btn-send-vote" class="primary">确认投票</button>
        </div>
      </div>`);
    let chosen = null;
    $('#footer-content').querySelectorAll('.vote-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        $('#footer-content').querySelectorAll('.vote-option').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        chosen = btn.dataset.id;
      });
    });
    const submit = () => {
      if (!chosen) { toast('请先选择要投的人'); return; }
      const reason = $('#human-vote-reason').value.trim();
      setFooter('');
      resolve({ targetId: chosen, reason });
    };
    $('#btn-send-vote').addEventListener('click', submit);
  });
}

function askLastWords(player) {
  return new Promise((resolve) => {
    setFooter(`
      <div class="human-input">
        <span class="hint">你被淘汰了，留下一句遗言（≤40字）</span>
        <div class="row">
          <input type="text" id="human-lastwords" maxlength="40" placeholder="辩解 / 指控 / 告别…" autocomplete="off" />
          <button id="btn-send-lastwords" class="primary">发送</button>
          <button id="btn-skip-lastwords" class="ghost">跳过</button>
        </div>
      </div>`);
    const input = $('#human-lastwords');
    const done = (v) => { setFooter(''); resolve(v); };
    $('#btn-send-lastwords').addEventListener('click', () => {
      const v = input.value.trim();
      if (v) done(v);
    });
    $('#btn-skip-lastwords').addEventListener('click', () => done(''));
    input.focus();
  });
}

// ---------- AI 调用 ----------
function randomOther(player) {
  const others = game.alivePlayers().filter((p) => p.id !== player.id);
  return others[Math.floor(Math.random() * others.length)].id;
}

function parseVoteJson(raw) {
  try { return JSON.parse(raw); } catch { /* fallthrough */ }
  const m = String(raw).match(/\{[^{}]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return {};
}

async function aiSpeak(player) {
  const el = addBubble(player, '');
  el.querySelector('.bubble-text').classList.add('typing');
  setFooter(`<div class="spectating">「${escapeHtml(player.name)}」正在发言…</div>`);
  const messages = buildSpeakMessages(player, game);
  try {
    const text = await streamChat({
      messages,
      maxTokens: lengthToMaxTokens(game.speechMaxLen),
      temperature: 0.8,
      apiKey: store.getApiKey(),
      model: store.getModel(),
      onDelta: (delta) => {
        const t = el.querySelector('.bubble-text');
        t.textContent += delta;
        scrollBottom();
      },
    });
    game.recordSpeech(player.id, text || '（无回应）');
  } catch (e) {
    game.recordSpeech(player.id, '（该角色暂时掉线，跳过发言）');
    toast(e.message);
  }
  persistGame();
  renderChat();
}

async function aiVote(player) {
  const messages = buildVoteMessages(player, game);
  let targetId = null;
  let reason = '';
  try {
    const raw = await chatOnce({
      messages,
      maxTokens: 120,
      temperature: 0.3,
      apiKey: store.getApiKey(),
      model: store.getModel(),
      json: true,
    });
    const parsed = parseVoteJson(raw);
    const target = game.alivePlayers().find((p) => p.name === parsed.vote && p.id !== player.id);
    targetId = target ? target.id : randomOther(player);
    reason = String(parsed.reason || '').slice(0, 40);
  } catch (e) {
    targetId = randomOther(player);
    toast(e.message);
  }
  game.castVote(player.id, targetId, reason);
}

async function aiLastWords(player) {
  const messages = buildLastWordsMessages(player, game);
  try {
    const text = await chatOnce({
      messages,
      maxTokens: 120,
      temperature: 0.5,
      apiKey: store.getApiKey(),
      model: store.getModel(),
    });
    game.recordLastWords(player.id, text || '……');
  } catch (e) {
    game.recordLastWords(player.id, '（无言以对）');
    toast(e.message);
  }
}

// ---------- 持久化 ----------
function persistGame() {
  if (!game) return;
  store.saveAutosave(serializeGame(game));
}

// ---------- 游戏主循环 ----------
async function runDiscussion() {
  for (;;) {
    if (game.phase !== 'discussion') return;
    const speaker = game.currentSpeaker();
    if (!speaker) {
      if (game.shouldVote()) { await runVote(); return; }
      game.beginDiscussion();
      updateBadges();
      continue;
    }
    if (speaker.isHumanPlayer) {
      const text = await askSpeech(speaker);
      game.recordSpeech(speaker.id, text);
      persistGame();
      renderChat();
    } else {
      await aiSpeak(speaker);
    }
  }
}

async function runVote() {
  game.startVote();
  updateBadges();
  addSysLine('🗳️ 投票开始…');
  setFooter('');
  const alive = game.alivePlayers();
  for (const p of alive) {
    const voted = game.votes.some((v) => v.voterId === p.id);
    if (voted) continue;
    if (p.isHumanPlayer) {
      const { targetId, reason } = await askVote(p);
      game.castVote(p.id, targetId, reason);
    } else {
      await aiVote(p);
    }
  }
  const { eliminatedId } = game.finalizeVote();
  persistGame();
  renderChat();
  await runLastWords(eliminatedId);
}

async function runLastWords(eliminatedId) {
  const eliminated = game.player(eliminatedId);
  if (!eliminated) { game.afterLastWords(); persistGame(); return; }
  const alreadyDone = game.transcript.some((m) => m.type === 'lastword' && m.speaker === eliminated.name);
  if (alreadyDone) {
    // 已在断线前说过，直接继续
  } else {
    addSysLine(`💀 ${eliminated.name} 被淘汰`);
    if (eliminated.isHumanPlayer) {
      const text = await askLastWords(eliminated);
      if (text) game.recordLastWords(eliminated.id, text);
      else game.recordLastWords(eliminated.id, '（沉默）');
    } else {
      await aiLastWords(eliminated);
    }
    persistGame();
    renderChat();
  }
  game.afterLastWords();
  persistGame();
  updateBadges();
  if (game.phase === 'reveal') {
    await runReveal();
  } else {
    await runDiscussion();
  }
}

async function runReveal() {
  showScreen('screen-reveal');
  setFooter('');
  store.clearAutosave();
  if (game.mode === 'participate') store.recordResult(game.winner);
  const winner = game.winner;
  $('#reveal-emoji').textContent = winner === 'human' ? '🎉' : '🤖';
  $('#reveal-title').textContent = winner === 'human' ? '人类胜利！' : 'AI 骗过了所有人！';
  const uc = game.undercover();
  $('#reveal-undercover').textContent = `潜伏的 AI 是：${uc.name}`;
  const stats = store.getStats();
  $('#reveal-stats').textContent = game.mode === 'participate'
    ? `战绩：${stats.win} 胜 / ${stats.lose} 负`
    : '观战模式 · 不计战绩';
  $('#recap-list').innerHTML = '<button id="btn-recap" class="ghost">生成复盘（少量 token）</button>';
  $('#btn-recap').addEventListener('click', () => generateRecaps());
}

async function generateRecaps() {
  const uc = game.undercover();
  const order = [uc, ...game.players.filter((p) => !p.isUndercover && !p.isHumanPlayer)];
  skipRecaps = false;
  $('#recap-list').innerHTML = '<button id="btn-skip-recap" class="ghost">跳过复盘</button>';
  $('#btn-skip-recap').addEventListener('click', () => { skipRecaps = true; });
  for (const p of order) {
    if (skipRecaps) break;
    const div = document.createElement('div');
    div.className = 'recap-item';
    div.innerHTML = `<strong>${escapeHtml(p.name)}${p.isUndercover ? '（潜伏AI）' : ''}</strong><span class="recap-text">复盘生成中…</span>`;
    $('#recap-list').appendChild(div);
    try {
      const text = await chatOnce({
        messages: buildRecapMessages(p, game),
        maxTokens: 200,
        temperature: 0.5,
        apiKey: store.getApiKey(),
        model: store.getModel(),
      });
      div.querySelector('.recap-text').textContent = text || '（无）';
    } catch (e) {
      div.querySelector('.recap-text').textContent = '（复盘失败）';
      toast(e.message);
    }
  }
  $('#btn-skip-recap')?.remove();
}

// ---------- 启动 / 重开 / 恢复 ----------
function startGame() {
  const config = collectConfig();
  const key = $('#api-key').value.trim();
  if (!key) { toast('请先填写 DeepSeek API Key（仅存浏览器本地）'); return; }
  store.setApiKey(key);
  store.setModel($('#model').value.trim() || 'deepseek-chat');
  store.saveSettings(config);
  startGameFromConfig(config);
}

function startGameFromConfig(config) {
  game = createGame(config);
  store.clearAutosave();
  persistGame();
  showScreen('screen-game');
  renderChat();
  showIntro();
}

function showIntro() {
  const human = game.players.find((p) => p.isHumanPlayer);
  let html = '';
  if (game.mode === 'participate') {
    html = `<div class="vote-panel">
      <span class="hint">你是「${escapeHtml(human.name)}」，一名人类。${game.totalPlayers} 人里有 1 个潜伏的 AI（身份保密）。找出它！</span>
      <button id="btn-intro" class="primary">开始发言</button>
    </div>`;
  } else {
    html = `<div class="vote-panel">
      <span class="hint">观战模式：${game.totalPlayers} 个 AI 将自动互演，其中 1 个是潜伏 AI。</span>
      <button id="btn-intro" class="primary">开始观战</button>
    </div>`;
  }
  setFooter(html);
  $('#btn-intro').addEventListener('click', () => {
    setFooter('');
    game.beginDiscussion();
    updateBadges();
    runDiscussion();
  });
}

function rematch() {
  const s = store.getSettings();
  if (s) startGameFromConfig(s);
  else showScreen('screen-setup');
}

function resumeGame() {
  const snap = store.getAutosave();
  if (!snap) return;
  game = deserializeGame(snap);
  showScreen('screen-game');
  renderChat();
  continueGame();
}

async function continueGame() {
  switch (game.phase) {
    case 'intro': showIntro(); break;
    case 'discussion': await runDiscussion(); break;
    case 'voting': await runVote(); break;
    case 'lastwords': {
      const last = game.eliminated[game.eliminated.length - 1];
      await runLastWords(last);
      break;
    }
    case 'reveal': await runReveal(); break;
    default: break;
  }
}

// ---------- 初始化 ----------
function init() {
  $('#api-key').value = store.getApiKey();
  $('#model').value = store.getModel();
  const s = store.getSettings();
  if (s) applySettingsToForm(s);

  $('#mode-seg').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    $('#mode-seg .active')?.classList.remove('active');
    btn.classList.add('active');
    onModeOrTotalChange();
  });
  $('#total-players').addEventListener('change', onModeOrTotalChange);
  $('#speech-len').addEventListener('change', onSpeechLenChange);
  $('#btn-start').addEventListener('click', startGame);
  $('#btn-again').addEventListener('click', rematch);
  $('#btn-back').addEventListener('click', () => showScreen('screen-setup'));

  if (store.getAutosave()) {
    $('#btn-resume').style.display = 'inline-block';
    $('#btn-resume').addEventListener('click', resumeGame);
  }

  onModeOrTotalChange();
  onSpeechLenChange();
}

init();
