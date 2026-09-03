module.exports = {
  apps: [
    {
      name: 'daily-trainer-bot',
      script: 'src/index.js',
      cwd: __dirname,
      // Auto-restart on crash, but don't loop forever if it's crash-looping.
      autorestart: true,
      max_restarts: 20,
      min_uptime: '30s',
      restart_delay: 5000,
      // Guard against a memory leak silently growing forever.
      max_memory_restart: '300M',
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      time: true,
    },
    {
      name: 'raid-tunnel',
      script: 'scripts/tunnel.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 50,
      min_uptime: '5s',
      restart_delay: 3000,
      watch: false,
      out_file: './logs/tunnel-out.log',
      error_file: './logs/tunnel-error.log',
      time: true,
    },
  ],
};
