const mysql = require('mysql2/promise');

// 数据库配置
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: 'zsz12345',
    database: 'ctcsdk_testplan'
};

async function queryTestCaseProjects(caseId) {
    let connection;
    try {
        // 创建数据库连接
        connection = await mysql.createConnection(dbConfig);
        console.log('数据库连接成功');
        
        // 1. 查询测试用例的ID
        console.log(`\n1. 查询测试用例 ${caseId} 的ID:`);
        const [testCases] = await connection.execute(
            'SELECT id FROM test_cases WHERE case_id = ?', [caseId]
        );
        
        if (testCases.length === 0) {
            console.log(`未找到测试用例 ${caseId}`);
            return;
        }
        
        const testCaseId = testCases[0].id;
        console.log(`测试用例 ${caseId} 的ID: ${testCaseId}`);
        
        // 2. 查询关联的项目
        console.log(`\n2. 查询测试用例 ${caseId} 关联的项目:`);
        const [projectAssociations] = await connection.execute(
            `SELECT tcp.*, p.name as project_name 
             FROM test_case_projects tcp 
             JOIN projects p ON tcp.project_id = p.id 
             WHERE tcp.test_case_id = ?`, 
            [testCaseId]
        );
        
        if (projectAssociations.length === 0) {
            console.log(`测试用例 ${caseId} 未关联任何项目`);
            return;
        }
        
        console.log(`测试用例 ${caseId} 关联了 ${projectAssociations.length} 个项目:`);
        projectAssociations.forEach((assoc, index) => {
            console.log(`\n项目 ${index + 1}:`);
            console.log(`  项目ID: ${assoc.project_id}`);
            console.log(`  项目名称: ${assoc.project_name}`);
            console.log(`  负责人: ${assoc.owner || '未设置'}`);
            console.log(`  测试进度ID: ${assoc.progress_id || '未设置'}`);
            console.log(`  测试状态ID: ${assoc.status_id || '未设置'}`);
            console.log(`  备注: ${assoc.remark || '无'}`);
            console.log(`  创建时间: ${assoc.created_at}`);
            console.log(`  更新时间: ${assoc.updated_at}`);
        });
        
    } catch (error) {
        console.error('查询过程中发生错误:', error.message);
        console.error('错误堆栈:', error.stack);
    } finally {
        // 关闭数据库连接
        if (connection) {
            await connection.end();
            console.log('\n数据库连接已关闭');
        }
    }
}

// 执行查询
queryTestCaseProjects('CASE-20260118-8279');
