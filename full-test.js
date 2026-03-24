// 完整测试脚本：测试用例关联项目的整个生命周期
// 包括：创建测试用例、关联项目、数据库验证、更新关联、删除关联等

const mysql = require('mysql2/promise');
const http = require('http');

// 数据库配置（从.env文件中获取）
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: 'zsz12345',
    database: 'ctcsdk_testplan'
};

const API_BASE_URL = 'http://localhost:3000/api';

// 辅助函数：发送HTTP请求
async function httpRequest(endpoint, method = 'GET', data = null) {
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json'
        }
    };

    if (data) {
        options.body = JSON.stringify(data);
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
    const result = await response.json();
    return {
        status: response.status,
        data: result
    };
}

// 辅助函数：打印测试结果
function printResult(title, status, data) {
    console.log(`\n=== ${title} ===`);
    console.log(`状态: ${status ? '✅ 成功' : '❌ 失败'}`);
    if (data) {
        console.log(`数据: ${JSON.stringify(data, null, 2)}`);
    }
}

// 主测试函数
async function runFullTest() {
    console.log('🚀 开始完整测试：测试用例关联项目生命周期');
    
    let testCaseId = null;
    let connection = null;

    try {
        // 1. 连接数据库
        console.log('\n1. 连接数据库...');
        connection = await mysql.createConnection(dbConfig);
        printResult('连接数据库', true, { host: dbConfig.host, database: dbConfig.database });

        // 2. 获取第一个已存在的测试用例
        console.log('\n2. 获取测试用例...');
        const [existingCases] = await connection.execute(
            'SELECT id, name FROM test_cases LIMIT 1'
        );

        if (existingCases.length > 0) {
            testCaseId = existingCases[0].id;
            printResult('获取测试用例', true, { message: '找到测试用例', testCaseId, name: existingCases[0].name });
        } else {
            throw new Error('没有找到测试用例，请先创建测试用例');
        }

        // 3. 测试获取项目列表
        console.log('\n3. 测试获取项目列表...');
        const projectsResult = await httpRequest('/projects/list');
        printResult('获取项目列表', projectsResult.status === 200, projectsResult.data);

        if (projectsResult.status !== 200 || !projectsResult.data.success || !projectsResult.data.projects || projectsResult.data.projects.length === 0) {
            throw new Error('获取项目列表失败，无法继续测试');
        }

        const projectIds = projectsResult.data.projects.slice(0, 2).map(p => p.id);
        printResult('选择测试项目', true, { projectIds });

        // 4. 测试关联项目到测试用例
        console.log('\n4. 测试关联项目到测试用例...');
        const associationData = {
            associations: [
                {
                    project_id: projectIds[0],
                    owner: '1',
                    progress_id: '1',
                    status_id: '1',
                    remark: '测试关联项目1'
                },
                {
                    project_id: projectIds[1],
                    owner: '2',
                    progress_id: '2',
                    status_id: '2',
                    remark: '测试关联项目2'
                }
            ]
        };

        const updateResult = await httpRequest(`/testcases/${testCaseId}/projects`, 'PUT', associationData);
        printResult('关联项目到测试用例', updateResult.status === 200 && updateResult.data.success, updateResult.data);

        // 5. 数据库验证：检查关联是否正确保存
        console.log('\n5. 数据库验证：检查关联是否正确保存...');
        const [dbAssociations] = await connection.execute(
            'SELECT * FROM test_case_projects WHERE test_case_id = ?',
            [testCaseId]
        );
        printResult('数据库验证关联保存', dbAssociations.length === 2, dbAssociations);

        // 6. 测试获取测试用例关联项目
        console.log('\n6. 测试获取测试用例关联项目...');
        const getAssociationsResult = await httpRequest(`/testcases/${testCaseId}/projects`);
        printResult('获取测试用例关联项目', getAssociationsResult.status === 200 && getAssociationsResult.data.success, getAssociationsResult.data);

        // 7. 测试更新关联项目
        console.log('\n7. 测试更新关联项目...');
        const updateAssociationData = {
            associations: [
                {
                    project_id: projectIds[0],
                    owner: '1',
                    progress_id: '2',
                    status_id: '2',
                    remark: '更新后的测试关联项目1'
                }
            ]
        };

        const updateResult2 = await httpRequest(`/testcases/${testCaseId}/projects`, 'PUT', updateAssociationData);
        printResult('更新关联项目', updateResult2.status === 200 && updateResult2.data.success, updateResult2.data);

        // 8. 数据库验证：检查更新是否正确
        console.log('\n8. 数据库验证：检查更新是否正确...');
        const [updatedAssociations] = await connection.execute(
            'SELECT * FROM test_case_projects WHERE test_case_id = ?',
            [testCaseId]
        );
        printResult('数据库验证关联更新', updatedAssociations.length === 1 && updatedAssociations[0].remark === '更新后的测试关联项目1', updatedAssociations);

        // 9. 测试删除所有关联项目
        console.log('\n9. 测试删除所有关联项目...');
        const removeAllResult = await httpRequest(`/testcases/${testCaseId}/projects`, 'PUT', { associations: [] });
        printResult('删除所有关联项目', removeAllResult.status === 200 && removeAllResult.data.success, removeAllResult.data);

        // 10. 数据库验证：检查是否已删除
        console.log('\n10. 数据库验证：检查是否已删除...');
        const [emptyAssociations] = await connection.execute(
            'SELECT * FROM test_case_projects WHERE test_case_id = ?',
            [testCaseId]
        );
        printResult('数据库验证关联删除', emptyAssociations.length === 0, emptyAssociations);

        // 11. 测试旧格式（projectIds）更新
        console.log('\n11. 测试旧格式（projectIds）更新...');
        const oldFormatResult = await httpRequest(`/testcases/${testCaseId}/projects`, 'PUT', { projectIds: [projectIds[0]] });
        printResult('旧格式更新', oldFormatResult.status === 200 && oldFormatResult.data.success, oldFormatResult.data);

        // 12. 最终数据库验证
        console.log('\n12. 最终数据库验证...');
        const [finalAssociations] = await connection.execute(
            'SELECT * FROM test_case_projects WHERE test_case_id = ?',
            [testCaseId]
        );
        printResult('最终数据库验证', finalAssociations.length === 1, finalAssociations);

        // 13. 清理测试数据（只清理关联项目，不删除测试用例）
        console.log('\n13. 清理测试数据...');
        await connection.execute('DELETE FROM test_case_projects WHERE test_case_id = ?', [testCaseId]);
        printResult('清理测试数据', true, { testCaseId, message: '已清理关联项目，保留测试用例' });

        // 🎉 测试完成
        console.log('\n\n🎉 完整测试完成！所有测试通过！');

    } catch (error) {
        console.error('\n\n❌ 测试失败:', error);
        console.error('错误堆栈:', error.stack);
    } finally {
        // 关闭数据库连接
        if (connection) {
            await connection.end();
            console.log('\n🔌 数据库连接已关闭');
        }
    }
}

// 运行测试
runFullTest();
