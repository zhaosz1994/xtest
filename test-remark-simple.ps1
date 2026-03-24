# Test test case remark functionality
$BASE_URL = 'http://localhost:3000/api'

# Test data
$testCaseData = @{
    caseId = "TEST-CASE-$(Get-Date -Format yyyyMMdd-HHmmss)"
    name = "Test Remark Functionality"
    priority = "medium"
    type = "functional"
    precondition = "Test precondition"
    purpose = "Test purpose"
    steps = "1. Step 1\n2. Step 2\n3. Step 3"
    expected = "Expected result"
    creator = "admin"
    owner = "admin"
    libraryId = 1
    moduleId = 1
    level1Id = 1
    projects = @()
    environments = @(1)
    methods = @(1)
    remark = "Test case remark - initial version"
}

Write-Host "=== Start testing test case remark functionality ==="
Write-Host ""

# 1. Create test case with remark
Write-Host "1. Creating test case with remark..."
$createBody = $testCaseData | ConvertTo-Json
$createResponse = Invoke-RestMethod -Uri "$BASE_URL/cases/create" -Method POST -ContentType "application/json" -Body $createBody
Write-Host "Create test case result:" ($createResponse | ConvertTo-Json -Depth 2)
Write-Host ""

if (-not $createResponse.success) {
    Write-Host "Create test case failed:" $createResponse.message -ForegroundColor Red
    return
}

Write-Host "Create test case succeeded" -ForegroundColor Green
Write-Host ""

# 2. Get test cases list, verify remark is returned
Write-Host "2. Getting test cases list, verifying remark is returned..."
$listBody = @{ page = 1; pageSize = 32 } | ConvertTo-Json
$listResponse = Invoke-RestMethod -Uri "$BASE_URL/cases/list" -Method POST -ContentType "application/json" -Body $listBody

$createdTestCase = $listResponse.testCases | Where-Object { $_.caseId -eq $testCaseData.caseId }
if (-not $createdTestCase) {
    Write-Host "Could not find created test case" -ForegroundColor Red
    return
}

Write-Host "Found created test case:" ($createdTestCase | ConvertTo-Json -Depth 2)
Write-Host ""

if ($createdTestCase.remark -eq $testCaseData.remark) {
    Write-Host "✓ Test passed: Remark is correctly returned" -ForegroundColor Green
} else {
    Write-Host "✗ Test failed: Remark is not correctly returned" -ForegroundColor Red
    Write-Host "Expected remark: $($testCaseData.remark)" -ForegroundColor Yellow
    Write-Host "Actual remark: $($createdTestCase.remark)" -ForegroundColor Yellow
    return
}

# 3. Update test case remark
Write-Host ""
Write-Host "3. Updating test case remark..."
$updatedRemark = "Test case remark - updated version"
$updateData = $testCaseData.Clone()
$updateData.id = $createdTestCase.id
$updateData.remark = $updatedRemark
$updateBody = $updateData | ConvertTo-Json
$updateResponse = Invoke-RestMethod -Uri "$BASE_URL/cases/update" -Method POST -ContentType "application/json" -Body $updateBody
Write-Host "Update test case result:" ($updateResponse | ConvertTo-Json -Depth 2)
Write-Host ""

if (-not $updateResponse.success) {
    Write-Host "Update test case failed:" $updateResponse.message -ForegroundColor Red
    return
}

Write-Host "Update test case succeeded" -ForegroundColor Green
Write-Host ""

# 4. Get test cases list again, verify updated remark is returned
Write-Host "4. Getting test cases list again, verifying updated remark is returned..."
$listResponse2 = Invoke-RestMethod -Uri "$BASE_URL/cases/list" -Method POST -ContentType "application/json" -Body $listBody

$updatedTestCase = $listResponse2.testCases | Where-Object { $_.caseId -eq $testCaseData.caseId }
if (-not $updatedTestCase) {
    Write-Host "Could not find updated test case" -ForegroundColor Red
    return
}

Write-Host "Found updated test case:" ($updatedTestCase | ConvertTo-Json -Depth 2)
Write-Host ""

if ($updatedTestCase.remark -eq $updatedRemark) {
    Write-Host "✓ Test passed: Updated remark is correctly returned" -ForegroundColor Green
} else {
    Write-Host "✗ Test failed: Updated remark is not correctly returned" -ForegroundColor Red
    Write-Host "Expected remark: $updatedRemark" -ForegroundColor Yellow
    Write-Host "Actual remark: $($updatedTestCase.remark)" -ForegroundColor Yellow
    return
}

Write-Host ""
Write-Host "=== All tests passed! ===" -ForegroundColor Green
