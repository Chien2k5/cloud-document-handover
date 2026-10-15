"""Run the packaged JAR on an EMPTY disposable PostgreSQL DB, then stop the JAR.

Requires DB_URL / DB_USERNAME / DB_PASSWORD, Java on PATH, and a built target JAR.
Creates four local demo users and two projects. Never use a shared/production DB.
Only status/summary output is retained; password/cookies/tokens are not printed.
"""
import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request


class Client:
    def __init__(self, base):
        self.base = base
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
        self.csrf = None
        self.checks = 0

    def request(self, method, path, expected, payload=None, form=False, token=None):
        headers = {}
        data = None
        if payload is not None:
            data = urllib.parse.urlencode(payload).encode() if form else json.dumps(payload).encode()
            headers['Content-Type'] = 'application/x-www-form-urlencoded' if form else 'application/json'
        if token is not None:
            headers['X-CSRF-TOKEN'] = token
        request = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            response = self.opener.open(request, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            body = response.read()
            assert response.status == expected, f'{method} {path}: expected {expected}, got {response.status}'
            assert response.headers.get('X-Request-Id'), 'Missing request correlation header'
            parsed = json.loads(body) if body else None
            if expected >= 400:
                assert {'code','message','requestId'} <= parsed.keys(), 'Error envelope missing fields'
                assert parsed['requestId'] == response.headers['X-Request-Id']
            self.checks += 1
            print(f'PASS {method} {path.split("?")[0]} -> {expected}')
            return parsed

    def session_id(self):
        return next((c.value for c in self.cookies if c.name == 'JSESSIONID'), None)

    def login(self, name, password):
        self.csrf = self.request('GET','/auth/csrf',200)['token']
        previous_session = self.session_id()
        previous_csrf = self.csrf
        user = self.request('POST','/auth/login',200,{'email':name+'@example.test','password':password},True,self.csrf)
        assert self.session_id() != previous_session, 'Session fixation protection did not rotate ID'
        assert set(user) == {'id','email','displayName'}, 'Unexpected account fields'
        self.csrf = self.request('GET','/auth/csrf',200)['token']
        self.request('POST','/projects',403,{'name':'Must not be created'},token=previous_csrf)
        return user


def run():
    backend = Path(__file__).resolve().parents[1]
    for name in ('DB_URL','DB_USERNAME','DB_PASSWORD'):
        if name not in os.environ:
            raise RuntimeError(f'{name} must be set for a disposable empty PostgreSQL database')
    port = int(os.environ.get('SMOKE_PORT','18080'))
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', port))
    password = secrets.token_urlsafe(24)
    env = os.environ.copy()
    env.update(SPRING_PROFILES_ACTIVE='local', LOCAL_DEMO_PASSWORD=password,
               SERVER_PORT=str(port), SESSION_COOKIE_SECURE='false')
    logs = backend/'target'/'http-smoke-server.log'
    base = f'http://127.0.0.1:{port}/api/v1'
    process = None
    try:
        with logs.open('w',encoding='utf-8') as output:
            process = subprocess.Popen(['java','-jar',str(backend/'target/document-handover-0.1.0-SNAPSHOT.jar')],
                                       cwd=backend, env=env, stdout=output, stderr=subprocess.STDOUT,
                                       creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
            deadline = time.monotonic()+45
            while True:
                if process.poll() is not None:
                    raise RuntimeError('JAR exited before readiness; inspect target/http-smoke-server.log')
                try:
                    with urllib.request.urlopen(base+'/health',timeout=1) as response:
                        if response.status==200: break
                except (urllib.error.URLError, TimeoutError):
                    pass
                if time.monotonic()>deadline:
                    raise RuntimeError('Readiness timeout; inspect target/http-smoke-server.log')
                time.sleep(0.25)
            owner,editor,viewer,outsider = [Client(base) for _ in range(4)]
            owner.request('GET','/health',200)
            owner.request('GET','/auth/me',401)
            csrf = owner.request('GET','/auth/csrf',200)['token']
            owner.request('POST','/auth/login',401,{'email':'dung@example.test','password':'invalid'},True,csrf)
            people = [c.login(n,password) for c,n in zip((owner,editor,viewer,outsider),('dung','editor','viewer','outsider'))]
            owner.request('GET','/auth/me',200)
            project = owner.request('POST','/projects',201,{'name':'HTTP smoke A'},token=owner.csrf)['id']
            other = outsider.request('POST','/projects',201,{'name':'HTTP smoke B'},token=outsider.csrf)['id']
            owner.request('GET','/projects/'+project,200)
            outsider.request('GET','/projects/'+project,404)
            owner.request('GET','/projects/'+other,404)
            listing = owner.request('GET','/projects',200)
            assert len(listing['items']) == 1
            for person,role in ((people[1],'EDITOR'),(people[2],'VIEWER')):
                owner.request('PUT',f'/projects/{project}/members/'+person['id'],200,{'role':role},token=owner.csrf)
            for client in (editor,viewer):
                client.request('GET','/projects/'+project,200)
                client.request('PUT',f'/projects/{project}/members/'+people[3]['id'],403,{'role':'EDITOR'},token=client.csrf)
            owner.request('DELETE',f'/projects/{project}/members/'+people[0]['id'],409,token=owner.csrf)
            owner.request('POST','/projects',400,{'name':'','role':'OWNER'},token=owner.csrf)
            owner.request('POST','/projects',403,{'name':'No CSRF'})
            owner.request('DELETE',f'/projects/{project}/members/'+people[2]['id'],204,token=owner.csrf)
            viewer.request('GET','/projects/'+project,404)
            owner.request('POST',f'/projects/{project}/files/uploads',404,{},token=owner.csrf)
            owner.request('POST','/auth/logout',204,token=owner.csrf)
            owner.request('GET','/auth/me',401)
            print(json.dumps({'status':'PASS','httpChecks':sum(c.checks for c in (owner,editor,viewer,outsider)),
                              'sessionIdRotation':True,'staleCsrfRejected':True,'secretsRetained':False}))
    finally:
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


if __name__ == '__main__':
    run()
