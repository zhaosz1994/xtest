// 详细测试关联项目数据流：从API到前端映射表到页面渲染
// 模拟前端代码的每一步，验证数据是否正确处理

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
            success: response.ok
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
function printSection(title) {
    console.log(`\n\n=== ${title} ===`);
}

function printResult(title, data) {
    console.log(`\n${title}:`);
    console.log(JSON.stringify(data, null, 2));
}

// 主测试函数
async function testAssociationFlow() {
    console.log('🚀 开始详细测试关联项目数据流');
    
    const testCaseId = 1;
    console.log(`\n测试用例ID: ${testCaseId}`);
    
    // 1. 先为测试用例创建一些关联项目
    printSection('1. 为测试用例创建关联项目');
    
    // 1.1 获取项目列表
    const projectsResult = await httpRequest('/projects/list');
    printResult('项目列表API返回', projectsResult);
    
    if (!projectsResult.success || !projectsResult.data.projects || projectsResult.data.projects.length < 2) {
        console.log('\n❌ 项目列表不足，无法测试');
        return;
    }
    
    // 1.2 创建关联项目
    const createData = {
        associations: [
            {
                project_id: projectsResult.data.projects[0].id,
                owner: '1',
                progress_id: '1',
                status_id: '1',
                remark: '测试关联项目1'
            },
            {
                project_id: projectsResult.data.projects[1].id,
                owner: '2',
                progress_id: '2',
                status_id: '2',
                remark: '测试关联项目2'
            }
        ]
    };
    
    printResult('准备创建的关联数据', createData);
    
    const createResult = await httpRequest(`/testcases/${testCaseId}/projects`, 'PUT', createData);
    printResult('创建关联项目API返回', createResult);
    
    // 2. 测试获取关联项目API
    printSection('2. 测试获取关联项目API');
    
    const getAssociationsResult = await httpRequest(`/testcases/${testCaseId}/projects`);
    printResult('获取关联项目API返回', getAssociationsResult);
    
    if (!getAssociationsResult.success || !getAssociationsResult.data.projects) {
        console.log('\n❌ 获取关联项目失败');
        return;
    }
    
    const apiAssociations = getAssociationsResult.data.projects;
    printResult('API返回的关联项目列表', apiAssociations);
    
    // 3. 模拟前端映射表创建过程
    printSection('3. 模拟前端映射表创建');
    
    // 3.1 模拟前端调用getTestCaseProjectDetails函数
    const testCaseAssociations = apiAssociations;
    printResult('前端获取到的关联项目', testCaseAssociations);
    
    // 3.2 模拟前端创建映射表
    console.log('\n前端代码：创建关联项目映射表');
    console.log('原始代码：const associationsMap = {};');
    console.log('原始代码：testCaseAssociations.forEach(association => { associationsMap[association.id] = association; });');
    
    // 创建映射表
    const associationsMap = {};
    testCaseAssociations.forEach(association => {
        // 这里是关键：API返回的是项目信息，不是关联信息
        console.log(`处理关联项目: project_id=${association.id}, name=${association.name}`);
        associationsMap[association.id] = association;
    });
    
    printResult('创建的映射表', associationsMap);
    
    // 4. 模拟前端项目列表渲染
    printSection('4. 模拟前端项目列表渲染');
    
    // 4.1 获取完整项目列表
    const fullProjects = projectsResult.data.projects;
    printResult('完整项目列表', fullProjects);
    
    // 4.2 模拟前端遍历项目列表，检查是否关联
    console.log('\n前端代码：遍历项目列表，检查是否关联');
    fullProjects.forEach(project => {
        console.log(`\n处理项目: id=${project.id}, name=${project.name}`);
        const isAssociated = associationsMap[project.id] !== undefined;
        console.log(`关联状态: ${isAssociated ? '已关联' : '未关联'}`);
        
        if (isAssociated) {
            const association = associationsMap[project.id];
            console.log(`关联信息: owner=${association.owner}, progress_id=${association.progress_id}, status_id=${association.status_id}, remark=${association.remark}`);
        }
    });
    
    // 5. 测试前端渲染逻辑
    printSection('5. 测试前端渲染逻辑');
    
    // 5.1 模拟前端的映射表逻辑
    console.log('\n测试前端映射表逻辑：');
    console.log('问题1：API返回的是项目信息，不是关联信息');
    console.log('问题2：关联信息应该包含项目ID和关联属性');
    console.log('问题3：前端期望的是关联表中的项目关联信息');
    
    // 5.2 测试正确的映射表逻辑
    console.log('\n正确的映射表逻辑应该是：');
    console.log('1. API返回的是项目列表，每个项目包含关联信息');
    console.log('2. 前端应该直接根据API返回的项目列表渲染');
    console.log('3. 对于每个项目，检查是否有关联信息');
    
    // 6. 测试直接渲染API返回数据
    printSection('6. 测试直接渲染API返回数据');
    
    // 6.1 直接使用API返回的数据渲染
    console.log('\n直接使用API返回的数据渲染：');
    apiAssociations.forEach(project => {
        console.log(`项目: ${project.name}，关联状态: 已关联`);
        console.log(`  负责人: ${project.owner}`);
        console.log(`  测试进度: ${project.progress_name || project.progress_id}`);
        console.log(`  测试状态: ${project.status_name || project.status_id}`);
        console.log(`  备注: ${project.remark}`);
    });
    
    // 7. 修复前端代码逻辑
    printSection('7. 修复前端代码逻辑');
    
    console.log('\n前端代码需要修复的问题：');
    console.log('1. getTestCaseProjectDetails函数返回的是项目列表，不是关联信息列表');
    console.log('2. 映射表应该直接使用项目ID作为键');
    console.log('3. 渲染时应该直接检查项目是否在关联列表中');
    
    // 8. 验证修复后的逻辑
    printSection('8. 验证修复后的逻辑');
    
    // 8.1 修复后的映射表逻辑
    console.log('\n修复后的映射表逻辑：');
    const fixedAssociationsMap = {};
    apiAssociations.forEach(project => {
        // API返回的项目ID就是关联的项目ID
        fixedAssociationsMap[project.id] = {
            owner: project.owner,
            progress_id: project.progress_id,
            status_id: project.status_id,
            remark: project.remark
        };
    });
    
    printResult('修复后的映射表', fixedAssociationsMap);
    
    // 8.2 修复后的渲染逻辑
    console.log('\n修复后的渲染逻辑：');
    fullProjects.forEach(project => {
        const isAssociated = fixedAssociationsMap[project.id] !== undefined;
        console.log(`项目: ${project.name}，关联状态: ${isAssociated ? '已关联' : '未关联'}`);
        
        if (isAssociated) {
            const association = fixedAssociationsMap[project.id];
            console.log(`  负责人: ${association.owner}`);
            console.log(`  测试进度: ${association.progress_id}`);
            console.log(`  测试状态: ${association.status_id}`);
            console.log(`  备注: ${association.remark}`);
        }
    });
    
    // 9. 清理测试数据
    printSection('9. 清理测试数据');
    
    const cleanupResult = await httpRequest(`/testcases/${testCaseId}/projects`, 'PUT', { associations: [] });
    printResult('清理关联项目API返回', cleanupResult);
    
    // 10. 最终验证
    printSection('10. 最终验证');
    
    const finalResult = await httpRequest(`/testcases/${testCaseId}/projects`);
    printResult('最终关联项目状态', finalResult);
    
    console.log('\n\n🎉 详细测试完成！');
    console.log('\n📋 测试总结:');
    console.log('1. API返回的是项目列表，每个项目包含关联信息');
    console.log('2. 前端映射表创建逻辑有误，需要修复');
    console.log('3. 正确的做法是直接使用API返回的项目ID作为键');
    console.log('4. 渲染时直接检查项目是否在关联列表中');
}

// 运行测试
testAssociationFlow();
