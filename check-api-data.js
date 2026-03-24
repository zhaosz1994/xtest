const http = require('http');

// 发送HTTP请求获取数据
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
  });
}

// 调用API端点检查数据
async function checkData() {
  try {
    const response = await httpGet('http://localhost:3000/api/test/data');
    console.log('API响应:', JSON.stringify(response, null, 2));
  } catch (error) {
    console.error('请求失败:', error);
  }
}

checkData();
