import { spawn } from 'node:child_process';

const children = [
  spawn(process.execPath, ['server.js'], { stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...process.argv.slice(2)], { stdio: 'inherit' }),
];

function stop() {
  children.forEach((child) => child.kill());
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
children.forEach((child) => child.on('exit', (code) => {
  if (code && code !== 0) {
    stop();
    process.exitCode = code;
  }
}));
