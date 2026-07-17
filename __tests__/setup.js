/**
 * Jest 测试环境设置
 * 在所有测试运行前执行
 */

// 设置测试环境变量
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing';
process.env.DB_HOST = 'localhost';
process.env.DB_USER = 'test_user';
process.env.DB_PASSWORD = 'test_password';
process.env.DB_NAME = 'xtest_test';

// 增加测试超时时间
jest.setTimeout(30000);

// 全局测试前钩子
beforeAll(async () => {
    console.log('🚀 开始运行测试套件...');
});

// 全局测试后钩子
afterAll(async () => {
    console.log('✅ 测试套件运行完成');
});

// 模拟 console.error 以保持测试输出清洁
global.console = {
    ...console,
    error: jest.fn(),
    warn: jest.fn(),
    log: jest.fn()
};
