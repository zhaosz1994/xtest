#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Excel测试用例导入数据库脚本
使用前请先安装依赖: pip3 install pandas openpyxl pymysql
"""

import pandas as pd
import pymysql
from datetime import datetime
import uuid
import sys

# ============================================================
# 配置区域 - 请根据实际情况修改
# ============================================================

# 数据库配置
DB_CONFIG = {
    'host': 'localhost',
    'port': 3306,
    'user': 'root',
    'password': 'your_password',  # 请修改为实际密码
    'database': 'ctcsdk_testplan',
    'charset': 'utf8mb4'
}

# Excel文件路径
EXCEL_FILE_PATH = '/Users/zhao/Desktop/my_projects/初始产品测试计划 - SDK-NetTx.xlsx'

# Excel Sheet名称或索引 (0表示第一个sheet)
SHEET_NAME_OR_INDEX = 0

# Excel Header行号 (从0开始计数，第10行为索引9)
HEADER_ROW = 9

# 默认值配置
DEFAULT_VALUES = {
    'creator': 'admin',           # 默认创建者
    'owner': 'admin',             # 默认负责人
    'library_id': None,           # 默认用例库ID (None表示不设置)
    'module_id': 1,               # 默认模块ID (必填，需要在映射中指定或在此设置)
    'level1_id': None,            # 默认一级测试点ID
    'priority': '中',              # 默认优先级
    'type': '功能测试',            # 默认测试类型
    'status': '维护中',            # 默认状态
    'method': '自动化',            # 默认测试方式
}

# ============================================================
# Excel列名 -> 数据库字段映射关系
# 
# 左侧: Excel中的列名
# 右侧: 数据库test_cases表中的字段名
# 
# 如果Excel列名与数据库字段名相同，可以省略映射
# 如果不需要映射某个字段，可以删除对应的行或设为None
# ============================================================

COLUMN_MAPPING = {
    # Excel列名              -> 数据库字段名
    '功能点'                 : 'name',
    '用例名称'               : 'name',
    '测试用例名称'           : 'name',
    '名称'                   : 'name',
    'name'                   : 'name',
    
    '具体功能测试项'         : 'purpose',
    '测试目的'               : 'purpose',
    '目的'                   : 'purpose',
    'purpose'                : 'purpose',
    
    '测试方法'               : 'steps',
    '测试步骤'               : 'steps',
    '步骤'                   : 'steps',
    'steps'                  : 'steps',
    
    '来源'                   : 'remark',
    '分类'                   : 'type',
    
    '优先级'                 : 'priority',
    'priority'               : 'priority',
    
    '测试类型'               : 'type',
    '类型'                   : 'type',
    'type'                   : 'type',
    
    '前置条件'               : 'precondition',
    '前提条件'               : 'precondition',
    'precondition'           : 'precondition',
    
    '预期结果'               : 'expected',
    '预期'                   : 'expected',
    'expected'               : 'expected',
    
    '备注'                   : 'remark',
    '说明'                   : 'remark',
    'remark'                 : 'remark',
    
    '关键配置'               : 'key_config',
    '配置'                   : 'key_config',
    'key_config'             : 'key_config',
    
    '负责人'                 : 'owner',
    'owner'                  : 'owner',
    
    '创建者'                 : 'creator',
    'creator'                : 'creator',
    
    '测试方式'               : 'method',
    'method'                 : 'method',
    
    '状态'                   : 'status',
    'status'                 : 'status',
}

# ============================================================
# 模块映射配置
# 
# 如果Excel中有模块名称列，可以配置模块名称到模块ID的映射
# 如果没有模块信息，会使用DEFAULT_VALUES中的module_id
# ============================================================

MODULE_MAPPING = {
    # Excel中的模块名称 -> 数据库中的模块ID
    # 示例:
    # 'SDK基础功能': 1,
    # '网络通信': 2,
    # '数据传输': 3,
}

# 模块名称对应的Excel列名
MODULE_COLUMN_NAME = '模块'  # Excel中模块列的名称

# ============================================================
# 关联表映射配置 (可选)
# 
# 这些配置用于处理测试用例的关联关系
# 如果Excel中有这些列，可以配置名称到ID的映射
# ============================================================

# 测试阶段映射
PHASE_MAPPING = {
    # Excel中的阶段名称 -> 数据库中的阶段ID
    # 示例:
    # '单元测试': 1,
    # '集成测试': 2,
    # '系统测试': 3,
}

# 测试环境映射
ENVIRONMENT_MAPPING = {
    # Excel中的环境名称 -> 数据库中的环境ID
    # 示例:
    # 'Linux': 1,
    # 'Windows': 2,
}

# 测试方式映射
METHOD_MAPPING = {
    # Excel中的方式名称 -> 数据库中的方式ID
    # 示例:
    # '自动化': 1,
    # '手动': 2,
}

# ============================================================
# 以下为脚本逻辑，一般不需要修改
# ============================================================

def generate_case_id(index):
    """生成用例ID"""
    today = datetime.now().strftime('%Y%m%d')
    short_uuid = uuid.uuid4().hex[:8]
    return f'CASE-{today}-{short_uuid}-{index}'

def get_db_connection():
    """获取数据库连接"""
    return pymysql.connect(**DB_CONFIG)

def print_excel_columns(excel_path, sheet_name_or_index=0, header_row=9):
    """打印Excel文件的列名"""
    try:
        df = pd.read_excel(excel_path, sheet_name=sheet_name_or_index, header=header_row, nrows=3)
        print("\n" + "="*60)
        print("Excel文件列名:")
        print("="*60)
        for i, col in enumerate(df.columns, 1):
            print(f"  {i}. {col}")
        print("="*60)
        print("\n前3行数据预览:")
        print(df.to_string())
        print("="*60 + "\n")
    except Exception as e:
        print(f"读取Excel文件失败: {e}")
        sys.exit(1)

def map_excel_to_db(row, mapping, default_values):
    """将Excel行数据映射到数据库字段"""
    db_data = {}
    
    for excel_col, db_field in mapping.items():
        if excel_col in row.index and pd.notna(row[excel_col]):
            db_data[db_field] = str(row[excel_col]).strip()
    
    # 应用默认值
    for key, value in default_values.items():
        if key not in db_data or not db_data[key]:
            if value is not None:
                db_data[key] = value
    
    return db_data

def validate_data(data, index):
    """验证数据完整性"""
    errors = []
    
    if not data.get('name'):
        errors.append(f"第{index}行: 缺少用例名称")
    
    if not data.get('module_id'):
        errors.append(f"第{index}行: 缺少模块ID")
    
    if not data.get('steps'):
        errors.append(f"第{index}行: 缺少测试步骤")
    
    if not data.get('expected'):
        errors.append(f"第{index}行: 缺少预期结果")
    
    return errors

def check_duplicate_case(conn, case_name, module_id, level1_id=None):
    """
    检查是否存在重复的测试用例
    
    Args:
        conn: 数据库连接
        case_name: 用例名称
        module_id: 模块ID
        level1_id: 一级测试点ID（可选）
    
    Returns:
        True表示存在重复，False表示不重复
    """
    try:
        cursor = conn.cursor()
        
        # 检查test_cases表中是否存在相同名称的用例
        if level1_id:
            sql = """
                SELECT COUNT(*) FROM test_cases 
                WHERE name = %s AND module_id = %s AND level1_id = %s
            """
            cursor.execute(sql, (case_name, module_id, level1_id))
        else:
            sql = """
                SELECT COUNT(*) FROM test_cases 
                WHERE name = %s AND module_id = %s AND (level1_id IS NULL OR level1_id = 0)
            """
            cursor.execute(sql, (case_name, module_id))
        
        count = cursor.fetchone()[0]
        cursor.close()
        
        return count > 0
    except Exception as e:
        print(f"检查重复用例时出错: {e}")
        return False

def generate_html_report(report_data, output_file='import_report.html'):
    """
    生成HTML报告
    
    Args:
        report_data: 报告数据字典
        output_file: 输出文件名
    """
    html_content = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>测试用例导入报告</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }}
        .container {{
            background-color: white;
            border-radius: 8px;
            padding: 30px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }}
        h1 {{
            color: #2c3e50;
            border-bottom: 3px solid #3498db;
            padding-bottom: 10px;
        }}
        h2 {{
            color: #34495e;
            margin-top: 30px;
            border-left: 4px solid #3498db;
            padding-left: 10px;
        }}
        .summary {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin: 20px 0;
        }}
        .summary-card {{
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
        }}
        .summary-card.success {{
            background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
        }}
        .summary-card.warning {{
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        }}
        .summary-card.error {{
            background: linear-gradient(135deg, #eb3349 0%, #f45c43 100%);
        }}
        .summary-card h3 {{
            margin: 0;
            font-size: 2em;
        }}
        .summary-card p {{
            margin: 5px 0 0 0;
            opacity: 0.9;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
            background-color: white;
        }}
        th, td {{
            border: 1px solid #ddd;
            padding: 12px;
            text-align: left;
        }}
        th {{
            background-color: #3498db;
            color: white;
            font-weight: bold;
        }}
        tr:nth-child(even) {{
            background-color: #f9f9f9;
        }}
        tr:hover {{
            background-color: #f5f5f5;
        }}
        .empty-name {{
            background-color: #fff3cd;
        }}
        .duplicate {{
            background-color: #f8d7da;
        }}
        .success-row {{
            background-color: #d4edda;
        }}
        .timestamp {{
            color: #7f8c8d;
            font-size: 0.9em;
            margin-top: 20px;
        }}
        .section {{
            margin-bottom: 30px;
        }}
        .badge {{
            display: inline-block;
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 0.85em;
            font-weight: bold;
        }}
        .badge-success {{ background-color: #28a745; color: white; }}
        .badge-warning {{ background-color: #ffc107; color: #333; }}
        .badge-error {{ background-color: #dc3545; color: white; }}
    </style>
</head>
<body>
    <div class="container">
        <h1>📊 测试用例导入报告</h1>
        
        <div class="section">
            <h2>📈 导入统计</h2>
            <div class="summary">
                <div class="summary-card">
                    <h3>{report_data['total_rows']}</h3>
                    <p>总行数</p>
                </div>
                <div class="summary-card success">
                    <h3>{report_data['success_count']}</h3>
                    <p>导入成功</p>
                </div>
                <div class="summary-card warning">
                    <h3>{report_data['empty_name_count']}</h3>
                    <p>用例名为空（已跳过）</p>
                </div>
                <div class="summary-card error">
                    <h3>{report_data['duplicate_count']}</h3>
                    <p>重复导入（已跳过）</p>
                </div>
            </div>
        </div>
"""
    
    # 添加用例名为空的行
    if report_data['empty_name_rows']:
        html_content += """
        <div class="section">
            <h2>⚠️ 用例名为空的行（已跳过）</h2>
            <table>
                <thead>
                    <tr>
                        <th>Excel行号</th>
                        <th>具体功能测试项</th>
                        <th>来源</th>
                        <th>分类</th>
                    </tr>
                </thead>
                <tbody>
"""
        for row in report_data['empty_name_rows']:
            html_content += f"""
                    <tr class="empty-name">
                        <td>{row['row_number']}</td>
                        <td>{row.get('具体功能测试项', 'N/A')}</td>
                        <td>{row.get('来源', 'N/A')}</td>
                        <td>{row.get('分类', 'N/A')}</td>
                    </tr>
"""
        html_content += """
                </tbody>
            </table>
        </div>
"""
    
    # 添加重复导入的行
    if report_data['duplicate_rows']:
        html_content += """
        <div class="section">
            <h2>🔄 重复导入的行（已跳过）</h2>
            <table>
                <thead>
                    <tr>
                        <th>Excel行号</th>
                        <th>用例名称</th>
                        <th>具体功能测试项</th>
                        <th>来源</th>
                        <th>分类</th>
                    </tr>
                </thead>
                <tbody>
"""
        for row in report_data['duplicate_rows']:
            html_content += f"""
                    <tr class="duplicate">
                        <td>{row['row_number']}</td>
                        <td>{row.get('name', 'N/A')}</td>
                        <td>{row.get('具体功能测试项', 'N/A')}</td>
                        <td>{row.get('来源', 'N/A')}</td>
                        <td>{row.get('分类', 'N/A')}</td>
                    </tr>
"""
        html_content += """
                </tbody>
            </table>
        </div>
"""
    
    # 添加导入成功的行
    if report_data['success_rows']:
        html_content += """
        <div class="section">
            <h2>✅ 导入成功的用例</h2>
            <table>
                <thead>
                    <tr>
                        <th>Excel行号</th>
                        <th>用例名称</th>
                        <th>具体功能测试项</th>
                        <th>来源</th>
                        <th>分类</th>
                        <th>状态</th>
                    </tr>
                </thead>
                <tbody>
"""
        for row in report_data['success_rows']:
            html_content += f"""
                    <tr class="success-row">
                        <td>{row['row_number']}</td>
                        <td>{row.get('name', 'N/A')}</td>
                        <td>{row.get('具体功能测试项', 'N/A')}</td>
                        <td>{row.get('来源', 'N/A')}</td>
                        <td>{row.get('分类', 'N/A')}</td>
                        <td><span class="badge badge-success">成功</span></td>
                    </tr>
"""
        html_content += """
                </tbody>
            </table>
        </div>
"""
    
    html_content += f"""
        <div class="timestamp">
            <p>报告生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
            <p>Excel文件: {EXCEL_FILE_PATH}</p>
        </div>
    </div>
</body>
</html>
"""
    
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(html_content)
    
    print(f"\n✅ HTML报告已生成: {output_file}")
    print(f"   可以在浏览器中打开查看详细信息")

def import_test_cases(dry_run=True, batch_size=100, header_row=9):
    """
    导入测试用例到数据库
    
    Args:
        dry_run: True表示只预览不实际导入，False表示实际导入
        batch_size: 批量导入的批次大小
        header_row: Excel中header行的索引（从0开始）
    """
    print(f"\n{'[预览模式]' if dry_run else '[导入模式]'}")
    print(f"Excel文件: {EXCEL_FILE_PATH}")
    print(f"Sheet: {SHEET_NAME_OR_INDEX}")
    print(f"Header行: {header_row + 1} (Excel第{header_row + 1}行)")
    
    # 打印Excel列信息
    print_excel_columns(EXCEL_FILE_PATH, SHEET_NAME_OR_INDEX, header_row)
    
    # 读取Excel数据
    try:
        df = pd.read_excel(EXCEL_FILE_PATH, sheet_name=SHEET_NAME_OR_INDEX, header=header_row)
        print(f"共读取到 {len(df)} 行数据\n")
    except Exception as e:
        print(f"读取Excel失败: {e}")
        sys.exit(1)
    
    if len(df) == 0:
        print("Excel文件为空，没有数据需要导入")
        return
    
    # 初始化报告数据
    report_data = {
        'total_rows': len(df),
        'success_count': 0,
        'empty_name_count': 0,
        'duplicate_count': 0,
        'error_count': 0,
        'empty_name_rows': [],
        'duplicate_rows': [],
        'success_rows': [],
        'error_rows': []
    }
    
    # 准备导入数据
    cases_to_import = []
    all_errors = []
    
    # 如果是实际导入模式，先建立数据库连接用于检查重复
    conn = None
    if not dry_run:
        try:
            conn = get_db_connection()
        except Exception as e:
            print(f"数据库连接失败: {e}")
            print("将使用预览模式运行...")
            dry_run = True
    
    for idx, row in df.iterrows():
        # Excel行号 = header_row + idx + 2 (header_row是索引，+2是因为Excel从第1行开始，且第1行是header)
        excel_row_number = header_row + idx + 2
        
        # 检查用例名称是否为空
        case_name = None
        for excel_col in ['功能点', '用例名称', '测试用例名称', '名称', 'name']:
            if excel_col in row.index and pd.notna(row[excel_col]):
                case_name = str(row[excel_col]).strip()
                break
        
        # 如果用例名称为空，跳过该行
        if not case_name:
            report_data['empty_name_count'] += 1
            report_data['empty_name_rows'].append({
                'row_number': excel_row_number,
                '具体功能测试项': str(row.get('具体功能测试项', '')) if pd.notna(row.get('具体功能测试项')) else 'N/A',
                '来源': str(row.get('来源', '')) if pd.notna(row.get('来源')) else 'N/A',
                '分类': str(row.get('分类', '')) if pd.notna(row.get('分类')) else 'N/A'
            })
            continue
        
        # 映射数据
        case_data = map_excel_to_db(row, COLUMN_MAPPING, DEFAULT_VALUES)
        
        # 处理模块ID
        if MODULE_COLUMN_NAME and MODULE_COLUMN_NAME in row.index:
            module_name = str(row[MODULE_COLUMN_NAME]).strip() if pd.notna(row[MODULE_COLUMN_NAME]) else None
            if module_name and module_name in MODULE_MAPPING:
                case_data['module_id'] = MODULE_MAPPING[module_name]
        
        # 检查必填字段
        if not case_data.get('module_id'):
            all_errors.append(f"第{excel_row_number}行: 缺少模块ID")
            continue
        
        # 检查重复导入（仅在非预览模式下）
        if not dry_run and conn:
            module_id = case_data.get('module_id')
            level1_id = case_data.get('level1_id')
            
            if check_duplicate_case(conn, case_name, module_id, level1_id):
                report_data['duplicate_count'] += 1
                report_data['duplicate_rows'].append({
                    'row_number': excel_row_number,
                    'name': case_name,
                    '具体功能测试项': str(row.get('具体功能测试项', '')) if pd.notna(row.get('具体功能测试项')) else 'N/A',
                    '来源': str(row.get('来源', '')) if pd.notna(row.get('来源')) else 'N/A',
                    '分类': str(row.get('分类', '')) if pd.notna(row.get('分类')) else 'N/A'
                })
                continue
        
        # 生成用例ID
        case_data['case_id'] = generate_case_id(idx)
        
        # 添加到成功列表
        cases_to_import.append(case_data)
        report_data['success_rows'].append({
            'row_number': excel_row_number,
            'name': case_name,
            '具体功能测试项': str(row.get('具体功能测试项', '')) if pd.notna(row.get('具体功能测试项')) else 'N/A',
            '来源': str(row.get('来源', '')) if pd.notna(row.get('来源')) else 'N/A',
            '分类': str(row.get('分类', '')) if pd.notna(row.get('分类')) else 'N/A'
        })
    
    # 显示验证错误
    if all_errors:
        print("\n" + "="*60)
        print("数据验证错误:")
        print("="*60)
        for error in all_errors[:20]:  # 只显示前20个错误
            print(f"  - {error}")
        if len(all_errors) > 20:
            print(f"  ... 还有 {len(all_errors) - 20} 个错误")
        print("="*60 + "\n")
    
    # 显示统计信息
    print("\n" + "="*60)
    print("导入统计:")
    print("="*60)
    print(f"  总行数: {report_data['total_rows']}")
    print(f"  用例名为空（已跳过）: {report_data['empty_name_count']}")
    print(f"  重复导入（已跳过）: {report_data['duplicate_count']}")
    print(f"  有效数据: {len(cases_to_import)}")
    print("="*60 + "\n")
    
    if not cases_to_import:
        print("没有有效的数据可以导入")
        # 生成HTML报告
        generate_html_report(report_data)
        return
    
    # 预览模式：只显示数据
    if dry_run:
        print("="*60)
        print("数据预览 (前5条):")
        print("="*60)
        for i, case in enumerate(cases_to_import[:5], 1):
            print(f"\n第{i}条:")
            for key, value in case.items():
                if value:
                    print(f"  {key}: {value[:100] if len(str(value)) > 100 else value}")
        print("="*60 + "\n")
        
        print(f"\n提示: 共 {len(cases_to_import)} 条数据待导入")
        print("如需实际导入，请修改脚本中的 dry_run=False 参数\n")
        
        # 生成HTML报告
        generate_html_report(report_data)
        return
    
    # 实际导入模式
    print("开始导入数据到数据库...\n")
    
    try:
        cursor = conn.cursor()
        
        success_count = 0
        error_count = 0
        
        # 批量导入
        for i in range(0, len(cases_to_import), batch_size):
            batch = cases_to_import[i:i+batch_size]
            
            for case in batch:
                try:
                    sql = """
                        INSERT INTO test_cases 
                        (case_id, name, priority, type, precondition, purpose, 
                         steps, expected, creator, library_id, module_id, level1_id,
                         owner, status, method, remark, key_config)
                        VALUES 
                        (%(case_id)s, %(name)s, %(priority)s, %(type)s, %(precondition)s, 
                         %(purpose)s, %(steps)s, %(expected)s, %(creator)s, %(library_id)s, 
                         %(module_id)s, %(level1_id)s, %(owner)s, %(status)s, %(method)s, 
                         %(remark)s, %(key_config)s)
                    """
                    
                    cursor.execute(sql, case)
                    success_count += 1
                    
                except Exception as e:
                    error_count += 1
                    print(f"  导入失败 [{case.get('name', 'Unknown')}]: {e}")
            
            conn.commit()
            print(f"  已处理: {min(i + batch_size, len(cases_to_import))}/{len(cases_to_import)}")
        
        cursor.close()
        conn.close()
        
        # 更新报告数据
        report_data['success_count'] = success_count
        report_data['error_count'] = error_count
        
        print(f"\n导入完成!")
        print(f"  成功: {success_count} 条")
        print(f"  失败: {error_count} 条")
        
        # 生成HTML报告
        generate_html_report(report_data)
        
    except Exception as e:
        print(f"\n数据库操作失败: {e}")
        # 即使失败也生成报告
        generate_html_report(report_data)
        sys.exit(1)

def main():
    """主函数"""
    print("\n" + "="*60)
    print("Excel测试用例导入工具")
    print("="*60)
    
    # 显示当前配置
    print("\n当前配置:")
    print(f"  数据库: {DB_CONFIG['database']}@{DB_CONFIG['host']}:{DB_CONFIG['port']}")
    print(f"  Excel: {EXCEL_FILE_PATH}")
    print(f"  默认模块ID: {DEFAULT_VALUES.get('module_id', '未设置')}")
    print(f"  默认创建者: {DEFAULT_VALUES.get('creator')}")
    print(f"  默认负责人: {DEFAULT_VALUES.get('owner')}")
    
    # 执行导入 (dry_run=True 表示只预览，不实际导入)
    # 修改为 dry_run=False 以实际导入数据
    import_test_cases(dry_run=True, header_row=HEADER_ROW)

if __name__ == '__main__':
    main()
