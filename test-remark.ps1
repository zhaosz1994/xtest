# 测试测试用例备注功能
$BASE_URL = 'http://localhost:3000/api'

# 测试数据
$testCaseData = @{
    caseId = "TEST-CASE-$(Get-Date -Format yyyyMMdd-HHmmss)"
    name = "测试用例备注功能"
    priority = "medium"
    type = "functional"
    precondition = "测试前置条件"
    purpose = "测试目的"
    steps = "1. 步骤1\n2. 步骤2\n3. 步骤3"
    expected = "预期结果"
    creator = "admin"
    owner = "admin"
    libraryId = 1
    moduleId = 1
    level1Id = 1
    projects = @()
    environments = @(1)
    methods = @(1)
    remark = "测试用例备注 - 初始版本"
}

Write-Host "=== 开始测试测试用例备注功能 ==="
Write-Host ""

# 1. 新建测试用例并添加备注
Write-Host "1. 新建测试用例并添加备注..."
$createBody = $testCaseData | ConvertTo-Json
$createResponse = Invoke-RestMethod -Uri "$BASE_URL/cases/create" -Method POST -ContentType "application/json" -Body $createBody
Write-Host "新建测试用例结果:" ($createResponse | ConvertTo-Json -Depth 5)
Write-Host ""

if (-not $createResponse.success) {
    Write-Host "新建测试用例失败:" $createResponse.message -ForegroundColor Red
    return
}

$testCaseId = $createResponse.testCaseId
Write-Host "新建测试用例成功，ID: $testCaseId" -ForegroundColor Green
Write-Host ""

# 2. 获取测试用例列表，验证备注是否返回
Write-Host "2. 获取测试用例列表，验证备注是否返回..."
$listBody = @{ page = 1; pageSize = 32 } | ConvertTo-Json
$listResponse = Invoke-RestMethod -Uri "$BASE_URL/cases/list" -Method POST -ContentType "application/json" -Body $listBody
Write-Host "获取测试用例列表结果:" ($listResponse | ConvertTo-Json -Depth 5)
Write-Host ""

$createdTestCase = $listResponse.testCases | Where-Object { $_.caseId -eq $testCaseData.caseId }
if (-not $createdTestCase) {
    Write-Host "未找到新建的测试用例" -ForegroundColor Red
    return
}

Write-Host "找到新建的测试用例:" ($createdTestCase | ConvertTo-Json -Depth 5)
Write-Host ""

if ($createdTestCase.remark -eq $testCaseData.remark) {
    Write-Host "✓ 测试通过：测试用例备注正确返回" -ForegroundColor Green
} else {
    Write-Host "✗ 测试失败：测试用例备注未正确返回" -ForegroundColor Red
    Write-Host "预期备注: $($testCaseData.remark)" -ForegroundColor Yellow
    Write-Host "实际备注: $($createdTestCase.remark)" -ForegroundColor Yellow
    return
}

# 3. 更新测试用例的备注
Write-Host ""
Write-Host "3. 更新测试用例的备注..."
$updatedRemark = "测试用例备注 - 更新版本"
$updateData = $testCaseData.Clone()
$updateData.id = $createdTestCase.id
$updateData.remark = $updatedRemark
$updateBody = $updateData | ConvertTo-Json
$updateResponse = Invoke-RestMethod -Uri "$BASE_URL/cases/update" -Method POST -ContentType "application/json" -Body $updateBody
Write-Host "更新测试用例结果:" ($updateResponse | ConvertTo-Json -Depth 5)
Write-Host ""

if (-not $updateResponse.success) {
    Write-Host "更新测试用例失败:" $updateResponse.message -ForegroundColor Red
    return
}

Write-Host "测试用例更新成功" -ForegroundColor Green
Write-Host ""

# 4. 再次获取测试用例列表，验证更新后的备注是否返回
Write-Host "4. 再次获取测试用例列表，验证更新后的备注是否返回..."
$listResponse2 = Invoke-RestMethod -Uri "$BASE_URL/cases/list" -Method POST -ContentType "application/json" -Body $listBody

$updatedTestCase = $listResponse2.testCases | Where-Object { $_.caseId -eq $testCaseData.caseId }
if (-not $updatedTestCase) {
    Write-Host "未找到更新的测试用例" -ForegroundColor Red
    return
}

Write-Host "找到更新的测试用例:" ($updatedTestCase | ConvertTo-Json -Depth 5)
Write-Host ""

if ($updatedTestCase.remark -eq $updatedRemark) {
    Write-Host "✓ 测试通过：更新后的测试用例备注正确返回" -ForegroundColor Green
} else {
    Write-Host "✗ 测试失败：更新后的测试用例备注未正确返回" -ForegroundColor Red
    Write-Host "预期备注: $updatedRemark" -ForegroundColor Yellow
    Write-Host "实际备注: $($updatedTestCase.remark)" -ForegroundColor Yellow
    return
}

Write-Host ""
Write-Host "=== 测试用例备注功能测试全部通过！ ===" -ForegroundColor Green
