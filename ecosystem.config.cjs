// For path-based deployment (e.g. behind reverse proxy at /automation-testing), set BASE_PATH
// and build the client with VITE_BASE_PATH. See docs/RASPBERRY_PI_SETUP.md.
module.exports = {
  apps: [
    {
      name: 'automation-testing',
      script: 'dist/server/index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        // BASE_PATH: '/automation-testing',
      },
      instances: 1,
      autorestart: true,
      watch: false,
    },
  ],
}
