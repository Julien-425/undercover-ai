// 候选名、性格预设与头像配色（纯数据，无副作用）

export const NAME_CANDIDATES = ['汐汐', '阿狸', '阿冷', '小满', '阿凯', '露露', '星野', '七夜'];

export const PERSONA_PRESETS = {
  高冷寡言: '你高冷寡言，说话简短克制、惜字如金，偶尔一针见血。',
  话痨热情: '你热情话痨，爱主动搭话、抛话题、活跃气氛，话偏多。',
  毒舌吐槽: '你毒舌爱吐槽，说话犀利幽默，喜欢挑刺和阴阳怪气。',
  温柔治愈: '你温柔治愈，说话体贴，倾向缓和矛盾、照顾他人感受。',
  中二戏精: '你中二戏精，喜欢夸张表演，用戏剧化、中二的台词说话。',
  老实憨厚: '你老实憨厚，说话朴素直接，不擅长撒谎和绕弯子。',
};

export const AVATAR_COLORS = [
  '#5b8def', '#ef6a6a', '#5ec4ac', '#f2a65a',
  '#b07ae0', '#e0709a', '#7aa8f0', '#d0a24a',
];

// 把性格预设 key 或自定义文案解析为最终的性格描述
export function resolvePersona(keyOrCustom) {
  const s = String(keyOrCustom ?? '').trim();
  if (PERSONA_PRESETS[s]) return PERSONA_PRESETS[s];
  return s || '性格自然随和。';
}
