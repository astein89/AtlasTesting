# Automation Testing — Raspberry Pi Install & Setup Guide

This guide walks you through installing and running Automation Testing on a Raspberry Pi (Raspberry Pi OS).

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

Required for native modules (e.g. `better-sqlite3` if you switch from sql.js):

```bash
sudo apt install -y build-essential python3
```

---

## Step 4: Clone or Copy the Project

### From Git

```bash
cd ~
git clone <your-repo-url> automation-testing
cd automation-testing
```

### From Another Machine (SCP/rsync)

On your development machine:

```bash
rsync -avz --exclude node_modules --exclude atlas.db ./automation-testing/ pi@<pi-ip>:~/automation-testing/
```

Or use SCP, USB drive, or another transfer method.

---

## Step 5: Install Dependencies & Build

If you will serve the app at a path (e.g. under a reverse proxy at `/automation-testing`), set the base path when building: `VITE_BASE_PATH=/automation-testing npm run build` (see [Serving on port 80 with a reverse proxy](#serving-on-port-80-with-a-reverse-proxy-multiple-apps) below).

### Option A: Build on the Pi

You need full dependencies (including Vite) to build:

```bash
cd ~/automation-testing
npm install
npm run build
```

For path-based deployment (e.g. at `/automation-testing`), run: `VITE_BASE_PATH=/automation-testing npm run build` instead.

### Option B: Build on Your Dev Machine, Copy to Pi (recommended for low-memory Pi)

On your development machine:

```bash
npm install
npm run build
```

For path-based deployment, run: `VITE_BASE_PATH=/automation-testing npm run build` instead.

Then copy the project to the Pi (including the `dist` folder). On the Pi:

```bash
cd ~/automation-testing
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

When using a base path (e.g. behind a reverse proxy at `/automation-testing`), set `BASE_PATH` in `ecosystem.config.cjs` in the `env` section, e.g. `BASE_PATH: '/automation-testing'`. See [Serving on port 80 with a reverse proxy](#serving-on-port-80-with-a-reverse-proxy-multiple-apps) below.

```bash
cd ~/automation-testing
pm2 start ecosystem.config.cjs
```

Check status:

```bash
pm2 status
pm2 logs automation-testing
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

- **Default:** http://\<raspberry-pi-ip\>:3000
- **Default login:** `admin` / `admin`

**Port 80 with multiple apps:** To serve on port 80 at a path (e.g. http://\<pi-ip\>/automation-testing) alongside other apps, see [Serving on port 80 with a reverse proxy](#serving-on-port-80-with-a-reverse-proxy-multiple-apps) below.

**Change the port** (optional): Edit `ecosystem.config.cjs` and set `PORT` in the `env` section (e.g. 80, 8080). For multiple apps on port 80, use the reverse proxy approach instead.

---

## Serving on port 80 with a reverse proxy (multiple apps)

To access the app at **http://\<pi-ip\>/automation-testing** (port 80, no `:3000`) and host other apps the same way, use a reverse proxy on port 80.

### Recommended: nginx strips the path (no BASE_PATH)

The app runs at the **root** (no `BASE_PATH`). Nginx rewrites `/automation-testing/...` to `/...` before proxying, so the Node app receives `/`, `/assets/...`, `/api/...` and serves them normally.

**1. Build with base path** (so the client requests `/automation-testing/...` in the browser):

```bash
VITE_BASE_PATH=/automation-testing npm run build
```

**2. Do not set BASE_PATH** in `ecosystem.config.cjs`. Leave only `NODE_ENV` and `PORT` in the `env` section (comment out or remove `BASE_PATH`).

**3. Configure nginx** to strip `/automation-testing` and proxy:

```bash
sudo apt install nginx
```

Edit `/etc/nginx/sites-available/default` (or your site config). Use a **rewrite** so the backend sees paths at root:

```nginx
location /automation-testing/ {
    rewrite ^/automation-testing/?(.*)$ /$1 break;
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
location = /automation-testing {
    rewrite ^ / break;
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Reload nginx: `sudo nginx -t && sudo systemctl reload nginx`.

**Access:** http://\<pi-ip\>/automation-testing — the app and assets load correctly because nginx sends `/`, `/assets/...`, `/api/...` to Node.

**Add more apps:** Add similar `location` blocks for other paths (e.g. `/other-app/`) with rewrite and their own backend port.

### Alternative: proxy without rewrite (Node uses BASE_PATH)

If you prefer the Node app to handle the full path, set `BASE_PATH: '/automation-testing'` in `ecosystem.config.cjs` and use a simple proxy (no rewrite). This can be fragile depending on how the request path is seen by Node; the nginx-rewrite approach above is more reliable.

```nginx
location /automation-testing {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### Caddy (with path strip)

With Caddy you can strip the path before proxying so the app sees root paths. Example (strip prefix and proxy):

```
handle_path /automation-testing/* {
    reverse_proxy 127.0.0.1:3000
}
```

Reload Caddy. Use the same build and no `BASE_PATH` as in the nginx section. Access at http://\<pi-ip\>/automation-testing.

### Landing page at root (links to all apps)

The repo includes a simple landing page at **`landing/index.html`** that you can serve at **http://\<pi-ip\>/** with links to Automation Testing and other apps.

**1. Copy the landing folder to the Pi** (e.g. next to your app or under `/var/www`):

```bash
# On the Pi, create a directory and copy the landing page
mkdir -p /var/www/landing
# Copy landing/index.html from the project into /var/www/landing/
```

Or from your dev machine: `scp -r landing pi@<pi-ip>:/var/www/landing`

**2. Configure nginx** so the default server root serves the landing page, and keep your app under `/automation-testing/`:

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;

    root /var/www/landing;
    index index.html;

    # Landing page at /
    location = / {
        try_files /index.html =404;
    }

    # Redirect /at to /automation-testing/
    location = /at { return 301 /automation-testing/; }
    location = /at/ { return 301 /automation-testing/; }

    # Automation Testing app
    location /automation-testing/ {
        rewrite ^/automation-testing/?(.*)$ /$1 break;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Add more location blocks for other apps...
}
```

Reload nginx: `sudo nginx -t && sudo systemctl reload nginx`. Then **http://\<pi-ip\>/** shows the landing page with links; edit `landing/index.html` to add or change app links.

---

## Useful PM2 Commands

| Command | Description |
|--------|-------------|
| `pm2 status` | List running apps |
| `pm2 logs automation-testing` | View logs |
| `pm2 restart automation-testing` | Restart app |
| `pm2 stop automation-testing` | Stop app |
| `pm2 delete automation-testing` | Remove from PM2 |

---

## Database Location

The SQLite database is stored at:

```
~/automation-testing/atlas.db
```

Back it up regularly:

```bash
cp ~/automation-testing/atlas.db ~/automation-testing/atlas.db.backup
```

---

## Deployment Checklist

- [ ] Raspberry Pi OS updated
- [ ] Node.js 18+ installed
- [ ] Project copied to Pi
- [ ] `npm install` run (full install if building on Pi)
- [ ] `npm run build` completed (use `VITE_BASE_PATH=/automation-testing npm run build` if using reverse proxy at a path)
- [ ] PM2 installed globally
- [ ] `pm2 start ecosystem.config.cjs` run (set `BASE_PATH` in ecosystem if using reverse proxy)
- [ ] `pm2 startup` and `pm2 save` executed
- [ ] App accessible at http://\<pi-ip\>:3000 (or http://\<pi-ip\>/automation-testing if using reverse proxy)

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

When using a reverse proxy, the app still listens on port 3000; the proxy listens on 80.

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

Use that IP from another device: `http://192.168.1.xxx:3000` (or `http://192.168.1.xxx/automation-testing` if using a reverse proxy).

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

To run the app on port 80 without a reverse proxy (one app per Pi):

```bash
sudo setcap 'cap_net_bind_service=+ep' $(which node)
```

Then set `PORT: 80` in `ecosystem.config.cjs` and restart:

```bash
pm2 restart automation-testing
```

For **multiple apps** on port 80 (e.g. http://\<pi-ip\>/automation-testing and http://\<pi-ip\>/other-app), use the [reverse proxy](#serving-on-port-80-with-a-reverse-proxy-multiple-apps) approach instead.
