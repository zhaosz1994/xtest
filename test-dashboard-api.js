const http = require('http');

const API_BASE_URL = 'http://localhost:3000/api';

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

async function testDashboardAPIs() {
  console.log('=== 测试测试管理页面API ===\n');

  try {
    // 测试统计数据API
    console.log('1. 测试统计数据API...');
    const statsResult = await httpRequest('/dashboard/stats');
    console.log('统计数据结果:', JSON.stringify(statsResult, null, 2));

    // 测试项目进度API
    console.log('\n2. 测试项目进度API...');
    const projectProgressResult = await httpRequest('/dashboard/project-progress');
    console.log('项目进度结果:', JSON.stringify(projectProgressResult, null, 2));

    // 测试负责人分析API
    console.log('\n3. 测试负责人分析API...');
    const ownerAnalysisResult = await httpRequest('/dashboard/owner-analysis');
    console.log('负责人分析结果:', JSON.stringify(ownerAnalysisResult, null, 2));

    // 测试状态分布API
    console.log('\n4. 测试状态分布API...');
    const statusDistributionResult = await httpRequest('/dashboard/status-distribution');
    console.log('状态分布结果:', JSON.stringify(statusDistributionResult, null, 2));

    // 测试进度分布API
    console.log('\n5. 测试进度分布API...');
    const progressDistributionResult = await httpRequest('/dashboard/progress-distribution');
    console.log('进度分布结果:', JSON.stringify(progressDistributionResult, null, 2));

    console.log('\n=== 所有API测试完成 ===');
  } catch (error) {
    console.error('测试失败:', error);
  }
}

testDashboardAPIs();
