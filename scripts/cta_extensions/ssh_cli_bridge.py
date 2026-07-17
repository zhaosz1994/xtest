#!/usr/bin/env python3
"""
SSH CLI Bridge - xtest Python扩展层
功能: SSH多会话管理 + CLI命令执行 + 异常自愈 + 跳板机(ProxyJump)支持
调用方式: stdin接收JSON, stdout返回JSON

跳板机参数:
  jump_host / jump_port / jump_username / jump_password / jump_key_path
  当提供 jump_host 时，先连接跳板机，通过跳板机的SSH隧道连接目标设备。
"""
import sys, json, time, socket, threading, select, re
import paramiko
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s', stream=sys.stderr)
logger = logging.getLogger('ssh_bridge')


class SSHSessionManager:
    def __init__(self):
        self.sessions = {}
        self.lock = threading.Lock()

    def _build_jump_sock(self, jump_host, jump_port, jump_username, jump_password=None, jump_key_path=None):
        """通过跳板机建立SSH隧道，返回可用的 sock 对象"""
        jump_client = paramiko.SSHClient()
        jump_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        jump_kwargs = {'hostname': jump_host, 'port': int(jump_port), 'username': jump_username, 'timeout': 30}
        if jump_password:
            jump_kwargs['password'] = jump_password
        if jump_key_path:
            jump_kwargs['key_filename'] = jump_key_path
        logger.info(f"Connecting to jump host: {jump_host}:{jump_port}")
        jump_client.connect(**jump_kwargs)
        # 建立到目标host:port的隧道（此时尚不知道目标，先返回jump_client）
        return jump_client

    def create_session(self, host, port, username, password=None, key_path=None, device_type='generic',
                       jump_host=None, jump_port=22, jump_username=None, jump_password=None, jump_key_path=None):
        session_id = f"ssh_{int(time.time()*1000)}_{abs(hash(host))%10000}"
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        kwargs = {'hostname': host, 'port': int(port), 'username': username, 'timeout': 30}

        if password:
            kwargs['password'] = password
        if key_path:
            kwargs['key_filename'] = key_path

        jump_client = None
        # 跳板机模式：先连接跳板机，通过跳板机的Transport建立到目标设备的隧道
        if jump_host:
            jump_port = int(jump_port or 22)
            jump_username = jump_username or username
            jump_client = paramiko.SSHClient()
            jump_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            jump_kwargs = {'hostname': jump_host, 'port': jump_port, 'username': jump_username, 'timeout': 30}
            if jump_password:
                jump_kwargs['password'] = jump_password
            if jump_key_path:
                jump_kwargs['key_filename'] = jump_key_path
            logger.info(f"Connecting to jump host: {jump_host}:{jump_port}")
            jump_client.connect(**jump_kwargs)
            # 通过跳板机的Transport创建到目标设备的隧道
            jump_transport = jump_client.get_transport()
            dest_addr = (host, int(port))
            local_addr = ('127.0.0.1', 0)
            tunnel_sock = jump_transport.open_channel('direct-tcpip', dest_addr, local_addr, timeout=30)
            # 用隧道sock连接目标设备
            kwargs['sock'] = tunnel_sock
            logger.info(f"Tunnel established: {jump_host}:{jump_port} -> {host}:{port}")

        client.connect(**kwargs)
        channel = client.invoke_shell()
        channel.settimeout(30)
        time.sleep(1)
        while channel.recv_ready():
            channel.recv(4096)
        with self.lock:
            self.sessions[session_id] = {
                'client': client, 'channel': channel,
                'host': host, 'port': int(port), 'username': username,
                'password': password, 'key_path': key_path,
                'device_type': device_type, 'created_at': time.time(),
                'last_activity': time.time(), 'reconnect_count': 0,
                'command_history': [],
                # 跳板机信息（用于reconnect）
                'jump_host': jump_host, 'jump_port': int(jump_port or 22),
                'jump_username': jump_username,
                'jump_password': jump_password, 'jump_key_path': jump_key_path,
                'jump_client': jump_client,
            }
        logger.info(f"Session created: {session_id} -> {host}:{port}" + (f" via jump {jump_host}" if jump_host else ""))
        return session_id

    def execute(self, session_id, command, timeout=30):
        session = self._get_session(session_id)
        if not session:
            return {'status': 'error', 'error_type': 'session_not_found', 'error': f'Session {session_id} not found'}
        try:
            channel = session['channel']
            if channel is None or session['client'] is None:
                return {'status': 'error', 'error_type': 'connection_lost', 'error': 'Session channel closed'}
            while channel.recv_ready():
                channel.recv(65536)
            channel.send(command + '\n')
            output = self._read_until_prompt(channel, timeout, session['device_type'])
            session['last_activity'] = time.time()
            session['command_history'].append({'command': command, 'timestamp': time.time()})
            return {'status': 'success', 'stdout': output, 'stderr': '', 'exit_code': 0}
        except socket.timeout:
            return {'status': 'error', 'error_type': 'timeout', 'error': f'Timed out after {timeout}s'}
        except (paramiko.SSHException, socket.error, EOFError) as e:
            logger.warning(f"Session {session_id} lost: {e}")
            with self.lock:
                if session_id in self.sessions:
                    self.sessions[session_id]['channel'] = None
                    self.sessions[session_id]['client'] = None
            return {'status': 'error', 'error_type': 'connection_lost', 'error': str(e)}

    def execute_batch(self, session_id, commands, timeout=30):
        results = []
        for cmd in commands:
            r = self.execute(session_id, cmd, timeout)
            results.append({'command': cmd, 'stdout': r.get('stdout', ''), 'stderr': r.get('stderr', ''), 'exit_code': r.get('exit_code', -1), 'status': r.get('status', 'error')})
            if r.get('status') == 'error' and r.get('error_type') == 'connection_lost':
                break
        return {'status': 'success', 'results': results}

    def reconnect(self, session_id):
        session = self._get_session(session_id)
        if not session:
            return {'status': 'error', 'error': f'Session {session_id} not found'}
        try:
            # 关闭旧连接
            if session['channel']:
                try: session['channel'].close()
                except Exception: pass
            if session['client']:
                try: session['client'].close()
                except Exception: pass
            if session.get('jump_client'):
                try: session['jump_client'].close()
                except Exception: pass

            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            kwargs = {'hostname': session['host'], 'port': session['port'], 'username': session['username'], 'timeout': 30}
            if session['password']:
                kwargs['password'] = session['password']
            if session['key_path']:
                kwargs['key_filename'] = session['key_path']

            # 跳板机模式：重新建立隧道
            jump_client = None
            if session.get('jump_host'):
                jump_client = paramiko.SSHClient()
                jump_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                jump_kwargs = {'hostname': session['jump_host'], 'port': session['jump_port'],
                               'username': session['jump_username'], 'timeout': 30}
                if session.get('jump_password'):
                    jump_kwargs['password'] = session['jump_password']
                if session.get('jump_key_path'):
                    jump_kwargs['key_filename'] = session['jump_key_path']
                logger.info(f"Reconnecting via jump host: {session['jump_host']}")
                jump_client.connect(**jump_kwargs)
                jump_transport = jump_client.get_transport()
                dest_addr = (session['host'], session['port'])
                local_addr = ('127.0.0.1', 0)
                tunnel_sock = jump_transport.open_channel('direct-tcpip', dest_addr, local_addr, timeout=30)
                kwargs['sock'] = tunnel_sock

            client.connect(**kwargs)
            channel = client.invoke_shell()
            channel.settimeout(30)
            time.sleep(1)
            while channel.recv_ready():
                channel.recv(4096)
            with self.lock:
                self.sessions[session_id]['client'] = client
                self.sessions[session_id]['channel'] = channel
                self.sessions[session_id]['jump_client'] = jump_client
                self.sessions[session_id]['reconnect_count'] += 1
                self.sessions[session_id]['last_activity'] = time.time()
            logger.info(f"Session {session_id} reconnected (count={self.sessions[session_id]['reconnect_count']})")
            return {'status': 'success', 'session_id': session_id, 'reconnect_count': self.sessions[session_id]['reconnect_count']}
        except Exception as e:
            return {'status': 'error', 'error': f'Reconnect failed: {str(e)}'}

    def take_snapshot(self, session_id):
        snapshot = {}
        for cmd in ['show running-config', 'show interface', 'show version']:
            r = self.execute(session_id, cmd, timeout=15)
            snapshot[cmd] = r.get('stdout', '')
        return {'status': 'success', 'snapshot': snapshot}

    def close_session(self, session_id):
        with self.lock:
            session = self.sessions.pop(session_id, None)
        if session:
            try:
                if session.get('channel'):
                    session['channel'].close()
                if session.get('client'):
                    session['client'].close()
                # 关闭跳板机连接
                if session.get('jump_client'):
                    session['jump_client'].close()
            except Exception:
                pass
            return {'status': 'success'}
        return {'status': 'error', 'error': f'Session {session_id} not found'}

    def _get_session(self, session_id):
        with self.lock:
            return self.sessions.get(session_id)

    def _read_until_prompt(self, channel, timeout, device_type):
        output = ''
        start = time.time()
        prompts = {
            'cisco': [r'\w+\(config[^)]*\)#\s*$', r'\w+>\s*$', r'\w+#\s*$'],
            'huawei': [r'<\w+>\s*$', r'\[\w+\]\s*$'],
            'linux': [r'\$\s*$', r'#\s*$'],
            'generic': [r'#\s*$', r'\$\s*$', r'>\s*$'],
        }
        patterns = prompts.get(device_type, prompts['generic'])
        while True:
            if time.time() - start > timeout:
                if output.strip():
                    break
                raise socket.timeout()
            readable, _, _ = select.select([channel], [], [], 0.1)
            if readable:
                try:
                    data = channel.recv(65536).decode('utf-8', errors='replace')
                    output += data
                    lines = output.strip().split('\n')
                    if lines:
                        last = lines[-1].strip()
                        for p in patterns:
                            if re.search(p, last):
                                return output
                except Exception:
                    break
            else:
                if output.strip() and time.time() - start > 1:
                    break
        return output


manager = SSHSessionManager()


def main():
    input_data = sys.stdin.read()
    req = json.loads(input_data)
    action = req.get('action')

    if action == 'create_session':
        sid = manager.create_session(
            req['host'], req.get('port', 22), req['username'],
            req.get('password'), req.get('key_path'), req.get('device_type', 'generic'),
            jump_host=req.get('jump_host'),
            jump_port=req.get('jump_port', 22),
            jump_username=req.get('jump_username'),
            jump_password=req.get('jump_password'),
            jump_key_path=req.get('jump_key_path'),
        )
        print(json.dumps({'status': 'success', 'session_id': sid}))
    elif action == 'execute':
        result = manager.execute(req['session_id'], req['command'], req.get('timeout', 30))
        print(json.dumps(result))
    elif action == 'execute_batch':
        result = manager.execute_batch(req['session_id'], req['commands'], req.get('timeout', 30))
        print(json.dumps(result))
    elif action == 'reconnect':
        result = manager.reconnect(req['session_id'])
        print(json.dumps(result))
    elif action == 'take_snapshot':
        result = manager.take_snapshot(req['session_id'])
        print(json.dumps(result))
    elif action == 'close_session':
        result = manager.close_session(req['session_id'])
        print(json.dumps(result))
    else:
        print(json.dumps({'status': 'error', 'error': f'Unknown action: {action}'}))


if __name__ == '__main__':
    main()
