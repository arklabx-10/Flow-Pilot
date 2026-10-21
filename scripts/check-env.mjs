import { execSync } from 'node:child_process';

function checkCommand(label, command, required) {
  try {
    const output = execSync(command, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const firstLine = output.split(/\r?\n/)[0] ?? output;
    console.log(`[OK]   ${label.padEnd(22)} ${firstLine}`);
    return true;
  } catch {
    const tag = required ? '[MISS]' : '[WARN]';
    const note = required
      ? 'Required for core build/test'
      : 'Optional locally (required for full native/container workflow; see docs/windows-prerequisites.md)';
    console.log(`${tag} ${label.padEnd(22)} Not found (${note})`);
    return !required;
  }
}

console.log('=== FlowPilot Environment Diagnostic ===\n');

const results = [
  checkCommand('Git', 'git --version', true),
  checkCommand('Node.js (>=22)', 'node --version', true),
  checkCommand('npm (>=10)', 'npm --version', true),
  checkCommand('.NET SDK (10.0 LTS)', 'dotnet --version', true),
  checkCommand('Rust (rustc)', 'rustc --version', false),
  checkCommand('Cargo', 'cargo --version', false),
  checkCommand('Docker', 'docker --version', false),
];

console.log('\n========================================');

if (results.some((ok) => !ok)) {
  console.error('One or more core prerequisites are missing. See docs/windows-prerequisites.md.');
  process.exit(1);
}
