# DC Automation — Raspberry Pi Install & Setup Guide

This guide walks you through installing and running **DC Automation** on a Raspberry Pi (Raspberry Pi OS).

After login, open **Home** (`/`) to choose **Testing** or **Locations**; the API stays at `/api`.

**Production URL:** This guide assumes you want the app at **http://\<raspberry-pi-ip\>/** (site root on port 80). The Node process listens on **port 3000**; **Caddy 2** on port 80 reverse-proxies to it (nginx is optional). For a subpath (e.g. `/dc-automation`) or multiple apps on one Pi, see [Optional: path-based URL or multiple apps](#optional-path-based-url-or-multiple-apps).

**Already installed?** See **[Upgrade Instructions](UPGRADE.md)** to update to a newer version.

## Prerequisites

- Raspberry Pi 3, 4, or 5 (recommended: Pi 4 with 2GB+ RAM)
- Raspberry Pi OS (64-bit recommended)
- Network connection
- SSH or direct terminal access

---

## Step 1: Update the System

```bash
sudo apt update
sudo apt upgrade -y
```

---

## Step 2: Install Node.js 18+

### Option A: NodeSource (recommended)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # Should show v20.x.x
npm -v
```

### Option B: Node Version Manager (nvm)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
node -v
```

---

## Step 3: Install Build Tools (if needed)

Required to compile **better-sqlite3** (native SQLite bindings):

```bash
sudo apt install -y build-essential python3
```

---

## Step 4: Clone or Copy the Project

### From Git

```bash
cd ~
git clone <your-repo-url> dc-automation
cd dc-automation
```

### From Another Machine (SCP/rsync)

On your development machine:

```bash
rsync -avz --exclude node_modules --exclude dc_automation.db ./dc-automation/ pi@<pi-ip>:~/dc-automation/
```

Or use SCP, USB drive, or another transfer method.

---

## Step 5: Install Dependencies & Build

**Site root (`http://\<pi-ip\>/`):** use the default build (no base path):

```bash
npm run build
```

**Subpath only** (e.g. `http://\<pi-ip\>/dc-automation`): set the client base when building, e.g. `VITE_BASE_PATH=/dc-automation npm run build`, and see [Optional: path-based URL or multiple apps](#optional-path-based-url-or-multiple-apps).

### Option A: Build on the Pi

You need full dependencies (including Vite) to build:

```bash
cd ~/dc-automation
npm install
npm run build
```

### Option B: Build on Your Dev Machine, Copy to Pi (recommended for low-memory Pi)

On your development machine:

```bash
npm install
npm run build
```

Then copy the project to the Pi (including the `dist` folder). On the Pi:

```bash
cd ~/dc-automation
npm install --omit=dev
```

This skips dev dependencies since `dist` is already built.

---

## Step 6: Verify Build

Ensure these exist:

- `dist/client/` — static frontend (HTML, JS, CSS)
- `dist/server/` — backend server

---

## Step 7: Install PM2 (Process Manager)

```bash
sudo npm install -g pm2
```

PM2 keeps the app running, restarts it on crash, and can start it on boot.

---

## Step 8: Start the Application

For **http://\<pi-ip\>/** (root), leave **`BASE_PATH` unset** (commented out) in `ecosystem.config.cjs` — only set `BASE_PATH` when the Node app must see a subpath; see the optional section below.

```bash
cd ~/dc-automation
pm2 start ecosystem.config.cjs
```

Check status:

```bash
pm2 status
pm2 logs dc-automation
```

---

## Step 9: Enable Auto-Start on Boot

```bash
pm2 startup
```

Follow the command it prints (usually involves `sudo env PATH=...`). Then save the current process list:

```bash
pm2 save
```

The app will now start automatically after a reboot.

---

## Step 10: Access the App

- **Default login:** `admin` / `admin`
- **Direct to Node (testing):** http://\<raspberry-pi-ip\>:3000
- **Production (recommended):** http://\<raspberry-pi-ip\>/ — put **Caddy 2** (or nginx) on port 80 and proxy to Node on 3000; see [Serve at http://\<pi-ip\>/ on port 80](#serve-at-httppi-ip-on-port-80-recommended) below.

**Change the app port** (optional): Edit `ecosystem.config.cjs` and set `PORT` in the `env` section (e.g. `8080`). For port **80** without a proxy, see [Optional: run directly on port 80](#optional-run-directly-on-port-80-single-app-only).

---

## Serve at http://\<pi-ip\>/ on port 80 (recommended)

Use **Caddy 2** (or nginx) on port 80 to forward all paths to the Node app on **127.0.0.1:3000**. The app is built **without** `VITE_BASE_PATH`; do **not** set `BASE_PATH` in PM2.

**1. Build** (default — site root):

```bash
npm run build
```

**2. PM2** is already running the app on port 3000 (`ecosystem.config.cjs`).

**3. Install Caddy 2**

On Raspberry Pi OS / Debian, use the [official Caddy package](https://caddyserver.com/docs/install#debian-ubuntu-raspbian) (recommended — current **Caddy 2**):

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

Confirm the binary is v2: `caddy version`.

If port 80 is already used (e.g. by nginx), stop the other service before continuing: `sudo systemctl disable --now nginx` (only if you are switching to Caddy).

**4. Configure the Caddyfile**

Edit **`/etc/caddy/Caddyfile`**. For access **only by IP** over HTTP (no TLS), use the **`http://`** scheme so Caddy does **not** try to obtain certificates for a bare IP:

```caddyfile
http://:80 {
	reverse_proxy 127.0.0.1:3000
}
```

Tabs or spaces are fine. This listens on **:80** on all interfaces and proxies `/`, `/assets/…`, `/api/…`, etc. to Node.

**Later, with a real DNS name:** you can replace the first line with your hostname (e.g. `automation.example.com {`) and let Caddy obtain HTTPS automatically; keep `reverse_proxy` as above. See [Automatic HTTPS](https://caddyserver.com/docs/automatic-https) in the Caddy docs.

Validate and apply:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
# or: sudo systemctl restart caddy
```

Check status: `sudo systemctl status caddy` — it should be **active (running)**.

**5. Firewall:** allow HTTP if you use `ufw`:

```bash
sudo ufw allow 80
```

**Access:** **http://\<raspberry-pi-ip\>/**

### Alternative: nginx

If you prefer nginx instead of Caddy, install it and use a minimal server block:

```bash
sudo apt install nginx
```

`/etc/nginx/sites-available/default` (or your vhost):

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Then: `sudo nginx -t && sudo systemctl reload nginx`.

---

## Optional: path-based URL or multiple apps

Use this when the app must live under a **subpath** (e.g. **http://\<pi-ip\>/dc-automation**) or you run **several apps** on one Pi.

### Caddy 2: strip path (recommended for Caddy users)

[`handle_path`](https://caddyserver.com/docs/caddyfile/directives/handle_path) strips the prefix before proxying so Node still sees `/`, `/assets/…`, `/api/…`.

**1. Build with base path:**

```bash
VITE_BASE_PATH=/dc-automation npm run build
```

**2. Do not set `BASE_PATH`** in `ecosystem.config.cjs` (leave it commented).

**3. Caddyfile** (HTTP only by IP — same idea as [site root](#serve-at-httppi-ip-on-port-80-recommended)):

```caddyfile
http://:80 {
	redir /dc-automation /dc-automation/
	handle_path /dc-automation/* {
		reverse_proxy 127.0.0.1:3000
	}
}
```

Then:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

**Access:** http://\<pi-ip\>/dc-automation/

**Add more apps:** Add another `handle_path /other-app/* { reverse_proxy 127.0.0.1:PORT }` block (or a different `handle` + `reverse_proxy` on another port).

### nginx: strip path (same behaviour)

**1–2.** Same build and PM2 as above.

**3. Configure nginx** with rewrites so the backend sees root paths:

```bash
sudo apt install nginx
```

```nginx
location /dc-automation/ {
    rewrite ^/dc-automation/?(.*)$ /$1 break;
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
location = /dc-automation {
    rewrite ^ / break;
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

`sudo nginx -t && sudo systemctl reload nginx`

### Alternative: proxy without rewrite (Node uses BASE_PATH)

Set `BASE_PATH: '/dc-automation'` in `ecosystem.config.cjs` and proxy the prefix without stripping. This can be fragile; **strip-path** (Caddy `handle_path` or nginx rewrite) is usually easier.

**Caddy 2** (example — tune matchers if your app expects every request under `/dc-automation`):

```caddyfile
http://:80 {
	handle /dc-automation* {
		reverse_proxy 127.0.0.1:3000
	}
}
```

**nginx:**

```nginx
location /dc-automation {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### Landing page at / with app under a subpath

If **http://\<pi-ip\>/** must show a static landing page and DC Automation stays under **/dc-automation/**:

**Caddy 2** — copy **`landing/`** to e.g. `/var/www/landing` (so `/var/www/landing/index.html` exists). Example:

```caddyfile
http://:80 {
	redir /dc-automation /dc-automation/
	handle_path /dc-automation/* {
		reverse_proxy 127.0.0.1:3000
	}
	handle {
		root * /var/www/landing
		file_server
	}
}
```

`handle_path` runs first for the app; the final `handle` serves the landing files at `/`. Validate/reload Caddy. Edit `landing/index.html` to link to `/dc-automation/`.

**nginx** — use `root` / `try_files` for `/` and the same `location /dc-automation/` rewrite + `proxy_pass` pattern as in the nginx strip-path section above.

---

## Useful PM2 Commands

| Command | Description |
|--------|-------------|
| `pm2 status` | List running apps |
| `pm2 logs dc-automation` | View logs |
| `pm2 restart dc-automation` | Restart app |
| `pm2 stop dc-automation` | Stop app |
| `pm2 delete dc-automation` | Remove from PM2 |

---

## Database Location

The SQLite database is stored at:

```
~/dc-automation/dc_automation.db
```

Back it up regularly:

```bash
cp ~/dc-automation/dc_automation.db ~/dc-automation/dc_automation.db.backup
```

---

## Deployment Checklist

- [ ] Raspberry Pi OS updated
- [ ] Node.js 18+ installed
- [ ] Project copied to Pi
- [ ] `npm install` run (full install if building on Pi)
- [ ] `npm run build` completed (default for **http://\<pi-ip\>/**; use `VITE_BASE_PATH=...` only if deploying under a subpath)
- [ ] PM2 installed globally
- [ ] `pm2 start ecosystem.config.cjs` run (`BASE_PATH` only if needed — see [optional path section](#optional-path-based-url-or-multiple-apps))
- [ ] **Caddy 2** (or nginx) on port 80 proxying to Node :3000 for production URL **http://\<pi-ip\>/**
- [ ] `pm2 startup` and `pm2 save` executed
- [ ] App accessible at **http://\<pi-ip\>/** (or http://\<pi-ip\>:3000 if testing without a proxy)

---

## Troubleshooting

### Source map error (installHook.js.map 404)

This comes from the **React DevTools** browser extension, not the app. It’s harmless and doesn’t affect behavior. To hide it:

- Disable the React DevTools extension for this site, or
- Ignore it — the app works normally.

### Port already in use

```bash
sudo lsof -i :3000
# Kill the process or change PORT in ecosystem.config.cjs
```

When using Caddy or nginx, the app still listens on port 3000; the proxy listens on 80.

**Port 80 busy:** Only one service can bind to port 80. If Caddy fails to start, check `sudo journalctl -u caddy -e` and whether nginx (or another web server) is already using 80 — e.g. `sudo systemctl disable --now nginx` if you switched to Caddy.

### Out of memory

Reduce Node memory or add swap:

```bash
sudo dphys-swapfile swapoff
sudo nano /etc/dphys-swapfile  # Set CONF_SWAPSIZE=1024
sudo dphys-swapfile setup
sudo dphys-swapfile swapon
```

### Build fails (out of memory)

Build on your development machine, then copy the `dist` folder and `package.json` to the Pi. Run only `npm install --omit=dev` on the Pi.

### Cannot connect from other devices

**1. Allow the port in the firewall**

If ufw is not installed:

```bash
sudo apt install ufw
```

Then allow the port the app uses: `sudo ufw allow 3000` (direct access), or if using a reverse proxy on port 80: `sudo ufw allow 80`. Then run `sudo ufw status`.

**2. Ensure the server binds to all interfaces**

The app listens on `0.0.0.0` by default (all network interfaces). If you changed this, revert to `0.0.0.0`.

**3. Find the Pi's IP address**

```bash
hostname -I
```

Use that IP from another device: **http://192.168.1.xxx/** if Caddy (or nginx) proxies port 80 to Node, or `http://192.168.1.xxx:3000` for direct access.

**4. Same network**

Both devices must be on the same LAN (same Wi‑Fi or wired network).

**5. No firewall (Raspberry Pi OS default)**

Raspberry Pi OS often has no firewall by default. If `ufw` is not installed and you still can't connect, the issue may be:

- Wrong IP address — run `hostname -I` and use that IP
- Different network — ensure both devices are on the same Wi‑Fi/LAN
- Router isolation — some routers block device-to-device traffic (guest networks, AP isolation)

**6. Disable firewall temporarily to test** (if ufw is installed)

```bash
sudo ufw disable
# Try connecting from other PC
# If it works, re-enable and add the rule: sudo ufw allow 3000 && sudo ufw enable
# (or sudo ufw allow 80 if using a reverse proxy)
```

---

## Optional: Run directly on port 80 (single app only)

To bind Node to port **80** without Caddy/nginx (one app per Pi; serves at **http://\<pi-ip\>/**):

```bash
sudo setcap 'cap_net_bind_service=+ep' $(which node)
```

Then set `PORT: 80` in `ecosystem.config.cjs` and restart:

```bash
pm2 restart dc-automation
```

For **multiple apps** on port 80, use a [reverse proxy](#serve-at-httppi-ip-on-port-80-recommended) with separate backends instead.
