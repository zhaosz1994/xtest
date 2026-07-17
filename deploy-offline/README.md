# xTest Docker 离线部署说明

## 目录结构

```
deploy-offline/
├── images/                    # Docker 镜像文件
│   ├── xtest-app.tar         # 应用镜像
│   └── mysql.tar             # MySQL 镜像
├── init-sql/                  # 数据库初始化脚本
│   └── init.sql              # 初始化 SQL（可选）
├── docker-compose.offline.yml # Docker Compose 配置
├── .env.example              # 环境变量示例
├── start.sh                  # 启动脚本
├── stop.sh                   # 停止脚本
└── README.md                 # 本文件
```

## 部署步骤

### 1. 环境要求

- Docker 20.10+
- Docker Compose 2.0+
- 至少 2GB 可用内存
- 至少 10GB 可用磁盘空间

### 2. 配置环境变量

```bash
# 复制环境变量示例文件
cp .env.example .env

# 编辑配置（重要！）
vi .env
```

**必须修改的配置：**
- `MYSQL_ROOT_PASSWORD` - MySQL root 密码
- `DB_PASSWORD` - 应用数据库密码
- `JWT_SECRET` - JWT 密钥（请使用随机字符串）

### 3. 启动服务

```bash
# 添加执行权限
chmod +x start.sh stop.sh

# 启动服务
./start.sh
```

### 4. 访问应用

启动成功后，访问：**http://localhost:8000**

## 常用命令

```bash
# 查看服务状态
docker-compose -f docker-compose.offline.yml ps

# 查看日志
docker-compose -f docker-compose.offline.yml logs -f

# 查看应用日志
docker-compose -f docker-compose.offline.yml logs -f app

# 查看 MySQL 日志
docker-compose -f docker-compose.offline.yml logs -f mysql

# 停止服务
./stop.sh

# 重启服务
docker-compose -f docker-compose.offline.yml restart
```

## 数据备份

```bash
# 备份数据库
docker exec xtest-mysql mysqldump -u root -p${MYSQL_ROOT_PASSWORD} xtest_db > backup_$(date +%Y%m%d).sql

# 恢复数据库
docker exec -i xtest-mysql mysql -u root -p${MYSQL_ROOT_PASSWORD} xtest_db < backup.sql
```

## 故障排查

### 服务无法启动

```bash
# 检查容器状态
docker ps -a

# 检查容器日志
docker logs xtest-app
docker logs xtest-mysql
```

### 端口冲突

如果 8000 端口被占用，修改 `docker-compose.offline.yml` 中的端口映射：

```yaml
ports:
  - "8001:3000"  # 改为其他端口
```

### 数据库连接失败

1. 确认 MySQL 容器已启动
2. 检查 `.env` 文件中的数据库配置
3. 查看应用日志确认错误信息

## 安全建议

1. **修改默认密码**：部署前务必修改 `.env` 中的所有密码
2. **防火墙配置**：生产环境建议配置防火墙，限制端口访问
3. **HTTPS**：建议在前面部署 Nginx 反向代理并配置 SSL
4. **定期备份**：定期备份数据库数据
