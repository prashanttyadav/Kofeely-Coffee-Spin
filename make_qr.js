#!/usr/bin/env node
// make_qr.js – Generate QR code (PNG + SVG) for the Kofeely Lucky Wheel URL
// Usage: node make_qr.js <public-url>
// Example: node make_qr.js https://kofeely.example.com

const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const url = process.argv[2];

if (!url) {
  console.error('Usage: node make_qr.js <public-url>');
  console.error('Example: node make_qr.js https://kofeely.example.com');
  process.exit(1);
}

// Validate that the URL looks reasonable
try {
  new URL(url);
} catch {
  console.error('Error: Invalid URL. Provide a full URL like https://kofeely.example.com');
  process.exit(1);
}

const pngPath = path.join(__dirname, 'qr.png');
const svgPath = path.join(__dirname, 'qr.svg');

async function generate() {
  try {
    // Generate PNG (high resolution)
    await QRCode.toFile(pngPath, url, {
      type: 'png',
      width: 1024,
      margin: 2,
      color: { dark: '#3E2723', light: '#FFF8F0' },
      errorCorrectionLevel: 'H'
    });
    console.log(`✅ PNG saved: ${pngPath}`);

    // Generate SVG
    const svgString = await QRCode.toString(url, {
      type: 'svg',
      margin: 2,
      color: { dark: '#3E2723', light: '#FFF8F0' },
      errorCorrectionLevel: 'H'
    });
    fs.writeFileSync(svgPath, svgString);
    console.log(`✅ SVG saved: ${svgPath}`);

    console.log(`\n🫘 QR code points to: ${url}`);
    console.log('   (The QR code does NOT contain the PIN – it links to the home page only.)');
  } catch (err) {
    console.error('Error generating QR code:', err.message);
    process.exit(1);
  }
}

generate();
