// Default: app at site root (http://<host>/) — leave BASE_PATH unset. For subpath deployment
// (e.g. /dc-automation), set BASE_PATH and build with VITE_BASE_PATH. See docs/RASPBERRY_PI_SETUP.md.
module.exports = {
  apps: [
    {
      name: 'dc-automation',
      script: 'dist/server/index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        // BASE_PATH: '/dc-automation',
      },
      instances: 1,
      autorestart: true,
      watch: false,
    },
  ],
}
