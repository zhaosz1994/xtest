// 在浏览器控制台运行此脚本来诊断问题

console.log('========== 开始诊断模态框问题 ==========');

// 1. 检查模态框是否存在
const modal = document.getElementById('batch-submit-review-modal');
console.log('1. 模态框元素:', modal);

if (modal) {
    // 2. 检查计算后的样式
    const computedStyle = window.getComputedStyle(modal);
    console.log('2. 模态框display:', computedStyle.display);
    console.log('3. 模态框z-index:', computedStyle.zIndex);
    console.log('4. 模态框position:', computedStyle.position);
    console.log('5. 模态框top:', computedStyle.top);
    console.log('6. 模态框left:', computedStyle.left);
    console.log('7. 模态框width:', computedStyle.width);
    console.log('8. 模态框height:', computedStyle.height);
    console.log('9. 模态框opacity:', computedStyle.opacity);
    console.log('10. 模态框visibility:', computedStyle.visibility);
    
    // 3. 检查模态框在DOM中的位置
    console.log('11. 模态框父元素:', modal.parentElement);
    console.log('12. 模态框在body中的位置:', document.body.lastElementChild === modal);
    
    // 4. 检查模态框内容
    const content = modal.querySelector('.modal-content');
    console.log('13. 模态框内容:', content);
    if (content) {
        const contentStyle = window.getComputedStyle(content);
        console.log('14. 内容display:', contentStyle.display);
        console.log('15. 内容z-index:', contentStyle.zIndex);
    }
    
    // 5. 检查是否被其他元素遮挡
    const rect = modal.getBoundingClientRect();
    console.log('16. 模态框位置:', rect);
    
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const elementAtPoint = document.elementFromPoint(centerX, centerY);
    console.log('17. 中心点元素:', elementAtPoint);
    console.log('18. 是否被遮挡:', elementAtPoint !== modal && !modal.contains(elementAtPoint));
    
    // 6. 尝试强制显示
    console.log('========== 尝试强制显示 ==========');
    modal.style.cssText = 'display: flex !important; position: fixed !important; z-index: 999999 !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; background-color: rgba(255, 0, 0, 0.8) !important; align-items: center !important; justify-content: center !important;';
    console.log('19. 已强制修改样式，请查看页面是否有红色背景');
    
} else {
    console.log('❌ 模态框不存在！');
}

console.log('========== 诊断结束 ==========');
