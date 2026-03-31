# xtest 数据库架构文档

生成时间：2026/3/31 22:41:57

数据库：xtest_db

---

## 目录

- [activity_logs](#activity_logs) - 无注释
- [ai_config](#ai_config) - 无注释
- [ai_models](#ai_models) - 无注释
- [ai_skills](#ai_skills) - 无注释
- [case_execution_records](#case_execution_records) - 测试用例执行记录表
- [case_libraries](#case_libraries) - 无注释
- [case_library_cases](#case_library_cases) - 无注释
- [chips](#chips) - 无注释
- [email_config](#email_config) - 无注释
- [email_logs](#email_logs) - 无注释
- [environments](#environments) - 无注释
- [forum_comments](#forum_comments) - 无注释
- [forum_likes](#forum_likes) - 无注释
- [forum_post_tags](#forum_post_tags) - 无注释
- [forum_posts](#forum_posts) - 无注释
- [forum_tags](#forum_tags) - 无注释
- [history](#history) - 无注释
- [history_snapshots](#history_snapshots) - 无注释
- [hyperlink_configs](#hyperlink_configs) - 无注释
- [level1_points](#level1_points) - 无注释
- [level2_points](#level2_points) - 无注释
- [modules](#modules) - 无注释
- [notifications](#notifications) - 无注释
- [projects](#projects) - 无注释
- [report_templates](#report_templates) - 无注释
- [test_case_environments](#test_case_environments) - 无注释
- [test_case_methods](#test_case_methods) - 无注释
- [test_case_phases](#test_case_phases) - 无注释
- [test_case_progresses](#test_case_progresses) - 无注释
- [test_case_projects](#test_case_projects) - 无注释
- [test_case_sources](#test_case_sources) - 无注释
- [test_case_statuses](#test_case_statuses) - 无注释
- [test_case_test_types](#test_case_test_types) - 无注释
- [test_cases](#test_cases) - 无注释
- [test_execution_logs](#test_execution_logs) - 无注释
- [test_methods](#test_methods) - 无注释
- [test_phases](#test_phases) - 无注释
- [test_plan_cases](#test_plan_cases) - 无注释
- [test_plan_rules](#test_plan_rules) - 无注释
- [test_plans](#test_plans) - 无注释
- [test_priorities](#test_priorities) - 无注释
- [test_progresses](#test_progresses) - 无注释
- [test_reports](#test_reports) - 无注释
- [test_softwares](#test_softwares) - 无注释
- [test_sources](#test_sources) - 无注释
- [test_statuses](#test_statuses) - 无注释
- [test_types](#test_types) - 无注释
- [testpoint_chips](#testpoint_chips) - 无注释
- [testpoint_status](#testpoint_status) - 无注释
- [user_skill_settings](#user_skill_settings) - 无注释
- [users](#users) - 无注释

---

## activity_logs

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| user_id | int | 否 | NULL | 🔗 索引 |  |  |
| username | varchar(50) | 否 | NULL |  |  |  |
| role | varchar(20) | 否 | NULL |  |  |  |
| action | varchar(100) | 否 | NULL | 🔗 索引 |  |  |
| description | text | 是 | NULL |  |  |  |
| entity_type | varchar(50) | 是 | NULL |  |  |  |
| entity_id | int | 是 | NULL |  |  |  |
| ip_address | varchar(45) | 是 | NULL |  |  |  |
| user_agent | text | 是 | NULL |  |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP | 🔗 索引 | DEFAULT_GENERATED |  |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| idx_action | action | - | 非唯一 | BTREE |
| idx_activity_logs_created_at | created_at | - | 非唯一 | BTREE |
| idx_activity_logs_user_id | user_id | - | 非唯一 | BTREE |
| idx_created_at | created_at | - | 非唯一 | BTREE |
| idx_user_id | user_id | - | 非唯一 | BTREE |

### 表统计

- 记录数：约 49 条
- 数据大小：0.02 MB
- 索引大小：0.08 MB

---

## ai_config

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| config_key | varchar(100) | 否 | NULL | ✨ 唯一 |  |  |
| config_value | text | 是 | NULL |  |  |  |
| description | varchar(255) | 是 | NULL |  |  |  |
| updated_by | varchar(50) | 是 | NULL |  |  |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED on update CURRENT_TIMESTAMP |  |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| config_key | config_key | - | 唯一 | BTREE |

### 表统计

- 记录数：约 2 条
- 数据大小：0.02 MB
- 索引大小：0.02 MB

---

## ai_models

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| model_id | varchar(50) | 否 | NULL | ✨ 唯一 |  |  |
| name | varchar(100) | 否 | NULL |  |  |  |
| provider | varchar(50) | 否 | NULL |  |  |  |
| api_key | text | 否 | NULL |  |  |  |
| endpoint | varchar(500) | 否 | NULL |  |  |  |
| model_name | varchar(100) | 否 | NULL |  |  |  |
| is_default | tinyint(1) | 是 | 0 |  |  |  |
| is_enabled | tinyint(1) | 是 | 1 |  |  |  |
| description | text | 是 | NULL |  |  |  |
| created_by | varchar(50) | 是 | NULL |  |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED on update CURRENT_TIMESTAMP |  |
| user_id | int | 是 | NULL |  |  | 用户ID |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| model_id | model_id | - | 唯一 | BTREE |

### 表统计

- 记录数：约 5 条
- 数据大小：0.02 MB
- 索引大小：0.02 MB

---

## ai_skills

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| name | varchar(100) | 否 | NULL | ✨ 唯一 |  | 技能标识名，如 analyze_pass_rate |
| display_name | varchar(200) | 是 | NULL |  |  | 技能显示名称 |
| description | text | 是 | NULL |  |  | 技能描述 |
| definition | json | 是 | NULL |  |  | LLM Tool Schema 定义 |
| execute_code | text | 是 | NULL |  |  | Node.js 可执行的 JS 脚本 |
| category | varchar(50) | 是 | general | 🔗 索引 |  | 技能分类 |
| is_enabled | tinyint(1) | 是 | 1 | 🔗 索引 |  | 是否启用 |
| is_system | tinyint(1) | 是 | 0 |  |  | 是否系统内置 |
| created_by | varchar(50) | 是 | NULL |  |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED on update CURRENT_TIMESTAMP |  |
| is_public | tinyint(1) | 是 | 1 |  |  | 是否公开 |
| creator_id | int | 是 | NULL |  |  | 创建者ID |
| updater_id | int | 是 | NULL |  |  | 更新者ID |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| idx_category | category | - | 非唯一 | BTREE |
| idx_enabled | is_enabled | - | 非唯一 | BTREE |
| idx_name | name | - | 非唯一 | BTREE |
| name | name | - | 唯一 | BTREE |

### 表统计

- 记录数：约 4 条
- 数据大小：0.02 MB
- 索引大小：0.06 MB

---

## case_execution_records

**说明：** 测试用例执行记录表

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| case_id | int | 否 | NULL | 🔗 索引 |  | 测试用例ID |
| record_type | enum('defect','other') | 否 | NULL |  |  | 记录类型: defect-缺陷, other-其他 |
| bug_id | varchar(100) | 是 | NULL |  |  | Bug ID |
| bug_type | varchar(50) | 是 | NULL |  |  | Bug类型 |
| description | text | 是 | NULL |  |  | 详细描述 |
| images | json | 是 | NULL |  |  | 图片列表JSON数组 |
| creator | varchar(50) | 否 | NULL |  |  | 创建人 |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP | 🔗 索引 | DEFAULT_GENERATED |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED on update CURRENT_TIMESTAMP |  |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| idx_case_id | case_id | - | 非唯一 | BTREE |
| idx_created_at | created_at | - | 非唯一 | BTREE |

### 表统计

- 记录数：约 0 条
- 数据大小：0.02 MB
- 索引大小：0.03 MB

---

## case_libraries

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| name | varchar(100) | 否 | NULL |  |  |  |
| creator | varchar(50) | 否 | NULL |  |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |
| module_count | int | 是 | 0 |  |  |  |
| config | text | 是 | NULL |  |  |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED on update CURRENT_TIMESTAMP |  |

### 表统计

- 记录数：约 2 条
- 数据大小：0.02 MB
- 索引大小：0.00 MB

---

## case_library_cases

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| library_id | int | 否 | NULL | 🔗 索引 |  |  |
| case_id | int | 否 | NULL |  |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| unique_library_case | library_id, case_id | - | 唯一 | BTREE |

### 表统计

- 记录数：约 0 条
- 数据大小：0.02 MB
- 索引大小：0.02 MB

---

## chips

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| chip_id | varchar(50) | 否 | NULL | ✨ 唯一 |  |  |
| name | varchar(100) | 否 | NULL |  |  |  |
| description | text | 是 | NULL |  |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| chip_id | chip_id | - | 唯一 | BTREE |

### 表统计

- 记录数：约 3 条
- 数据大小：0.02 MB
- 索引大小：0.02 MB

---

## email_config

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| config_name | varchar(100) | 否 | NULL |  |  | 配置名称 |
| email_type | enum('smtp','self_hosted') | 否 | smtp |  |  | 邮件类型: smtp-企业邮箱, self_hosted-自建服务器 |
| smtp_host | varchar(255) | 是 | NULL |  |  | SMTP服务器地址 |
| smtp_port | int | 是 | 587 |  |  | SMTP端口 |
| smtp_secure | tinyint(1) | 是 | 0 |  |  | 是否使用SSL/TLS |
| smtp_user | varchar(255) | 是 | NULL |  |  | SMTP用户名 |
| smtp_password | varchar(255) | 是 | NULL |  |  | SMTP密码(加密存储) |
| sender_email | varchar(255) | 是 | NULL |  |  | 发件人邮箱 |
| sender_name | varchar(100) | 是 | NULL |  |  | 发件人名称 |
| self_hosted_api_url | varchar(255) | 是 | NULL |  |  | 自建服务器API地址 |
| self_hosted_api_key | varchar(255) | 是 | NULL |  |  | 自建服务器API密钥 |
| is_default | tinyint(1) | 是 | 0 | 🔗 索引 |  | 是否默认配置 |
| is_enabled | tinyint(1) | 是 | 1 | 🔗 索引 |  | 是否启用 |
| daily_limit | int | 是 | 500 |  |  | 每日发送限制 |
| sent_today | int | 是 | 0 |  |  | 今日已发送数量 |
| last_sent_date | date | 是 | NULL |  |  | 最后发送日期 |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED on update CURRENT_TIMESTAMP |  |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| idx_is_default | is_default | - | 非唯一 | BTREE |
| idx_is_enabled | is_enabled | - | 非唯一 | BTREE |

### 表统计

- 记录数：约 2 条
- 数据大小：0.02 MB
- 索引大小：0.03 MB

---

## email_logs

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| config_id | int | 是 | NULL | 🔗 索引 |  | 使用的配置ID |
| recipient_email | varchar(255) | 否 | NULL | 🔗 索引 |  | 收件人邮箱 |
| recipient_name | varchar(100) | 是 | NULL |  |  | 收件人名称 |
| subject | varchar(500) | 否 | NULL |  |  | 邮件主题 |
| email_type | varchar(50) | 是 | NULL |  |  | 邮件类型: verification, notification, report等 |
| status | enum('pending','sent','failed') | 是 | pending | 🔗 索引 |  | 发送状态 |
| error_message | text | 是 | NULL |  |  | 错误信息 |
| sent_at | timestamp | 是 | NULL |  |  | 发送时间 |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP | 🔗 索引 | DEFAULT_GENERATED |  |

### 外键关联

| 字段 | 约束名 | 引用表 | 引用字段 | 删除规则 | 更新规则 |
|------|--------|--------|----------|----------|----------|
| config_id | email_logs_ibfk_1 | email_config | id | SET NULL | NO ACTION |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| config_id | config_id | - | 非唯一 | BTREE |
| idx_created_at | created_at | - | 非唯一 | BTREE |
| idx_recipient_email | recipient_email | - | 非唯一 | BTREE |
| idx_status | status | - | 非唯一 | BTREE |

### 表统计

- 记录数：约 0 条
- 数据大小：0.02 MB
- 索引大小：0.06 MB

---

## environments

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| env_id | varchar(50) | 否 | NULL | ✨ 唯一 |  |  |
| name | varchar(100) | 否 | NULL |  |  |  |
| description | text | 是 | NULL |  |  |  |
| creator | varchar(50) | 否 | NULL |  |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED on update CURRENT_TIMESTAMP |  |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| env_id | env_id | - | 唯一 | BTREE |

### 表统计

- 记录数：约 5 条
- 数据大小：0.02 MB
- 索引大小：0.02 MB

---

## forum_comments

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment | 评论ID |
| comment_id | varchar(50) | 否 | NULL | ✨ 唯一 |  | 评论唯一标识 |
| post_id | int | 否 | NULL | 🔗 索引 |  | 帖子ID |
| author_id | int | 否 | NULL | 🔗 索引 |  | 评论者ID |
| parent_id | int | 是 | NULL | 🔗 索引 |  | 父评论ID |
| reply_to_id | int | 是 | NULL |  |  | 回复的评论ID |
| content | text | 否 | NULL |  |  | 评论内容 |
| content_html | text | 是 | NULL |  |  | 评论内容HTML渲染结果 |
| like_count | int | 是 | 0 |  |  | 点赞数量 |
| is_anonymous | tinyint(1) | 是 | 0 |  |  | 是否匿名 |
| status | enum('normal','hidden','deleted') | 是 | normal |  |  | 评论状态 |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP | 🔗 索引 | DEFAULT_GENERATED | 创建时间 |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED on update CURRENT_TIMESTAMP | 更新时间 |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| comment_id | comment_id | - | 唯一 | BTREE |
| idx_author_id | author_id | - | 非唯一 | BTREE |
| idx_created_at | created_at | - | 非唯一 | BTREE |
| idx_parent_id | parent_id | - | 非唯一 | BTREE |
| idx_post_id | post_id | - | 非唯一 | BTREE |

### 表统计

- 记录数：约 0 条
- 数据大小：0.02 MB
- 索引大小：0.08 MB

---

## forum_likes

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| user_id | int | 否 | NULL | 🔗 索引 |  | 用户ID |
| target_type | enum('post','comment') | 否 | NULL |  |  | 点赞目标类型 |
| target_id | int | 否 | NULL |  |  | 目标ID |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| uk_user_target | user_id, target_type, target_id | - | 唯一 | BTREE |

### 表统计

- 记录数：约 0 条
- 数据大小：0.02 MB
- 索引大小：0.02 MB

---

## forum_post_tags

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| post_id | int | 否 | NULL | 🔗 索引 |  | 帖子ID |
| tag_id | int | 否 | NULL |  |  | 标签ID |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| uk_post_tag | post_id, tag_id | - | 唯一 | BTREE |

### 表统计

- 记录数：约 0 条
- 数据大小：0.02 MB
- 索引大小：0.02 MB

---

## forum_posts

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment | 帖子ID |
| post_id | varchar(50) | 否 | NULL | ✨ 唯一 |  | 帖子唯一标识 |
| author_id | int | 否 | NULL | 🔗 索引 |  | 作者ID |
| title | varchar(200) | 否 | NULL |  |  | 帖子标题 |
| content | longtext | 否 | NULL |  |  | 帖子内容 |
| content_html | longtext | 是 | NULL |  |  | 帖子内容HTML渲染结果 |
| view_count | int | 是 | 0 |  |  | 浏览次数 |
| comment_count | int | 是 | 0 |  |  | 评论数量 |
| like_count | int | 是 | 0 |  |  | 点赞数量 |
| is_pinned | tinyint(1) | 是 | 0 | 🔗 索引 |  | 是否置顶 |
| is_locked | tinyint(1) | 是 | 0 |  |  | 是否锁定 |
| is_anonymous | tinyint(1) | 是 | 0 |  |  | 是否匿名 |
| status | enum('normal','hidden','deleted') | 是 | normal | 🔗 索引 |  | 帖子状态 |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP | 🔗 索引 | DEFAULT_GENERATED | 创建时间 |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED on update CURRENT_TIMESTAMP | 更新时间 |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| idx_author_id | author_id | - | 非唯一 | BTREE |
| idx_created_at | created_at | - | 非唯一 | BTREE |
| idx_is_pinned | is_pinned | - | 非唯一 | BTREE |
| idx_status | status | - | 非唯一 | BTREE |
| post_id | post_id | - | 唯一 | BTREE |

### 表统计

- 记录数：约 0 条
- 数据大小：0.02 MB
- 索引大小：0.08 MB

---

## forum_tags

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment | 标签ID |
| name | varchar(50) | 否 | NULL | ✨ 唯一 |  | 标签名称 |
| color | varchar(20) | 是 | #3498db |  |  | 标签颜色 |
| post_count | int | 是 | 0 |  |  | 关联帖子数量 |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED | 创建时间 |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| name | name | - | 唯一 | BTREE |

### 表统计

- 记录数：约 7 条
- 数据大小：0.02 MB
- 索引大小：0.02 MB

---

## history

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| user | varchar(50) | 否 | NULL |  |  |  |
| action | varchar(50) | 否 | NULL |  |  |  |
| content | text | 否 | NULL |  |  |  |
| version | varchar(20) | 否 | NULL |  |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |

### 表统计

- 记录数：约 0 条
- 数据大小：0.02 MB
- 索引大小：0.00 MB

---

## history_snapshots

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| entity_type | varchar(50) | 否 | NULL |  |  |  |
| entity_id | int | 否 | NULL |  |  |  |
| snapshot_data | text | 否 | NULL |  |  |  |
| version | varchar(20) | 否 | NULL |  |  |  |
| user | varchar(50) | 否 | NULL |  |  |  |
| action | varchar(50) | 否 | NULL |  |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |

### 表统计

- 记录数：约 0 条
- 数据大小：0.02 MB
- 索引大小：0.00 MB

---

## hyperlink_configs

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| name | varchar(100) | 否 | NULL |  |  | 配置名称 |
| prefix | varchar(500) | 否 | NULL |  |  | 链接前缀 |
| description | text | 是 | NULL |  |  | 描述 |
| sort_order | int | 是 | 0 |  |  | 排序顺序 |
| is_active | tinyint(1) | 是 | 1 |  |  | 是否启用 |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED on update CURRENT_TIMESTAMP |  |

### 表统计

- 记录数：约 2 条
- 数据大小：0.02 MB
- 索引大小：0.00 MB

---

## level1_points

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| module_id | int | 否 | NULL |  |  |  |
| name | varchar(100) | 否 | NULL |  |  |  |
| test_type | varchar(50) | 是 | 功能测试 |  |  |  |
| order_index | int | 是 | 0 |  |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED on update CURRENT_TIMESTAMP |  |

### 表统计

- 记录数：约 8 条
- 数据大小：0.02 MB
- 索引大小：0.00 MB

---

## level2_points

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| level1_id | int | 否 | NULL |  |  |  |
| name | varchar(100) | 否 | NULL |  |  |  |
| test_steps | text | 否 | NULL |  |  |  |
| expected_behavior | text | 否 | NULL |  |  |  |
| test_environment | varchar(255) | 否 | NULL |  |  |  |
| case_name | varchar(100) | 否 | NULL |  |  |  |
| remarks | text | 是 | NULL |  |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |

### 表统计

- 记录数：约 0 条
- 数据大小：0.02 MB
- 索引大小：0.00 MB

---

## modules

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| module_id | varchar(50) | 否 | NULL | ✨ 唯一 |  |  |
| name | varchar(100) | 否 | NULL |  |  |  |
| library_id | int | 是 | NULL |  |  |  |
| parent_id | int | 是 | NULL |  |  |  |
| order_index | int | 是 | 0 |  |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| module_id | module_id | - | 唯一 | BTREE |

### 表统计

- 记录数：约 5 条
- 数据大小：0.02 MB
- 索引大小：0.02 MB

---

## notifications

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| user_id | int | 否 | NULL | 🔗 索引 |  | 接收通知的用户ID |
| sender_id | int | 是 | NULL |  |  | 触发通知的用户ID(可选) |
| type | varchar(50) | 否 | NULL |  |  | 通知类型: mention, comment, like, system |
| target_id | int | 否 | NULL |  |  | 关联的目标ID (通常为帖子 post_id 或者评论 comment_id) |
| title | varchar(255) | 是 | 系统通知 |  |  | 通知标题 |
| content | text | 是 | NULL |  |  | 通知完整内容 |
| content_preview | varchar(255) | 是 | NULL |  |  | 通知内容预览摘要 |
| data | json | 是 | NULL |  |  | 额外数据(JSON格式) |
| is_read | tinyint(1) | 是 | 0 | 🔗 索引 |  | 是否已读 |
| read_at | timestamp | 是 | NULL |  |  | 已读时间 |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP | 🔗 索引 | DEFAULT_GENERATED |  |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| idx_notifications_created_at | created_at | - | 非唯一 | BTREE |
| idx_notifications_is_read | is_read | - | 非唯一 | BTREE |
| idx_notifications_user_id | user_id | - | 非唯一 | BTREE |

### 表统计

- 记录数：约 0 条
- 数据大小：0.02 MB
- 索引大小：0.05 MB

---

## projects

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| name | varchar(100) | 否 | NULL |  |  |  |
| code | varchar(50) | 否 | NULL | ✨ 唯一 |  |  |
| description | text | 是 | NULL |  |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED on update CURRENT_TIMESTAMP |  |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| code | code | - | 唯一 | BTREE |

### 表统计

- 记录数：约 2 条
- 数据大小：0.02 MB
- 索引大小：0.02 MB

---

## report_templates

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| name | varchar(200) | 否 | NULL | 🔗 索引 |  | 模板名称 |
| description | text | 是 | NULL |  |  | 模板描述 |
| file_path | varchar(500) | 否 | NULL |  |  | 文件存储路径 |
| file_type | varchar(20) | 是 | md |  |  | 文件类型：md/txt |
| is_default | tinyint(1) | 是 | 0 | 🔗 索引 |  | 是否默认模板 |
| created_by | varchar(50) | 是 | NULL |  |  | 创建者 |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED | 创建时间 |
| updated_by | varchar(50) | 是 | NULL |  |  | 最后编辑者 |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED on update CURRENT_TIMESTAMP | 最后编辑时间 |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| idx_default | is_default | - | 非唯一 | BTREE |
| idx_name | name | - | 非唯一 | BTREE |

### 表统计

- 记录数：约 1 条
- 数据大小：0.02 MB
- 索引大小：0.03 MB

---

## test_case_environments

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| test_case_id | int | 否 | NULL | 🔗 索引 |  |  |
| environment_id | int | 否 | NULL | 🔗 索引 |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |

### 外键关联

| 字段 | 约束名 | 引用表 | 引用字段 | 删除规则 | 更新规则 |
|------|--------|--------|----------|----------|----------|
| test_case_id | test_case_environments_ibfk_1 | test_cases | id | CASCADE | NO ACTION |
| environment_id | test_case_environments_ibfk_2 | environments | id | CASCADE | NO ACTION |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| environment_id | environment_id | - | 非唯一 | BTREE |
| unique_test_case_environment | test_case_id, environment_id | - | 唯一 | BTREE |

### 表统计

- 记录数：约 56 条
- 数据大小：0.02 MB
- 索引大小：0.03 MB

---

## test_case_methods

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| test_case_id | int | 否 | NULL | 🔗 索引 |  |  |
| method_id | int | 否 | NULL | 🔗 索引 |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |

### 外键关联

| 字段 | 约束名 | 引用表 | 引用字段 | 删除规则 | 更新规则 |
|------|--------|--------|----------|----------|----------|
| test_case_id | test_case_methods_ibfk_1 | test_cases | id | CASCADE | NO ACTION |
| method_id | test_case_methods_ibfk_2 | test_methods | id | CASCADE | NO ACTION |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| method_id | method_id | - | 非唯一 | BTREE |
| unique_test_case_method | test_case_id, method_id | - | 唯一 | BTREE |

### 表统计

- 记录数：约 18 条
- 数据大小：0.02 MB
- 索引大小：0.03 MB

---

## test_case_phases

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| test_case_id | int | 否 | NULL | 🔗 索引 |  |  |
| phase_id | int | 否 | NULL | 🔗 索引 |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |

### 外键关联

| 字段 | 约束名 | 引用表 | 引用字段 | 删除规则 | 更新规则 |
|------|--------|--------|----------|----------|----------|
| test_case_id | test_case_phases_ibfk_1 | test_cases | id | CASCADE | NO ACTION |
| phase_id | test_case_phases_ibfk_2 | test_phases | id | CASCADE | NO ACTION |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| phase_id | phase_id | - | 非唯一 | BTREE |
| unique_test_case_phase | test_case_id, phase_id | - | 唯一 | BTREE |

### 表统计

- 记录数：约 21 条
- 数据大小：0.02 MB
- 索引大小：0.03 MB

---

## test_case_progresses

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| test_case_id | int | 否 | NULL | 🔗 索引 |  |  |
| progress_id | int | 否 | NULL | 🔗 索引 |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |

### 外键关联

| 字段 | 约束名 | 引用表 | 引用字段 | 删除规则 | 更新规则 |
|------|--------|--------|----------|----------|----------|
| test_case_id | test_case_progresses_ibfk_1 | test_cases | id | CASCADE | NO ACTION |
| progress_id | test_case_progresses_ibfk_2 | test_progresses | id | CASCADE | NO ACTION |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| progress_id | progress_id | - | 非唯一 | BTREE |
| unique_test_case_progress | test_case_id, progress_id | - | 唯一 | BTREE |

### 表统计

- 记录数：约 0 条
- 数据大小：0.02 MB
- 索引大小：0.03 MB

---

## test_case_projects

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| test_case_id | int | 否 | NULL | 🔗 索引 |  |  |
| project_id | int | 否 | NULL | 🔗 索引 |  |  |
| owner | varchar(50) | 是 |  |  |  |  |
| progress_id | int | 是 | NULL | 🔗 索引 |  |  |
| status_id | int | 是 | NULL | 🔗 索引 |  |  |
| remark | varchar(128) | 是 | NULL |  |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED on update CURRENT_TIMESTAMP |  |

### 外键关联

| 字段 | 约束名 | 引用表 | 引用字段 | 删除规则 | 更新规则 |
|------|--------|--------|----------|----------|----------|
| test_case_id | test_case_projects_ibfk_1 | test_cases | id | CASCADE | NO ACTION |
| project_id | test_case_projects_ibfk_2 | projects | id | CASCADE | NO ACTION |
| progress_id | test_case_projects_ibfk_3 | test_progresses | id | SET NULL | NO ACTION |
| status_id | test_case_projects_ibfk_4 | test_statuses | id | SET NULL | NO ACTION |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| progress_id | progress_id | - | 非唯一 | BTREE |
| project_id | project_id | - | 非唯一 | BTREE |
| status_id | status_id | - | 非唯一 | BTREE |
| unique_test_case_project | test_case_id, project_id | - | 唯一 | BTREE |

### 表统计

- 记录数：约 28 条
- 数据大小：0.02 MB
- 索引大小：0.06 MB

---

## test_case_sources

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| test_case_id | int | 否 | NULL | 🔗 索引 |  |  |
| source_id | int | 否 | NULL | 🔗 索引 |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |

### 外键关联

| 字段 | 约束名 | 引用表 | 引用字段 | 删除规则 | 更新规则 |
|------|--------|--------|----------|----------|----------|
| test_case_id | test_case_sources_ibfk_1 | test_cases | id | CASCADE | NO ACTION |
| source_id | test_case_sources_ibfk_2 | test_sources | id | CASCADE | NO ACTION |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| source_id | source_id | - | 非唯一 | BTREE |
| unique_test_case_source | test_case_id, source_id | - | 唯一 | BTREE |

### 表统计

- 记录数：约 36 条
- 数据大小：0.02 MB
- 索引大小：0.03 MB

---

## test_case_statuses

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| test_case_id | int | 否 | NULL | 🔗 索引 |  |  |
| status_id | int | 否 | NULL | 🔗 索引 |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |

### 外键关联

| 字段 | 约束名 | 引用表 | 引用字段 | 删除规则 | 更新规则 |
|------|--------|--------|----------|----------|----------|
| test_case_id | test_case_statuses_ibfk_1 | test_cases | id | CASCADE | NO ACTION |
| status_id | test_case_statuses_ibfk_2 | test_statuses | id | CASCADE | NO ACTION |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| status_id | status_id | - | 非唯一 | BTREE |
| unique_test_case_status | test_case_id, status_id | - | 唯一 | BTREE |

### 表统计

- 记录数：约 0 条
- 数据大小：0.02 MB
- 索引大小：0.03 MB

---

## test_case_test_types

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| test_case_id | int | 否 | NULL | 🔗 索引 |  |  |
| test_type_id | int | 否 | NULL | 🔗 索引 |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |

### 外键关联

| 字段 | 约束名 | 引用表 | 引用字段 | 删除规则 | 更新规则 |
|------|--------|--------|----------|----------|----------|
| test_case_id | test_case_test_types_ibfk_1 | test_cases | id | CASCADE | NO ACTION |
| test_type_id | test_case_test_types_ibfk_2 | test_types | id | CASCADE | NO ACTION |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| test_type_id | test_type_id | - | 非唯一 | BTREE |
| unique_test_case_test_type | test_case_id, test_type_id | - | 唯一 | BTREE |

### 表统计

- 记录数：约 19 条
- 数据大小：0.02 MB
- 索引大小：0.03 MB

---

## test_cases

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| case_id | varchar(50) | 否 | NULL | ✨ 唯一 |  |  |
| name | varchar(500) | 否 | NULL |  |  |  |
| priority | varchar(20) | 否 | NULL |  |  |  |
| type | varchar(50) | 否 | NULL |  |  |  |
| precondition | text | 是 | NULL |  |  |  |
| purpose | text | 是 | NULL |  |  |  |
| steps | text | 否 | NULL |  |  |  |
| expected | text | 否 | NULL |  |  |  |
| creator | varchar(50) | 否 | NULL |  |  |  |
| library_id | int | 是 | NULL | 🔗 索引 |  |  |
| module_id | int | 否 | NULL | 🔗 索引 |  |  |
| level1_id | int | 是 | NULL |  |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED on update CURRENT_TIMESTAMP |  |
| owner | varchar(50) | 否 | admin | 🔗 索引 |  |  |
| remark | text | 是 | NULL |  |  |  |
| key_config | text | 是 | NULL |  |  |  |
| method | varchar(50) | 是 | 自动化 |  |  |  |
| status | varchar(50) | 是 | 维护中 | 🔗 索引 |  |  |
| is_deleted | tinyint(1) | 是 | 0 |  |  | 软删除标记 |
| deleted_at | timestamp | 是 | NULL |  |  | 删除时间 |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| case_id | case_id | - | 唯一 | BTREE |
| idx_test_cases_library_id | library_id | - | 非唯一 | BTREE |
| idx_test_cases_module_id | module_id | - | 非唯一 | BTREE |
| idx_test_cases_owner | owner | - | 非唯一 | BTREE |
| idx_test_cases_status | status | - | 非唯一 | BTREE |

### 表统计

- 记录数：约 32 条
- 数据大小：0.02 MB
- 索引大小：0.08 MB

---

## test_execution_logs

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| plan_case_id | int | 否 | NULL | 🔗 索引 |  |  |
| log_type | varchar(20) | 否 | NULL |  |  | 日志类型: INFO, WARNING, ERROR, DEBUG |
| message | text | 否 | NULL |  |  |  |
| timestamp | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |
| metadata | json | 是 | NULL |  |  | 额外元数据 |

### 外键关联

| 字段 | 约束名 | 引用表 | 引用字段 | 删除规则 | 更新规则 |
|------|--------|--------|----------|----------|----------|
| plan_case_id | test_execution_logs_ibfk_1 | test_plan_cases | id | CASCADE | NO ACTION |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| plan_case_id | plan_case_id | - | 非唯一 | BTREE |

### 表统计

- 记录数：约 0 条
- 数据大小：0.02 MB
- 索引大小：0.02 MB

---

## test_methods

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| method_id | varchar(50) | 否 | NULL | ✨ 唯一 |  |  |
| name | varchar(100) | 否 | NULL |  |  |  |
| description | text | 是 | NULL |  |  |  |
| creator | varchar(50) | 否 | NULL |  |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED on update CURRENT_TIMESTAMP |  |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| method_id | method_id | - | 唯一 | BTREE |

### 表统计

- 记录数：约 3 条
- 数据大小：0.02 MB
- 索引大小：0.02 MB

---

## test_phases

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| phase_id | varchar(50) | 否 | NULL | ✨ 唯一 |  |  |
| name | varchar(100) | 否 | NULL |  |  |  |
| description | text | 是 | NULL |  |  |  |
| creator | varchar(50) | 否 | NULL |  |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED on update CURRENT_TIMESTAMP |  |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| phase_id | phase_id | - | 唯一 | BTREE |

### 表统计

- 记录数：约 3 条
- 数据大小：0.02 MB
- 索引大小：0.02 MB

---

## test_plan_cases

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| plan_id | int | 否 | NULL | 🔗 索引 |  |  |
| case_id | int | 否 | NULL | 🔗 索引 |  |  |
| test_point_id | int | 是 | NULL |  |  | 一级测试点ID |
| module_id | int | 是 | NULL |  |  | 模块ID |
| executor_id | varchar(50) | 是 | NULL |  |  | 执行者ID |
| status | varchar(30) | 否 | pending |  |  | 执行状态: Pass, Fail, Block, ASIC_Hang, Core_Dump, Traffic_Drop, pending |
| execution_time | timestamp | 是 | NULL |  |  | 执行时间 |
| duration | int | 是 | NULL |  |  | 执行耗时(秒) |
| log_path | varchar(500) | 是 | NULL |  |  | 日志文件路径 |
| error_message | text | 是 | NULL |  |  | 错误信息 |
| bug_id | varchar(100) | 是 | NULL |  |  | 关联的缺陷ID |
| retry_count | int | 是 | 0 |  |  | 重试次数 |
| pfc_specific | tinyint(1) | 是 | 0 |  |  | 是否为PFC专属测试 |
| buffer_test | tinyint(1) | 是 | 0 |  |  | 是否为Buffer测试 |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED on update CURRENT_TIMESTAMP |  |

### 外键关联

| 字段 | 约束名 | 引用表 | 引用字段 | 删除规则 | 更新规则 |
|------|--------|--------|----------|----------|----------|
| plan_id | test_plan_cases_ibfk_1 | test_plans | id | CASCADE | NO ACTION |
| case_id | test_plan_cases_ibfk_2 | test_cases | id | CASCADE | NO ACTION |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| case_id | case_id | - | 非唯一 | BTREE |
| unique_plan_case | plan_id, case_id | - | 唯一 | BTREE |

### 表统计

- 记录数：约 21 条
- 数据大小：0.02 MB
- 索引大小：0.03 MB

---

## test_plan_rules

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| plan_id | int | 否 | NULL | 🔗 索引 |  |  |
| rule_type | varchar(30) | 否 | NULL |  |  | 规则类型: PRIORITY, AUTOMATION等 |
| rule_name | varchar(100) | 是 | NULL |  |  | 规则名称 |
| rule_config | json | 否 | NULL |  |  | 规则配置JSON |
| priority | int | 是 | 0 |  |  | 规则优先级 |
| enabled | tinyint(1) | 是 | 1 |  |  | 是否启用 |
| created_by | varchar(50) | 否 | NULL |  |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED on update CURRENT_TIMESTAMP |  |

### 外键关联

| 字段 | 约束名 | 引用表 | 引用字段 | 删除规则 | 更新规则 |
|------|--------|--------|----------|----------|----------|
| plan_id | test_plan_rules_ibfk_1 | test_plans | id | CASCADE | NO ACTION |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| plan_id | plan_id | - | 非唯一 | BTREE |

### 表统计

- 记录数：约 0 条
- 数据大小：0.02 MB
- 索引大小：0.02 MB

---

## test_plans

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| name | varchar(100) | 否 | NULL |  |  |  |
| owner | varchar(50) | 否 | NULL | 🔗 索引 |  |  |
| status | varchar(20) | 否 | NULL | 🔗 索引 |  |  |
| test_phase | varchar(50) | 否 | NULL |  |  |  |
| project | varchar(100) | 否 | NULL | 🔗 索引 |  |  |
| iteration | varchar(50) | 是 | NULL |  |  |  |
| description | text | 是 | NULL |  |  |  |
| start_date | date | 是 | NULL |  |  |  |
| end_date | date | 是 | NULL |  |  |  |
| pass_rate | decimal(5,2) | 是 | NULL |  |  |  |
| tested_cases | int | 是 | 0 |  |  |  |
| total_cases | int | 是 | 0 |  |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP | 🔗 索引 | DEFAULT_GENERATED |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED on update CURRENT_TIMESTAMP |  |
| stage_id | int | 是 | NULL |  |  | 测试阶段ID |
| software_id | int | 是 | NULL |  |  | 测试软件ID |
| actual_start_time | datetime | 是 | NULL |  |  | 实际开始时间 |
| actual_end_time | datetime | 是 | NULL |  |  | 实际完成时间 |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| idx_test_plans_created_at | created_at | - | 非唯一 | BTREE |
| idx_test_plans_owner | owner | - | 非唯一 | BTREE |
| idx_test_plans_project | project | - | 非唯一 | BTREE |
| idx_test_plans_status | status | - | 非唯一 | BTREE |

### 表统计

- 记录数：约 1 条
- 数据大小：0.02 MB
- 索引大小：0.06 MB

---

## test_priorities

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| priority_id | varchar(50) | 否 | NULL | ✨ 唯一 |  |  |
| name | varchar(100) | 否 | NULL |  |  |  |
| description | text | 是 | NULL |  |  |  |
| creator | varchar(50) | 否 | NULL |  |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED on update CURRENT_TIMESTAMP |  |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| priority_id | priority_id | - | 唯一 | BTREE |

### 表统计

- 记录数：约 3 条
- 数据大小：0.02 MB
- 索引大小：0.02 MB

---

## test_progresses

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| progress_id | varchar(50) | 否 | NULL | ✨ 唯一 |  |  |
| name | varchar(100) | 否 | NULL |  |  |  |
| description | text | 是 | NULL |  |  |  |
| creator | varchar(50) | 否 | NULL |  |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED on update CURRENT_TIMESTAMP |  |
| status_category | varchar(50) | 是 | not_started |  |  | 进度分类: not_started, in_progress, completed |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| progress_id | progress_id | - | 唯一 | BTREE |

### 表统计

- 记录数：约 2 条
- 数据大小：0.02 MB
- 索引大小：0.02 MB

---

## test_reports

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| name | varchar(100) | 否 | NULL |  |  |  |
| creator | varchar(50) | 否 | NULL |  |  |  |
| creator_id | int | 是 | NULL | 🔗 索引 |  |  |
| project | varchar(100) | 否 | NULL | 🔗 索引 |  |  |
| iteration | varchar(50) | 是 | NULL |  |  |  |
| test_plan_id | int | 是 | NULL | 🔗 索引 |  |  |
| report_type | varchar(20) | 否 | NULL |  |  |  |
| summary | text | 是 | NULL |  |  |  |
| has_ai_analysis | tinyint(1) | 是 | 0 |  |  |  |
| status | varchar(20) | 是 | ready | 🔗 索引 |  |  |
| job_id | varchar(100) | 是 | NULL |  |  |  |
| start_date | date | 是 | NULL |  |  |  |
| end_date | date | 是 | NULL |  |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP | 🔗 索引 | DEFAULT_GENERATED |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED on update CURRENT_TIMESTAMP |  |

### 外键关联

| 字段 | 约束名 | 引用表 | 引用字段 | 删除规则 | 更新规则 |
|------|--------|--------|----------|----------|----------|
| test_plan_id | test_reports_ibfk_1 | test_plans | id | SET NULL | NO ACTION |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| idx_test_reports_created_at | created_at | - | 非唯一 | BTREE |
| idx_test_reports_creator_id | creator_id | - | 非唯一 | BTREE |
| idx_test_reports_project | project | - | 非唯一 | BTREE |
| idx_test_reports_status | status | - | 非唯一 | BTREE |
| test_plan_id | test_plan_id | - | 非唯一 | BTREE |

### 表统计

- 记录数：约 1 条
- 数据大小：0.02 MB
- 索引大小：0.08 MB

---

## test_softwares

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| software_id | varchar(50) | 否 | NULL | ✨ 唯一 |  |  |
| name | varchar(100) | 否 | NULL |  |  |  |
| description | text | 是 | NULL |  |  |  |
| creator | varchar(50) | 否 | NULL |  |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED on update CURRENT_TIMESTAMP |  |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| software_id | software_id | - | 唯一 | BTREE |

### 表统计

- 记录数：约 4 条
- 数据大小：0.02 MB
- 索引大小：0.02 MB

---

## test_sources

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| source_id | varchar(50) | 否 | NULL | ✨ 唯一 |  |  |
| name | varchar(100) | 否 | NULL |  |  |  |
| description | text | 是 | NULL |  |  |  |
| creator | varchar(50) | 否 | NULL |  |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED on update CURRENT_TIMESTAMP |  |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| source_id | source_id | - | 唯一 | BTREE |

### 表统计

- 记录数：约 5 条
- 数据大小：0.02 MB
- 索引大小：0.02 MB

---

## test_statuses

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| status_id | varchar(50) | 否 | NULL | ✨ 唯一 |  |  |
| name | varchar(100) | 否 | NULL |  |  |  |
| description | text | 是 | NULL |  |  |  |
| creator | varchar(50) | 否 | NULL |  |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED on update CURRENT_TIMESTAMP |  |
| status_category | varchar(50) | 是 | pending |  |  | 状态分类: passed, failed, pending, blocked |
| sort_order | int | 是 | 0 |  |  | 排序顺序 |
| is_active | tinyint(1) | 是 | 1 |  |  | 是否启用 |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| status_id | status_id | - | 唯一 | BTREE |

### 表统计

- 记录数：约 5 条
- 数据大小：0.02 MB
- 索引大小：0.02 MB

---

## test_types

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| type_id | varchar(50) | 否 | NULL | ✨ 唯一 |  |  |
| name | varchar(100) | 否 | NULL |  |  |  |
| description | text | 是 | NULL |  |  |  |
| creator | varchar(50) | 否 | NULL |  |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED on update CURRENT_TIMESTAMP |  |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| type_id | type_id | - | 唯一 | BTREE |

### 表统计

- 记录数：约 5 条
- 数据大小：0.02 MB
- 索引大小：0.02 MB

---

## testpoint_chips

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| testpoint_id | int | 否 | NULL | 🔗 索引 |  |  |
| chip_id | int | 否 | NULL |  |  |  |
| chip_sequence | varchar(255) | 否 |  |  |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| unique_testpoint_chip | testpoint_id, chip_id | - | 唯一 | BTREE |

### 表统计

- 记录数：约 0 条
- 数据大小：0.02 MB
- 索引大小：0.02 MB

---

## testpoint_status

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| testpoint_id | int | 否 | NULL | 🔗 索引 |  |  |
| chip_id | int | 否 | NULL |  |  |  |
| test_result | varchar(20) | 否 | NULL |  |  |  |
| test_date | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| unique_testpoint_chip_status | testpoint_id, chip_id | - | 唯一 | BTREE |

### 表统计

- 记录数：约 0 条
- 数据大小：0.02 MB
- 索引大小：0.02 MB

---

## user_skill_settings

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| user_id | int | 否 | NULL | 🔗 索引 |  | 用户ID |
| skill_id | int | 否 | NULL | 🔗 索引 |  | 技能ID |
| is_enabled | tinyint(1) | 是 | 1 |  |  | 是否启用 |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED on update CURRENT_TIMESTAMP |  |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| idx_skill_id | skill_id | - | 非唯一 | BTREE |
| idx_user_id | user_id | - | 非唯一 | BTREE |
| uk_user_skill | user_id, skill_id | - | 唯一 | BTREE |

### 表统计

- 记录数：约 0 条
- 数据大小：0.02 MB
- 索引大小：0.05 MB

---

## users

**说明：** 无注释

### 表结构

| 字段名 | 类型 | 允许 NULL | 默认值 | 键 | 额外 | 注释 |
|--------|------|----------|--------|-----|------|------|
| id | int | 否 | NULL | 🔑 主键 | auto_increment |  |
| username | varchar(50) | 否 | NULL | ✨ 唯一 |  |  |
| password | varchar(255) | 否 | NULL |  |  |  |
| role | varchar(20) | 否 | NULL | 🔗 索引 |  |  |
| email | varchar(100) | 否 | NULL | ✨ 唯一 |  |  |
| created_at | timestamp | 是 | CURRENT_TIMESTAMP | 🔗 索引 | DEFAULT_GENERATED |  |
| updated_at | timestamp | 是 | CURRENT_TIMESTAMP |  | DEFAULT_GENERATED |  |
| status | enum('pending','active','disabled') | 是 | active |  |  | 用户状态: pending-待审核, active-正常, disabled-禁用 |
| email_notify_mentions | tinyint(1) | 是 | 1 |  |  | 接收@提醒邮件 |
| email_notify_comments | tinyint(1) | 是 | 1 |  |  | 接收评论提醒邮件 |
| email_notify_likes | tinyint(1) | 是 | 0 |  |  | 接收被赞提醒邮件 |
| muted_until | timestamp | 是 | NULL |  |  | 禁言到期时间 |

### 索引

| 索引名 | 字段 | 顺序 | 唯一性 | 类型 |
|------|------|------|--------|------|
| email | email | - | 唯一 | BTREE |
| idx_users_created_at | created_at | - | 非唯一 | BTREE |
| idx_users_role | role | - | 非唯一 | BTREE |
| idx_users_username | username | - | 非唯一 | BTREE |
| username | username | - | 唯一 | BTREE |

### 表统计

- 记录数：约 5 条
- 数据大小：0.02 MB
- 索引大小：0.08 MB

---

## 表关联关系

以下是数据库中所有外键关联关系的汇总：

### 外键关系列表

| 表名 | 字段 | 引用表 | 引用字段 | 删除规则 | 更新规则 |
|------|------|--------|----------|----------|----------|
| email_logs | config_id | email_config | id | SET NULL | NO ACTION |
| test_case_environments | test_case_id | test_cases | id | CASCADE | NO ACTION |
| test_case_environments | environment_id | environments | id | CASCADE | NO ACTION |
| test_case_methods | test_case_id | test_cases | id | CASCADE | NO ACTION |
| test_case_methods | method_id | test_methods | id | CASCADE | NO ACTION |
| test_case_phases | test_case_id | test_cases | id | CASCADE | NO ACTION |
| test_case_phases | phase_id | test_phases | id | CASCADE | NO ACTION |
| test_case_progresses | test_case_id | test_cases | id | CASCADE | NO ACTION |
| test_case_progresses | progress_id | test_progresses | id | CASCADE | NO ACTION |
| test_case_projects | status_id | test_statuses | id | SET NULL | NO ACTION |
| test_case_projects | project_id | projects | id | CASCADE | NO ACTION |
| test_case_projects | progress_id | test_progresses | id | SET NULL | NO ACTION |
| test_case_projects | test_case_id | test_cases | id | CASCADE | NO ACTION |
| test_case_sources | test_case_id | test_cases | id | CASCADE | NO ACTION |
| test_case_sources | source_id | test_sources | id | CASCADE | NO ACTION |
| test_case_statuses | test_case_id | test_cases | id | CASCADE | NO ACTION |
| test_case_statuses | status_id | test_statuses | id | CASCADE | NO ACTION |
| test_case_test_types | test_case_id | test_cases | id | CASCADE | NO ACTION |
| test_case_test_types | test_type_id | test_types | id | CASCADE | NO ACTION |
| test_execution_logs | plan_case_id | test_plan_cases | id | CASCADE | NO ACTION |
| test_plan_cases | plan_id | test_plans | id | CASCADE | NO ACTION |
| test_plan_cases | case_id | test_cases | id | CASCADE | NO ACTION |
| test_plan_rules | plan_id | test_plans | id | CASCADE | NO ACTION |
| test_reports | test_plan_id | test_plans | id | SET NULL | NO ACTION |

### 按引用表分组

#### email_config 被以下表引用

- email_logs.config_id → email_config.id

#### test_cases 被以下表引用

- test_case_environments.test_case_id → test_cases.id
- test_case_methods.test_case_id → test_cases.id
- test_case_phases.test_case_id → test_cases.id
- test_case_progresses.test_case_id → test_cases.id
- test_case_projects.test_case_id → test_cases.id
- test_case_sources.test_case_id → test_cases.id
- test_case_statuses.test_case_id → test_cases.id
- test_case_test_types.test_case_id → test_cases.id
- test_plan_cases.case_id → test_cases.id

#### environments 被以下表引用

- test_case_environments.environment_id → environments.id

#### test_methods 被以下表引用

- test_case_methods.method_id → test_methods.id

#### test_phases 被以下表引用

- test_case_phases.phase_id → test_phases.id

#### test_progresses 被以下表引用

- test_case_progresses.progress_id → test_progresses.id
- test_case_projects.progress_id → test_progresses.id

#### test_statuses 被以下表引用

- test_case_projects.status_id → test_statuses.id
- test_case_statuses.status_id → test_statuses.id

#### projects 被以下表引用

- test_case_projects.project_id → projects.id

#### test_sources 被以下表引用

- test_case_sources.source_id → test_sources.id

#### test_types 被以下表引用

- test_case_test_types.test_type_id → test_types.id

#### test_plan_cases 被以下表引用

- test_execution_logs.plan_case_id → test_plan_cases.id

#### test_plans 被以下表引用

- test_plan_cases.plan_id → test_plans.id
- test_plan_rules.plan_id → test_plans.id
- test_reports.test_plan_id → test_plans.id

