// Inspect the actual Git index; never print matched secret values.
import { execFileSync } from 'node:child_process';
const files = execFileSync('git', ['ls-files', '--cached', '-z'], { maxBuffer: 16 * 1024 * 1024 }).toString().split('\0').filter(Boolean);
if (!files.length) throw new Error('暂存区为空；先暂存候选文件再检查');
const forbidden = /(^|\/)(?:\.env(?:\..*)?|model\.json|clip-ai\.json|sync-config\.json|config\.json|clips\.json|file-grants\.json|\.tiker|\.tiker-learning|\.trae|\.superpowers|node_modules|target|artifacts)(?:\/|$)|\.(?:pem|key|p12|pfx)$/i;
const secret = /(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----)/;
const failures = [];
for (const file of files) {
  if (forbidden.test(file) && !/\.example(?:\.|$)/.test(file)) failures.push(`${file}: 本机数据或凭据文件`);
  const data = execFileSync('git', ['show', `:${file}`], { maxBuffer: 32 * 1024 * 1024 });
  if (data.includes(0)) continue;
  data.toString('utf8').split('\n').forEach((line, i) => {
    if (secret.test(line)) failures.push(`${file}:${i + 1}: 疑似凭据`);
    if (/\/Users\/[^/\s]+\/|\/home\/[^/\s]+\//.test(line)) failures.push(`${file}:${i + 1}: 本机绝对路径`);
  });
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log(`已检查 ${files.length} 个暂存文件：未发现规则覆盖的凭据、运行数据或个人绝对路径。此检查不替代内容审阅。`);
