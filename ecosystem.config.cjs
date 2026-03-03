module.exports = {
  apps: [
    {
      name: 'atlas-testing',
      script: 'dist/server/index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      instances: 1,
      autorestart: true,
      watch: false,
    },
  ],
}
