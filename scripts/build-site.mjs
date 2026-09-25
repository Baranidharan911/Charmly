// Copies the app's charm renderer into the website so the live demo always
// matches the app. Netlify runs this before publishing website/.
import { cpSync, rmSync } from 'node:fs';
rmSync('website/demo', { recursive: true, force: true });
cpSync('renderer', 'website/demo', { recursive: true });
console.log('Copied renderer/ -> website/demo/');
