/** Local stand-in for a Discord webhook; prints whatever the bot would post. */
import http from 'http';

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const p = JSON.parse(body || '{}');
    console.log('\n--- POST ---');
    console.log('content:', p.content);
    for (const e of p.embeds || []) {
      console.log('  title:', e.title);
      console.log('  url:', e.url);
      console.log('  desc:', e.description);
      for (const f of e.fields || []) console.log(`   • ${f.name}: ${f.value}`);
      console.log('  footer:', e.footer?.text);
    }
    console.log('allowed_mentions:', JSON.stringify(p.allowed_mentions));
    res.writeHead(204).end();
  });
});
server.listen(8787, () => console.log('mock webhook on http://127.0.0.1:8787/hook'));
