// 测试前端saveProjectAssociations函数的核心逻辑
const API_BASE_URL = 'http://localhost:3000/api';

// 模拟项目项数据
const mockProjectItems = [
    {
        checkbox: { checked: true, value: '1' },
        ownerSelect: { value: 'zhaosz' },
        progressSelect: { value: '1' },
        statusSelect: { value: '1' },
        remarkInput: { value: '测试备注' }
    },
    {
        checkbox: { checked: false, value: '2' },
        ownerSelect: { value: 'user1' },
        progressSelect: { value: '2' },
        statusSelect: { value: '2' },
        remarkInput: { value: '' }
    }
];

// 模拟saveProjectAssociations函数的核心逻辑
function testSaveProjectAssociationsLogic(projectItems) {
    console.log('=== 测试saveProjectAssociations核心逻辑 ===');
    
    const associations = [];
    
    console.log('项目项数量:', projectItems.length);
    
    // 遍历所有项目项，收集被选中的项目
    projectItems.forEach((item, index) => {
        // 获取项目ID - 从checkbox的value属性获取
        const checkbox = item.checkbox;
        console.log(`项目项${index}的checkbox:`, checkbox);
        if (checkbox) {
            // 检查checkbox是否被选中
            console.log(`项目项${index}的checkbox.checked:`, checkbox.checked);
            if (checkbox.checked) {
                const projectId = parseInt(checkbox.value);
                console.log(`项目项${index}的projectId:`, projectId);
                if (!isNaN(projectId)) {
                    // 获取其他关联数据
                    const ownerSelect = item.ownerSelect;
                    const progressSelect = item.progressSelect;
                    const statusSelect = item.statusSelect;
                    const remarkInput = item.remarkInput;
                    
                    // 处理空值，将空字符串转换为 null，避免数据库插入错误
                    const progressId = progressSelect && progressSelect.value ? progressSelect.value : null;
                    const statusId = statusSelect && statusSelect.value ? statusSelect.value : null;
                    
                    // 构建关联对象
                    const association = {
                        project_id: projectId,
                        owner: ownerSelect ? ownerSelect.value : '',
                        progress_id: progressId,
                        status_id: statusId,
                        remark: remarkInput ? remarkInput.value.trim() : ''
                    };
                    
                    console.log('收集到关联项目:', association);
                    associations.push(association);
                }
            }
        }
    });
    
    console.log('最终收集到的关联项目:', associations);
    return associations;
}

// 测试1：默认情况，只选中第一个项目
console.log('\n=== 测试1：只选中第一个项目 ===');
try {
    const associations = testSaveProjectAssociationsLogic(mockProjectItems);
    console.log('\n=== 测试结果 ===');
    console.log('收集到的关联项目数量:', associations.length);
    console.log('预期结果: 1个项目被选中（CTCSDK项目）');
    console.log('实际结果:', associations.length === 1 ? '通过' : '失败');
    
    if (associations.length === 1) {
        console.log('选中的项目ID:', associations[0].project_id);
        console.log('预期项目ID: 1');
        console.log('项目ID匹配:', associations[0].project_id === 1 ? '通过' : '失败');
    }
} catch (error) {
    console.error('测试失败:', error);
}

// 测试2：两个项目都选中
console.log('\n\n=== 测试2：两个项目都选中 ===');
try {
    const mockProjectItemsAllChecked = [
        {
            checkbox: { checked: true, value: '1' },
            ownerSelect: { value: 'zhaosz' },
            progressSelect: { value: '1' },
            statusSelect: { value: '1' },
            remarkInput: { value: '测试备注' }
        },
        {
            checkbox: { checked: true, value: '2' },
            ownerSelect: { value: 'user1' },
            progressSelect: { value: '2' },
            statusSelect: { value: '2' },
            remarkInput: { value: '' }
        }
    ];
    
    const associations = testSaveProjectAssociationsLogic(mockProjectItemsAllChecked);
    console.log('\n=== 测试结果 ===');
    console.log('收集到的关联项目数量:', associations.length);
    console.log('预期结果: 2个项目被选中');
    console.log('实际结果:', associations.length === 2 ? '通过' : '失败');
    
    if (associations.length === 2) {
        console.log('选中的项目ID列表:', associations.map(a => a.project_id).join(', '));
        console.log('预期项目ID列表: 1, 2');
        console.log('项目ID匹配:', associations.map(a => a.project_id).sort().join(', ') === '1, 2' ? '通过' : '失败');
    }
} catch (error) {
    console.error('测试失败:', error);
}

// 测试3：没有项目被选中
console.log('\n\n=== 测试3：没有项目被选中 ===');
try {
    const mockProjectItemsNoneChecked = [
        {
            checkbox: { checked: false, value: '1' },
            ownerSelect: { value: 'zhaosz' },
            progressSelect: { value: '1' },
            statusSelect: { value: '1' },
            remarkInput: { value: '测试备注' }
        },
        {
            checkbox: { checked: false, value: '2' },
            ownerSelect: { value: 'user1' },
            progressSelect: { value: '2' },
            statusSelect: { value: '2' },
            remarkInput: { value: '' }
        }
    ];
    
    const associations = testSaveProjectAssociationsLogic(mockProjectItemsNoneChecked);
    console.log('\n=== 测试结果 ===');
    console.log('收集到的关联项目数量:', associations.length);
    console.log('预期结果: 0个项目被选中');
    console.log('实际结果:', associations.length === 0 ? '通过' : '失败');
} catch (error) {
    console.error('测试失败:', error);
}

// 测试4：只有第二个项目被选中
console.log('\n\n=== 测试4：只有第二个项目被选中 ===');
try {
    const mockProjectItemsSecondChecked = [
        {
            checkbox: { checked: false, value: '1' },
            ownerSelect: { value: 'zhaosz' },
            progressSelect: { value: '1' },
            statusSelect: { value: '1' },
            remarkInput: { value: '测试备注' }
        },
        {
            checkbox: { checked: true, value: '2' },
            ownerSelect: { value: 'user1' },
            progressSelect: { value: '2' },
            statusSelect: { value: '2' },
            remarkInput: { value: '' }
        }
    ];
    
    const associations = testSaveProjectAssociationsLogic(mockProjectItemsSecondChecked);
    console.log('\n=== 测试结果 ===');
    console.log('收集到的关联项目数量:', associations.length);
    console.log('预期结果: 1个项目被选中（U12芯片项目）');
    console.log('实际结果:', associations.length === 1 ? '通过' : '失败');
    
    if (associations.length === 1) {
        console.log('选中的项目ID:', associations[0].project_id);
        console.log('预期项目ID: 2');
        console.log('项目ID匹配:', associations[0].project_id === 2 ? '通过' : '失败');
    }
} catch (error) {
    console.error('测试失败:', error);
}

console.log('\n\n=== 所有测试完成 ===');
