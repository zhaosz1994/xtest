// 测试测试用例备注功能
const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:3000/api';

// 测试数据
const testCaseData = {
    caseId: 'TEST-CASE-' + Date.now(),
    name: '测试用例备注功能',
    priority: 'medium',
    type: 'functional',
    precondition: '测试前置条件',
    purpose: '测试目的',
    steps: '1. 步骤1\n2. 步骤2\n3. 步骤3',
    expected: '预期结果',
    creator: 'admin',
    owner: 'admin',
    libraryId: 1,
    moduleId: 1,
    level1Id: 1,
    projects: [],
    environments: [1],
    methods: [1],
    remark: '测试用例备注 - 初始版本'
};

// 测试步骤
async function testRemarkFunctionality() {
    try {
        console.log('=== 开始测试测试用例备注功能 ===\n');
        
        // 1. 新建测试用例并添加备注
        console.log('1. 新建测试用例并添加备注...');
        const createResponse = await fetch(`${BASE_URL}/cases/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(testCaseData)
        });
        const createResult = await createResponse.json();
        console.log('新建测试用例结果:', JSON.stringify(createResult, null, 2));
        
        if (!createResult.success) {
            console.error('新建测试用例失败:', createResult.message);
            return;
        }
        
        const testCaseId = createResult.testCaseId;
        console.log('新建测试用例成功，ID:', testCaseId);
        
        // 2. 获取测试用例列表，验证备注是否返回
        console.log('\n2. 获取测试用例列表，验证备注是否返回...');
        const listResponse = await fetch(`${BASE_URL}/cases/list`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ page: 1, pageSize: 32 })
        });
        const listResult = await listResponse.json();
        console.log('获取测试用例列表结果:', JSON.stringify(listResult, null, 2));
        
        const createdTestCase = listResult.testCases.find(tc => tc.caseId === testCaseData.caseId);
        if (!createdTestCase) {
            console.error('未找到新建的测试用例');
            return;
        }
        
        console.log('找到新建的测试用例:', JSON.stringify(createdTestCase, null, 2));
        if (createdTestCase.remark === testCaseData.remark) {
            console.log('✓ 测试通过：测试用例备注正确返回');
        } else {
            console.error('✗ 测试失败：测试用例备注未正确返回');
            return;
        }
        
        // 3. 更新测试用例的备注
        console.log('\n3. 更新测试用例的备注...');
        const updatedRemark = '测试用例备注 - 更新版本';
        const updateResponse = await fetch(`${BASE_URL}/cases/update`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ...testCaseData,
                id: createdTestCase.id,
                remark: updatedRemark
            })
        });
        const updateResult = await updateResponse.json();
        console.log('更新测试用例结果:', JSON.stringify(updateResult, null, 2));
        
        if (!updateResult.success) {
            console.error('更新测试用例失败:', updateResult.message);
            return;
        }
        
        // 4. 再次获取测试用例列表，验证更新后的备注是否返回
        console.log('\n4. 再次获取测试用例列表，验证更新后的备注是否返回...');
        const listResponse2 = await fetch(`${BASE_URL}/cases/list`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ page: 1, pageSize: 32 })
        });
        const listResult2 = await listResponse2.json();
        
        const updatedTestCase = listResult2.testCases.find(tc => tc.caseId === testCaseData.caseId);
        if (!updatedTestCase) {
            console.error('未找到更新的测试用例');
            return;
        }
        
        console.log('找到更新的测试用例:', JSON.stringify(updatedTestCase, null, 2));
        if (updatedTestCase.remark === updatedRemark) {
            console.log('✓ 测试通过：更新后的测试用例备注正确返回');
        } else {
            console.error('✗ 测试失败：更新后的测试用例备注未正确返回');
            return;
        }
        
        console.log('\n=== 测试用例备注功能测试全部通过！ ===');
        
    } catch (error) {
        console.error('测试用例备注功能测试失败:', error.message);
        console.error(error.stack);
    }
}

// 执行测试
testRemarkFunctionality();