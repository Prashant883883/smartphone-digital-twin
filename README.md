# Smartphone Digital Twin demo

A static browser demo for a classroom activity. It uses:
- Device Orientation events to rotate a Three.js 3D phone model.
- Device Motion events to display acceleration values when available.
- A calibration button that saves the current orientation as the visual reference position.

## Run locally

Because `app.js` imports Three.js as an ES module, serve this folder over HTTP rather than opening `index.html` directly.

For example, with Python installed:

```bash
cd smartphone-digital-twin
python3 -m http.server 8000
```

Then open `http://localhost:8000` on your computer. For phone testing, the hosted page must use HTTPS. A phone cannot access your computer's `localhost` unless you use your computer's LAN IP and an appropriate secure context; easiest is to deploy to GitHub Pages for the classroom test.

## Important browser notes

- iPhone Safari requires a user gesture and permission for motion/orientation access.
- Browser support and sensor availability vary by device and browser.
- The 3D orientation mapping is a visual demonstration, not a precision industrial measurement system.
- The calibration button stores the current orientation as a reference offset. It does not perform laboratory-grade sensor calibration or remove physical sensor bias/noise.
- Acceleration values may be unavailable or differ by browser/device. The page displays `—` when readings are not supplied.
