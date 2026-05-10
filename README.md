# ⚡ NutriPulse — Calorie Tracking PWA

A fully responsive, installable Progressive Web App for tracking daily calorie intake and weight progress.

---

## 🚀 Features

### Core
- **Personalized calorie goal** using Mifflin-St Jeor BMR + TDEE formula
- **Meal logging** — Breakfast, Lunch, Dinner, Snacks
- **Built-in food database** with 30+ common foods + custom entry
- **Visual calorie ring** with progress indicator
- **Dark/Light mode** toggle

### PWA
- ✅ Installable on mobile & desktop via Web App Manifest
- ✅ Offline support with Service Worker (Cache-first strategy)
- ✅ Push notifications (meal reminders)
- ✅ App-like fullscreen experience

### Analytics
- 7-day calorie intake chart (Chart.js)
- Weight history chart
- Day streak counter
- Per-meal weekly averages
- Weight progress bar toward goal

---

## 🧮 Calorie Calculation

Uses the **Mifflin-St Jeor** equation:

```
Men:   BMR = 10×weight(kg) + 6.25×height(cm) − 5×age + 5
Women: BMR = 10×weight(kg) + 6.25×height(cm) − 5×age − 161
TDEE   = BMR × Activity Multiplier
Goal:  Lose: TDEE − 500 | Maintain: TDEE | Gain: TDEE + 300
```

---

## 📁 File Structure

```
calorie-pwa/
├── index.html       # App shell + all pages
├── style.css        # Full CSS (dark/light, animations)
├── app.js           # App logic + state management
├── sw.js            # Service Worker (offline + push)
├── manifest.json    # PWA manifest
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
└── README.md
```

---

## 🛠 Setup & Deployment

### Local Development
```bash
# Using Python
python3 -m http.server 8080

# Using Node.js
npx serve .

# Using VS Code Live Server
# Install Live Server extension, right-click index.html → Open with Live Server
```

> ⚠️ **Service Workers require HTTPS or localhost**

### Deploy to Production (Free options)

**Netlify** (drag & drop):
1. Go to [netlify.com](https://netlify.com)
2. Drag the `calorie-pwa/` folder onto the dashboard
3. Done — HTTPS auto-configured ✅

**GitHub Pages**:
```bash
git init
git add .
git commit -m "NutriPulse PWA"
gh repo create nutripulse --public --push --source=.
# Enable Pages in repo Settings → Pages → Deploy from main branch
```

**Vercel**:
```bash
npx vercel --prod
```

---

## 🔔 Firebase Cloud Messaging (Push Notifications)

To enable full server-sent push notifications:

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable Cloud Messaging
3. Add your `firebaseConfig` to `app.js`:
```javascript
import { initializeApp } from 'firebase/app';
import { getMessaging, getToken } from 'firebase/messaging';

const app = initializeApp(firebaseConfig);
const messaging = getMessaging(app);
getToken(messaging, { vapidKey: 'YOUR_VAPID_KEY' });
```
4. Update `sw.js` to use Firebase SW:
```javascript
importScripts('https://www.gstatic.com/firebasejs/10.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.0.0/firebase-messaging-compat.js');
```

---

## 🍽 Food Database Expansion

The built-in DB has 30 foods. To expand:
- Integrate **Open Food Facts API** (free): `https://world.openfoodfacts.org/api/v0/product/{barcode}.json`
- Integrate **Nutritionix API** for restaurant/branded foods
- Add barcode scanning via `@zxing/library` for JS

---

## 🏗 Tech Stack

| Layer | Tech |
|-------|------|
| UI | Vanilla HTML/CSS/JS |
| Fonts | Syne (headings) + DM Sans (body) |
| Charts | Chart.js 4.4 |
| Storage | localStorage |
| PWA | Service Worker + Web App Manifest |
| Notifications | Web Notifications API + FCM-ready |
| Offline | Cache-first SW strategy |

---

## 📱 Install on Mobile

1. Open the app URL in **Chrome** (Android) or **Safari** (iOS)
2. Android: Tap **"Add to Home Screen"** in the browser menu, or accept the install banner
3. iOS: Tap the **Share** button → **"Add to Home Screen"**

---

## 🔮 Roadmap / Bonus Features

- [ ] Firebase Auth (multi-device sync)
- [ ] Barcode scanner integration
- [ ] Open Food Facts API integration
- [ ] Exercise logging + calories burned
- [ ] Water intake tracker
- [ ] Macro tracking (protein/carbs/fat)
- [ ] Export data as CSV

---

## 📄 License
MIT — Free to use and modify.
