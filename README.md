# FlipLedger — Deploy Guide

## Step 1 — Deploy to Vercel (free, takes ~2 minutes)

1. Go to **github.com** and create a free account if you don't have one
2. Click **New repository** → name it `flipledger` → set to **Private** → click **Create**
3. Upload these files to the repo (drag & drop works):
   - `public/index.html`
   - `api/ebay.js`
   - `vercel.json`
   - `package.json`
4. Go to **vercel.com** → sign up free with your GitHub account
5. Click **Add New Project** → import your `flipledger` repo
6. Leave all settings as-is → click **Deploy**
7. Done! Vercel gives you a URL like `https://flipledger-abc123.vercel.app`

That URL is your app. Bookmark it — it's always live.

---

## Step 2 — Set up eBay API Sync (one-time, ~10 minutes)

### 2a. Create a free eBay Developer account

1. Go to **developer.ebay.com**
2. Sign in with your regular eBay seller account
3. Click **My Account** → **Application Access Keys**
4. Click **Create an App Key Set** → give it any name (e.g. "FlipLedger")
5. Select **Production** environment

### 2b. Get your User OAuth Token

1. In your app's key page, click **Get a Token from eBay via Your Application**
2. Sign in with your eBay seller account when prompted
3. Click **Accept** to grant access
4. Copy the **User Token** (it's a long string starting with `v^1.1#i^1...`)

### 2c. Use it in FlipLedger

1. Open your FlipLedger app (the Vercel URL)
2. Click **⟳ eBay** in the top bar
3. Click the **🔗 API Sync** tab
4. Paste your token in the box → set a date range → click **Sync**
5. Your orders will auto-import with title, price, fees, shipping, and date filled in

**Token lasts ~18 months.** When it expires, repeat step 2b.

---

## Notes

- **Your data** (sales, expenses, deposits, photos) is still stored in your browser's localStorage on whatever device you're using. The Vercel server only touches eBay — it never stores any of your data.
- **Photos** are stored as base64 in localStorage. If you use the app on a different browser or device, use **↓ Backup** to export and **↑ Import** to restore.
- **COGS** (your product cost) will always be blank on imported orders since eBay doesn't know what you paid. Fill those in using the edit button (✎) in Sale History.
- The CSV Import tab works without any of this setup — you can always use that as a fallback.
