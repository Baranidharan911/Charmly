# Charm Line

Physics-simulated 3D charms hanging on your desktop.

```
main.js, preload.js, renderer/   the Electron app
build/                           app and tray icons
website/                         the download page (deployed by Netlify)
.github/workflows/release.yml    builds installers when you push a tag
```

## Run locally

```
npm install
npm start
```

Build a Windows installer on your own machine: `npm run dist:win`. The files land in `dist/`.

## Release a new version

1. Bump `"version"` in `package.json`.
2. Commit, then tag and push:
   ```
   git tag v1.0.1
   git push origin main --tags
   ```
3. GitHub Actions builds Windows, Mac and Linux and attaches the files to a new Release.

The installers keep the same names on every release (`CharmLine-Setup.exe` and so on),
so the website's buttons always serve the newest version. You don't need to redeploy the site.

## Website (Netlify)

Live at **https://luckonaline.netlify.app**, deployed from `main`.

Netlify runs `node scripts/build-site.mjs` and publishes `website/`. The script copies `renderer/`
into `website/demo/`, so the page's live, swingable preview is the real app engine. It also
writes the collection list from the app's `COLLECTIONS`. Run the same command before previewing
the site locally, for example with `python -m http.server 8080` inside `website/`.

The charm pictures in `website/assets/charms/` are renders of the app's charms. After you add
or change a charm, render them again and commit the new images.

The embedded preview is `renderer/index.html?demo=1`. It takes `charms=id:ropeLength,...`,
`size=` and `rope=` in the URL, and accepts `postMessage` calls for `charms`, `rope`, `cap` and
`nudge`. In demo mode it never saves anything.

Download buttons use short links like `/download/windows`. `website/_redirects` forwards
each one to the matching file in the latest GitHub Release.

The GitHub repo must be **public**, or visitors will get a 404 when they download.
