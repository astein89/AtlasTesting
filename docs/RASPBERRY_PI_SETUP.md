# Atlas Testing — Raspberry Pi Install & Setup Guide

This guide walks you through installing and running Atlas Testing on a Raspberry Pi (Raspberry Pi OS).

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
git clone <your-repo-url> atlas-testing
cd atlas-testing
```

### From Another Machine (SCP/rsync)

On your development machine:

```bash
rsync -avz --exclude node_modules --exclude atlas.db ./atlas-testing/ pi@<pi-ip>:~/atlas-testing/
```

Or use SCP, USB drive, or another transfer method.

---

## Step 5: Install Dependencies & Build

### Option A: Build on the Pi

You need full dependencies (including Vite) to build:

```bash
cd ~/atlas-testing
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
cd ~/atlas-testing
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

```bash
cd ~/atlas-testing
pm2 start ecosystem.config.cjs
```

Check status:

```bash
pm2 status
pm2 logs atlas-testing
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

**Change the port** (optional): Edit `ecosystem.config.cjs` and set `PORT` in the `env` section:

```javascript
env: {
  NODE_ENV: 'production',
  PORT: 3000,  // Change to 80, 8080, etc.
}
```

---

## Useful PM2 Commands

| Command | Description |
|--------|-------------|
| `pm2 status` | List running apps |
| `pm2 logs atlas-testing` | View logs |
| `pm2 restart atlas-testing` | Restart app |
| `pm2 stop atlas-testing` | Stop app |
| `pm2 delete atlas-testing` | Remove from PM2 |

---

## Database Location

The SQLite database is stored at:

```
~/atlas-testing/atlas.db
```

Back it up regularly:

```bash
cp ~/atlas-testing/atlas.db ~/atlas-testing/atlas.db.backup
```

---

## Deployment Checklist

- [ ] Raspberry Pi OS updated
- [ ] Node.js 18+ installed
- [ ] Project copied to Pi
- [ ] `npm install` run (full install if building on Pi)
- [ ] `npm run build` completed
- [ ] PM2 installed globally
- [ ] `pm2 start ecosystem.config.cjs` run
- [ ] `pm2 startup` and `pm2 save` executed
- [ ] App accessible at http://\<pi-ip\>:3000
- [ ] Default password changed (via app: Change password)

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

Then allow the port:

```bash
sudo ufw allow 3000
sudo ufw status
```

**2. Ensure the server binds to all interfaces**

The app listens on `0.0.0.0` by default (all network interfaces). If you changed this, revert to `0.0.0.0`.

**3. Find the Pi's IP address**

```bash
hostname -I
```

Use that IP from another device: `http://192.168.1.xxx:3000`

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
```

---

## Optional: Run on Port 80

To use port 80 (no `:3000` in the URL):

```bash
sudo setcap 'cap_net_bind_service=+ep' $(which node)
```

Then set `PORT: 80` in `ecosystem.config.cjs` and restart:

```bash
pm2 restart atlas-testing
```
