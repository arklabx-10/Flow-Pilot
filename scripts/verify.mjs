import { execSync } from 'node:child_process';

const steps = [
  { name: 'Environment Prerequisite Check', cmd: 'node scripts/check-env.mjs' },
  {
    name: 'Build Contracts (@flowpilot/contracts)',
    cmd: 'npm --workspace=@flowpilot/contracts run build',
  },
  { name: 'Format Check (Prettier + dotnet format)', cmd: 'npm run format:check' },
  { name: 'ESLint Check', cmd: 'npm run lint' },
  { name: 'TypeScript Typecheck', cmd: 'npm run typecheck' },
  { name: 'JS/TS Unit Tests (Vitest)', cmd: 'npm run test' },
  { name: 'Build Web & Desktop Frontend Bundles', cmd: 'npm run build' },
  {
    name: 'Build & Test .NET API (xUnit)',
    cmd: 'dotnet test FlowPilot.slnx --configuration Release',
  },
];

console.log('=== FlowPilot Monorepo Verification Suite ===\n');

for (const step of steps) {
  console.log(`>>> Running: ${step.name}`);
  console.log(`    $ ${step.cmd}`);
  execSync(step.cmd, { stdio: 'inherit' });
  console.log(`<<< Passed:  ${step.name}\n`);
}

console.log('All verification checks passed!');
