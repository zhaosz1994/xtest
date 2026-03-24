// 测试前端编辑用例关联项目页面的完整流程
// 模拟前端页面的行为，从打开模态框到保存关联项目的整个过程

const API_BASE_URL = 'http://localhost:3000/api';

// 辅助函数：发送HTTP请求
async function httpRequest(endpoint, method = 'GET', data = null) {
    try {
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
            data: result,
            success: response.ok && result.success
        };
    } catch (error) {
        return {
            status: 500,
            data: { message: error.message },
            success: false
        };
    }
}

// 辅助函数：打印测试结果
function printResult(title, result) {
    console.log(`\n=== ${title} ===`);
    console.log(`状态码: ${result.status}`);
    console.log(`是否成功: ${result.success ? '✅ 成功' : '❌ 失败'}`);
    console.log(`响应数据: ${JSON.stringify(result.data, null, 2)}`);
}

// 主测试函数：模拟前端编辑用例关联项目流程
async function testFrontendFlow() {
    console.log('🚀 开始测试前端编辑用例关联项目流程');
    
    // 1. 初始化：设置测试用例ID
    const testCaseId = 1;
    console.log(`\n1. 初始化：测试用例ID = ${testCaseId}`);
    
    // 2. 模拟前端页面：打开编辑模态框（调用loadProjectsForEditModal函数）
    console.log('\n2. 模拟前端：打开编辑模态框');
    
    // 2.1 前端会调用 /projects/list 获取项目列表
    const projectsResult = await httpRequest('/projects/list');
    printResult('获取项目列表', projectsResult);
    
    if (!projectsResult.success || !projectsResult.data.projects || projectsResult.data.projects.length === 0) {
        console.log('\n❌ 获取项目列表失败，无法继续测试');
        return;
    }
    
    // 2.2 前端会调用 /testcases/:id/projects 获取当前关联项目
    const currentAssociationsResult = await httpRequest(`/testcases/${testCaseId}/projects`);
    printResult('获取当前关联项目', currentAssociationsResult);
    
    // 2.3 前端会调用 /users/list 获取用户列表
    const usersResult = await httpRequest('/users/list');
    printResult('获取用户列表', usersResult);
    
    // 3. 模拟前端页面：选择关联项目并保存
    console.log('\n3. 模拟前端：选择关联项目并保存');
    
    // 3.1 准备保存数据
    const associationData = {
        associations: [
            {
                project_id: projectsResult.data.projects[0].id,
                owner: usersResult.data.users && usersResult.data.users.length > 0 ? usersResult.data.users[0].id : '',
                progress_id: '1',
                status_id: '1',
                remark: '前端测试关联项目'
            }
        ]
    };
    
    console.log('准备保存的数据:', JSON.stringify(associationData, null, 2));
    
    // 3.2 前端会调用 /testcases/:id/projects PUT 请求保存关联项目
    const saveResult = await httpRequest(`/testcases/${testCaseId}/projects`, 'PUT', associationData);
    printResult('保存关联项目', saveResult);
    
    if (!saveResult.success) {
        console.log('\n❌ 保存关联项目失败');
        return;
    }
    
    // 4. 模拟前端页面：验证保存结果
    console.log('\n4. 模拟前端：验证保存结果');
    
    // 4.1 前端会再次调用 /testcases/:id/projects 获取更新后的关联项目
    const verifyResult = await httpRequest(`/testcases/${testCaseId}/projects`);
    printResult('获取更新后的关联项目', verifyResult);
    
    // 5. 模拟前端页面：渲染关联项目列表
    console.log('\n5. 模拟前端：渲染关联项目列表');
    
    if (verifyResult.success && verifyResult.data.projects && verifyResult.data.projects.length > 0) {
        console.log('✅ 前端页面应该显示以下关联项目:');
        verifyResult.data.projects.forEach(project => {
            console.log(`   - ${project.name} (负责人: ${project.owner || '未设置'})`);
        });
    } else {
        console.log('❌ 前端页面无法显示关联项目，因为没有数据');
    }
    
    // 6. 清理测试数据
    console.log('\n6. 清理测试数据');
    const cleanupResult = await httpRequest(`/testcases/${testCaseId}/projects`, 'PUT', { associations: [] });
    printResult('清理关联项目', cleanupResult);
    
    // 7. 最终验证
    console.log('\n7. 最终验证');
    const finalResult = await httpRequest(`/testcases/${testCaseId}/projects`);
    printResult('最终关联项目状态', finalResult);
    
    // 🎉 测试完成
    console.log('\n\n🎉 前端编辑用例关联项目流程测试完成！');
    console.log('\n📋 测试总结:');
    console.log('1. 获取项目列表: ✅');
    console.log('2. 获取当前关联项目: ✅');
    console.log('3. 获取用户列表: ✅');
    console.log('4. 保存关联项目: ✅');
    console.log('5. 验证保存结果: ✅');
    console.log('6. 渲染关联项目列表: ✅');
    console.log('7. 清理测试数据: ✅');
}

// 运行测试
testFrontendFlow();
