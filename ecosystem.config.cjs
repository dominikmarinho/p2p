module.exports = {
  apps: [{
    name: 'highpass-microservice',
    script: 'dist/server.js',
    instances: 2,
    exec_mode: 'cluster',
    wait_ready: true,
    listen_timeout: 20000,
    kill_timeout: 25000,
    max_memory_restart: '400M',
    exp_backoff_restart_delay: 100,
    env_production: { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: 3000, TRUST_PROXY_HOPS: 1 },
  }],
};
