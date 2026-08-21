// 纯逻辑状态机：与 DOM 解耦，可独立单测。
// 管理一局「寻找卧底AI」的全部状态与规则，不感知 UI / API。
import { NAME_CANDIDATES } from './characters.js';

// ---------- 通用工具 ----------
export function clamp(n, lo, hi) {
  const v = Number(n);
  if (Number.isNaN(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

function shuffle(arr, random = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- 长度 → max_tokens（中文 ≈ 1 字 1–2 token，留缓冲） ----------
export function lengthToMaxTokens(chars) {
  return clamp(Math.round(chars * 2 + 20), 32, 2048);
}

// ---------- 名字清洗 ----------
function stripBad(raw) {
  return String(raw ?? '')
    .replace(/["'“”‘’,，]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

// 逐个清洗名字：去引号/逗号/空白；空名回填候选；重名自动加 -2/-3 后缀；保证唯一非空。
export function sanitizeNames(rawNames, usedNames = []) {
  const used = [...usedNames];
  const out = [];
  for (const raw of rawNames) {
    let name = stripBad(raw);
    if (!name) {
      name = NAME_CANDIDATES.find((c) => !used.includes(c)) || `角色${out.length + 1}`;
    }
    let candidate = name;
    let suffix = 2;
    while (used.includes(candidate)) candidate = `${name}-${suffix++}`;
    used.push(candidate);
    out.push(candidate);
  }
  return out;
}

// ---------- 计票 ----------
// votes: [{ voterId, targetId, reason }]
export function tallyVotes(votes) {
  const counts = new Map();
  for (const v of votes) counts.set(v.targetId, (counts.get(v.targetId) || 0) + 1);
  return counts;
}

// 淘汰判定：得票 >50% 者淘汰；无人过半则从并列最高票中随机淘汰 1 人（保证推进）。
export function pickEliminated(votes, random = Math.random) {
  const counts = tallyVotes(votes);
  const total = votes.length;
  const majority = Math.floor(total / 2) + 1;
  let maxCount = 0;
  for (const c of counts.values()) if (c > maxCount) maxCount = c;
  const top = [...counts.entries()].filter(([, c]) => c === maxCount).map(([id]) => id);
  if (maxCount >= majority && top.length === 1) return top[0];
  return top[Math.floor(random() * top.length)];
}

// ---------- 方法挂载（createGame / deserializeGame 共用） ----------
function attachMethods(game) {
  game.player = (id) => game.players.find((p) => p.id === id);
  game.alivePlayers = () => game.players.filter((p) => p.alive);
  game.undercover = () => game.players.find((p) => p.isUndercover);

  game.beginDiscussion = () => {
    game.round += 1;
    game.phase = 'discussion';
    game.speakQueue = shuffle(game.alivePlayers().map((p) => p.id));
  };

  game.currentSpeaker = () => (game.speakQueue[0] ? game.player(game.speakQueue[0]) : null);

  game.recordSpeech = (id, text) => {
    const p = game.player(id);
    if (!p) return;
    game.transcript.push({ speaker: p.name, type: 'speech', text: String(text ?? '').trim() });
    game.speakQueue.shift();
  };

  // 本轮是否结束且该投票了
  game.shouldVote = () =>
    game.speakQueue.length === 0 && game.round % game.voteInterval === 0;

  game.startVote = () => {
    game.phase = 'voting';
    game.votes = [];
  };

  // 记录一票；返回是否所有存活者都已投票
  game.castVote = (voterId, targetId, reason) => {
    game.votes.push({ voterId, targetId, reason: String(reason ?? '').trim() });
    return game.votes.length === game.alivePlayers().length;
  };

  // 汇总并淘汰；返回 { eliminatedId, winner }
  game.finalizeVote = (r = Math.random) => {
    const eliminatedId = pickEliminated(game.votes, r);
    const eliminated = game.player(eliminatedId);
    eliminated.alive = false;
    eliminated.eliminatedAt = game.round;
    game.eliminated.push(eliminatedId);

    // 公开投票结果（含理由，供后续 AI 推理）
    for (const v of game.votes) {
      const voter = game.player(v.voterId);
      const target = game.player(v.targetId);
      game.transcript.push({
        speaker: voter.name,
        type: 'vote',
        text: `投给「${target.name}」：${v.reason || '（无理由）'}`,
      });
    }
    const votesFor = tallyVotes(game.votes).get(eliminatedId) || 0;
    game.transcript.push({
      speaker: '系统',
      type: 'system',
      text: `${eliminated.name} 以 ${votesFor} 票被淘汰。`,
    });

    // 胜负判定
    if (eliminated.isUndercover) {
      game.winner = 'human'; // 卧底被投出 → 人类胜
    } else if (game.alivePlayers().length <= 2) {
      game.winner = 'ai'; // 卧底活到只剩 2 人 → AI 胜
    } else {
      game.winner = null;
    }

    game.phase = 'lastwords';
    return { eliminatedId, winner: game.winner };
  };

  game.recordLastWords = (id, text) => {
    const p = game.player(id);
    if (!p) return;
    game.transcript.push({ speaker: p.name, type: 'lastword', text: String(text ?? '').trim() });
  };

  // 遗言之后：揭晓 或 继续下一轮
  game.afterLastWords = () => {
    if (game.winner) game.phase = 'reveal';
    else game.beginDiscussion();
  };

  // 公开聊天记录（喂给 AI 的上下文），超长取尾部
  game.transcriptText = (maxChars = 12000) => {
    const lines = game.transcript.map((m) => {
      if (m.type === 'system') return `【系统】${m.text}`;
      if (m.type === 'vote') return `【投票】${m.speaker} ${m.text}`;
      if (m.type === 'lastword') return `【遗言】${m.speaker}：${m.text}`;
      return `【${m.speaker}】${m.text}`;
    });
    let text = lines.join('\n');
    if (text.length > maxChars) {
      text = `…（前文略）\n` + text.slice(text.length - maxChars);
    }
    return text;
  };
}

// ---------- 建局 ----------
// config: {
//   mode: 'participate' | 'spectate',
//   totalPlayers: 3..6,
//   characters: [{ name, persona }],   // 仅 AI 角色
//   humanName: string,                 // 参与模式的人类显示名
//   speechMaxLen: number,              // 发言字数上限
//   voteInterval: number,              // 每几轮投一次票
// }
export function createGame(config, random = Math.random) {
  const mode = config.mode === 'participate' ? 'participate' : 'spectate';
  const players = [];

  if (mode === 'participate') {
    const humanName = sanitizeNames([config.humanName || '你'])[0];
    players.push({
      id: 'human',
      name: humanName,
      persona: '你是一名真实人类玩家。',
      color: -1,
      isUndercover: false,
      isHumanPlayer: true,
      alive: true,
      eliminatedAt: null,
    });
  }

  const used = mode === 'participate' ? [players[0].name] : [];
  const names = sanitizeNames(
    config.characters.map((c) => c.name),
    used,
  );
  config.characters.forEach((c, i) => {
    players.push({
      id: `ai-${i}`,
      name: names[i],
      persona: String(c.persona ?? '').trim() || '性格自然随和。',
      color: i % 8,
      isUndercover: false,
      isHumanPlayer: false,
      alive: true,
      eliminatedAt: null,
    });
  });

  const aiPlayers = players.filter((p) => !p.isHumanPlayer);
  const undercover = aiPlayers[Math.floor(random() * aiPlayers.length)];
  undercover.isUndercover = true;

  const game = {
    mode,
    totalPlayers: players.length,
    players,
    undercoverId: undercover.id,
    phase: 'intro',
    round: 0,
    voteInterval: clamp(config.voteInterval, 1, 5),
    speechMaxLen: clamp(config.speechMaxLen, 10, 500),
    speakQueue: [],
    votes: [],
    transcript: [],
    eliminated: [],
    winner: null,
  };
  attachMethods(game);
  return game;
}

// ---------- 序列化（断线续玩用） ----------
export function serializeGame(game) {
  return {
    mode: game.mode,
    totalPlayers: game.totalPlayers,
    players: game.players.map((p) => ({ ...p })),
    undercoverId: game.undercoverId,
    phase: game.phase,
    round: game.round,
    voteInterval: game.voteInterval,
    speechMaxLen: game.speechMaxLen,
    speakQueue: [...game.speakQueue],
    votes: game.votes.map((v) => ({ ...v })),
    transcript: game.transcript.map((m) => ({ ...m })),
    eliminated: [...game.eliminated],
    winner: game.winner,
  };
}

export function deserializeGame(snapshot) {
  const game = {
    mode: snapshot.mode,
    totalPlayers: snapshot.totalPlayers,
    players: snapshot.players.map((p) => ({ ...p })),
    undercoverId: snapshot.undercoverId,
    phase: snapshot.phase,
    round: snapshot.round,
    voteInterval: snapshot.voteInterval,
    speechMaxLen: snapshot.speechMaxLen,
    speakQueue: [...snapshot.speakQueue],
    votes: snapshot.votes.map((v) => ({ ...v })),
    transcript: snapshot.transcript.map((m) => ({ ...m })),
    eliminated: [...snapshot.eliminated],
    winner: snapshot.winner,
  };
  attachMethods(game);
  return game;
}
