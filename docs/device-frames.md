# Pictures for the READMEs

`tools/device-frames/make.mjs` puts screenshots inside drawn devices and writes one picture. The devices (phones, a folding phone, three laptops, two browser windows) are drawn in HTML and CSS by the script, so nothing is downloaded and no maker's artwork is used.

```
PLAYWRIGHT=<path to playwright's index.js> CHROMIUM=/usr/bin/chromium \
  node tools/device-frames/make.mjs tools/device-frames/specs/oldenbyte.json
```

Without the two variables it uses the `playwright` package and its own browser.

A spec is `{ out, gap, pad, background, items }`, with paths relative to the spec. Each item has a `frame` (`iphone`, `android`, `fold`, `macbook`, `thinkpad`, `surface`, `chrome`, `firefox`), an `image` and a `height` in pixels (the body of a phone, the screen of a laptop, the page of a browser). A laptop takes `os` (`mac`, `linux`, `windows`) to show the picture as an app's window with that system's title strip. A browser takes `icon` and, to show the extension's popup, `popup` and `popupWidth`.

The specs in `tools/device-frames/specs` make the pictures of this repository and of the app repositories checked out beside it (`oldenbyte-mobile`, `oldenbyte-desktop`, `oldenbyte-extension`). The screenshots they use are in `tools/device-frames/shots`:

- `desktop.png`, `fold.png`: the website in a browser, at a laptop's size and at an unfolded phone's width.
- `android.png`, `iphone.png`: the phone app with a server, on an Android emulator and in the iPhone Simulator.
- `popup.png`: the extension's popup page with sample values filled in.

All of them show the first-run dashboard of a development server, which holds nobody's data. Check any new screenshot for private details before it goes in.
