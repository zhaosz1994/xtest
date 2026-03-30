# xTest 后端系统

## 数据库设计

### 1. 用户表 (users)
| 字段名 | 数据类型 | 约束 | 描述 |
| :--- | :--- | :--- | :--- |
| `id` | `INT` | `PRIMARY KEY AUTO_INCREMENT` | 用户ID |
| `username` | `VARCHAR(50)` | `UNIQUE NOT NULL` | 用户名 |
| `password` | `VARCHAR(255)` | `NOT NULL` | 密码（加密存储） |
| `role` | `VARCHAR(20)` | `NOT NULL` | 角色（管理员/测试人员） |
| `email` | `VARCHAR(100)` | `UNIQUE NOT NULL` | 邮箱 |
| `created_at` | `TIMESTAMP` | `DEFAULT CURRENT_TIMESTAMP` | 创建时间 |
| `updated_at` | `TIMESTAMP` | `DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP` | 更新时间 |

### 2. 模块表 (modules)
| 字段名 | 数据类型 | 约束 | 描述 |
| :--- | :--- | :--- | :--- |
| `id` | `INT` | `PRIMARY KEY AUTO_INCREMENT` | 模块ID |
| `module_id` | `VARCHAR(50)` | `UNIQUE NOT NULL` | 模块标识符 |
| `name` | `VARCHAR(100)` | `NOT NULL` | 模块名称 |
| `created_at` | `TIMESTAMP` | `DEFAULT CURRENT_TIMESTAMP` | 创建时间 |
| `updated_at` | `TIMESTAMP` | `DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP` | 更新时间 |

### 3. 一级测试点表 (level1_points)
| 字段名 | 数据类型 | 约束 | 描述 |
| :--- | :--- | :--- | :--- |
| `id` | `INT` | `PRIMARY KEY AUTO_INCREMENT` | 一级测试点ID |
| `module_id` | `INT` | `FOREIGN KEY REFERENCES modules(id)` | 所属模块ID |
| `name` | `VARCHAR(100)` | `NOT NULL` | 一级测试点名称 |
| `created_at` | `TIMESTAMP` | `DEFAULT CURRENT_TIMESTAMP` | 创建时间 |
| `updated_at` | `TIMESTAMP` | `DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP` | 更新时间 |

### 4. 二级测试点表 (level2_points)
| 字段名 | 数据类型 | 约束 | 描述 |
| :--- | :--- | :--- | :--- |
| `id` | `INT` | `PRIMARY KEY AUTO_INCREMENT` | 二级测试点ID |
| `level1_id` | `INT` | `FOREIGN KEY REFERENCES level1_points(id)` | 所属一级测试点ID |
| `name` | `VARCHAR(100)` | `NOT NULL` | 二级测试点名称 |
| `test_steps` | `TEXT` | `NOT NULL` | 测试步骤 |
| `expected_behavior` | `TEXT` | `NOT NULL` | 期望行为 |
| `chip_sequence` | `VARCHAR(255)` | `NOT NULL` | 芯片序列 |
| `test_result` | `VARCHAR(20)` | `NOT NULL` | 测试结果 |
| `test_environment` | `VARCHAR(255)` | `NOT NULL` | 测试环境 |
| `case_name` | `VARCHAR(100)` | `NOT NULL` | Case名字 |
| `remarks` | `TEXT` | | 备注 |
| `created_at` | `TIMESTAMP` | `DEFAULT CURRENT_TIMESTAMP` | 创建时间 |
| `updated_at` | `TIMESTAMP` | `DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP` | 更新时间 |

### 5. 历史记录表 (history)
| 字段名 | 数据类型 | 约束 | 描述 |
| :--- | :--- | :--- | :--- |
| `id` | `INT` | `PRIMARY KEY AUTO_INCREMENT` | 历史记录ID |
| `user_id` | `INT` | `FOREIGN KEY REFERENCES users(id)` | 操作用户ID |
| `action` | `VARCHAR(50)` | `NOT NULL` | 操作类型 |
| `content` | `TEXT` | `NOT NULL` | 操作内容 |
| `version` | `VARCHAR(20)` | `NOT NULL` | 版本号 |
| `created_at` | `TIMESTAMP` | `DEFAULT CURRENT_TIMESTAMP` | 创建时间 |

## 后端代码实现

### 1. 项目初始化
```bash
npm init -y
npm install express mysql2 bcryptjs jsonwebtoken cors dotenv
```

### 2. 配置文件 (.env)
```env
# 数据库连接信息
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=ctcsdk_testplan

# JWT密钥
JWT_SECRET=your_jwt_secret

# 服务器配置
PORT=3000
```

### 3. 数据库连接 (db.js)
```javascript
const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = pool;
```

### 4. 中间件 (middleware.js)
```javascript
const jwt = require('jsonwebtoken');
require('dotenv').config();

// JWT认证中间件
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: '访问令牌缺失' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: '访问令牌无效' });
    }
    req.user = user;
    next();
  });
};

// 管理员权限中间件
const requireAdmin = (req, res, next) => {
  if (req.user.role !== '管理员') {
    return res.status(403).json({ message: '需要管理员权限' });
  }
  next();
};

module.exports = {
  authenticateToken,
  requireAdmin
};
```

### 5. 路由 (routes/)

#### 5.1 用户路由 (routes/users.js)
```javascript
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware');
require('dotenv').config();

// 登录
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const [users] = await pool.execute('SELECT * FROM users WHERE username = ?', [username]);
    if (users.length === 0) {
      return res.status(401).json({ message: '用户名或密码错误' });
    }

    const user = users[0];
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: '用户名或密码错误' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ token, user: { id: user.id, username: user.username, role: user.role, email: user.email } });
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// 注册
router.post('/register', async (req, res) => {
  const { username, password, email } = req.body;

  try {
    // 检查用户名是否已存在
    const [existingUsers] = await pool.execute('SELECT * FROM users WHERE username = ?', [username]);
    if (existingUsers.length > 0) {
      return res.status(400).json({ message: '用户名已存在' });
    }

    // 检查邮箱是否已存在
    const [existingEmails] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
    if (existingEmails.length > 0) {
      return res.status(400).json({ message: '邮箱已被注册' });
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10);

    // 创建新用户（默认角色为测试人员）
    await pool.execute(
      'INSERT INTO users (username, password, role, email) VALUES (?, ?, ?, ?)',
      [username, hashedPassword, '测试人员', email]
    );

    res.json({ message: '注册成功' });
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// 获取用户列表（需要管理员权限）
router.get('/list', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [users] = await pool.execute('SELECT id, username, role, email FROM users');
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// 添加用户（需要管理员权限）
router.post('/add', authenticateToken, requireAdmin, async (req, res) => {
  const { username, password, role, email } = req.body;

  try {
    // 检查用户名是否已存在
    const [existingUsers] = await pool.execute('SELECT * FROM users WHERE username = ?', [username]);
    if (existingUsers.length > 0) {
      return res.status(400).json({ message: '用户名已存在' });
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10);

    // 创建新用户
    await pool.execute(
      'INSERT INTO users (username, password, role, email) VALUES (?, ?, ?, ?)',
      [username, hashedPassword, role, email]
    );

    res.json({ message: '用户添加成功' });
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// 编辑用户（需要管理员权限）
router.put('/edit/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { role, email } = req.body;

  try {
    await pool.execute(
      'UPDATE users SET role = ?, email = ? WHERE id = ?',
      [role, email, id]
    );

    res.json({ message: '用户编辑成功' });
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// 删除用户（需要管理员权限）
router.delete('/delete/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    await pool.execute('DELETE FROM users WHERE id = ?', [id]);
    res.json({ message: '用户删除成功' });
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

module.exports = router;
```

#### 5.2 模块路由 (routes/modules.js)
```javascript
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware');

// 获取模块列表
router.get('/list', authenticateToken, async (req, res) => {
  try {
    const [modules] = await pool.execute('SELECT id, module_id, name FROM modules');
    res.json(modules);
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// 添加模块
router.post('/add', authenticateToken, async (req, res) => {
  const { module_id, name } = req.body;

  try {
    await pool.execute(
      'INSERT INTO modules (module_id, name) VALUES (?, ?)',
      [module_id, name]
    );

    res.json({ message: '模块添加成功' });
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// 删除模块
router.delete('/delete/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    // 先删除相关的测试点
    await pool.execute('DELETE FROM level2_points WHERE level1_id IN (SELECT id FROM level1_points WHERE module_id = ?)', [id]);
    await pool.execute('DELETE FROM level1_points WHERE module_id = ?', [id]);
    
    // 删除模块
    await pool.execute('DELETE FROM modules WHERE id = ?', [id]);
    
    res.json({ message: '模块删除成功' });
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

module.exports = router;
```

#### 5.3 测试点路由 (routes/testpoints.js)
```javascript
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware');

// 获取一级测试点列表
router.get('/level1/:moduleId', authenticateToken, async (req, res) => {
  const { moduleId } = req.params;

  try {
    const [points] = await pool.execute('SELECT id, name FROM level1_points WHERE module_id = ?', [moduleId]);
    res.json(points);
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// 添加一级测试点
router.post('/level1/add', authenticateToken, async (req, res) => {
  const { module_id, name } = req.body;

  try {
    await pool.execute(
      'INSERT INTO level1_points (module_id, name) VALUES (?, ?)',
      [module_id, name]
    );

    res.json({ message: '一级测试点添加成功' });
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// 获取二级测试点列表
router.get('/level2/:level1Id', authenticateToken, async (req, res) => {
  const { level1Id } = req.params;

  try {
    const [points] = await pool.execute('SELECT * FROM level2_points WHERE level1_id = ?', [level1Id]);
    res.json(points);
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// 添加二级测试点
router.post('/level2/add', authenticateToken, async (req, res) => {
  const { level1_id, name, test_steps, expected_behavior, chip_sequence, test_result, test_environment, case_name, remarks } = req.body;

  try {
    await pool.execute(
      'INSERT INTO level2_points (level1_id, name, test_steps, expected_behavior, chip_sequence, test_result, test_environment, case_name, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [level1_id, name, test_steps, expected_behavior, chip_sequence, test_result, test_environment, case_name, remarks]
    );

    res.json({ message: '二级测试点添加成功' });
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// 编辑二级测试点
router.put('/level2/edit/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name, test_steps, expected_behavior, chip_sequence, test_result, test_environment, case_name, remarks } = req.body;

  try {
    await pool.execute(
      'UPDATE level2_points SET name = ?, test_steps = ?, expected_behavior = ?, chip_sequence = ?, test_result = ?, test_environment = ?, case_name = ?, remarks = ? WHERE id = ?',
      [name, test_steps, expected_behavior, chip_sequence, test_result, test_environment, case_name, remarks, id]
    );

    res.json({ message: '二级测试点编辑成功' });
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// 删除二级测试点
router.delete('/level2/delete/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    await pool.execute('DELETE FROM level2_points WHERE id = ?', [id]);
    res.json({ message: '二级测试点删除成功' });
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

module.exports = router;
```

#### 5.4 历史记录路由 (routes/history.js)
```javascript
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware');

// 获取历史记录
router.get('/list', authenticateToken, async (req, res) => {
  try {
    const [history] = await pool.execute('SELECT h.*, u.username FROM history h JOIN users u ON h.user_id = u.id ORDER BY h.created_at DESC LIMIT 100');
    res.json(history);
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// 添加历史记录
router.post('/add', authenticateToken, async (req, res) => {
  const { action, content, version } = req.body;
  const userId = req.user.id;

  try {
    await pool.execute(
      'INSERT INTO history (user_id, action, content, version) VALUES (?, ?, ?, ?)',
      [userId, action, content, version]
    );

    res.json({ message: '历史记录添加成功' });
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

module.exports = router;
```

### 6. 主服务器文件 (server.js)
```javascript
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const usersRouter = require('./routes/users');
const modulesRouter = require('./routes/modules');
const testpointsRouter = require('./routes/testpoints');
const historyRouter = require('./routes/history');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());

// 路由
app.use('/api/users', usersRouter);
app.use('/api/modules', modulesRouter);
app.use('/api/testpoints', testpointsRouter);
app.use('/api/history', historyRouter);

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 初始化数据库
async function initDatabase() {
  try {
    // 创建数据库（如果不存在）
    await pool.execute(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME}`);
    await pool.execute(`USE ${process.env.DB_NAME}`);

    // 创建用户表
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT PRIMARY KEY AUTO_INCREMENT,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // 创建模块表
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS modules (
        id INT PRIMARY KEY AUTO_INCREMENT,
        module_id VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // 创建一级测试点表
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS level1_points (
        id INT PRIMARY KEY AUTO_INCREMENT,
        module_id INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE
      )
    `);

    // 创建二级测试点表
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS level2_points (
        id INT PRIMARY KEY AUTO_INCREMENT,
        level1_id INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        test_steps TEXT NOT NULL,
        expected_behavior TEXT NOT NULL,
        chip_sequence VARCHAR(255) NOT NULL,
        test_result VARCHAR(20) NOT NULL,
        test_environment VARCHAR(255) NOT NULL,
        case_name VARCHAR(100) NOT NULL,
        remarks TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (level1_id) REFERENCES level1_points(id) ON DELETE CASCADE
      )
    `);

    // 创建历史记录表
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS history (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        action VARCHAR(50) NOT NULL,
        content TEXT NOT NULL,
        version VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // 检查是否有管理员用户
    const [users] = await pool.execute('SELECT * FROM users WHERE role = ?', ['管理员']);
    if (users.length === 0) {
      // 创建默认管理员用户
      const bcrypt = require('bcryptjs');
      const hashedPassword = await bcrypt.hash('ctc@2026.', 10);
      await pool.execute(
        'INSERT INTO users (username, password, role, email) VALUES (?, ?, ?, ?)',
        ['admin', hashedPassword, '管理员', 'admin@example.com']
      );
    }

    console.log('数据库初始化完成');
  } catch (error) {
    console.error('数据库初始化失败:', error);
  }
}

// 启动服务器
app.listen(PORT, async () => {
  await initDatabase();
  console.log(`服务器运行在 http://localhost:${PORT}`);
});
```

## 前端代码修改建议

### 1. 添加API调用函数
```javascript
// API基础URL
const API_BASE_URL = 'http://localhost:3000/api';

// 存储token
let token = localStorage.getItem('ctcsdk_token');

// 设置请求头
function getAuthHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
}

// 登录
async function loginAPI(username, password) {
  const response = await fetch(`${API_BASE_URL}/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await response.json();
  if (response.ok) {
    token = data.token;
    localStorage.setItem('ctcsdk_token', token);
    localStorage.setItem('ctcsdk_user', JSON.stringify(data.user));
  }
  return data;
}

// 注册
async function registerAPI(username, password, email) {
  const response = await fetch(`${API_BASE_URL}/users/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, email })
  });
  return await response.json();
}

// 获取模块列表
async function getModulesAPI() {
  const response = await fetch(`${API_BASE_URL}/modules/list`, {
    headers: getAuthHeaders()
  });
  return await response.json();
}

// 添加模块
async function addModuleAPI(moduleId, name) {
  const response = await fetch(`${API_BASE_URL}/modules/add`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ module_id: moduleId, name })
  });
  return await response.json();
}

// 获取历史记录
async function getHistoryAPI() {
  const response = await fetch(`${API_BASE_URL}/history/list`, {
    headers: getAuthHeaders()
  });
  return await response.json();
}

// 添加历史记录
async function addHistoryAPI(action, content, version) {
  const response = await fetch(`${API_BASE_URL}/history/add`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ action, content, version })
  });
  return await response.json();
}
```

### 2. 修改登录和注册函数
```javascript
// 登录功能
async function login() {
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  
  try {
    const result = await loginAPI(username, password);
    if (result.token) {
      currentUser = result.user;
      document.getElementById('user-info').textContent = `${currentUser.username} (${currentUser.role})`;
      
      // 隐藏登录/注册页面，显示首页
      document.getElementById('login-section').style.display = 'none';
      document.getElementById('register-section').style.display = 'none';
      document.getElementById('dashboard-section').style.display = 'block';
      
      // 根据角色显示/隐藏相应功能
      if (currentUser.role === '管理员') {
        document.querySelector('nav a[href="#users"]').style.display = 'block';
      } else {
        document.querySelector('nav a[href="#users"]').style.display = 'none';
      }
      
      // 初始化模块
      await initModules();
      
      // 更新统计数据
      updateStats();
    } else {
      alert(result.message);
    }
  } catch (error) {
    alert('登录失败，请检查网络连接');
  }
}

// 注册功能
async function register() {
  const username = document.getElementById('reg-username').value;
  const password = document.getElementById('reg-password').value;
  const email = document.getElementById('reg-email').value;
  
  try {
    const result = await registerAPI(username, password, email);
    if (result.message === '注册成功') {
      alert('注册成功，请登录');
      document.getElementById('register-section').style.display = 'none';
      document.getElementById('login-section').style.display = 'block';
    } else {
      alert(result.message);
    }
  } catch (error) {
    alert('注册失败，请检查网络连接');
  }
}
```

### 3. 修改模块初始化函数
```javascript
// 初始化模块
async function initModules() {
  const moduleTabs = document.querySelector('.module-tabs');
  const moduleContent = document.querySelector('.module-content');
  
  // 清空现有模块
  moduleTabs.innerHTML = '';
  moduleContent.innerHTML = '';
  
  try {
    // 从API获取模块列表
    const modulesData = await getModulesAPI();
    
    // 添加模块标签和内容
    modulesData.forEach(module => {
      // 添加模块标签
      const newTab = document.createElement('button');
      newTab.className = 'module-tab';
      newTab.dataset.module = module.module_id;
      newTab.textContent = module.name;
      moduleTabs.appendChild(newTab);
      
      // 添加模块内容
      const newPanel = document.createElement('div');
      newPanel.id = `${module.module_id}-content`;
      newPanel.className = 'module-panel';
      newPanel.innerHTML = `
        <h3>${module.name}测试计划</h3>
        <div class="test-points">
          <button id="add-level1-btn-${module.module_id}" class="add-level1-btn">添加一级测试点</button>
        </div>
      `;
      moduleContent.appendChild(newPanel);
      
      // 添加事件监听器
      newTab.addEventListener('click', function() {
        switchModule(this.dataset.module);
      });
      
      document.getElementById(`add-level1-btn-${module.module_id}`).addEventListener('click', function() {
        addLevel1Point(module.module_id);
      });
    });
    
    // 添加添加模块按钮
    const addModuleBtn = document.createElement('button');
    addModuleBtn.id = 'add-module-btn';
    addModuleBtn.textContent = '添加模块';
    addModuleBtn.addEventListener('click', addModule);
    moduleTabs.appendChild(addModuleBtn);
    
    // 激活第一个模块
    if (modulesData.length > 0) {
      document.querySelector('.module-tab').classList.add('active');
      document.querySelector('.module-panel').classList.add('active');
      currentModule = modulesData[0].module_id;
    }
  } catch (error) {
    console.error('获取模块列表失败:', error);
  }
}
```

### 4. 修改添加模块函数
```javascript
// 添加模块
async function addModule() {
  const moduleName = prompt('请输入模块名称：');
  if (!moduleName) return;
  
  const moduleId = `module${Date.now()}`;
  
  try {
    const result = await addModuleAPI(moduleId, moduleName);
    if (result.message === '模块添加成功') {
      // 添加模块标签
      const moduleTabs = document.querySelector('.module-tabs');
      const newTab = document.createElement('button');
      newTab.className = 'module-tab';
      newTab.dataset.module = moduleId;
      newTab.textContent = moduleName;
      moduleTabs.insertBefore(newTab, document.getElementById('add-module-btn'));
      
      // 添加模块内容
      const moduleContent = document.querySelector('.module-content');
      const newPanel = document.createElement('div');
      newPanel.id = `${moduleId}-content`;
      newPanel.className = 'module-panel';
      newPanel.innerHTML = `
        <h3>${moduleName}测试计划</h3>
        <div class="test-points">
          <button id="add-level1-btn-${moduleId}" class="add-level1-btn">添加一级测试点</button>
        </div>
      `;
      moduleContent.appendChild(newPanel);
      
      // 添加事件监听器
      newTab.addEventListener('click', function() {
        switchModule(this.dataset.module);
      });
      
      document.getElementById(`add-level1-btn-${moduleId}`).addEventListener('click', function() {
        addLevel1Point(moduleId);
      });
      
      // 记录添加模块历史
      await addHistoryAPI('添加模块', `添加了模块 ${moduleName}`, `v${Date.now()}`);
      
      // 切换到新模块
      switchModule(moduleId);
    } else {
      alert(result.message);
    }
  } catch (error) {
    alert('添加模块失败，请检查网络连接');
  }
}
```

## 部署步骤

1. **安装依赖**
   ```bash
   npm install
   ```

2. **配置数据库连接**
   修改 `.env` 文件中的数据库连接信息。

3. **启动数据库**
   确保 MySQL 服务已启动。

4. **启动后端服务器**
   ```bash
   node server.js
   ```

5. **部署前端**
   将修改后的前端代码部署到 web 服务器或直接在浏览器中打开 `index.html`。

## 注意事项

1. **安全性**
   - 密码使用 bcryptjs 加密存储
   - 使用 JWT 进行身份验证
   - 实现了基于角色的访问控制

2. **性能**
   - 使用连接池管理数据库连接
   - 合理的索引设计
   - 限制历史记录查询数量

3. **可扩展性**
   - 模块化的代码结构
   - 清晰的 API 设计
   - 易于添加新功能

4. **维护性**
   - 详细的代码注释
   - 标准化的错误处理
   - 遵循 RESTful API 设计规范