# MFAnalyser — Indian Mutual Fund Analyser

A free, open-source mutual fund analysis portal built with React + Vite.
All data sourced from AMFI India via [mfapi.in](https://api.mfapi.in).

## Features
- 🔍 Search 10,000+ Indian mutual fund schemes
- 📈 Live NAV chart (YTD / 1Y / 3Y / 5Y / ALL)
- 📊 Trailing & Calendar Year Returns
- ⚖️ Risk Metrics (Sharpe, Sortino, Std Dev, Max Drawdown)
- 🏆 Best & Worst Periods (Week / Month / Quarter / Year)
- 🔄 Rolling Returns CAGR (1Y – 15Y)
- 🗓️ Monthly Returns Heatmap
- 🧮 SIP & Lumpsum Calculator
- 🌙 Dark / ☀️ Light theme toggle

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

## Deploy to Vercel

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → New Project
3. Import your GitHub repo
4. Framework: **Vite** (auto-detected)
5. Click **Deploy** — done!

## Build for Production

```bash
npm run build
# output is in /dist
```

## Tech Stack
- React 18
- Vite 5
- Pure inline styles (zero CSS dependencies)
- Data: [mfapi.in](https://api.mfapi.in) (free, no auth)

## Disclaimer
For informational purposes only. Not investment advice.
Past performance does not guarantee future results.
