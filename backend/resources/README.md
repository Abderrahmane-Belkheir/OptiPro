# resources

Drop the website's production build here as a `dist/` folder and the server serves it
automatically — nothing else to configure.

```bash
cd ../website
npm run build        # outputs to website/dist
cp -r dist ../backend/resources/dist
```

Resulting layout: `resources/dist/index.html`, `resources/dist/assets/...`, etc.

This directory is intentionally empty for now (no `dist/` yet). This file is the only thing
tracked by git here so the (otherwise empty) folder still exists after a clone — `dist/` itself
should stay untracked (see `.gitignore`).
