# The app's icon

`icon.ico` and `icon.png` here are a **demo** icon (a pair of glasses). To use your own:

1. Replace **`build/icon.ico`**: a Windows icon holding 256x256 (it can also hold 16, 32, 48, 64, 128). It is the icon of `OptiPro.exe`,
   of the installer, of the uninstaller and of the shortcuts.
2. Replace **`build/icon.png`**: a square PNG, 512x512 or larger. It is the icon of the app's window.
3. Run `npm run dist`. The installer is made in `release/`.

Any image editor can export a PNG; to turn it into an `.ico`, use an online converter or a tool such as ImageMagick
(`magick icon.png -define icon:auto-resize=256,128,64,48,32,24,16 icon.ico`).

`npm run icon:demo` draws the demo icon again (scripts/make-demo-icon.mjs); it overwrites both files.
