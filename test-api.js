// 测试编辑用例关联项目API的脚本
const fetch = require('node-fetch');

const API_BASE_URL = 'http://localhost:3000/api';

// 测试用例ID，需要先创建一个测试用例
const TEST_CASE_ID = 1;

// 测试项目ID，需要确保这些项目存在
const TEST_PROJECT_IDS = [1, 2];

async function testAPI() {
    console.log('=== 测试编辑用例关联项目API ===\n');
    
    try {
        // 1. 测试获取测试用例关联项目
        console.log('1. 测试获取测试用例关联项目');
        const getResponse = await fetch(`${API_BASE_URL}/testcases/${TEST_CASE_ID}/projects`);
        const getResult = await getResponse.json();
        console.log('状态码:', getResponse.status);
        console.log('响应结果:', JSON.stringify(getResult, null, 2));
        console.log('');
        
        // 2. 测试更新测试用例关联项目
        console.log('2. 测试更新测试用例关联项目');
        const updateData = {
            associations: [
                {
                    project_id: TEST_PROJECT_IDS[0],
                    owner: '1',
                    progress_id: '1',
                    status_id: '1',
                    remark: '测试关联项目1'
                },
                {
                    project_id: TEST_PROJECT_IDS[1],
                    owner: '2',
                    progress_id: '2',
                    status_id: '2',
                    remark: '测试关联项目2'
                }
            ]
        };
        
        const updateResponse = await fetch(`${API_BASE_URL}/testcases/${TEST_CASE_ID}/projects`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updateData)
        });
        
        const updateResult = await updateResponse.json();
        console.log('状态码:', updateResponse.status);
        console.log('请求数据:', JSON.stringify(updateData, null, 2));
        console.log('响应结果:', JSON.stringify(updateResult, null, 2));
        console.log('');
        
        // 3. 再次获取测试用例关联项目，验证更新是否成功
        console.log('3. 验证更新是否成功');
        const verifyResponse = await fetch(`${API_BASE_URL}/testcases/${TEST_CASE_ID}/projects`);
        const verifyResult = await verifyResponse.json();
        console.log('状态码:', verifyResponse.status);
        console.log('更新后的数据:', JSON.stringify(verifyResult, null, 2));
        console.log('');
        
        // 4. 测试获取项目列表
        console.log('4. 测试获取项目列表');
        const projectsResponse = await fetch(`${API_BASE_URL}/projects/list`);
        const projectsResult = await projectsResponse.json();
        console.log('状态码:', projectsResponse.status);
        console.log('项目列表:', JSON.stringify(projectsResult, null, 2));
        console.log('');
        
        // 5. 测试获取用户列表
        console.log('5. 测试获取用户列表');
        const usersResponse = await fetch(`${API_BASE_URL}/users/list`);
        const usersResult = await usersResponse.json();
        console.log('状态码:', usersResponse.status);
        console.log('用户列表:', JSON.stringify(usersResult, null, 2));
        console.log('');
        
        console.log('=== 测试完成 ===');
        
    } catch (error) {
        console.error('测试过程中发生错误:', error);
        process.exit(1);
    }
}

testAPI();
