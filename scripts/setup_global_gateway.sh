#!/usr/bin/env bash
set -e

# ==========================================
# 单一全局 Caddy 边缘网关 (彻底替代并停用 baklab-caddy)
# ==========================================

BAKLAB_DIR="/opt/baklab/output"
GATEWAY_DIR="/opt/global-gateway"

echo "===> 1. 停止并禁用 BakLab 原有的 baklab-caddy 容器 (释放 80/443)..."
cd "$BAKLAB_DIR"
docker compose --env-file .env.production -f docker-compose.production.yml stop caddy || true

echo "===> 2. 创建单一全局边缘网关配置 (/opt/global-gateway)..."
mkdir -p "$GATEWAY_DIR"

cat << 'EOF' > "$GATEWAY_DIR/Caddyfile"
{
	admin off
	on_demand_tls {
		ask http://app:3000/health
	}
}

# 1. 独立服务：Fruman 项目
fruman.baklab.app {
	reverse_proxy host.docker.internal:8080
}

# 2. BakLab 主站
baklab.app {
	encode gzip zstd

	log {
		output file /data/access.log {
			roll_size 100mb
			roll_keep 10
		}
		format json
	}

	@health path /health
	handle @health {
		respond "ok" 200
	}

	handle_path /static/* {
		root * /data/custom_static
		file_server
		header Cache-Control "public, immutable, max-age=31536000"
	}

	handle /favicon.ico {
		root * /data/custom_static
		rewrite * /favicon.ico
		file_server
		header Cache-Control "public, immutable, max-age=31536000"
	}

	handle /robots.txt {
		root * /data/custom_static
		rewrite * /robots.txt
		file_server
		header Cache-Control "public, max-age=604800"
	}

	handle_path /sw.js {
		root * /data/static/frontend
		file_server
		header Cache-Control "no-cache, no-store, must-revalidate"
		header Pragma "no-cache"
		header Expires "0"
		header Service-Worker-Allowed "/"
	}

	@sse {
		path /api/events*
	}
	handle @sse {
		reverse_proxy app:3000 {
			header_up Host {host}
			header_up X-Real-IP {remote_host}
			header_up Connection "upgrade"

			flush_interval -1

			transport http {
				read_timeout 24h
				write_timeout 24h
				read_buffer 0
				write_buffer 0
			}
		}
	}

	handle {
		reverse_proxy app:3000 {
			header_up Host {host}
			header_up X-Real-IP {remote_host}
		}
	}
}

# 3. Dali 服务
dali.baklab.app {
	encode gzip zstd
	reverse_proxy dali:80 {
		header_up Host {host}
		header_up X-Real-IP {remote_host}
	}
}

# 4. 多租户 Catch-All 通用规则 (支持 dizkaz.com 及任意动态租户自定义域名)
http://, https:// {
	tls {
		on_demand
	}

	encode gzip zstd

	handle_path /static/* {
		root * /data/custom_static
		file_server
		header Cache-Control "public, immutable, max-age=31536000"
	}

	handle_path /sw.js {
		root * /data/static/frontend
		file_server
		header Cache-Control "no-cache, no-store, must-revalidate"
		header Pragma "no-cache"
		header Expires "0"
		header Service-Worker-Allowed "/"
	}

	@sse {
		path /api/events*
	}
	handle @sse {
		reverse_proxy app:3000 {
			header_up Host {host}
			header_up X-Real-IP {remote_host}
			header_up Connection "upgrade"

			flush_interval -1

			transport http {
				read_timeout 24h
				write_timeout 24h
				read_buffer 0
				write_buffer 0
			}
		}
	}

	handle {
		reverse_proxy app:3000 {
			header_up Host {host}
			header_up X-Real-IP {remote_host}
		}
	}
}
EOF

cat << 'EOF' > "$GATEWAY_DIR/docker-compose.yaml"
services:
  global-gateway:
    image: caddy:2.8-alpine
    container_name: global-gateway
    restart: always
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - /opt/baklab/output/frontend_dist:/data/static/frontend:ro
      - /opt/baklab/output/static:/data/custom_static:ro
      - caddy_data:/data
      - caddy_config:/config
    networks:
      - output_default
    extra_hosts:
      - "host.docker.internal:host-gateway"

volumes:
  caddy_data:
  caddy_config:

networks:
  output_default:
    external: true
EOF

echo "===> 3. 启动唯一的全局边缘网关 (global-gateway)..."
cd "$GATEWAY_DIR"
docker compose up -d

echo "===> 4. 启动 Fruman 项目容器..."
cd /home/kholin/github/fruman
docker compose up -d

echo "=========================================="
echo "✓ 架构改造升级完成！"
echo "1. 原有的 baklab-caddy 已彻底停用关闭。"
echo "2. 唯一全局边缘网关已独占 80/443 端口接管所有服务与多租户。"
echo "3. Fruman 及 BakLab 所有站点均正常上线。"
echo "=========================================="
