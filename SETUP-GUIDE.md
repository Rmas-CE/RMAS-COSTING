# RMAS Costing: Setup Guide

Pareho ang ayos nito sa VS-REQUEST-FORM:
- **GitHub Pages** ang nagho-host ng website (`index.html`).
- **Apps Script** ng Google Sheet ang API at database.
- Bawat user ay may **personal link** na may access key (`?key=…`).

---

## Part A: Google Sheet + Apps Script

### 1. Buksan ang Apps Script ng sheet
1. Buksan ang RMAS Costing Google Sheet. Gamitin ang account na magiging may-ari, mas mabuti kung ang account ng RMAS Head. Sa account na ito manggagaling ang email at dito mase-save ang mga litrato.
2. I-click ang **Extensions → Apps Script**.

### 2. I-paste ang code
1. Buksan ang `apps-script/Code.gs` sa Notepad (right-click → **Open with → Notepad**). Pindutin ang **Ctrl+A**, tapos **Ctrl+C**.
2. Sa Apps Script, burahin ang laman ng **Code.gs**, i-paste ang kinopya, at pindutin ang **Ctrl+S**.
3. I-click ang **Project Settings** (gear icon) at i-check ang **Show "appsscript.json" manifest file in editor**.
4. Bumalik sa Editor, buksan ang `appsscript.json`, at palitan ang laman nito ng laman ng `apps-script/appsscript.json`. I-save.
5. **Opsyonal:** Sa itaas ng Code.gs, palitan ang `SITE_URL` kung iba ang GitHub Pages address ninyo.

### 3. I-run ang setup (isang beses lang)
1. Sa itaas, piliin ang **`setup`** at i-click ang **Run**.
2. I-click ang **Review permissions**, piliin ang account mo, tapos **Advanced → Go to … (unsafe) → Allow**. Normal ang "unsafe" para sa sariling script.
3. Sa **Execution log**, makikita ang "Setup done" at ang **link ng RMAS Head**.

Ang ginagawa ng setup:
- Gumagawa ito ng mga tab na **Receipts, Budgets, Team, Audit, Settings**.
- Gumagawa ito ng Drive folder na **RMAS Costing Receipts**.
- Inilalagay nito ang 7 users sa **Team** tab, bawat isa may sariling **Access key**.
- Nagse-set ito ng araw-araw na trigger nang 8:00 AM para sa approval email.

### 4. I-deploy bilang Web app
1. I-click ang **Deploy → New deployment**, at piliin ang **Web app** sa gear icon.
2. I-set ang:
   - **Execute as:** *Me*
   - **Who has access:** *Anyone*
3. I-click ang **Deploy** at kopyahin ang **Web app URL**. Nagtatapos ito sa `/exec`.

---

## Part B: GitHub

### 5. Ilagay ang Apps Script URL sa index.html
1. Buksan ang `index.html` sa Notepad at hanapin (Ctrl+F) ang `APPS_SCRIPT_URL`.
2. Palitan ang `''` ng URL mo, halimbawa:
   ```
   const APPS_SCRIPT_URL='https://script.google.com/macros/s/AKfy.../exec';
   ```
3. I-save.

### 6. Gumawa ng repo at i-upload
1. Sa GitHub, sa organization ninyo (halimbawa **rmas-ce**), i-click ang **New repository** at pangalanan itong **RMAS-COSTING**.
2. I-click ang **uploading an existing file**. I-drag ang laman ng `RMAS-COSTING` folder: ang `index.html`, `README.md`, `SETUP-GUIDE.md` at ang buong **apps-script** folder.
3. I-click ang **Commit changes**.

### 7. I-on ang GitHub Pages
1. Sa repo, pumunta sa **Settings → Pages**.
2. Sa **Source**, piliin ang **Deploy from a branch**, tapos **Branch: main**, **/ (root)**, at i-click ang **Save**.
3. Pagkalipas ng mga 1 minuto, bukas na ito sa `https://rmas-ce.github.io/RMAS-COSTING/`.

---

## Part C: Simulan

### 8. Buksan bilang RMAS Head
Gamitin ang link ng RMAS Head mula sa Step 3. Makikita rin ito sa **Team** tab ng sheet bilang `…/RMAS-COSTING/?key=ACCESS_KEY`.

### 9. Ilagay ang team at ipadala ang mga link
1. Pumunta sa **Team** page.
2. Ilagay ang pangalan, region at email ng bawat isa, at i-click ang **Save team**.
3. I-click ang **Copy link** sa bawat user at ipadala sa kanila, halimbawa sa Viber o email. Iyon ang link na gagamitin nila palagi.
4. Kung may nawalan ng link o umalis sa team, i-click ang **New key** para gumawa ng bagong link. Hindi na gagana ang luma.

### 10. Subukan
- **Upload:** Mag-upload ng isang resibo. Dapat itong lumabas sa **Receipts** tab at sa Drive folder.
- **Email:** Sa **Approval email**, i-click ang **Send a test email to me**.
- **Live update:** Buksan sa dalawang device. Lalabas sa kabila ang upload sa loob ng mga 15 segundo.

---

## Kapag may binago sa Code.gs
Pagkatapos i-edit, i-click ang **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. Pareho pa rin ang URL, kaya hindi na kailangang baguhin ang `index.html`.

## Kapag may binago sa index.html
I-upload ulit ang `index.html` sa GitHub (**Add file → Upload files**) at i-commit. Mag-a-update ang site pagkalipas ng mga 1 minuto.

## Paalala
- Huwag palitan ang pagkakasunod ng mga column sa mga tab ng sheet.
- Ang mga litrato ng resibo ay naka-share bilang **"anyone with the link can view"**. Kailangan ito para makita sa gallery. Mahaba at mahirap hulaan ang link, at sa loob lang ng app ito ipinapakita.
- Ang **RMAS Head** lang ang makakapag-save ng approved budget at makakapagpalit ng team.
- Huwag i-post sa publiko ang personal link. Para itong password.
