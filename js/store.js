// localStorage 持久化：Key、模型、设置、战绩、断线续玩快照。全部只存浏览器本地。

const KEY = 'undercover-ai';

function load() {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) || 'null');
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

function save(patch) {
  const cur = load();
  const next = { ...cur, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 忽略配额/隐私模式异常 */
  }
  return next;
}

export function getApiKey() {
  return load().apiKey || '';
}

export function setApiKey(key) {
  save({ apiKey: String(key || '').trim() });
}

export function getModel() {
  return load().model || 'deepseek-chat';
}

export function setModel(model) {
  save({ model: String(model || 'deepseek-chat').trim() });
}

export function getSettings() {
  return load().settings || null;
}

export function saveSettings(settings) {
  save({ settings });
}

export function getStats() {
  return load().stats || { win: 0, lose: 0 };
}

// 仅参与模式记战绩：winner 'human' 算玩家赢，'ai' 算输
export function recordResult(winner) {
  const stats = getStats();
  if (winner === 'human') stats.win = (stats.win || 0) + 1;
  else if (winner === 'ai') stats.lose = (stats.lose || 0) + 1;
  save({ stats });
}

export function getAutosave() {
  return load().autosave || null;
}

export function saveAutosave(snapshot) {
  save({ autosave: snapshot });
}

export function clearAutosave() {
  save({ autosave: null });
}
