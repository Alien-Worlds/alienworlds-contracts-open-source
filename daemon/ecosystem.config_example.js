const CONFIG = 'dev'

module.exports = {
    apps: [
        {
            name: "dcl-server",
            script: "./dcl-server.js",
            node_args: ["--max-old-space-size=8192"],
            autorestart: true,
            kill_timeout: 3600,
            env: {
                CONFIG
            }
        }
    ]
};
