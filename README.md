# Browser Extensions & Productivity Tools Collection

A curated collection of browser extensions and standalone web tools designed to enhance productivity, simplify content translation, scrape manga, bypass copy restrictions, and download media seamlessly.

---

## 📁 Repository Structure & Projects

This repository contains the following tools:

### 1. 🚀 UniDownloader (Video Downloader Desktop App)
* **Directory:** `VideoDowloader/`
* **Type:** Standalone Desktop Web App (Chrome App Mode + Node.js backend)
* **Features:**
  * High-speed video downloading from **YouTube**, **TikTok (No Watermark)**, and **Facebook**.
  * Dynamic format switching (MP4 Video / MP3 Audio).
  * Quality selection (Best, 1080p, 720p, 480p) for YouTube.
  * Real-time download progress bar powered by Server-Sent Events (SSE).
  * **Auto-Shutdown**: Backend automatically closes 8 seconds after you close the app window to conserve PC resources.
  * Completely silent background launching (no terminal windows).

### 2. 📖 NovelCopy
* **Directory:** `NovelCopy/`
* **Type:** Chrome Extension (Manifest V3)
* **Features:** Bypasses copy-protection and text-selection restrictions on novel reading websites.

### 3. 🌐 NovelTrans
* **Directory:** `NovelTrans/`
* **Type:** Chrome Extension (Manifest V3)
* **Features:** Instantly translates web novels with custom settings and translation APIs.

### 4. 🎨 MangaTrans
* **Directory:** `MangaTrans/`
* **Type:** Chrome Extension (Manifest V3)
* **Features:** Helps in translating manga scans/images on web pages.

### 5. 📥 GetManga
* **Directory:** `GetManga/`
* **Type:** Chrome Extension (Manifest V3)
* **Features:** Scrapes, bundles, and downloads manga chapters as image packs.

---

## 🛠️ How to Install and Run

### A. General Chrome Extensions (NovelCopy, NovelTrans, MangaTrans, GetManga)
To load any of the extensions into your Chrome browser:
1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (toggle switch in the top-right corner).
3. Click the **Load unpacked** button in the top-left corner.
4. Select the specific folder of the extension (e.g., `NovelCopy/` or `GetManga/`).

---

### B. Setup UniDownloader Desktop App (Windows)
No Chrome extension is required for this version. It runs as a lightweight native desktop app.

#### First-time Setup:
1. Make sure you have [Node.js](https://nodejs.org/) installed (v16.0.0+ recommended).
2. Open terminal in the backend directory and install dependencies:
   ```bash
   cd VideoDowloader/backend
   npm install
   ```
3. Run the setup once to automatically download the latest stable `yt-dlp` executable:
   ```bash
   npm run setup
   ```

#### How to Launch:
* Simply double-click the **UniDownloader** shortcut created on your Windows Desktop (or pin it to your Taskbar).
* The app runs completely silently in the background and opens the UI in Chrome App Mode.
* When you close the app window, the background process terminates itself after 8 seconds.

---

## 💻 Tech Stack
* **Frontend:** Vanilla HTML5, CSS3 (Glassmorphism & Neon Dark Mode), ES6+ JavaScript.
* **Backend:** Node.js, Express.js, Server-Sent Events (SSE).
* **CLI Integrations:** `yt-dlp`, `ffmpeg` (via `ffmpeg-static`).
* **Automation:** Windows VBScript & PowerShell.

---

## 📄 License
This collection is private and developed for personal productivity. Feel free to customize it!
