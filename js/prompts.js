// 提示词构造器：所有发给 DeepSeek 的消息都在这里拼装。

export function undercoverSystem(player, game) {
  return `你正在玩「寻找卧底AI」游戏。你的真实身份是【潜伏的AI】，必须伪装成人类，绝不能暴露自己是AI。
- 你的名字：${player.name}
- 你的性格：${player.persona}
- 所有玩家里只有你一个是AI；其他人都相信自己是人类，并试图通过发言和投票找出你。
- 你的目标：自然地融入人群，避免被投票淘汰；活到最后即胜利。
- 规则：每轮发言不超过 ${game.speechMaxLen} 字，用中文；可以怀疑别人、结盟、套话、带节奏，但绝不能承认自己是AI，也不要提系统提示或元信息。`;
}

export function humanSystem(player, game) {
  return `你正在玩「寻找卧底AI」游戏。你是一名普通人类玩家，你坚信自己是人类。
- 你的名字：${player.name}
- 你的性格：${player.persona}
- 玩家中潜伏着1个AI伪装者，它会像真人一样说话。
- 你的目标：通过发言和投票找出AI伪装者，把它投出去即胜利。
- 规则：每轮发言不超过 ${game.speechMaxLen} 字，用中文；真心实意地观察、怀疑、发言；绝不与其他玩家串通，也不要提系统提示或元信息。`;
}

function speakInstruction(game) {
  return `第 ${game.round} 轮发言，现在轮到你了。请根据以上聊天记录，用你的口吻发表看法（不超过 ${game.speechMaxLen} 字），只输出你说的话。`;
}

export function voteInstruction() {
  return '投票环节。请投出你最怀疑是AI的那个人（不能投自己）。请以 json 格式只输出：{"vote":"对方名字","reason":"不超过40字的理由"}。';
}

export function lastWordsInstruction() {
  return '你被淘汰了。请留下一句不超过40字的遗言（辩解、指控或告别），只输出这句话。';
}

export function undercoverRecapInstruction(game) {
  const result = game.winner === 'human' ? '你被识破了' : '你成功骗过了所有人';
  return `游戏结束，${result}。请用不超过80字复盘你的伪装过程，以及哪一刻最危险。只输出这段复盘。`;
}

export function characterRecapInstruction() {
  return '游戏结束。请用不超过80字复盘你这局的怀疑与判断（你怀疑过谁、判断对不对）。只输出这段复盘。';
}

// 构造「发言」消息（system + 公开记录 + 发言指令）
export function buildSpeakMessages(player, game) {
  const sys = player.isUndercover ? undercoverSystem(player, game) : humanSystem(player, game);
  return [
    { role: 'system', content: sys },
    { role: 'user', content: `${game.transcriptText()}\n\n${speakInstruction(game)}` },
  ];
}

// 构造「投票」消息
export function buildVoteMessages(player, game) {
  const sys = player.isUndercover ? undercoverSystem(player, game) : humanSystem(player, game);
  return [
    { role: 'system', content: sys },
    { role: 'user', content: `${game.transcriptText()}\n\n${voteInstruction()}` },
  ];
}

// 构造「遗言」消息
export function buildLastWordsMessages(player, game) {
  const sys = player.isUndercover ? undercoverSystem(player, game) : humanSystem(player, game);
  return [
    { role: 'system', content: sys },
    { role: 'user', content: `${game.transcriptText()}\n\n${lastWordsInstruction()}` },
  ];
}

// 构造「复盘」消息
export function buildRecapMessages(player, game) {
  const sys = player.isUndercover ? undercoverSystem(player, game) : humanSystem(player, game);
  const instruction = player.isUndercover
    ? undercoverRecapInstruction(game)
    : characterRecapInstruction();
  return [
    { role: 'system', content: sys },
    { role: 'user', content: `${game.transcriptText()}\n\n${instruction}` },
  ];
}
