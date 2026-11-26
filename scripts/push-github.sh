#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")/.."

# 清掉 Cursor 沙箱代理，走本机真实网络
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
unset GIT_HTTP_PROXY GIT_HTTPS_PROXY SOCKS_PROXY SOCKS5_PROXY socks_proxy socks5_proxy
unset GIT_SSH_COMMAND

echo "==> 工作目录: $(pwd)"
echo "==> 检查 GitHub 登录…"

if ! gh auth status >/dev/null 2>&1; then
  echo "需要登录 GitHub：浏览器会打开，按提示授权即可。"
  gh auth login --hostname github.com --git-protocol https --web
fi

gh auth status

# 若用了 separate-git-dir，保持可用
export GIT_DIR="${GIT_DIR:-}"
if [[ -f .git ]] && grep -q 'gitdir:' .git 2>/dev/null; then
  echo "==> 使用 separate gitdir"
fi

REPO_NAME="interview-review"
OWNER="$(gh api user --jq .login)"
echo "==> 账号: $OWNER"

if gh repo view "$OWNER/$REPO_NAME" >/dev/null 2>&1; then
  echo "==> 仓库已存在，准备推送"
  if ! git remote get-url origin >/dev/null 2>&1; then
    git remote add origin "https://github.com/$OWNER/$REPO_NAME.git"
  fi
else
  echo "==> 创建公开仓库（方便手机 GitHub Pages 访问）"
  gh repo create "$REPO_NAME" --public --source=. --remote=origin --description "面试复习 App（知识点/问答/算法）"
fi

git push -u origin main

echo "==> 开启 GitHub Pages（Actions）"
gh api -X POST "repos/$OWNER/$REPO_NAME/pages" \
  -f build_type=workflow \
  -f source='{"branch":"main","path":"/"}' 2>/dev/null \
  || gh api -X PUT "repos/$OWNER/$REPO_NAME/pages" -f build_type=workflow 2>/dev/null \
  || echo "（若 Pages 未自动开启：仓库 Settings → Pages → Build: GitHub Actions）"

echo "==> 触发部署工作流"
gh workflow run "Deploy Pages" --ref main 2>/dev/null || true

echo ""
echo "仓库: https://github.com/$OWNER/$REPO_NAME"
echo "手机打开（部署约 1～2 分钟后可用）:"
echo "  https://$OWNER.github.io/$REPO_NAME/"
echo ""
echo "完成。可关闭此窗口。"
read -r '?按回车关闭 '
