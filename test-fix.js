// 测试修复后的关联项目保存功能
const API_BASE_URL = 'http://localhost:3000/api';
const TEST_CASE_ID = 'CASE-20260118-8279';

// 延迟函数
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 发送HTTP请求的函数
async function sendRequest(endpoint, method = 'GET', body = null) {
    const options = {
        method: method,
        headers: {
            'Content-Type': 'application/json'
        }
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error(`发送请求失败 ${endpoint}:`, error);
        throw error;
    }
}

// 测试主函数
async function runTest() {
    console.log('=== 开始测试关联项目保存功能 ===');
    console.log(`测试用例ID: ${TEST_CASE_ID}`);
    console.log('\n1. 查询可用项目列表');
    
    // 查询可用项目列表
    let response = await sendRequest('/projects/list');
    let projectList = [];
    
    // 处理不同的数据格式
    if (response.success && Array.isArray(response.projects)) {
        projectList = response.projects;
    } else if (response.data && response.data.success && Array.isArray(response.data.projects)) {
        projectList = response.data.projects;
    } else if (Array.isArray(response)) {
        projectList = response;
    }
    
    console.log('可用项目列表:', projectList);
    
    // 确保至少有两个项目可用
    if (projectList.length < 2) {
        console.log('\n❌ 测试失败！可用项目数量不足2个。');
        return;
    }
    
    // 选择前两个项目
    const project1 = projectList[0];
    const project2 = projectList[1];
    
    console.log('\n2. 初始状态 - 查询当前关联项目');
    
    // 初始状态查询
    response = await sendRequest(`/testcases/${TEST_CASE_ID}/projects`);
    console.log('当前关联项目:', response.projects);
    
    console.log('\n3. 添加两个关联项目');
    console.log(`添加项目: ${project1.id} (${project1.name}) 和 ${project2.id} (${project2.name})`);
    
    // 添加两个关联项目
    response = await sendRequest(`/testcases/${TEST_CASE_ID}/projects`, 'PUT', {
        associations: [
            {
                project_id: project1.id,
                owner: 'zhaosz',
                progress_id: 1,
                status_id: 1,
                remark: '测试备注1'
            },
            {
                project_id: project2.id,
                owner: 'user1',
                progress_id: 2,
                status_id: 2,
                remark: '测试备注2'
            }
        ]
    });
    
    console.log('添加结果:', response.success ? '成功' : '失败');
    if (response.success) {
        console.log('\n4. 查询添加后的关联项目');
        response = await sendRequest(`/testcases/${TEST_CASE_ID}/projects`);
        console.log('添加后的关联项目:', response.projects);
        
        // 验证添加结果
        if (response.success && Array.isArray(response.projects) && response.projects.length === 2) {
            console.log('\n5. 取消勾选一个项目（只保留项目1）');
            // 取消勾选一个项目
            response = await sendRequest(`/testcases/${TEST_CASE_ID}/projects`, 'PUT', {
                associations: [
                    {
                        project_id: project1.id,
                        owner: 'zhaosz',
                        progress_id: 1,
                        status_id: 1,
                        remark: '测试备注1'
                    }
                ]
            });
            
            console.log('取消勾选结果:', response.success ? '成功' : '失败');
            
            console.log('\n6. 查询取消勾选后的关联项目');
            response = await sendRequest(`/testcases/${TEST_CASE_ID}/projects`);
            console.log('取消勾选后的关联项目:', response.projects);
            
            // 验证结果
            if (response.success && Array.isArray(response.projects)) {
                if (response.projects.length === 1 && response.projects[0].id === project1.id) {
                    console.log('\n✅ 测试通过！只有被取消勾选的项目被删除，其他项目保持不变。');
                } else {
                    console.log('\n❌ 测试失败！取消勾选后项目数量或ID不符合预期。');
                    console.log(`预期：1个项目，ID为${project1.id}`);
                    console.log(`实际：${response.projects.length}个项目，ID列表：${response.projects.map(p => p.id).join(', ')}`);
                }
            } else {
                console.log('\n❌ 测试失败！查询关联项目失败。');
            }
        } else {
            console.log('\n❌ 测试失败！添加两个关联项目失败。');
            console.log(`预期：2个项目`);
            console.log(`实际：${response.projects ? response.projects.length : 0}个项目`);
        }
    } else {
        console.log('\n❌ 测试失败！添加关联项目失败。');
    }
    
    console.log('\n=== 测试结束 ===');
}

// 运行测试
runTest();
