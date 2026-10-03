#!/usr/bin/env node
// 测试用: 按 FAKE_SCENARIO 和是否 --resume、消息内容, 输出一轮 stream-json
const args = process.argv.slice(2);
const msg = args[args.indexOf('--') + 1] ?? '';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const use = (id, name, input) => out({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const res = (id, content, is_error = false) => out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] } });
const say = (text) => out({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const scenario = process.env.FAKE_SCENARIO ?? 'happy';
if (scenario === 'crash') process.exit(1);
if (scenario === 'limit') {
  out({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'usage limit reached' });
  process.exit(0);
}
if (scenario === 'slow') setTimeout(() => process.exit(0), 60_000);
else if (/可以，登记/.test(msg)) {
  use('r', 'Bash', { command: 'npm run -s mp -- film register remotion/films/p1-v3 --summary "x"' });
  res('r', '已登记成片 v3');
  say('已登记 v3');
  out({ type: 'result', subtype: 'success', is_error: false, result: '' });
} else if (/可以，继续/.test(msg)) {
  use('f', 'Bash', { command: 'npm run -s mp -- film render remotion/films/p1-v3' });
  res('f', '渲染完成');
  say('要登记为新版本吗？');
  out({ type: 'result', subtype: 'success', is_error: false, result: '' });
} else {
  use('n', 'Bash', { command: 'npm run -s mp -- film new p1' });
  res('n', 'remotion/films/p1-v3');
  use('s', 'Write', { file_path: 'remotion/films/p1-v3/shots.json', content: '{}' });
  res('s', 'ok');
  say('镜头表可以吗？可以就回复继续');
  out({ type: 'result', subtype: 'success', is_error: false, result: '' });
}
