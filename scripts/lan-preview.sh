#!/bin/zsh
cd "$(dirname "$0")/.."
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '本机IP')
echo "手机连同一 WiFi 后打开: http://$IP:5173/"
npm run content
npm run dev -- --host 0.0.0.0 --port 5173
