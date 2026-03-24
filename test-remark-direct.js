// 直接测试测试用例备注功能，不依赖外部模块

// 使用Node.js内置的http模块
const http = require('http');

const BASE_URL = 'localhost:3000';

// 测试数据
const testCaseData = {
    caseId: 'TEST-CASE-' + Date.now(),
    name: 'Test Remark Functionality',
    priority: 'medium',
    type: 'functional',
    precondition: 'Test precondition',
    purpose: 'Test purpose',
    steps: '1. Step 1\n2. Step 2\n3. Step 3',
    expected: 'Expected result',
    creator: 'admin',
    owner: 'admin',
    libraryId: 1,
    moduleId: 1,
    level1Id: 1,
    projects: [],
    environments: [1],
    methods: [1],
    remark: 'Test case remark - initial version'
};

// 发送HTTP请求的函数
function sendRequest(path, method, body) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: BASE_URL.split(':')[0],
            port: parseInt(BASE_URL.split(':')[1]),
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const parsedData = JSON.parse(data);
                    resolve(parsedData);
                } catch (error) {
                    reject(new Error('Failed to parse response: ' + error.message));
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.write(body);
        req.end();
    });
}

// 测试步骤
async function testRemarkFunctionality() {
    try {
        console.log('=== Start testing test case remark functionality ===\n');
        
        // 1. 新建测试用例并添加备注
        console.log('1. Creating test case with remark...');
        const createResponse = await sendRequest('/api/cases/create', 'POST', JSON.stringify(testCaseData));
        console.log('Create test case result:', JSON.stringify(createResponse, null, 2));
        
        if (!createResponse.success) {
            console.error('Create test case failed:', createResponse.message);
            return;
        }
        
        console.log('Create test case succeeded');
        
        // 2. 获取测试用例列表，验证备注是否返回
        console.log('\n2. Getting test cases list, verifying remark is returned...');
        const listResponse = await sendRequest('/api/cases/list', 'POST', JSON.stringify({ page: 1, pageSize: 32 }));
        console.log('Get test cases list result:', JSON.stringify(listResponse, null, 2));
        
        const createdTestCase = listResponse.testCases.find(tc => tc.caseId === testCaseData.caseId);
        if (!createdTestCase) {
            console.error('Could not find created test case');
            return;
        }
        
        console.log('Found created test case:', JSON.stringify(createdTestCase, null, 2));
        
        if (createdTestCase.remark === testCaseData.remark) {
            console.log('✓ Test passed: Remark is correctly returned');
        } else {
            console.error('✗ Test failed: Remark is not correctly returned');
            console.error('Expected remark:', testCaseData.remark);
            console.error('Actual remark:', createdTestCase.remark);
            return;
        }
        
        // 3. 更新测试用例的备注
        console.log('\n3. Updating test case remark...');
        const updatedRemark = 'Test case remark - updated version';
        const updateData = {
            ...testCaseData,
            id: createdTestCase.id,
            remark: updatedRemark
        };
        const updateResponse = await sendRequest('/api/cases/update', 'POST', JSON.stringify(updateData));
        console.log('Update test case result:', JSON.stringify(updateResponse, null, 2));
        
        if (!updateResponse.success) {
            console.error('Update test case failed:', updateResponse.message);
            return;
        }
        
        console.log('Update test case succeeded');
        
        // 4. 再次获取测试用例列表，验证更新后的备注是否返回
        console.log('\n4. Getting test cases list again, verifying updated remark is returned...');
        const listResponse2 = await sendRequest('/api/cases/list', 'POST', JSON.stringify({ page: 1, pageSize: 32 }));
        
        const updatedTestCase = listResponse2.testCases.find(tc => tc.caseId === testCaseData.caseId);
        if (!updatedTestCase) {
            console.error('Could not find updated test case');
            return;
        }
        
        console.log('Found updated test case:', JSON.stringify(updatedTestCase, null, 2));
        
        if (updatedTestCase.remark === updatedRemark) {
            console.log('✓ Test passed: Updated remark is correctly returned');
        } else {
            console.error('✗ Test failed: Updated remark is not correctly returned');
            console.error('Expected remark:', updatedRemark);
            console.error('Actual remark:', updatedTestCase.remark);
            return;
        }
        
        console.log('\n=== All tests passed! ===');
        
    } catch (error) {
        console.error('Test failed:', error.message);
        console.error(error.stack);
    }
}

// 执行测试
testRemarkFunctionality();