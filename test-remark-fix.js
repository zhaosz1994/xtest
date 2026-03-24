const http = require('http');

const API_BASE_URL = 'http://localhost:3000/api';

// 简单的HTTP请求函数
function httpRequest(endpoint, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(`${API_BASE_URL}${endpoint}`, options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ success: false, message: 'Invalid JSON response', data });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// 测试remark字段保存功能
async function testRemarkSave() {
  console.log('=== 测试关联项目remark字段保存功能 ===\n');

  try {
    // 1. 先获取项目列表，找一个可用的项目
    console.log('1. 获取项目列表...');
    const projects = await httpRequest('/projects/list');
    console.log('项目列表:', projects);

    if (!projects.success || !projects.projects || projects.projects.length === 0) {
      console.log('❌ 没有可用的项目，无法测试');
      return;
    }

    const project = projects.projects[0];
    console.log('使用项目:', project.name, '(ID:', project.id, ')\n');

    // 2. 使用固定的测试用例ID (假设存在测试用例1)
    const testCaseId = '1';
    console.log('使用测试用例ID:', testCaseId, '\n');

    // 3. 测试保存关联项目带remark字段
    console.log('3. 保存关联项目（带remark字段）...');
    const testRemark = '这是一个测试备注';
    const saveResult = await httpRequest(`/testcases/${testCaseId}/projects`, 'PUT', {
      associations: [
        {
          project_id: project.id,
          owner: 'test_user',
          progress_id: '1',
          status_id: '1',
          remark: testRemark
        }
      ]
    });
    console.log('保存结果:', saveResult);

    if (!saveResult.success) {
      console.log('❌ 保存关联项目失败');
      return;
    }

    // 4. 验证remark字段是否保存成功
    console.log('\n4. 验证remark字段是否保存成功...');
    const getResult = await httpRequest(`/testcases/${testCaseId}/projects`);
    console.log('获取关联项目结果:', getResult);

    if (getResult.success && getResult.projects && getResult.projects.length > 0) {
      const savedAssociation = getResult.projects[0];
      console.log('保存的remark字段:', savedAssociation.remark);
      console.log('预期的remark字段:', testRemark);

      if (savedAssociation.remark === testRemark) {
        console.log('✅ remark字段保存成功！');
      } else {
        console.log('❌ remark字段保存失败，实际值与预期不符');
      }
    } else {
      console.log('❌ 获取关联项目失败');
    }

    // 5. 清理测试数据 - 移除关联项目
    console.log('\n5. 清理测试数据...');
    await httpRequest(`/testcases/${testCaseId}/projects`, 'PUT', {
      associations: []
    });
    console.log('✅ 测试数据清理完成');

  } catch (error) {
    console.error('测试过程中发生错误:', error);
  }
}

// 运行测试
testRemarkSave();
