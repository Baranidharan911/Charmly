// Prepares website/ from the app so the site always matches it. Netlify runs this before publishing.
//  - copies renderer/ to website/demo/ (the live, swingable preview)
//  - writes website/demo/collections.json from the app's COLLECTIONS list
import { cpSync, rmSync, readFileSync, writeFileSync } from 'node:fs';

rmSync('website/demo', { recursive: true, force: true });
cpSync('renderer', 'website/demo', { recursive: true });

const src = readFileSync('renderer/index.html', 'utf8');
const block = src.slice(src.indexOf('const COLLECTIONS=['), src.indexOf('];', src.indexOf('const COLLECTIONS=[')));
const collections = [...block.matchAll(/\{name:'((?:\\'|[^'])+)',items:\[(.*)\]\}/g)].map(([, name, items]) => ({
  name: name.replace(/\\'/g, "'"),
  items: [...items.matchAll(/\['(\w+)','((?:\\'|[^'])+)'/g)].map(([, id, n]) => ({ id, name: n.replace(/\\'/g, "'") })),
}));
writeFileSync('website/demo/collections.json', JSON.stringify(collections));

console.log(`Site ready: ${collections.length} collections, ${collections.reduce((a, c) => a + c.items.length, 0)} charms`);
