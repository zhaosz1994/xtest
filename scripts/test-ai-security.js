#!/usr/bin/env node

const { validateSQL, extractTablesFromSQL, isSelectOnly } = require('../services/sqlSecurityValidator');
const { encryptAPIKey, decryptAPIKey, isEncrypted } = require('../services/apiKeyEncryption');
const connectionPoolMonitor = require('../services/connectionPoolMonitor');

console.log('========================================');
console.log('AI安全机制验证测试');
console.log('========================================\n');

let passedTests = 0;
let failedTests = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passedTests++;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  错误: ${error.message}`);
    failedTests++;
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: 期望 ${expected}, 实际 ${actual}`);
  }
}

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertFalse(condition, message) {
  if (condition) {
    throw new Error(message);
  }
}

console.log('1. SQL安全验证测试');
console.log('----------------------------------------');

test('允许SELECT查询', () => {
  const sql = 'SELECT * FROM test_cases WHERE id = ?';
  const result = validateSQL(sql);
  assertTrue(result.valid, 'SELECT查询应该被允许');
  assertEqual(result.operation, 'select', '操作类型应该是select');
});

test('禁止DELETE操作', () => {
  const sql = 'DELETE FROM test_cases WHERE id = ?';
  const result = validateSQL(sql);
  assertFalse(result.valid, 'DELETE操作应该被禁止');
  assertTrue(result.errors.length > 0, '应该返回错误信息');
});

test('禁止UPDATE操作', () => {
  const sql = 'UPDATE test_cases SET name = ? WHERE id = ?';
  const result = validateSQL(sql);
  assertFalse(result.valid, 'UPDATE操作应该被禁止');
});

test('禁止INSERT操作', () => {
  const sql = 'INSERT INTO test_cases (name) VALUES (?)';
  const result = validateSQL(sql);
  assertFalse(result.valid, 'INSERT操作应该被禁止');
});

test('禁止访问敏感表users', () => {
  const sql = 'SELECT * FROM users';
  const result = validateSQL(sql);
  assertFalse(result.valid, '访问users表应该被禁止');
  assertTrue(result.errors.some(e => e.includes('users')), '错误信息应该包含users表');
});

test('禁止访问敏感表ai_models', () => {
  const sql = 'SELECT * FROM ai_models';
  const result = validateSQL(sql);
  assertFalse(result.valid, '访问ai_models表应该被禁止');
});

test('提取表名功能', () => {
  const sql = 'SELECT * FROM test_cases tc JOIN test_plans tp ON tc.plan_id = tp.id';
  const tables = extractTablesFromSQL(sql);
  assertTrue(tables.includes('test_cases'), '应该提取到test_cases表');
  assertTrue(tables.includes('test_plans'), '应该提取到test_plans表');
});

test('isSelectOnly函数', () => {
  assertTrue(isSelectOnly('SELECT * FROM test_cases'), 'SELECT查询应该返回true');
  assertFalse(isSelectOnly('DELETE FROM test_cases'), 'DELETE查询应该返回false');
});

console.log('\n2. API Key加密测试');
console.log('----------------------------------------');

test('API Key加密', () => {
  const apiKey = 'sk-test-api-key-123456';
  const encrypted = encryptAPIKey(apiKey);
  assertTrue(encrypted !== apiKey, '加密后的值应该与原始值不同');
  assertTrue(isEncrypted(encrypted), '应该识别为已加密的值');
});

test('API Key解密', () => {
  const apiKey = 'sk-test-api-key-123456';
  const encrypted = encryptAPIKey(apiKey);
  const decrypted = decryptAPIKey(encrypted);
  assertEqual(decrypted, apiKey, '解密后的值应该与原始值相同');
});

test('识别未加密的值', () => {
  const plainText = 'plain-text-api-key';
  assertFalse(isEncrypted(plainText), '未加密的值应该返回false');
});

test('加密空值', () => {
  const encrypted = encryptAPIKey(null);
  assertEqual(encrypted, null, '加密null应该返回null');
});

test('解密空值', () => {
  const decrypted = decryptAPIKey(null);
  assertEqual(decrypted, null, '解密null应该返回null');
});

console.log('\n3. 连接池监控测试');
console.log('----------------------------------------');

test('获取连接池状态', () => {
  const status = connectionPoolMonitor.getPoolStatus();
  assertTrue(typeof status === 'object' || status === null, '应该返回对象或null');
});

test('获取性能指标', () => {
  const metrics = connectionPoolMonitor.getMetrics();
  assertTrue(typeof metrics === 'object', '应该返回对象');
  assertTrue('totalQueries' in metrics, '应该包含totalQueries字段');
  assertTrue('poolStatus' in metrics, '应该包含poolStatus字段');
});

test('记录查询性能', () => {
  const initialMetrics = connectionPoolMonitor.getMetrics();
  const initialTotal = initialMetrics.totalQueries;
  
  connectionPoolMonitor.recordQuery(100, true);
  
  const newMetrics = connectionPoolMonitor.getMetrics();
  assertEqual(newMetrics.totalQueries, initialTotal + 1, 'totalQueries应该增加1');
});

console.log('\n4. 综合安全测试');
console.log('----------------------------------------');

test('SQL注入防护 - UNION注入', () => {
  const sql = "SELECT * FROM test_cases UNION SELECT * FROM users";
  const result = validateSQL(sql);
  assertFalse(result.valid, 'UNION注入应该被检测到');
});

test('SQL注入防护 - OR 1=1', () => {
  const sql = "SELECT * FROM test_cases WHERE id = ? OR 1=1";
  const result = validateSQL(sql);
  assertTrue(result.valid, '带参数的OR查询应该被允许');
});

test('复杂SELECT查询', () => {
  const sql = `
    SELECT tc.*, tp.name as plan_name
    FROM test_cases tc
    LEFT JOIN test_plans tp ON tc.plan_id = tp.id
    WHERE tc.project_id = ?
    ORDER BY tc.created_at DESC
    LIMIT 10
  `;
  const result = validateSQL(sql);
  assertTrue(result.valid, '复杂SELECT查询应该被允许');
});

test('子查询', () => {
  const sql = `
    SELECT * FROM test_cases
    WHERE project_id IN (SELECT id FROM projects WHERE creator_id = ?)
  `;
  const result = validateSQL(sql);
  assertTrue(result.valid, '子查询应该被允许');
});

console.log('\n========================================');
console.log('测试结果汇总');
console.log('========================================');
console.log(`通过: ${passedTests}`);
console.log(`失败: ${failedTests}`);
console.log(`总计: ${passedTests + failedTests}`);
console.log(`通过率: ${((passedTests / (passedTests + failedTests)) * 100).toFixed(2)}%`);
console.log('========================================\n');

if (failedTests > 0) {
  console.error('❌ 存在失败的测试，请检查安全机制实现');
  process.exit(1);
} else {
  console.log('✓ 所有测试通过，安全机制正常工作');
  process.exit(0);
}
