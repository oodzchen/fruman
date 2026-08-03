#!/usr/bin/env bash
set -e

# ===================================================
# 统一多项目无缝升级部署脚本 (BakLab + Fruman + Global Gateway)
# ===================================================

BAKLAB_DIR="/opt/baklab/output"
FRUMAN_DIR="/home/kholin/github/fruman"
GATEWAY_DIR="/opt/global-gateway"

echo "===> 1. 检查并拉取 Fruman 最新镜像与滚动更新..."
if [ -d "$FRUMAN_DIR" ]; then
    cd "$FRUMAN_DIR"
    docker compose pull web || true
    docker compose up -d
fi

echo "===> 2. 应用 BakLab 最新容器 (启用后端与数据库，禁用内建 caddy)..."
if [ -d "$BAKLAB_DIR" ]; then
    cd "$BAKLAB_DIR"
    docker compose --env-file .env.production -f docker-compose.production.yml up -d --scale caddy=0
fi

echo "===> 3. 检查并热重载全局 Caddy 边缘网关 (global-gateway)..."
if [ -d "$GATEWAY_DIR" ]; then
    cd "$GATEWAY_DIR"
    docker compose up -d
    docker exec global-gateway caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || docker restart global-gateway
fi

echo "==================================================="
echo "✓ 全量服务升级与应用刷新完成！"
echo "1. Fruman 最新镜像拉取与重新加载完成。"
echo "2. BakLab 业务容器正常运行 (--scale caddy=0 避免端口冲突)。"
echo "3. 全局 Caddy 边缘网关已热重载，全站代理正常。"
echo "==================================================="
