module.exports = {
  apps: [
    {
      name: 'print-agent',
      script: 'index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 9101,
        // Set PUPPETEER_EXECUTABLE_PATH if needed on the VM, e.g. '/usr/bin/chromium'
        // PUPPETEER_EXECUTABLE_PATH: '/usr/bin/chromium'
      }
    }
  ]
};
