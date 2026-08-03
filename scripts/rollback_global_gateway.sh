#!/usr/bin/env bash
set -e

# ==========================================
# 全局网关一键回退脚本 (恢复 BakLab 原始绑定)
# ==========================================

BAKLAB_DIR="/opt/baklab/output"
GATEWAY_DIR="/opt/global-gateway"

echo "===> 1. 停止并移除全局网关容器..."
if [ -d "$GATEWAY_DIR" ]; then
    cd "$GATEWAY_DIR"
    docker compose down || true
    echo "✓ 全局网关容器已停止"
fi

echo "===> 2. 寻找最近的 BakLab 配置备份文件..."
LATEST_BAK=$(ls -t "$BAKLAB_DIR"/.env.production.bak_* 2>/dev/null | head -n 1 || true)

if [ -n "$LATEST_BAK" ] && [ -f "$LATEST_BAK" ]; then
    echo "找到备份文件: $LATEST_BAK"
    cp "$LATEST_BAK" "$BAKLAB_DIR/.env.production"
    echo "✓ 已成功恢复 .env.production"
else
    echo "⚠️ 未找到备份文件，自动手动还原 NGINX_PORT=80 与 NGINX_SSL_PORT=443..."
    sed -i 's/^NGINX_PORT=.*/NGINX_PORT=80/' "$BAKLAB_DIR/.env.production"
    sed -i 's/^NGINX_SSL_PORT=.*/NGINX_SSL_PORT=443/' "$BAKLAB_DIR/.env.production"
fi

echo "===> 3. 重启 BakLab 服务恢复占用 80/443 端口..."
cd "$BAKLAB_DIR"
docker compose --env-file .env.production -f docker-compose.production.yml up -d

echo "=========================================="
echo "✓ 已成功回退！BakLab 已经完全恢复原始状态。"
echo "=========================================="
