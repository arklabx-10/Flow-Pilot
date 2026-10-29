#!/usr/bin/env node
import { spawn } from 'node:child_process';
import net from 'node:net';
import process from 'node:process';

function checkTcpPort(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (reachable) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(reachable);
      }
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

async function main() {
  const postgresReachable = await checkTcpPort('127.0.0.1', 5432);
  console.log('=== FlowPilot Unified Local Development Runner ===');
  if (postgresReachable) {
    console.log('[INFO] PostgreSQL detected on localhost:5432 -> using SharedPostgres connection.');
  } else {
    console.log(
      '[INFO] PostgreSQL not detected on localhost:5432 -> enabling EF Core InMemory fallback (Database__UseInMemory=true).',
    );
  }

  const children = [];

  function spawnService(label, command, envOverrides = {}) {
    const child = spawn(command, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      env: {
        ...process.env,
        ...envOverrides,
      },
    });

    child.stdout.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.trim().length > 0) {
          console.log(`[${label}] ${line}`);
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.trim().length > 0) {
          console.error(`[${label}] ${line}`);
        }
      }
    });

    children.push(child);
    return child;
  }

  spawnService(
    'API :5080',
    'dotnet run --project services/api/src/FlowPilot.Api/FlowPilot.Api.csproj --urls http://localhost:5080',
    postgresReachable ? {} : { Database__UseInMemory: 'true' },
  );
  spawnService('WEB :5173', 'npm --workspace=@flowpilot/web run dev');
  spawnService('DESKTOP :1420', 'npm --workspace=@flowpilot/desktop run dev');

  const shutdown = () => {
    console.log('\nStopping FlowPilot services...');
    for (const child of children) {
      try {
        child.kill();
      } catch {
        // Ignore cleanup errors
      }
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
