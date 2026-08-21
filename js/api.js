// DeepSeek 客户端：浏览器直连官方 API（官方已支持 CORS，无需中转）。
// Key 只存浏览器 localStorage，每次请求由这里带上，不经过任何第三方。
const API_URL = 'https://api.deepseek.com/chat/completions';

function apiErrorMessage(status, bodyText) {
  let msg = `请求失败（${status}）`;
  try {
    const j = JSON.parse(bodyText);
    if (j && j.error && j.error.message) msg = j.error.message;
  } catch {
    /* ignore */
  }
  if (status === 401) msg = 'API Key 无效（401）。请在设置里检查 Key。';
  else if (status === 402) msg = '余额不足（402）。请到 DeepSeek 平台充值。';
  else if (status === 429) msg = '请求过于频繁（429），请稍后再试。';
  else if (status >= 500) msg = `DeepSeek 服务异常（${status}），请稍后重试。`;
  return msg;
}

// 流式请求：onDelta(delta, full) 每来一段回调一次；成功返回完整文本。
export async function streamChat({ messages, maxTokens = 512, temperature = 0.8, apiKey, model = 'deepseek-chat', signal, onDelta }) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey || ''}`,
    },
    body: JSON.stringify({ model, messages, stream: true, max_tokens: maxTokens, temperature }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(apiErrorMessage(res.status, await res.text().catch(() => '')));
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content ?? '';
        if (delta) {
          full += delta;
          onDelta?.(delta, full);
        }
      } catch {
        /* 跳过坏行 */
      }
    }
  }
  return full;
}

// 非流式请求：投票/遗言/复盘用。json=true 时请求 JSON 输出模式。
export async function chatOnce({ messages, maxTokens = 200, temperature = 0.3, apiKey, model = 'deepseek-chat', json = false }) {
  const body = { model, messages, stream: false, max_tokens: maxTokens, temperature };
  if (json) body.response_format = { type: 'json_object' };
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey || ''}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(apiErrorMessage(res.status, await res.text().catch(() => '')));
  }
  const j = await res.json();
  return j?.choices?.[0]?.message?.content ?? '';
}
