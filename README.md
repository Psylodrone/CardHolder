# Kardo

A simple Progressive Web App (PWA) for storing loyalty/rewards cards on your phone — scan a barcode or QR code once, then pull it back up at checkout.

## Features

- Scan barcodes/QR codes using your phone's camera
- Save cards locally (data stays in the browser, nothing sent to a server)
- View a large, scannable barcode/QR for each saved card
- Installable to your iPhone home screen (Add to Home Screen in Safari)

## Running locally

Any static file server works, e.g.:

```sh
npx serve .
```

Note: camera access (`getUserMedia`) requires a secure context (HTTPS or `localhost`). When testing from an iPhone over Wi-Fi, use the hosted GitHub Pages URL instead of a local `http://` address.

## Tech

- Plain HTML/CSS/JS, no build step
- [html5-qrcode](https://github.com/mebjas/html5-qrcode) for camera scanning
- [JsBarcode](https://github.com/lindell/JsBarcode) and [qrcode](https://github.com/soldair/node-qrcode) for rendering saved codes
- Service worker for offline app shell caching
