const COLORS = { info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m', hit: '\x1b[32m' };
const RESET = '\x1b[0m';

function stamp() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function emit(level, msg) {
  const color = COLORS[level] || '';
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(`${color}[${stamp()}] ${msg}${RESET}\n`);
}

export const log = {
  info: (m) => emit('info', m),
  warn: (m) => emit('warn', m),
  error: (m) => emit('error', m),
  hit: (m) => emit('hit', m),
};
