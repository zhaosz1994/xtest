#!/usr/bin/env python3
"""
Coverage Extractor - 硬约束提取+比对
功能: 从设计文档提取寄存器/状态机/参数矩阵, 测试后机械比对覆盖
"""
import sys, json, re
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s', stream=sys.stderr)
logger = logging.getLogger('coverage')


def extract_constraints(documents):
    """从设计文档提取硬约束"""
    constraints = []
    for doc in documents:
        content = doc.get('content', '')
        name = doc.get('name', 'unknown')
        constraints.extend(_extract_registers(content, name))
        constraints.extend(_extract_state_machines(content, name))
        constraints.extend(_extract_parameter_matrix(content, name))
    return constraints


def _extract_registers(content, source):
    """提取寄存器约束: Register Name (0xADDR) [rw] default=0xVAL"""
    constraints = []
    pattern = r'(\w+)\s*\(\s*(0x[0-9a-fA-F]+)\s*\)\s*\[(rw|ro|wo)\]\s*(?:default\s*=\s*(0x[0-9a-fA-F]+))?'
    for match in re.finditer(pattern, content):
        name, addr, access, default = match.groups()
        constraints.append({
            'type': 'register',
            'key': f'{name}@{addr}',
            'value': {'name': name, 'address': addr, 'access': access, 'default': default or '0x0'},
            'source': source,
        })
    bitfield_pattern = r'\[(\d+)(?::(\d+))?\]\s*(\w+)\s*(?:reset\s*=\s*(\d+))?'
    for match in re.finditer(bitfield_pattern, content):
        msb, lsb, field_name, reset_val = match.groups()
        constraints.append({
            'type': 'register_bitfield',
            'key': f'{field_name}_bit{msb}{"_"+lsb if lsb else ""}',
            'value': {'field': field_name, 'msb': int(msb), 'lsb': int(lsb) if lsb else int(msb), 'reset': int(reset_val) if reset_val else 0},
            'source': source,
        })
    return constraints


def _extract_state_machines(content, source):
    """提取状态机约束: state A -> state B on trigger"""
    constraints = []
    pattern = r'(?:state\s+)?(\w+)\s*->\s*(?:state\s+)?(\w+)\s*(?:on\s+|when\s+|trigger:\s*)?(.+)'
    for match in re.finditer(pattern, content, re.IGNORECASE):
        from_state, to_state, trigger = match.groups()
        if len(from_state) > 30 or len(to_state) > 30: continue
        constraints.append({
            'type': 'state_machine',
            'key': f'{from_state}->{to_state}',
            'value': {'from': from_state, 'to': to_state, 'trigger': (trigger or '').strip()},
            'source': source,
        })
    return constraints


def _extract_parameter_matrix(content, source):
    """提取参数矩阵约束（表格形式）"""
    constraints = []
    lines = content.split('\n')
    in_table = False
    headers = []
    for line in lines:
        if '|' in line and not in_table:
            headers = [h.strip() for h in line.split('|') if h.strip()]
            in_table = True
            continue
        if '|' in line and in_table:
            values = [v.strip() for v in line.split('|') if v.strip()]
            if len(values) == len(headers) and not all(v == '-' or v == '---' for v in values):
                combo = dict(zip(headers, values))
                constraints.append({
                    'type': 'parameter_matrix',
                    'key': '_'.join(values[:2]),
                    'value': combo,
                    'source': source,
                })
        else:
            in_table = False
    return constraints


def compare_constraints(constraints, test_outputs):
    """机械比对: 检查每个硬约束是否被测试覆盖"""
    covered = []
    uncovered = []
    for c in constraints:
        c_id = c.get('id')
        c_type = c.get('type')
        c_value = c.get('value', {})
        is_covered = False
        for output in test_outputs:
            commands = output.get('commands', [])
            output_text = ' '.join(str(o.get('output', '')) for o in output.get('output', []))
            full_text = ' '.join(commands) + ' ' + output_text
            if c_type == 'register':
                addr = c_value.get('address', '')
                name = c_value.get('name', '')
                if addr.lower() in full_text.lower() or name.lower() in full_text.lower():
                    is_covered = True; break
            elif c_type == 'register_bitfield':
                field = c_value.get('field', '')
                if field.lower() in full_text.lower():
                    is_covered = True; break
            elif c_type == 'state_machine':
                from_state = c_value.get('from', '')
                to_state = c_value.get('to', '')
                if from_state.lower() in full_text.lower() and to_state.lower() in full_text.lower():
                    is_covered = True; break
            elif c_type == 'parameter_matrix':
                all_values = list(c_value.values())
                if all(v.lower() in full_text.lower() for v in all_values if v):
                    is_covered = True; break
        if is_covered: covered.append(c_id)
        else: uncovered.append(c_id)
    return {'status': 'success', 'covered': covered, 'uncovered': uncovered}


def main():
    input_data = sys.stdin.read()
    req = json.loads(input_data)
    action = req.get('action')
    if action == 'extract':
        constraints = extract_constraints(req.get('documents', []))
        print(json.dumps({'status': 'success', 'constraints': constraints}))
    elif action == 'compare':
        result = compare_constraints(req.get('constraints', []), req.get('test_outputs', []))
        print(json.dumps(result))
    else:
        print(json.dumps({'status': 'error', 'error': f'Unknown action: {action}'}))

if __name__ == '__main__':
    main()
