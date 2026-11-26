// Until the collection has a game picker, the site root forwards to the only game.
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('dist', { recursive: true });
writeFileSync(
  'dist/index.html',
  '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=shooter/"><a href="shooter/">Shooter</a>\n',
);
writeFileSync('dist/.nojekyll', '');
