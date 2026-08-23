#!/usr/bin/env bash
# 在 yingwei 开发容器内执行一次，完成持久化环境配置。
# 所有配置都写在 /root 下（已挂载到宿主机），容器重建不会丢失。
set -euo pipefail

echo "==> 1/5 配置 ulimit（登录即生效，避免编译因 fd 不足失败）"
# 容器里 pam_limits 通常不生效，所以直接写进 .bashrc
if ! grep -q 'ulimit -n 65536' /root/.bashrc 2>/dev/null; then
  cat >> /root/.bashrc <<'EOF'

# --- 开发环境要求：文件描述符上限，编译需要 ---
ulimit -n 65536 2>/dev/null || true
EOF
fi
# 同时写 limits.conf，方便非 bash 登录场景
if ! grep -q 'ins-reader-dev' /etc/security/limits.conf 2>/dev/null; then
  cat >> /etc/security/limits.conf <<'EOF'
# ins-reader-dev
root soft nofile 65536
root hard nofile 65536
EOF
fi

echo "==> 2/5 配置 SSH 免密登录目录权限"
mkdir -p /root/.ssh
chmod 700 /root/.ssh
touch /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys

echo "==> 3/5 配置 git（持久化在 /root/.gitconfig）"
git config --global user.name  "odezz"
git config --global user.email "yezhilong@insta360.com"
git config --global core.editor vim
git config --global pull.rebase true
git config --global init.defaultBranch main

echo "==> 4/5 常用 shell 配置"
if ! grep -q 'ins-dev-aliases' /root/.bashrc 2>/dev/null; then
  cat >> /root/.bashrc <<'EOF'

# --- ins-dev-aliases ---
alias ll='ls -alF'
alias la='ls -A'
export EDITOR=vim
export HISTSIZE=10000
export HISTFILESIZE=20000
shopt -s histappend
EOF
fi

echo "==> 5/5 校验"
echo "  nofile: $(ulimit -n)  (新开 shell 后应为 65536)"
echo "  git:    $(git config --global user.name) <$(git config --global user.email)>"
echo "  workdir: /root  (务必把代码放这里)"
echo
echo "完成。请另外手动执行 passwd 修改默认密码 root。"
