# Finance dashboard

A private spending dashboard that runs entirely in your browser. You upload your bank and card exports; they are read on your device, encrypted with your password and stored in this browser only. Nothing is sent to any server, including GitHub.

## Deploy on GitHub Pages

1. Open the repository (rms2013v/FinanceTracker) on github.com.
2. Click **Add file → Upload files**, drag in everything from this folder (keep the `js` and `vendor` folders), and commit to `main`.
3. Go to **Settings → Pages**. Under "Build and deployment" choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and save.
4. After a minute the site is live at `https://rms2013v.github.io/FinanceTracker/`.

## First use

1. Open the site, enter the username `oleh` and set your password (at least 10 characters). On each new browser or device you set it again, or restore a backup there.
2. Click **Upload files** and add your exports:
   Wealthsimple credit card CSV, Wealthsimple chequing CSV, Amex Aeroplan `activity.xlsx`, Amex Delta SkyMiles `activity.xlsx` (USD, converted to CAD), RBC `download-transactions.csv`, or a small CSV of extra card transactions with Date, Description, Amount columns.
3. For Amex files, check the **Card** selector says the right card before adding.
4. Add your salary in the Budget section and mark it received when it lands.

Uploading a newer export of the same account replaces that account's data for the dates the file covers, so uploading the same file twice never double counts.

## Reading other files with AI

Files the dashboard doesn't recognise (another card's export, a different layout) get a **Read with AI** button in the upload window.

1. Get an API key at console.anthropic.com → API keys (this is billed separately from a Claude subscription; a file usually costs a few cents).
2. Paste it in **Menu → Settings → Reading files with AI** and save. It is stored inside your encrypted data, never in the code.
3. Upload the file and click **Read with AI**. Check the preview and the card name, then add it.

Only the first 30 rows of the file and its merchant names go to Claude. Claude describes the columns and sorts merchants into categories; every row is read in your browser. The layout and merchants are remembered, so the next file of the same kind is read with no AI call. AI reading covers credit card activity; other bank account statements aren't supported yet.

## Important

There is no password reset. If you forget it, the data in the browser can't be opened. Use **Menu → Download backup** after each upload. The backup is encrypted with the same password and lets you move your data to another computer or browser (**Menu → Restore a backup**).

Data lives in one browser on one device. Clearing site data in the browser erases it, so keep a backup.

The page locks itself after 15 minutes without activity.

## Privacy note for a public repo

GitHub Pages on a free account needs a public repository. The code holds no transactions, but `js/rules.js` contains the text used to recognise your housing payments (landlord and building names, the rent cheque amounts and the condo mortgage amount). If you'd rather not publish those, edit them to something generic before uploading; the Housing section will then group less precisely.

## Changing how things are categorised

Edit `js/rules.js`: category rules for each card, the housing rules, the $500 one-off threshold and the default USD to CAD rate.

## Libraries

`vendor/d3.min.js` (d3 v7) and `vendor/xlsx.full.min.js` (SheetJS 0.18.5) are included so the site works offline and needs no outside scripts. SheetJS 0.18.5 has a known issue with crafted malicious spreadsheets; since you only open your own bank exports this is low risk, but you can swap in 0.20.3 from https://cdn.sheetjs.com if you want the latest.
